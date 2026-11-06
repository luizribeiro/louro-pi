import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_WEB_CALLS_PER_DAY, spendWebCall } from "./web.ts";

const morning = new Date("2026-11-06T09:30:00Z");

test("a call counts against today's budget", () => {
	const budget = { day: "2026-11-06", calls: 41 };
	spendWebCall(budget, morning);
	assert.deepEqual(budget, { day: "2026-11-06", calls: 42 });
});

test("the first call ever starts today's count", () => {
	const budget = { day: "", calls: 0 };
	spendWebCall(budget, morning);
	assert.deepEqual(budget, { day: "2026-11-06", calls: 1 });
});

test("a new UTC day starts the count over, even from a spent budget", () => {
	const budget = { day: "2026-11-05", calls: MAX_WEB_CALLS_PER_DAY };
	spendWebCall(budget, new Date("2026-11-06T00:00:01Z"));
	assert.deepEqual(budget, { day: "2026-11-06", calls: 1 });
});

test("a spent budget refuses the call and counts nothing", () => {
	const budget = { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY };
	assert.throws(() => spendWebCall(budget, morning), /budget of 100 calls a day is spent; it resets at 00:00 UTC/);
	assert.deepEqual(budget, { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY });
});

test("the last call of the day still goes through", () => {
	const budget = { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY - 1 };
	spendWebCall(budget, morning);
	assert.equal(budget.calls, MAX_WEB_CALLS_PER_DAY);
});
