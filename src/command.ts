// The commands an agent needs; `connect` and `quit` are the operator's.
const ALLOWED_SUBCOMMANDS = new Set([
	"status",
	"wait",
	"send",
	"react",
	"redact",
	"typing",
	"history",
	"names",
	"help",
	"--help",
	"-h",
]);

const SHELL_OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "$", "`", "\n"]);

/** Splits a command line into argv with sh quoting, and rejects anything a shell would do more with. */
export function parseCommand(line: string): string[] {
	const words: string[] = [];
	let word = "";
	let inWord = false;
	let quote: "'" | '"' | undefined;

	for (let i = 0; i < line.length; i++) {
		const char = line.charAt(i);
		if (quote === "'") {
			if (char === "'") quote = undefined;
			else word += char;
		} else if (quote === '"') {
			if (char === '"') quote = undefined;
			else if (char === "\\" && i + 1 < line.length && '"\\$`'.includes(line.charAt(i + 1))) word += line.charAt(++i);
			else if (char === "$" || char === "`") throw new Error(`${char} is not allowed; escape it as \\${char}`);
			else word += char;
		} else if (char === " " || char === "\t") {
			if (inWord) words.push(word);
			word = "";
			inWord = false;
		} else if (SHELL_OPERATORS.has(char)) {
			throw new Error(
				`${JSON.stringify(char)} is not allowed: this runs one louro command, not a shell; quote it if it's text`,
			);
		} else {
			inWord = true;
			if (char === "'" || char === '"') quote = char;
			else if (char === "\\" && i + 1 < line.length) word += line.charAt(++i);
			else word += char;
		}
	}
	if (quote) throw new Error(`unterminated ${quote} quote`);
	if (inWord) words.push(word);

	if (words[0] !== "louro") throw new Error("only louro commands are allowed, e.g. louro status");
	if (!ALLOWED_SUBCOMMANDS.has(words[1] ?? "--help")) {
		throw new Error(`louro ${words[1]} is not allowed; use one of: ${[...ALLOWED_SUBCOMMANDS].join(", ")}`);
	}
	if (words.some((word) => word === "--socket" || word.startsWith("--socket="))) {
		throw new Error("--socket is not allowed");
	}
	return words.slice(1);
}

type ExecError = { code?: number | string | null; signal?: NodeJS.Signals | null; message: string };

/** One status line, then louro's stdout and stderr; a timeout or abort shows as `killed:SIGNAL`. */
export function formatResult(error: ExecError | null, stdout: string, stderr: string): string {
	const code = !error
		? 0
		: typeof error.code === "number"
			? error.code
			: (error.code ?? (error.signal ? `killed:${error.signal}` : error.message));
	return [`exit: ${code}`, stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}
