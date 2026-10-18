import { createModels, createProvider, envApiKeyAuth, type Model, type Models } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { AgentChange, Extension, HarnessSettings, ToolRegistration } from "@earendil-works/pi-durable";

export const CONTEXT_WINDOW = 65536;
// Small enough that a compaction leaves room for a few full batches (MAX_BATCH_BYTES) below the blocking threshold.
export const KEEP_RECENT_TOKENS = 8000;

const PROVIDER = "litellm";

const MODEL: Model<"openai-completions"> = {
	id: "vllm/qwen3.8-27b",
	name: "Qwen 3.8 27B (vanadium NVFP4)",
	api: "openai-completions",
	provider: PROVIDER,
	baseUrl: "https://litellm.thepromisedlan.club/v1",
	// Hack: litellm's session-affinity hook (ops config/litellm/custom_callbacks.py)
	// hashes each conversation's opening to pick vanadium or sodium for
	// vllm/qwen3.8-27b, ignoring whether that host is up. louro-pi's opening
	// never changes, so it always hashed to sodium. "louro" happens to hash to
	// vanadium. Drop this once the hook skips hosts that are down.
	headers: { "x-session-id": "louro" },
	reasoning: true,
	thinkingLevelMap: { off: "none", minimal: "low", low: "low", medium: "medium", high: "xhigh", xhigh: "xhigh" },
	input: ["text"],
	contextWindow: CONTEXT_WINDOW,
	maxTokens: 32768,
	compat: {
		supportsDeveloperRole: false,
		supportsReasoningEffort: true,
		supportsStore: false,
		maxTokensField: "max_tokens",
	},
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export function litellmModels(): Models {
	const models = createModels();
	models.setProvider(
		createProvider({
			id: PROVIDER,
			auth: { apiKey: envApiKeyAuth("LiteLLM", ["LITELLM_API_KEY"]) },
			models: [MODEL],
			api: openAICompletionsApi(),
		}),
	);
	return models;
}

export function harnessSettings(extension: Extension): HarnessSettings {
	return {
		extensions: [extension],
		followUpMode: "all",
		// Long enough to ride out the model server restarting instead of dropping the batch.
		retry: { maxRetries: 10, maxAgentDelayMs: 5 * 60_000 },
		// The default background margin starts compacting at 16k tokens in a 64k window, before there is much to cut.
		compaction: { enabled: true, keepRecentTokens: KEEP_RECENT_TOKENS, backgroundTokens: 16384 },
	};
}

export function agentChange(extension: Extension, tool: ToolRegistration): AgentChange {
	return {
		model: { provider: PROVIDER, modelId: MODEL.id },
		thinkingLevel: "medium",
		extensions: [extension],
		tools: [tool],
	};
}
