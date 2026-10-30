import assert from "node:assert/strict";
import { test } from "node:test";
import { CALLS_BEFORE_ENDING_RUN, callCounter, MAX_CALLS_PER_RUN } from "./calls.ts";

test("allows 8 calls per run, refuses 4 more, then ends the run", () => {
	assert.equal(MAX_CALLS_PER_RUN, 8);
	assert.equal(CALLS_BEFORE_ENDING_RUN, 12);
	const count = callCounter();
	const verdicts = Array.from({ length: 14 }, () => count("run-1"));
	assert.deepEqual(verdicts, [...Array(8).fill("run"), ...Array(4).fill("refuse"), "end", "end"]);
	assert.equal(count("run-2"), "run");
	assert.equal(count("run-2"), "run");
});
