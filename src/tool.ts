import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { formatResult, parseCommand } from "./command.ts";
import { runLouro } from "./louro.ts";

const TIMEOUT_MS = 60_000;
export const MAX_COMMAND_LENGTH = 2000;

export const WAIT_NOTE =
	"You don't run `louro wait`: louro waits for you, and new IRC events arrive as messages. Reply with `louro send`.";

export const louroTool = defineTool({
	name: "louro",
	description:
		"Run one louro command, written as you would type it in a shell: `louro status`, `louro send '#bots' 'hi'`. Quoting works like sh, but there is no shell: only louro runs, and pipes, redirects, `;`, `&&`, `$` and backticks are rejected unless quoted. `wait` is handled for you: new events arrive as messages. Returns the exit code, stdout (JSON) and stderr.",
	parameters: Type.Object({
		command: Type.String({
			description: "One louro command line, quoted like in sh, e.g. louro send '#bots' 'hi there'",
		}),
	}),
	async execute({ command }, _api, context) {
		let args: string[];
		try {
			if (command.length > MAX_COMMAND_LENGTH) {
				throw new Error(`command is ${command.length} characters; the limit is ${MAX_COMMAND_LENGTH}`);
			}
			args = parseCommand(command);
		} catch (error) {
			return { output: [{ type: "text", text: (error as Error).message }], isError: true };
		}
		const { error, stdout, stderr } = await runLouro(args, TIMEOUT_MS, context.abortSignal);
		return { output: [{ type: "text", text: formatResult(error, stdout, stderr) }], isError: error !== null };
	},
});

export function louroExtension(system: string, primer: string) {
	const prompt = [system.trim(), primer.trim(), WAIT_NOTE].join("\n\n");
	return defineExtension({
		name: "louro",
		tools: [louroTool],
		sections: [section("prompt", () => prompt, { tag: false })],
	});
}
