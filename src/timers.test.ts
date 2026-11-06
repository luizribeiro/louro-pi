import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness, PromptInput } from "@earendil-works/pi-durable";
import { inNewRun, openHarness } from "./fixtures.ts";
import {
	advanceTimers,
	dueTimers,
	editTimers,
	formatDuration,
	MAX_TIMERS,
	parseDuration,
	renderTimers,
	TIMERS_HEADER,
	type Timer,
	Timers,
	timerInput,
	timersSection,
	timerTool,
} from "./timers.ts";

const NOW = Date.parse("2026-10-30T18:40:00.000Z");
const MINUTE = 60_000;
const at = (ms: number) => new Date(ms).toISOString();

const DIGEST: Timer = { id: 1, note: "post the #lounge digest to luiz", due: at(NOW + 60 * MINUTE), every: 86_400 };
const STANDUP: Timer = { id: 2, note: "ask #bots how the ergo upgrade went", due: at(NOW + 5 * MINUTE) };

const stateOf = (...timers: Timer[]) => ({ timers: structuredClone(timers), nextId: timers.length + 1 });

test("reads durations like 90s, 30m and 1d12h, and writes them back", () => {
	assert.equal(parseDuration("90s"), 90);
	assert.equal(parseDuration("30m"), 1_800);
	assert.equal(parseDuration(" 1d 12h "), 129_600);
	assert.equal(formatDuration(129_600), "1d12h");
	assert.equal(formatDuration(5_430), "1h30m30s");
	assert.equal(formatDuration(0), "0s");
	for (const text of ["", "soon", "30", "1.5h", "-5m", "30 minutes"]) {
		assert.throws(() => parseDuration(text), /can't read .* as a duration/, text);
	}
});

test("sets timers in a while, at a time, or repeating, under new ids", () => {
	const state = stateOf(DIGEST);
	const result = editTimers(
		state,
		{
			set: [
				{ note: "check  whether\nmaria's build passed", in: "45m" },
				{ note: "wish luiz a good morning", at: "2026-10-31T09:00:00-03:00", every: "1d" },
				{ note: "skim #lounge for questions", every: "6h" },
				{ note: "nudge luiz about the standup notes", in: "10m", every: "1h" },
			],
		},
		NOW,
	);
	assert.deepEqual(state.timers.slice(1), [
		{ id: 2, note: "check whether maria's build passed", due: at(NOW + 45 * MINUTE) },
		{ id: 3, note: "wish luiz a good morning", due: "2026-10-31T12:00:00.000Z", every: 86_400 },
		{ id: 4, note: "skim #lounge for questions", due: at(NOW + 360 * MINUTE), every: 21_600 },
		{ id: 5, note: "nudge luiz about the standup notes", due: at(NOW + 10 * MINUTE), every: 3_600 },
	]);
	assert.equal(state.nextId, 6);
	assert.equal(
		result,
		[
			`set #2 for ${at(NOW + 45 * MINUTE)}`,
			"set #3 for 2026-10-31T12:00:00.000Z",
			`set #4 for ${at(NOW + 360 * MINUTE)}`,
			`set #5 for ${at(NOW + 10 * MINUTE)}`,
		].join("\n"),
	);
});

test("reschedules by cancelling and setting in one edit, never reusing an id", () => {
	const state = stateOf(DIGEST, STANDUP);
	assert.equal(
		editTimers(state, { cancel: [2, 2], set: [{ note: STANDUP.note, in: "1h" }] }, NOW),
		`cancelled #2\nset #3 for ${at(NOW + 60 * MINUTE)}`,
	);
	assert.deepEqual(
		state.timers.map((timer) => timer.id),
		[1, 3],
	);
});

test("refuses a bad edit and changes nothing", () => {
	const many = Array.from({ length: MAX_TIMERS - 1 }, () => ({ note: "ping", in: "1h" }));
	const cases: [Parameters<typeof editTimers>[1], RegExp][] = [
		[{}, /give timers to set or timer ids to cancel/],
		[{ cancel: [7] }, /no timer #7/],
		[{ set: [{ note: "  ", in: "5m" }] }, /needs a note/],
		[{ set: [{ note: "x".repeat(301), in: "5m" }] }, /at most 300 characters/],
		[{ set: [{ note: "ping" }] }, /say when the timer fires/],
		[{ set: [{ note: "ping", in: "5m", at: "2026-10-31T09:00:00Z" }] }, /not both/],
		[{ set: [{ note: "ping", at: "tomorrow" }] }, /can't read "tomorrow" as a time/],
		[{ set: [{ note: "ping", at: "2026-10-31T09:00:00" }] }, /can't read .* as a time/],
		[{ set: [{ note: "ping", at: "2026-10-31" }] }, /can't read .* as a time/],
		[{ set: [{ note: "ping", at: "2027-02-31T09:00:00Z" }] }, /can't read .* as a time/],
		[{ set: [{ note: "ping", in: "99999999999d" }] }, /at most 366d away/],
		[{ set: [{ note: "ping", in: "1h", every: "400d" }] }, /at most 366d away/],
		[{ set: [{ note: "ping", at: "2028-01-01T00:00:00Z" }] }, /at most 366d away/],
		[{ set: [{ note: "ping", at: "2026-10-30T18:00:00Z" }] }, /already passed/],
		[{ set: [{ note: "ping", every: "1m" }] }, /at most every 5m/],
		[{ set: [{ note: "ping", in: "soon" }] }, /as a duration/],
		[{ set: [{ note: "fine", in: "5m" }, ...many] }, /at most 20 timers/],
	];
	for (const [edit, reason] of cases) {
		const state = stateOf(DIGEST, STANDUP);
		const before = structuredClone(state);
		assert.throws(() => editTimers(state, edit, NOW), reason, JSON.stringify(edit).slice(0, 80));
		assert.deepEqual(state, before);
	}
});

test("allows exactly the most timers", () => {
	const state = stateOf();
	editTimers(state, { set: Array.from({ length: MAX_TIMERS }, () => ({ note: "ping", in: "1h" })) }, NOW);
	assert.equal(state.timers.length, MAX_TIMERS);
});

test("a timer due right now fires, and a repeating one moves a whole period on", () => {
	const state = stateOf(DIGEST);
	const now = Date.parse(DIGEST.due);
	advanceTimers(state, dueTimers(state.timers, now), now);
	assert.deepEqual(state.timers, [{ ...DIGEST, due: at(now + 86_400_000) }]);
	assert.deepEqual(dueTimers(state.timers, now), []);
});

test("finds due timers, drops fired one-shots and moves repeating ones past now", () => {
	const late = NOW + 3 * 86_400_000 + 90 * MINUTE;
	const state = stateOf(DIGEST, STANDUP, { id: 3, note: "later", due: at(late + MINUTE) });
	const due = dueTimers(state.timers, late);
	assert.deepEqual(
		due.map((timer) => timer.id),
		[1, 2],
	);
	advanceTimers(state, due, late);
	assert.deepEqual(state.timers, [
		{ ...DIGEST, due: at(NOW + 4 * 86_400_000 + 60 * MINUTE) },
		{ id: 3, note: "later", due: at(late + MINUTE) },
	]);
});

test("leaves a timer the bot rescheduled while it was firing", () => {
	const state = stateOf(STANDUP);
	const fired = dueTimers(state.timers, NOW + 5 * MINUTE);
	const moved = { ...STANDUP, due: at(NOW + 30 * MINUTE) };
	state.timers = [moved];
	advanceTimers(state, fired, NOW + 5 * MINUTE);
	assert.deepEqual(state.timers, [moved]);
});

test("shows the timers in the prompt, or that there are none", () => {
	assert.equal(
		renderTimers([DIGEST, STANDUP]),
		`${TIMERS_HEADER}\n#1 ${DIGEST.due} every 1d: post the #lounge digest to luiz\n#2 ${STANDUP.due}: ask #bots how the ergo upgrade went`,
	);
	assert.equal(renderTimers([]), `${TIMERS_HEADER}\nYou have no timers set.`);
});

test("wakes the bot with a timer event whose request id names that firing", () => {
	assert.deepEqual(timerInput(DIGEST, NOW + 61 * MINUTE), {
		type: "input",
		content: JSON.stringify({
			events: [
				{
					type: "timer",
					id: 1,
					note: DIGEST.note,
					due: DIGEST.due,
					every: "1d",
					now: at(NOW + 61 * MINUTE),
				},
			],
		}),
		requestId: `louro-timer-1-${DIGEST.due}`,
		whenBusy: "followUp",
	});
	assert.equal(JSON.parse(String(timerInput(STANDUP, NOW).content)).events[0].every, undefined);
});

test("the tool keeps timers across restarts, and the prompt shows them", async () => {
	const path = join(await mkdtemp(join(tmpdir(), "louro-pi-timers-")), "louro.sqlite");
	const render = (harness: Harness) =>
		timersSection.render({ read: harness } as unknown as PromptInput, BACKGROUND_CONTEXT);
	let harness = await openHarness(path);
	const set = await timerTool.execute(
		{ set: [{ note: "post the #lounge digest to luiz", every: "1d" }] },
		inNewRun(harness),
		BACKGROUND_CONTEXT,
	);
	assert.equal(set.isError, false);
	assert.match(JSON.stringify(set.output), /set #1 for /);
	await harness.close(BACKGROUND_CONTEXT);

	harness = await openHarness(path);
	assert.match(String(await render(harness)), /\n#1 \S+ every 1d: post the #lounge digest to luiz$/);
	const refused = await timerTool.execute({ cancel: [4] }, inNewRun(harness), BACKGROUND_CONTEXT);
	assert.deepEqual(refused, { output: [{ type: "text", text: "no timer #4" }], isError: true });
	assert.equal((await harness.snapshot(Timers, BACKGROUND_CONTEXT))?.timers.length, 1);
	await harness.close(BACKGROUND_CONTEXT);
});
