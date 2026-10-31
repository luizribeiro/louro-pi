import assert from "node:assert/strict";
import { test } from "node:test";
import { everyTick } from "./tick.ts";

/** Runs `outcomes.length` ticks, each succeeding or throwing its error, recording every call. */
async function ticks(outcomes: (Error | undefined)[], { aborted = false } = {}) {
	const controller = new AbortController();
	if (aborted) controller.abort();
	const calls: string[] = [];
	let left = outcomes.length;
	await everyTick(
		"digest",
		30_000,
		async () => {
			const outcome = outcomes.shift();
			calls.push("tick");
			if (outcome) throw outcome;
		},
		{
			async sleep(ms) {
				calls.push(`sleep ${ms}`);
				if (--left === 0) controller.abort();
			},
			warn: (line) => calls.push(line),
		},
		controller.signal,
	);
	return calls;
}

test("ticks, then sleeps, until shutdown", async () => {
	assert.deepEqual(await ticks([undefined, undefined]), ["tick", "sleep 30000", "tick", "sleep 30000"]);
});

test("a tick that throws warns, and the next tick still runs", async () => {
	assert.deepEqual(await ticks([new Error("ECONNRESET"), undefined]), [
		"tick",
		"! digest: Error: ECONNRESET; retrying in 30s",
		"sleep 30000",
		"tick",
		"sleep 30000",
	]);
});

test("never ticks once shutdown has begun", async () => {
	assert.deepEqual(await ticks([undefined], { aborted: true }), []);
});
