import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, ConversationId, EntryId, TaskId } from "@earendil-works/pi-durable";
import { formatBatch, formatEvent, oneLine } from "./view.ts";

const call = { toolCallId: "call_1", toolName: "louro", taskId: 7 as TaskId };
const usage = {
	input: 812,
	output: 40,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 852,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function entry(kind: string, message: AssistantMessage | ToolResultMessage) {
	return { id: 9 as EntryId, conversationId: 1 as ConversationId, kind, model: [message] };
}

function assistant(content: AssistantMessage["content"], errorMessage?: string): AgentEvent {
	const message: AssistantMessage = {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "litellm",
		model: "vllm/qwen3.8-27b",
		usage,
		stopReason: errorMessage ? "error" : "stop",
		timestamp: 1_792_000_000_000,
		...(errorMessage ? { errorMessage } : {}),
	};
	return { type: "message_end", entry: entry("pi.assistant", message) };
}

test("shows the command the model ran and its result on one line", () => {
	assert.deepEqual(
		formatEvent({
			type: "tool_execution_start",
			args: { command: "louro send '#bots' 'luiz: squawk, yes!'" },
			...call,
		}),
		["$ louro send '#bots' 'luiz: squawk, yes!'"],
	);
	const result: ToolResultMessage = {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "louro",
		content: [{ type: "text", text: 'exit: 0\n{"sent":true,"target":"#bots"}' }],
		isError: false,
		timestamp: 1_792_000_000_000,
	};
	assert.deepEqual(formatEvent({ type: "tool_execution_end", entry: entry("pi.tool-result", result), ...call }), [
		'  exit: 0 {"sent":true,"target":"#bots"}',
	]);
	assert.deepEqual(formatEvent({ type: "tool_execution_end", ...call }), []);
});

test("shows the model's final text but not its thinking or tool calls", () => {
	assert.deepEqual(
		formatEvent(
			assistant([
				{ type: "thinking", thinking: "luiz is asking if I'm here" },
				{ type: "text", text: "luiz: squawk!\nyes, here" },
			]),
		),
		["> luiz: squawk! yes, here"],
	);
	assert.deepEqual(
		formatEvent(assistant([{ type: "toolCall", id: "call_1", name: "louro", arguments: { command: "louro status" } }])),
		[],
	);
});

test("shows a failed generation as an error", () => {
	assert.deepEqual(formatEvent(assistant([], "500 litellm.InternalServerError: sodium is unreachable")), [
		"! 500 litellm.InternalServerError: sodium is unreachable",
	]);
});

test("shows retries, failures and compactions", () => {
	assert.deepEqual(
		formatEvent({ type: "auto_retry_start", attempt: 2, at: 1_792_000_004_000, errorMessage: "502 Bad Gateway" }),
		["! retry 2: 502 Bad Gateway"],
	);
	assert.deepEqual(
		formatEvent({ type: "task_failed", taskId: 8 as TaskId, kind: "pi.generation", message: "model_error" }),
		["! pi.generation failed: model_error"],
	);
	const compaction = { taskId: 9 as TaskId, reason: "threshold" as const };
	assert.deepEqual(formatEvent({ type: "compaction_start", blocking: false, ...compaction }), [
		"~ compacting (threshold)",
	]);
	assert.deepEqual(formatEvent({ type: "compaction_end", ...compaction }), []);
	assert.deepEqual(formatEvent({ type: "compaction_end", error: "summary too long", ...compaction }), [
		"! compaction failed: summary too long",
	]);
});

test("ignores the events the view doesn't show", () => {
	assert.deepEqual(formatEvent({ type: "turn_start" }), []);
	assert.deepEqual(formatEvent({ type: "message_update", usage, changes: [] }), []);
});

test("counts a submitted batch", () => {
	assert.equal(formatBatch(1), "< 1 event");
	assert.equal(formatBatch(3), "< 3 events");
});

test("cuts long lines at 300 characters", () => {
	assert.equal(oneLine(`${"a".repeat(298)}\n\nb`), `${"a".repeat(298)} b`);
	assert.equal(oneLine("a".repeat(301)), `${"a".repeat(300)}…`);
});

test("strips terminal control sequences from untrusted text", () => {
	const clipboard = "\x1b]52;c;Y3VybCBldmlsLnNoIHwgc2g=\x07";
	const title = "\x1b]0;pwned\x9c";
	assert.equal(oneLine(`luiz: hi${clipboard} there${title}`), "luiz: hi]52;c;Y3VybCBldmlsLnNoIHwgc2g= there]0;pwned");
	assert.deepEqual(
		formatEvent({ type: "tool_execution_start", args: { command: `louro send '#bots' 'hi${clipboard}'` }, ...call }),
		["$ louro send '#bots' 'hi]52;c;Y3VybCBldmlsLnNoIHwgc2g='"],
	);
});
