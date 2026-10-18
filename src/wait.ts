import type { InputSubmissionDraft } from "@earendil-works/pi-durable";
import { formatResult } from "./command.ts";
import type { LouroResult } from "./louro.ts";
import { formatBatch } from "./view.ts";

export const WAIT_ARGS = ["wait", "--timeout", "60"];
const BACKOFF_MS = 5_000;

type Batch = { notice?: string; events: unknown[] };

export type WaitStep =
	| { kind: "submit"; input: InputSubmissionDraft; count: number }
	| { kind: "idle" }
	| { kind: "backoff"; reason: string };

/** What to do with one `louro wait`; after a submit or an idle batch, wait again at once, `more` or not. */
export function nextStep({ error, stdout, stderr }: LouroResult, newId: () => string): WaitStep {
	if (error) return { kind: "backoff", reason: formatResult(error, stdout, stderr).replaceAll("\n", " ") };
	let batch: Batch | null;
	try {
		batch = JSON.parse(stdout);
	} catch {
		return { kind: "backoff", reason: `unreadable wait output: ${stdout.trim()}` };
	}
	if (!Array.isArray(batch?.events)) return { kind: "backoff", reason: `wait output has no events: ${stdout.trim()}` };
	if (batch.events.length === 0) return { kind: "idle" };
	return {
		kind: "submit",
		count: batch.events.length,
		input: {
			type: "input",
			content: JSON.stringify({ notice: batch.notice, events: batch.events }),
			// Unique per batch: louro restarts its cursor at 0, and pi-durable silently drops a request id it has seen.
			requestId: `louro-wait-${newId()}`,
			whenBusy: "followUp",
		},
	};
}

export type WaitLoop = {
	wait(signal: AbortSignal): Promise<LouroResult>;
	newId(): string;
	submit(input: InputSubmissionDraft): Promise<unknown>;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
	print(line: string): void;
	warn(line: string): void;
};

/** Forwards every louro batch to the conversation until `signal` aborts. */
export async function forwardEvents(loop: WaitLoop, signal: AbortSignal): Promise<void> {
	const backOff = async (reason: string) => {
		loop.warn(`! ${reason}; retrying in ${BACKOFF_MS / 1000}s`);
		await loop.sleep(BACKOFF_MS, signal);
	};
	// louro moved its cursor when wait returned, so a batch it handed over must be admitted before waiting again.
	const submitUntilAdmitted = async (input: InputSubmissionDraft) => {
		for (;;) {
			try {
				await loop.submit(input);
				return;
			} catch (error) {
				if (signal.aborted) return;
				await backOff(`submit failed: ${error}`);
			}
		}
	};
	while (!signal.aborted) {
		const step = nextStep(await loop.wait(signal), loop.newId);
		if (step.kind === "submit") {
			loop.print(formatBatch(step.count));
			await submitUntilAdmitted(step.input);
		} else if (signal.aborted) {
			return;
		} else if (step.kind === "backoff") {
			await backOff(`louro wait: ${step.reason}`);
		}
	}
}
