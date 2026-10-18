import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, LiveDoc, section, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { formatResult, parseCommand } from "./command.ts";
import { Conversations, scopeOf } from "./conversations.ts";
import { runLouro } from "./louro.ts";
import { checkTarget } from "./target.ts";

const TIMEOUT_MS = 60_000;
export const MAX_CALLS_PER_RUN = 8;
export const CALLS_BEFORE_ENDING_RUN = MAX_CALLS_PER_RUN + 4;
export const TOO_MANY_CALLS = "too many louro calls this turn; reply in text without tools";

export type CallVerdict = "run" | "refuse" | "end";

/** Counts each conversation's calls per run; past the cap they are refused, and a model that keeps calling gets its run ended. */
export function callCounter(): (conversation: number, run: string) => CallVerdict {
	const current = new Map<number, { run: string; calls: number }>();
	return (conversation, run) => {
		const last = current.get(conversation);
		const calls = last?.run === run ? last.calls + 1 : 1;
		current.set(conversation, { run, calls });
		return calls <= MAX_CALLS_PER_RUN ? "run" : calls <= CALLS_BEFORE_ENDING_RUN ? "refuse" : "end";
	};
}

const countCall = callCounter();

function failure(text: string): ToolExecutionResult {
	return { output: [{ type: "text", text }], isError: true };
}

export const WAIT_NOTE =
	"You don't run `louro wait`: louro waits for you, and new IRC events arrive as messages. Reply with `louro send`.";

export const SCOPE_NOTE =
	"Each conversation is one IRC channel or one person's DMs, and the louro tool refuses commands aimed anywhere else.";

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
		// A run's first input names it; ending a run lets the queued chat start the next one.
		const live = await api.snapshot(LiveDoc, api.conversationId, context);
		const verdict = countCall(api.conversationId, String(live?.run?.inputs[0]));
		if (verdict === "refuse") return failure(TOO_MANY_CALLS);
		if (verdict === "end") return { ...failure(TOO_MANY_CALLS), control: { terminate: true } };
		let args: string[];
		try {
			args = parseCommand(command);
		} catch (error) {
			return failure((error as Error).message);
		}
		const scope = scopeOf(await api.snapshot(Conversations, context), api.conversationId);
		const refusal = scope ? checkTarget(scope, args) : "this conversation has no IRC channel or DM partner";
		if (refusal) return failure(refusal);
		const { error, stdout, stderr } = await runLouro(args, TIMEOUT_MS, context.abortSignal);
		return { output: [{ type: "text", text: formatResult(error, stdout, stderr) }], isError: error !== null };
	},
});

export function louroExtension(system: string, primer: string) {
	const prompt = [system.trim(), primer.trim(), WAIT_NOTE, SCOPE_NOTE].join("\n\n");
	return defineExtension({
		name: "louro",
		tools: [louroTool],
		sections: [section("prompt", () => prompt, { tag: false })],
	});
}
