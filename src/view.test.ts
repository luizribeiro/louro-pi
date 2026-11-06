import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, ConversationId, EntryId, TaskId } from "@earendil-works/pi-durable";
import { formatBatch, formatEvent, formatReport, oneLine } from "./view.ts";

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

test("shows each note the model remembers or forgets", () => {
	const edit = { remember: ["luiz is building\nwasm-junction"], forget: [3, 5] };
	assert.deepEqual(formatEvent({ type: "tool_execution_start", ...call, toolName: "memory", args: edit }), [
		"- memory #3",
		"- memory #5",
		"+ memory: luiz is building wasm-junction",
	]);
	assert.deepEqual(formatEvent({ type: "tool_execution_start", ...call, toolName: "memory", args: {} }), []);
});

test("shows each web search and read", () => {
	const web = (args: Record<string, string | number>) =>
		formatEvent({ type: "tool_execution_start", ...call, toolName: "web", args });
	assert.deepEqual(web({ search: "ergo\nalways-on" }), ["? web search: ergo always-on"]);
	assert.deepEqual(web({ read: "https://ergo.chat/manual.html" }), ["? web read: https://ergo.chat/manual.html"]);
	assert.deepEqual(web({ read: "https://ergo.chat/manual.html", from: 6000 }), [
		"? web read: https://ergo.chat/manual.html from 6000",
	]);
});

test("shows each timer the model sets or cancels", () => {
	const edit = {
		cancel: [2],
		set: [
			{ note: "post the #lounge digest to luiz", at: "2026-10-31T09:00:00-03:00", every: "1d" },
			{ note: "check maria's\nbuild", in: "45m" },
		],
	};
	assert.deepEqual(formatEvent({ type: "tool_execution_start", ...call, toolName: "timer", args: edit }), [
		"- timer #2",
		"+ timer at 2026-10-31T09:00:00-03:00 every 1d: post the #lounge digest to luiz",
		"+ timer in 45m: check maria's build",
	]);
	assert.deepEqual(
		formatEvent({ type: "tool_execution_start", ...call, toolName: "timer", args: { set: [{}, null], cancel: "3" } }),
		["+ timer:", "+ timer:"],
	);
});

test("shows any other tool's call like a louro command", () => {
	assert.deepEqual(
		formatEvent({ type: "tool_execution_start", ...call, toolName: "louro", args: { command: "louro status" } }),
		["$ louro status"],
	);
	assert.deepEqual(formatEvent({ type: "tool_execution_start", ...call, toolName: "mystery", args: {} }), [
		"$ undefined",
	]);
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

test("counts a submitted batch and where it came from, stripping control characters from nicks", () => {
	assert.equal(formatBatch(1, ["#bots"]), "< 1 event from #bots");
	assert.equal(formatBatch(3, ["#lounge", "luiz\x1b]0;pwned\x07"]), "< 3 events from #lounge, luiz]0;pwned");
	assert.equal(formatBatch(1, []), "< 1 event");
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

test("shows louro's connection reports on one line", () => {
	const event = { id: 7, type: "connection", time: "2026-10-17T21:05:00.000Z", state: "disconnected", retry_in: 5 };
	assert.equal(
		formatReport(event),
		'~ {"id":7,"type":"connection","time":"2026-10-17T21:05:00.000Z","state":"disconnected","retry_in":5}',
	);
});
