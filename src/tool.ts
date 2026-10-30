import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { capCalls, failure } from "./calls.ts";
import { formatResult, parseCommand } from "./command.ts";
import { runLouro } from "./louro.ts";
import { memorySection, memoryTool } from "./memory.ts";

const TIMEOUT_MS = 60_000;
export const WAIT_NOTE =
	"You don't run `louro wait`: louro waits for you, and new IRC events arrive as messages. Reply with `louro send`.";

export const ROOM_NOTE =
	"You hear every channel you're in and your DMs here, as one conversation. Reply to channel chat in its `target` channel and to a DM by the sender's nick. You may speak only where `louro status` grants irc.send or irc.dm.send; everywhere else, just listen.";

export const louroTool = defineTool({
	name: "louro",
	description:
		"Run one louro command, written as you would type it in a shell: `louro status`, `louro send '#bots' 'hi'`. Quoting works like sh, but there is no shell: only louro runs, and pipes, redirects, `;`, `&&`, `$` and backticks are rejected unless quoted. `wait` is handled for you: new events arrive as messages. Returns the exit code, stdout (JSON) and stderr.",
	parameters: Type.Object({
		command: Type.String({
			description: "One louro command line, quoted like in sh, e.g. louro send '#bots' 'hi there'",
		}),
	}),
	async execute({ command }, api, context) {
		const capped = await capCalls(api, context);
		if (capped) return capped;
		let args: string[];
		try {
			args = parseCommand(command);
		} catch (error) {
			return failure((error as Error).message);
		}
		const { error, stdout, stderr } = await runLouro(args, TIMEOUT_MS, context.abortSignal);
		return { output: [{ type: "text", text: formatResult(error, stdout, stderr) }], isError: error !== null };
	},
});

export function louroExtension(system: string, primer: string) {
	const prompt = [system.trim(), primer.trim(), WAIT_NOTE, ROOM_NOTE].join("\n\n");
	return defineExtension({
		name: "louro",
		tools: [louroTool, memoryTool],
		sections: [section("prompt", () => prompt, { tag: false }), memorySection],
	});
}
