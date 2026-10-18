export type Scope = { kind: "channel"; name: string } | { kind: "dm"; partner: string };

type Subcommand = {
	/** Positional arguments in clap's order; the target is always the first. */
	positionals: string[];
	/** Each long flag louro accepts, and whether it takes a value. */
	flags: Record<string, boolean>;
	/** Only reads, so a DM conversation may point it at any channel too. */
	reads: boolean;
};

// From louro's clap definitions (src/socket.rs, src/commands/send.rs, HistoryQuery in src/irc.rs).
const SUBCOMMANDS: Record<string, Subcommand> = {
	send: {
		positionals: ["target", "text"],
		flags: { "--notice": false, "--action": false, "--reply-to": true },
		reads: false,
	},
	react: { positionals: ["target", "msgid", "reaction"], flags: { "--remove": false }, reads: false },
	redact: { positionals: ["target", "msgid"], flags: { "--reason": true }, reads: false },
	typing: { positionals: ["target", "state"], flags: {}, reads: false },
	history: {
		positionals: ["target"],
		flags: { "--latest": true, "--before": true, "--after": true },
		reads: true,
	},
	names: { positionals: ["channel"], flags: {}, reads: true },
};

const HELP = new Set(["help", "--help", "-h"]);

/** ASCII casemapping, as louro and Ergo use; folding more, like rfc1459's `[]\~`, would let `{luiz}` pass for `[luiz]`. */
export function casefold(name: string): string {
	return name.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

// IRC forbids spaces, commas and control characters in channel names; refuse them here too, not only in louro.
const isChannel = (target: string) => /^[#&][^,\s\p{Cc}]*$/u.test(target);

/** Finds the target the way clap would, refusing what the table doesn't know. */
function parseArgs(
	name: string,
	flags: Subcommand["flags"],
	args: string[],
): { help: boolean; target?: string | undefined } | string {
	const found: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === "--") {
			found.push(...args.slice(i + 1));
			break;
		}
		if (arg === "--help" || arg === "-h") return { help: true };
		if (!arg.startsWith("-") || arg === "-") {
			found.push(arg);
			continue;
		}
		const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
		const flag = equals < 0 ? arg : arg.slice(0, equals);
		const inline = equals < 0 ? undefined : arg.slice(equals + 1);
		const takesValue = flags[flag];
		if (takesValue === undefined) return `louro ${name} has no ${flag} flag`;
		if (!takesValue && inline !== undefined) return `${flag} takes no value`;
		if (takesValue && inline === undefined) {
			const value = args[++i];
			if (value === undefined || value.startsWith("-")) return `${flag} needs a value; write ${flag}=VALUE`;
		}
	}
	return { help: false, target: found[0] };
}

function describe(scope: Scope): string {
	return scope.kind === "channel" ? scope.name : `your DMs with ${scope.partner}`;
}

/** Returns why `args` (louro's argv) reaches beyond this conversation's target, or undefined if it doesn't. */
export function checkTarget(scope: Scope, args: string[]): string | undefined {
	const [name = "help", ...rest] = args;
	if (HELP.has(name) || name === "status") return undefined;
	const subcommand = Object.hasOwn(SUBCOMMANDS, name) ? SUBCOMMANDS[name] : undefined;
	if (!subcommand) return `louro ${name} is not allowed`;
	const parsed = parseArgs(name, subcommand.flags, rest);
	if (typeof parsed === "string") return parsed;
	if (parsed.help) return undefined;
	const { target } = parsed;
	if (target === undefined) return `louro ${name} needs a ${subcommand.positionals[0]}`;
	const own = scope.kind === "channel" ? scope.name : scope.partner;
	if (casefold(target) === casefold(own)) return undefined;
	if (scope.kind === "dm" && subcommand.reads && isChannel(target)) return undefined;
	const reach = scope.kind === "dm" ? `${own} (history and names may also read a channel)` : own;
	return `this conversation is ${describe(scope)}: louro ${name} may only target ${reach} here, not ${target}`;
}
