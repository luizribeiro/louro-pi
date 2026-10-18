import assert from "node:assert/strict";
import { test } from "node:test";
import { agentChange, CONTEXT_WINDOW, harnessSettings, KEEP_RECENT_TOKENS } from "./config.ts";
import { louroExtension, louroTool } from "./tool.ts";

const extension = louroExtension("You are louro, a bot on IRC.", "louro connects you to IRC as a bot.");

test("the agent runs Qwen with only the louro extension and tool", () => {
	assert.deepEqual(agentChange(extension, louroTool), {
		model: { provider: "litellm", modelId: "vllm/qwen3.8-27b" },
		thinkingLevel: "medium",
		extensions: [extension],
		tools: [louroTool],
	});
});

test("settings queue every batch, back off a long time and compact for a 64k window", () => {
	assert.equal(CONTEXT_WINDOW, 65536);
	assert.deepEqual(harnessSettings(extension), {
		extensions: [extension],
		followUpMode: "all",
		retry: { maxRetries: 10, maxAgentDelayMs: 300_000 },
		compaction: { enabled: true, keepRecentTokens: KEEP_RECENT_TOKENS, backgroundTokens: 16384 },
	});
	assert.equal(KEEP_RECENT_TOKENS, 8000);
});
