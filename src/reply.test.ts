import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentEvent, SubmissionId } from "@earendil-works/pi-durable";
import { replyTracker } from "./reply.ts";

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

/** `replying` after each event, in order. */
function follow(events: AgentEvent[], expected: SubmissionId[] = []): boolean[] {
	const tracker = replyTracker();
	for (const id of expected) tracker.expect(id);
	return events.map((event) => {
		tracker.see(event);
		return tracker.replying;
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
		[true, true, true, false, false, false, false],
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
		[false, false, false, false, true, true, true, false, false],
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
		[false, false, false, false, false, false, false],
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
		[false, true],
	);
});

test("a mention's run counts as replying even when it's marked after the run started", () => {
	const tracker = replyTracker();
	tracker.see(runStart(MENTION));
	assert.equal(tracker.replying, false);
	tracker.expect(MENTION);
	assert.equal(tracker.replying, true);
});

test("a mention queued behind another run waits for its own run", () => {
	assert.deepEqual(follow([runStart(CHATTER), runEnd(CHATTER), runStart(MENTION), runEnd(MENTION)], [MENTION]), [
		false,
		false,
		true,
		false,
	]);
});

test("a run that ends without sending stops replying", () => {
	assert.deepEqual(follow([runStart(MENTION), callStart(1, "louro send '#bots' 'hm'"), runEnd(MENTION)], [MENTION]), [
		true,
		true,
		false,
	]);
});

test("a snapshot resumes a mention's run, and a later one with no run ends it", () => {
	assert.deepEqual(follow([snapshot(MENTION), snapshot()], [MENTION]), [true, false]);
	assert.deepEqual(follow([snapshot(CHATTER), snapshot()]), [false, false]);
});

test("a snapshot of the same run keeps what the run already did", () => {
	assert.deepEqual(
		follow(
			[runStart(MENTION), execStart("call_1", "louro send '#bots' 'yes'"), execEnd("call_1"), snapshot(MENTION)],
			[MENTION],
		),
		[true, true, false, false],
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
		[false, true, true, true, false, false, false, false],
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
		[false, true, true, true, true, true, true, false],
	);
});
