import assert from "node:assert/strict";
import { test } from "node:test";
import type { Timer } from "./timers.ts";
import { TICK_MS, type WakeLoop, wakeForTimers } from "./wake.ts";

const NOW = Date.parse("2026-10-31T12:00:05.000Z");

const DIGEST: Timer = {
	id: 1,
	note: "post the #lounge digest to luiz",
	due: "2026-10-31T12:00:00.000Z",
	every: 86_400,
};
const STANDUP: Timer = { id: 2, note: "ask #bots how the ergo upgrade went", due: "2026-10-31T11:58:00.000Z" };
const LATER: Timer = { id: 3, note: "check maria's build", due: "2026-10-31T13:00:00.000Z" };

type Tick = { timers: readonly Timer[] | Error; failSubmit?: number; failAdvance?: boolean };

/** Runs one tick per entry of `ticks`, recording every call; a tick may fail reading, one submit, or advancing. */
function harness(ticks: Tick[], { aborted = false } = {}) {
	const controller = new AbortController();
	if (aborted) controller.abort();
	const calls: string[] = [];
	let tick: Tick | undefined;
	const loop: WakeLoop = {
		async timers() {
			tick = ticks.shift();
			if (tick?.timers instanceof Error) throw tick.timers;
			return tick?.timers ?? [];
		},
		async submit(input) {
			calls.push(`submit ${input.requestId}`);
			if (tick?.failSubmit !== undefined && input.requestId?.startsWith(`louro-timer-${tick.failSubmit}-`)) {
				throw new Error("SQLITE_BUSY: database is locked");
			}
		},
		async advance(fired, now) {
			calls.push(`advance ${fired.map((timer) => timer.id).join(",")} at ${new Date(now).toISOString()}`);
			if (tick?.failAdvance) throw new Error("SQLITE_BUSY: database is locked");
		},
		now: () => NOW,
		async sleep(ms) {
			calls.push(`sleep ${ms}`);
			if (ticks.length === 0) controller.abort();
		},
		print: (line) => calls.push(line),
		warn: (line) => calls.push(line),
	};
	return { calls, run: () => wakeForTimers(loop, controller.signal) };
}

const busy = `! timers: Error: SQLITE_BUSY: database is locked; retrying in ${TICK_MS / 1000}s`;

test("wakes the bot for each due timer, then moves them on together", async () => {
	const loop = harness([{ timers: [DIGEST, STANDUP, LATER] }]);
	await loop.run();
	assert.deepEqual(loop.calls, [
		`submit louro-timer-1-${DIGEST.due}`,
		"< timer #1",
		`submit louro-timer-2-${STANDUP.due}`,
		"< timer #2",
		"advance 1,2 at 2026-10-31T12:00:05.000Z",
		`sleep ${TICK_MS}`,
	]);
});

test("a tick with nothing due only sleeps", async () => {
	const loop = harness([{ timers: [LATER] }, { timers: [] }]);
	await loop.run();
	assert.deepEqual(loop.calls, [`sleep ${TICK_MS}`, `sleep ${TICK_MS}`]);
});

test("a tick that can't read the timers warns and tries again next tick", async () => {
	const loop = harness([{ timers: new Error("storage closed") }, { timers: [STANDUP] }]);
	await loop.run();
	assert.deepEqual(loop.calls, [
		`! timers: Error: storage closed; retrying in ${TICK_MS / 1000}s`,
		`sleep ${TICK_MS}`,
		`submit louro-timer-2-${STANDUP.due}`,
		"< timer #2",
		"advance 2 at 2026-10-31T12:00:05.000Z",
		`sleep ${TICK_MS}`,
	]);
});

test("after a failed submit nothing moves on, and the next tick resubmits every due timer under the same ids", async () => {
	const loop = harness([{ timers: [DIGEST, STANDUP], failSubmit: 2 }, { timers: [DIGEST, STANDUP] }]);
	await loop.run();
	assert.deepEqual(loop.calls, [
		`submit louro-timer-1-${DIGEST.due}`,
		"< timer #1",
		`submit louro-timer-2-${STANDUP.due}`,
		busy,
		`sleep ${TICK_MS}`,
		`submit louro-timer-1-${DIGEST.due}`,
		"< timer #1",
		`submit louro-timer-2-${STANDUP.due}`,
		"< timer #2",
		"advance 1,2 at 2026-10-31T12:00:05.000Z",
		`sleep ${TICK_MS}`,
	]);
});

test("a failed advance warns, and the next tick resubmits under the same ids before moving on", async () => {
	const loop = harness([{ timers: [STANDUP], failAdvance: true }, { timers: [STANDUP] }]);
	await loop.run();
	assert.deepEqual(loop.calls, [
		`submit louro-timer-2-${STANDUP.due}`,
		"< timer #2",
		"advance 2 at 2026-10-31T12:00:05.000Z",
		busy,
		`sleep ${TICK_MS}`,
		`submit louro-timer-2-${STANDUP.due}`,
		"< timer #2",
		"advance 2 at 2026-10-31T12:00:05.000Z",
		`sleep ${TICK_MS}`,
	]);
});

test("stops at once when shutdown has begun", async () => {
	const loop = harness([{ timers: [DIGEST] }], { aborted: true });
	await loop.run();
	assert.deepEqual(loop.calls, []);
});
