import { everyTick, type Ticker } from "./tick.ts";

export const IDLE_MS = 60 * 60_000;
export const IDLE_TICK_MS = 60_000;

export const IDLE_INSTRUCTIONS =
	"The chat went quiet for an hour. Keep what's still open, with the nicks it belongs to: questions you owe an answer, promises, follow-ups people asked for, and who is in the middle of what. Drop finished small talk. Your memory notes and timers are kept apart, so don't repeat them.";

export type IdleLoop = Ticker & {
	compact(): Promise<unknown>;
	now(): number;
};

/** Compacts the conversation once each time it goes IDLE_MS without a `touch`, so the next reply reads a short prompt. */
export function idleCompaction(loop: IdleLoop) {
	let lastActive = loop.now();
	let activity = 0;
	let compactedAt: number | undefined;
	const tick = async () => {
		if (compactedAt === activity || loop.now() - lastActive < IDLE_MS) return;
		const seen = activity;
		await loop.compact();
		compactedAt = seen;
	};
	return {
		touch() {
			lastActive = loop.now();
			activity++;
		},
		run: (signal: AbortSignal) => everyTick("idle compaction", IDLE_TICK_MS, tick, loop, signal),
	};
}
