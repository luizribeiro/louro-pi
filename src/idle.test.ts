import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE_MS, IDLE_TICK_MS, type IdleLoop, idleCompaction } from "./idle.ts";

const START = Date.parse("2026-10-31T12:00:00.000Z");

type Tick = { at: number; touch?: boolean; failCompact?: boolean; touchWhileCompacting?: boolean };

/** Runs one tick per entry of `ticks`, at its time, touching first when asked; records every call. */
function harness(ticks: Tick[], { aborted = false } = {}) {
	const controller = new AbortController();
	if (aborted) controller.abort();
	const calls: string[] = [];
	let clock = START;
	let tick: Tick | undefined;
	const advance = () => {
		tick = ticks.shift();
		if (tick === undefined) return controller.abort();
		clock = tick.at;
		if (tick.touch) idle.touch();
	};
	const loop: IdleLoop = {
		async compact() {
			calls.push(`compact at +${(clock - START) / 60_000}m`);
			if (tick?.touchWhileCompacting) idle.touch();
			if (tick?.failCompact) throw new Error("SQLITE_BUSY: database is locked");
		},
		now: () => clock,
		async sleep(ms) {
			calls.push(`sleep ${ms}`);
			advance();
		},
		warn: (line) => calls.push(line),
	};
	const idle = idleCompaction(loop);
	return {
		calls,
		run: () => {
			advance();
			return idle.run(controller.signal);
		},
	};
}

const minutes = (count: number) => START + count * 60_000;
const sleep = `sleep ${IDLE_TICK_MS}`;

test("compacts once after an hour without activity, not again until something happens", async () => {
	const loop = harness([{ at: minutes(59) }, { at: minutes(60) }, { at: minutes(61) }, { at: minutes(300) }]);
	await loop.run();
	assert.deepEqual(loop.calls, [sleep, "compact at +60m", sleep, sleep, sleep]);
});

test("activity pushes the hour back", async () => {
	const loop = harness([{ at: minutes(50), touch: true }, { at: minutes(100) }, { at: minutes(110) }]);
	await loop.run();
	assert.deepEqual(loop.calls, [sleep, sleep, "compact at +110m", sleep]);
});

test("compacts again after the next quiet hour", async () => {
	const loop = harness([{ at: minutes(60) }, { at: minutes(70), touch: true }, { at: minutes(130) }]);
	await loop.run();
	assert.deepEqual(loop.calls, ["compact at +60m", sleep, sleep, "compact at +130m", sleep]);
});

test("a failed compaction warns and tries again next tick", async () => {
	const loop = harness([{ at: minutes(60), failCompact: true }, { at: minutes(61) }]);
	await loop.run();
	assert.deepEqual(loop.calls, [
		"compact at +60m",
		`! idle compaction: Error: SQLITE_BUSY: database is locked; retrying in ${IDLE_TICK_MS / 1000}s`,
		sleep,
		"compact at +61m",
		sleep,
	]);
});

test("activity while a compaction is starting still earns a compaction after the next quiet hour", async () => {
	const loop = harness([{ at: minutes(60), touchWhileCompacting: true }, { at: minutes(119) }, { at: minutes(120) }]);
	await loop.run();
	assert.deepEqual(loop.calls, ["compact at +60m", sleep, sleep, "compact at +120m", sleep]);
});

test("activity after a failed compaction restarts the hour", async () => {
	const loop = harness([
		{ at: minutes(60), failCompact: true },
		{ at: minutes(61), touch: true },
		{ at: minutes(121) },
	]);
	await loop.run();
	assert.deepEqual(loop.calls, [
		"compact at +60m",
		`! idle compaction: Error: SQLITE_BUSY: database is locked; retrying in ${IDLE_TICK_MS / 1000}s`,
		sleep,
		sleep,
		"compact at +121m",
		sleep,
	]);
});

test("stops at once when shutdown has begun", async () => {
	const loop = harness([{ at: START + IDLE_MS }], { aborted: true });
	await loop.run();
	assert.deepEqual(loop.calls, []);
});
