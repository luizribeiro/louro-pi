import type { InputSubmissionDraft } from "@earendil-works/pi-durable";
import { everyTick, type Ticker } from "./tick.ts";
import { dueTimers, type Timer, timerInput } from "./timers.ts";

export const TICK_MS = 10_000;

export type WakeLoop = Ticker & {
	timers(): Promise<readonly Timer[]>;
	submit(input: InputSubmissionDraft): Promise<unknown>;
	advance(fired: readonly Timer[], now: number): Promise<unknown>;
	now(): number;
	print(line: string): void;
};

/** Every TICK_MS until `signal` aborts, wakes the bot for each due timer, then moves those timers on. */
export function wakeForTimers(loop: WakeLoop, signal: AbortSignal): Promise<void> {
	const tick = async () => {
		const now = loop.now();
		const due = dueTimers(await loop.timers(), now);
		for (const timer of due) {
			await loop.submit(timerInput(timer, now));
			loop.print(`< timer #${timer.id}`);
		}
		if (due.length > 0) await loop.advance(due, now);
	};
	return everyTick("timers", TICK_MS, tick, loop, signal);
}
