import type { InputSubmissionDraft } from "@earendil-works/pi-durable";
import { dueTimers, type Timer, timerInput } from "./timers.ts";

export const TICK_MS = 10_000;

export type WakeLoop = {
	timers(): Promise<readonly Timer[]>;
	submit(input: InputSubmissionDraft): Promise<unknown>;
	advance(fired: readonly Timer[], now: number): Promise<unknown>;
	now(): number;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
	print(line: string): void;
	warn(line: string): void;
};

/** Every TICK_MS until `signal` aborts, wakes the bot for each due timer, then moves those timers on. */
export async function wakeForTimers(loop: WakeLoop, signal: AbortSignal): Promise<void> {
	while (!signal.aborted) {
		try {
			const now = loop.now();
			const due = dueTimers(await loop.timers(), now);
			for (const timer of due) {
				await loop.submit(timerInput(timer, now));
				loop.print(`< timer #${timer.id}`);
			}
			if (due.length > 0) await loop.advance(due, now);
		} catch (error) {
			loop.warn(`! timers: ${error}; retrying in ${TICK_MS / 1000}s`);
		}
		await loop.sleep(TICK_MS, signal);
	}
}
