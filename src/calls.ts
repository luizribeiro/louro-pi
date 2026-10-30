import type { Context } from "@earendil-works/chord/context";
import { LiveDoc, type ToolExecutionApi, type ToolExecutionResult } from "@earendil-works/pi-durable";

export const MAX_CALLS_PER_RUN = 8;
export const CALLS_BEFORE_ENDING_RUN = MAX_CALLS_PER_RUN + 4;
export const TOO_MANY_CALLS = "too many tool calls this turn; reply in text without tools";

export type CallVerdict = "run" | "refuse" | "end";

/** Counts a run's calls; past the cap they are refused, and a model that keeps calling gets its run ended. */
export function callCounter(): (run: string) => CallVerdict {
	let current = { run: "", calls: 0 };
	return (run) => {
		current = { run, calls: current.run === run ? current.calls + 1 : 1 };
		return current.calls <= MAX_CALLS_PER_RUN ? "run" : current.calls <= CALLS_BEFORE_ENDING_RUN ? "refuse" : "end";
	};
}

const countCall = callCounter();

export function failure(text: string): ToolExecutionResult {
	return { output: [{ type: "text", text }], isError: true };
}

/** Counts this call against its run, every tool together, and returns the refusal once the run is past the cap. */
export async function capCalls(api: ToolExecutionApi, context: Context): Promise<ToolExecutionResult | undefined> {
	// A run's first input names it; ending a run lets the queued chat start the next one.
	const live = await api.snapshot(LiveDoc, api.conversationId, context);
	const verdict = countCall(String(live?.run?.inputs[0]));
	if (verdict === "refuse") return failure(TOO_MANY_CALLS);
	if (verdict === "end") return { ...failure(TOO_MANY_CALLS), control: { terminate: true } };
	return undefined;
}
