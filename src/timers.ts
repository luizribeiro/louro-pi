import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineTool, type InputSubmissionDraft, section } from "@earendil-works/pi-durable";
import { commitEdit } from "./calls.ts";

/** `every` is in seconds; a timer without it fires once. */
export type Timer = { id: number; note: string; due: string; every?: number };
type Timers = { timers: Timer[]; nextId: number };

export const MAX_TIMERS = 20;
export const MAX_TIMER_NOTE_CHARS = 300;
// A shorter repeat would keep the bot busy waking itself instead of listening.
export const MIN_EVERY_SECONDS = 5 * 60;
export const MAX_AHEAD_SECONDS = 366 * 86_400;

export const Timers = defineDoc<Timers>({
	kind: "louro.timers",
	version: 1,
	scope: "session",
	initial: () => ({ timers: [], nextId: 1 }),
});

const UNITS: Record<string, number> = { d: 86_400, h: 3_600, m: 60, s: 1 };

/** Seconds in a duration like `90s`, `30m` or `1d12h`. */
export function parseDuration(text: string): number {
	if (!/^\s*(\d+\s*[dhms]\s*)+$/.test(text)) {
		throw new Error(`can't read "${text}" as a duration; write it like 90s, 30m, 2h or 1d12h`);
	}
	return [...text.matchAll(/(\d+)\s*([dhms])/g)].reduce(
		(total, [, count, unit]) => total + Number(count) * (UNITS[unit as string] as number),
		0,
	);
}

export function formatDuration(seconds: number): string {
	let left = seconds;
	const parts = Object.entries(UNITS).flatMap(([unit, size]) => {
		const count = Math.floor(left / size);
		left -= count * size;
		return count > 0 ? [`${count}${unit}`] : [];
	});
	return parts.join("") || "0s";
}

export type TimerSetting = {
	note: string;
	in?: string | undefined;
	at?: string | undefined;
	every?: string | undefined;
};
export type TimerEdit = { set?: TimerSetting[] | undefined; cancel?: number[] | undefined };

const ISO_WITH_OFFSET = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/;

/** Milliseconds of an ISO time with an offset, or NaN; Date.parse alone reads a time without one in the host's zone and rolls Feb 31 into March. */
function parseTime(text: string): number {
	const [, year, month, day] = ISO_WITH_OFFSET.exec(text)?.map(Number) ?? [];
	if (year === undefined || month === undefined || day === undefined) return Number.NaN;
	const real = new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
	return real ? Date.parse(text) : Number.NaN;
}

function newTimer(id: number, { note, in: after, at, every }: TimerSetting, now: number): Timer {
	const text = note.replace(/\s+/g, " ").trim();
	if (text === "") throw new Error("a timer needs a note saying what to do when it fires");
	if (text.length > MAX_TIMER_NOTE_CHARS)
		throw new Error(`a timer's note may be at most ${MAX_TIMER_NOTE_CHARS} characters`);
	if (after !== undefined && at !== undefined) throw new Error("give a timer `in` or `at`, not both");
	const repeat = every === undefined ? undefined : parseDuration(every);
	if (repeat !== undefined && repeat < MIN_EVERY_SECONDS) {
		throw new Error(`a timer may repeat at most every ${formatDuration(MIN_EVERY_SECONDS)}`);
	}
	let due: number;
	if (at !== undefined) {
		due = parseTime(at);
		if (Number.isNaN(due)) throw new Error(`can't read "${at}" as a time; write it like 2026-10-31T09:00:00-03:00`);
		if (due <= now) throw new Error(`${at} has already passed`);
	} else {
		const wait = after ?? every;
		if (wait === undefined) throw new Error("say when the timer fires: `in`, `at` or `every`");
		due = now + parseDuration(wait) * 1000;
	}
	if (due - now > MAX_AHEAD_SECONDS * 1000 || (repeat ?? 0) > MAX_AHEAD_SECONDS) {
		throw new Error(`a timer may be at most ${formatDuration(MAX_AHEAD_SECONDS)} away`);
	}
	return { id, note: text, due: new Date(due).toISOString(), ...(repeat === undefined ? {} : { every: repeat }) };
}

/** Cancels, then sets, all or nothing; returns what changed, or throws why nothing did. */
export function editTimers(state: Timers, { set = [], cancel: ids = [] }: TimerEdit, now: number): string {
	const cancel = [...new Set(ids)];
	if (set.length === 0 && cancel.length === 0) throw new Error("give timers to set or timer ids to cancel");
	const unknown = cancel.filter((id) => !state.timers.some((timer) => timer.id === id));
	if (unknown.length > 0) throw new Error(`no timer ${unknown.map((id) => `#${id}`).join(", ")}`);
	const added = set.map((setting, i) => newTimer(state.nextId + i, setting, now));
	const timers = [...state.timers.filter((timer) => !cancel.includes(timer.id)), ...added];
	if (timers.length > MAX_TIMERS) throw new Error(`at most ${MAX_TIMERS} timers; cancel some first`);
	state.timers = timers;
	state.nextId += added.length;
	return [...cancel.map((id) => `cancelled #${id}`), ...added.map((timer) => `set #${timer.id} for ${timer.due}`)].join(
		"\n",
	);
}

export function dueTimers(timers: readonly Timer[], now: number): Timer[] {
	return timers.filter((timer) => Date.parse(timer.due) <= now);
}

/** Drops fired one-shot timers and moves repeating ones to their next time after `now`, skipping missed ones. */
export function advanceTimers(state: Timers, fired: readonly Timer[], now: number): void {
	const firedAt = new Map(fired.map((timer) => [timer.id, timer.due]));
	state.timers = state.timers.flatMap((timer) => {
		if (firedAt.get(timer.id) !== timer.due) return [timer];
		if (timer.every === undefined) return [];
		const period = timer.every * 1000;
		const due = Date.parse(timer.due);
		const next = due + (Math.floor((now - due) / period) + 1) * period;
		return [{ ...timer, due: new Date(next).toISOString() }];
	});
}

const describe = (timer: Timer) =>
	`#${timer.id} ${timer.due}${timer.every === undefined ? "" : ` every ${formatDuration(timer.every)}`}: ${timer.note}`;

export const TIMERS_HEADER =
	"Your timers, kept across restarts with the timer tool. Each wakes you with a `timer` event when it's due, carrying its note; times are UTC.";

export function renderTimers(timers: readonly Timer[]): string {
	return [TIMERS_HEADER, ...(timers.length > 0 ? timers.map(describe) : ["You have no timers set."])].join("\n");
}

export const timersSection = section("timers", async ({ read }, context) =>
	renderTimers((await read.snapshot(Timers, context))?.timers ?? []),
);

export const timerTool = defineTool({
	name: "timer",
	description:
		"Set or cancel timers that wake you later with a `timer` event, shown in <timers>. Give each timer a note saying what to do then, and when: `in` (like 30m), `at` (an ISO time with offset), and/or `every` (repeat, like 1d). `cancel` drops timers by id. Both at once reschedule.",
	parameters: Type.Object({
		set: Type.Optional(
			Type.Array(
				Type.Object({
					note: Type.String({ description: "What to do when it fires" }),
					in: Type.Optional(Type.String({ description: "How long from now, like 90s, 30m, 2h or 1d12h" })),
					at: Type.Optional(Type.String({ description: "When, as an ISO time like 2026-10-31T09:00:00-03:00" })),
					every: Type.Optional(Type.String({ description: "Repeat this often after it first fires, like 1d" })),
				}),
			),
		),
		cancel: Type.Optional(Type.Array(Type.Integer(), { description: "Ids of timers to cancel, like 3 for #3" })),
	}),
	execute: (edit, api, context) =>
		commitEdit(api, context, async (tx) => editTimers(await tx.doc(Timers), edit, Date.now())),
});

/** The input a due timer wakes the bot with; its id and time make the request id, so a refire after a crash is dropped. */
export function timerInput(timer: Timer, now: number): InputSubmissionDraft {
	const event = {
		type: "timer",
		id: timer.id,
		note: timer.note,
		due: timer.due,
		...(timer.every === undefined ? {} : { every: formatDuration(timer.every) }),
		now: new Date(now).toISOString(),
	};
	return {
		type: "input",
		content: JSON.stringify({ events: [event] }),
		requestId: `louro-timer-${timer.id}-${timer.due}`,
		whenBusy: "followUp",
	};
}
