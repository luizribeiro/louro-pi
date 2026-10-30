import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent, SubmissionId } from "@earendil-works/pi-durable";
import { casefold, replyTracker, sendTarget } from "./reply.ts";

const MENTION = 41 as SubmissionId;
const CHATTER = 42 as SubmissionId;
const usage = {
	input: 812,
	output: 40,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 852,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const runStart = (...inputs: SubmissionId[]): AgentEvent => ({ type: "run_start", inputs });
const runEnd = (...inputs: SubmissionId[]): AgentEvent => ({ type: "run_end", inputs });

function update(...changes: object[]): AgentEvent {
	return { type: "message_update", usage, changes } as unknown as AgentEvent;
}

const callStart = (index: number, command?: string) =>
	update({
		type: "toolcall_start",
		contentIndex: index,
		block: { type: "toolCall", id: `call_${index}`, name: "louro", arguments: command ? { command } : {} },
	});
const callDelta = (index: number, delta: string) =>
	update({ type: "toolcall_delta", contentIndex: index, path: ["command"], delta });
const thinking = update({ type: "thinking_delta", contentIndex: 0, delta: "luiz asked about the build" });

const execStart = (id: string, command: string): AgentEvent =>
	({ type: "tool_execution_start", toolCallId: id, toolName: "louro", args: { command } }) as AgentEvent;
const execEnd = (id: string): AgentEvent =>
	({ type: "tool_execution_end", toolCallId: id, toolName: "louro" }) as AgentEvent;

function snapshot(...inputs: SubmissionId[]): AgentEvent {
	return {
		type: "snapshot",
		entries: [],
		...(inputs.length ? { run: { inputs } } : {}),
		tools: [],
		nestedTools: [],
		compactions: [],
		inbox: [],
		agent: {},
		usage: {},
	} as unknown as AgentEvent;
}

const B = "#bots";
const NONE = "";

/** Where the bot is replying after each event, in order, as a sorted comma-separated list. */
function follow(events: AgentEvent[], expected: SubmissionId[] = [], targets = ["#Bots"]): string[] {
	const tracker = replyTracker();
	for (const id of expected) tracker.expect(id, targets);
	return events.map((event) => {
		tracker.see(event);
		return [...tracker.replyingTo].sort().join();
	});
}

test("a run for a mention replies from its start until its first send lands", () => {
	assert.deepEqual(
		follow(
			[
				runStart(MENTION),
				thinking,
				execStart("call_1", "louro send '#bots' 'luiz: it builds on ergo 2.15'"),
				execEnd("call_1"),
				execStart("call_2", "louro history '#bots' --latest 5"),
				execEnd("call_2"),
				runEnd(MENTION),
			],
			[MENTION],
		),
		[B, B, B, NONE, NONE, NONE, NONE],
	);
});

test("other runs reply only while the model writes and runs a send", () => {
	assert.deepEqual(
		follow([
			runStart(CHATTER),
			thinking,
			callStart(1),
			callDelta(1, "louro se"),
			callDelta(1, "nd '#bots' 'nice"),
			{ type: "message_end" } as AgentEvent,
			execStart("call_1", "louro send '#bots' 'nice'"),
			execEnd("call_1"),
			runEnd(CHATTER),
		]),
		[NONE, NONE, NONE, NONE, B, B, B, NONE, NONE],
	);
});

test("a run that only reads never replies", () => {
	assert.deepEqual(
		follow([
			runStart(CHATTER),
			callStart(1, "louro history '#bots'"),
			execStart("call_1", "louro history '#bots'"),
			execEnd("call_1"),
			callStart(2),
			callDelta(2, "louro names '#bots'"),
			runEnd(CHATTER),
		]),
		[NONE, NONE, NONE, NONE, NONE, NONE, NONE],
	);
});

test("spots a send in a tool call that arrives whole", () => {
	assert.deepEqual(
		follow([
			runStart(CHATTER),
			update({
				type: "block",
				contentIndex: 1,
				block: { type: "toolCall", id: "call_1", name: "louro", arguments: { command: "louro send '#bots' hi" } },
			}),
		]),
		[NONE, B],
	);
});

test("a mention's run counts as replying even when it's marked after the run started", () => {
	const tracker = replyTracker();
	tracker.see(runStart(MENTION));
	assert.deepEqual([...tracker.replyingTo], []);
	tracker.expect(MENTION, ["#bots"]);
	assert.deepEqual([...tracker.replyingTo], ["#bots"]);
});

test("a mention queued behind another run waits for its own run", () => {
	assert.deepEqual(follow([runStart(CHATTER), runEnd(CHATTER), runStart(MENTION), runEnd(MENTION)], [MENTION]), [
		NONE,
		NONE,
		B,
		NONE,
	]);
});

test("a run that ends without sending stops replying", () => {
	assert.deepEqual(follow([runStart(MENTION), callStart(1, "louro send '#bots' 'hm'"), runEnd(MENTION)], [MENTION]), [
		B,
		B,
		NONE,
	]);
});

test("a snapshot resumes a mention's run, and a later one with no run ends it", () => {
	assert.deepEqual(follow([snapshot(MENTION), snapshot()], [MENTION]), [B, NONE]);
	assert.deepEqual(follow([snapshot(CHATTER), snapshot()]), [NONE, NONE]);
});

test("a snapshot of the same run keeps what the run already did", () => {
	assert.deepEqual(
		follow(
			[runStart(MENTION), execStart("call_1", "louro send '#bots' 'yes'"), execEnd("call_1"), snapshot(MENTION)],
			[MENTION],
		),
		[B, B, NONE, NONE],
	);
});

test("a retry that drops a half-written send stops replying", () => {
	assert.deepEqual(
		follow([
			runStart(CHATTER),
			callStart(1, "louro send '#bots' 'hm"),
			{ type: "auto_retry_start", attempt: 1, at: 1_792_000_000_000, errorMessage: "502 Bad Gateway" },
			{ type: "auto_retry_end", attempt: 1 },
			{ type: "message_start", message: { role: "assistant", content: [] } } as unknown as AgentEvent,
			thinking,
			{ type: "message_end" } as AgentEvent,
			runEnd(CHATTER),
		]),
		[NONE, B, B, B, NONE, NONE, NONE, NONE],
	);
});

test("keeps replying until the last of two sends lands", () => {
	assert.deepEqual(
		follow([
			runStart(CHATTER),
			callStart(1, "louro send '#bots' 'first'"),
			callStart(2, "louro send '#bots' 'second'"),
			{ type: "message_end" } as AgentEvent,
			execStart("call_1", "louro send '#bots' 'first'"),
			execStart("call_2", "louro send '#bots' 'second'"),
			execEnd("call_1"),
			execEnd("call_2"),
		]),
		[NONE, B, B, B, B, B, B, NONE],
	);
});

test("a DM's run keeps replying to its sender after a send elsewhere", () => {
	assert.deepEqual(
		follow(
			[
				runStart(MENTION),
				execStart("call_1", "louro send '#bots' 'luiz asked me something'"),
				execEnd("call_1"),
				execStart("call_2", "louro send luiz 'done, see #bots'"),
				execEnd("call_2"),
			],
			[MENTION],
			["Luiz"],
		),
		["luiz", "#bots,luiz", "luiz", "luiz", NONE],
	);
});

test("shows a send's target only once its text has begun", () => {
	assert.deepEqual(
		follow([runStart(CHATTER), callStart(1), callDelta(1, "louro send '#lou"), callDelta(1, "nge' 'mari")]),
		[NONE, NONE, NONE, "#lounge"],
	);
});

test("finds a send's target past its flags and quotes, casefolded", () => {
	const cases: [unknown, string | undefined][] = [
		["louro send '#Bots' 'hi'", "#bots"],
		["louro send --reply-to 4y8kq7j2c9mnz Luiz 'yes'", "luiz"],
		["louro send --action '#bots' \"waves at maria", "#bots"],
		["louro send --reply-to=4y8kq7j2c9mnz '#bots' 'yes'", "#bots"],
		["louro send '#bots' ", undefined],
		["louro send '#bo", undefined],
		["louro history '#bots' --latest 5", undefined],
		["louro status; louro send '#bots' 'hi'", undefined],
		[undefined, undefined],
	];
	for (const [command, target] of cases) assert.equal(sendTarget(command), target, String(command));
});

test("casefolds ASCII letters only", () => {
	assert.equal(casefold("#Bots[1]\\~"), "#bots[1]\\~");
	assert.equal(casefold("Luiz"), "luiz");
	assert.equal(casefold("#AÇÃO"), "#aÇÃo");
});
