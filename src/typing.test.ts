import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { AgentEvent, SubmissionId } from "@earendil-works/pi-durable";
import type { LouroResult } from "./louro.ts";
import { TYPING_REFRESH_MS, type TypingState, typingIndicator, typingSender } from "./typing.ts";

const MENTION = 41 as SubmissionId;
const runStart: AgentEvent = { type: "run_start", inputs: [MENTION] };
const runEnd: AgentEvent = { type: "run_end", inputs: [MENTION] };
const send = (id: string): AgentEvent[] => [
	{ type: "tool_execution_start", toolCallId: id, toolName: "louro", args: { command: "louro send '#bots' hi" } },
	{ type: "tool_execution_end", toolCallId: id, toolName: "louro" },
];

/** Shows `#bots`'s states bare, and other targets' as `target state`. */
function watch() {
	mock.timers.enable({ apis: ["setInterval"] });
	const shown: string[] = [];
	return {
		shown,
		typing: typingIndicator((target, state) => shown.push(target === "#bots" ? state : `${target} ${state}`)),
	};
}

test("shows typing while a reply is coming, renewing it until the reply lands", (t) => {
	t.after(() => mock.timers.reset());
	const { shown, typing } = watch();
	typing.expect(MENTION, ["#bots"]);
	typing.see([runStart, { type: "turn_start" }]);
	assert.deepEqual(shown, ["active"]);
	mock.timers.tick(TYPING_REFRESH_MS * 2);
	assert.deepEqual(shown, ["active", "active", "active"]);
	typing.see(send("call_1"));
	mock.timers.tick(TYPING_REFRESH_MS * 2);
	assert.deepEqual(shown, ["active", "active", "active", "done"]);
	typing.see([runEnd]);
	assert.deepEqual(shown, ["active", "active", "active", "done"]);
});

test("starts typing as soon as a running input turns out to be a mention", (t) => {
	t.after(() => mock.timers.reset());
	const { shown, typing } = watch();
	typing.see([runStart]);
	assert.deepEqual(shown, []);
	typing.expect(MENTION, ["#bots"]);
	assert.deepEqual(shown, ["active"]);
	typing.see([runEnd]);
	assert.deepEqual(shown, ["active", "done"]);
});

test("a reply that starts and lands in one batch shows nothing", (t) => {
	t.after(() => mock.timers.reset());
	const { shown, typing } = watch();
	typing.expect(MENTION, ["#bots"]);
	typing.see([runStart, ...send("call_1"), runEnd]);
	mock.timers.tick(TYPING_REFRESH_MS);
	assert.deepEqual(shown, []);
});

test("a run that won't reply never shows typing", (t) => {
	t.after(() => mock.timers.reset());
	const { shown, typing } = watch();
	typing.see([runStart, { type: "turn_start" }]);
	typing.see([{ type: "turn_end" }, runEnd]);
	mock.timers.tick(TYPING_REFRESH_MS);
	assert.deepEqual(shown, []);
});

test("shows typing in each target on its own, renewing only the ones still coming", (t) => {
	t.after(() => mock.timers.reset());
	const { shown, typing } = watch();
	typing.expect(MENTION, ["luiz"]);
	typing.see([runStart]);
	typing.see([
		{
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "louro",
			args: { command: "louro send '#bots' 'luiz: on it'" },
		},
	]);
	assert.deepEqual(shown, ["luiz active", "active"]);
	typing.see([{ type: "tool_execution_end", toolCallId: "call_1", toolName: "louro" }]);
	mock.timers.tick(TYPING_REFRESH_MS);
	assert.deepEqual(shown, ["luiz active", "active", "done", "luiz active"]);
	typing.see([runEnd]);
	assert.deepEqual(shown, ["luiz active", "active", "done", "luiz active", "luiz done"]);
});

const ok: LouroResult = { error: null, stdout: '{"ok":true}', stderr: "" };

function refusal(code: number, kind: string, message: string): LouroResult {
	return {
		error: { code, message: "Command failed: louro typing #bots active" },
		stdout: JSON.stringify({ error: { code: kind, message } }),
		stderr: `louro: ${message}`,
	};
}

function sender(results: LouroResult[]) {
	const ran: string[] = [];
	const warned: string[] = [];
	const sendTo = typingSender(
		async (target, state) => {
			ran.push(target === "#bots" ? state : `${target} ${state}`);
			return results.shift() ?? ok;
		},
		(line) => warned.push(line),
	);
	return { ran, warned, sendTo, send: (state: TypingState) => sendTo("#bots", state) };
}

test("sends each state quietly while louro accepts them", async () => {
	const { ran, warned, send } = sender([]);
	await send("active");
	await send("active");
	await send("done");
	assert.deepEqual(ran, ["active", "active", "done"]);
	assert.deepEqual(warned, []);
});

test("gives up after louro refuses typing for good, warning once", async () => {
	for (const result of [
		refusal(5, "not_allowed", "irc.typing does not grant #bots"),
		refusal(7, "unsupported", "the server doesn't support typing"),
	]) {
		const { ran, warned, send } = sender([result]);
		await send("active");
		await send("active");
		await send("done");
		assert.deepEqual(ran, ["active"]);
		assert.equal(warned.length, 1);
		assert.match(warned[0] as string, /^! typing active in #bots failed, giving up: exit: \d\n/);
		assert.ok(warned[0]?.endsWith(result.stderr), warned[0]);
	}
});

test("keeps trying through a dropped connection", async () => {
	const { ran, warned, send } = sender([refusal(4, "disconnected", "not connected to IRC")]);
	await send("active");
	await send("active");
	await send("done");
	assert.deepEqual(ran, ["active", "active", "done"]);
	assert.deepEqual(warned, [
		'! typing active in #bots failed: exit: 4\n{"error":{"code":"disconnected","message":"not connected to IRC"}}\nlouro: not connected to IRC',
	]);
});

test("sends states in order even when one is slow", async () => {
	const ran: string[] = [];
	const slowActive = Promise.withResolvers<LouroResult>();
	const send = typingSender(
		(_target, state) => {
			ran.push(`start ${state}`);
			return state === "active" ? slowActive.promise : Promise.resolve(ok);
		},
		() => {},
	);
	const active = send("#bots", "active");
	const done = send("#bots", "done");
	await Promise.resolve();
	assert.deepEqual(ran, ["start active"]);
	slowActive.resolve(ok);
	await Promise.all([active, done]);
	assert.deepEqual(ran, ["start active", "start done"]);
});

test("overlapping sends after a refusal warn once", async () => {
	const { ran, warned, send } = sender([refusal(5, "not_allowed", "irc.typing does not grant #bots")]);
	await Promise.all([send("active"), send("active"), send("done")]);
	assert.deepEqual(ran, ["active"]);
	assert.equal(warned.length, 1);
});

test("a refusal in one target leaves the others typing", async () => {
	const { ran, warned, sendTo } = sender([refusal(5, "not_allowed", "irc.typing does not grant #lounge")]);
	await sendTo("#lounge", "active");
	await sendTo("#bots", "active");
	await sendTo("#lounge", "active");
	await sendTo("#bots", "done");
	assert.deepEqual(ran, ["#lounge active", "active", "done"]);
	assert.equal(warned.length, 1);
	assert.match(warned[0] as string, /^! typing active in #lounge failed, giving up/);
});
