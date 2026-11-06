import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { capCalls, failure } from "./calls.ts";
import { gitleaksRules } from "./gitleaks.ts";
import { type KagiClient, search } from "./kagi.ts";
import {
	MAX_WEB_CALLS_PER_DAY,
	PAGE_WINDOW_CHARS,
	spendWebCall,
	untrusted,
	WebBudget,
	type WebRequest,
	webLeakIn,
	webRequest,
} from "./web.ts";

export const NOT_SET_UP = "the web isn't set up: louro-pi has no KAGI_API_KEY";

export type WebDeps = {
	key?: () => string | undefined;
	fetch?: typeof fetch;
	rules?: typeof gitleaksRules;
	now?: () => Date;
};

async function answer(request: WebRequest, client: KagiClient): Promise<string> {
	if (request.kind === "search") {
		return untrusted({ query: request.outbound, results: await search(request.outbound, client) });
	}
	throw new Error("reading pages isn't available yet");
}

export function createWebTool({
	key = () => process.env.KAGI_API_KEY,
	fetch: send = fetch,
	rules = gitleaksRules,
	now = () => new Date(),
}: WebDeps = {}) {
	return defineTool({
		name: "web",
		description: `Search the web or read a page, through Kagi. \`search\` gives the top results with their links; \`read\` gives the text of a page whose link you've seen in chat, a search or another page, ${PAGE_WINDOW_CHARS} characters at a time, with \`next\` to pass as \`from\` for more. Each search or new page costs money, ${MAX_WEB_CALLS_PER_DAY} a day at most. Searches and links go to Kagi and the page's site, so secrets and personal details are refused.`,
		parameters: Type.Object({
			search: Type.Optional(Type.String({ description: "What to search the web for" })),
			read: Type.Optional(Type.String({ description: "An https:// link you've seen, to read" })),
			from: Type.Optional(
				Type.Integer({ minimum: 0, description: "Where to go on reading a long page, from the last read's `next`" }),
			),
		}),
		async execute(args, api, context): Promise<ToolExecutionResult> {
			const capped = await capCalls(api, context);
			if (capped) return capped;
			const kagiKey = key();
			if (!kagiKey) return failure(NOT_SET_UP);
			try {
				const request = webRequest(args);
				const leak = await webLeakIn(request.outbound, rules);
				if (leak) return failure(leak);
				await api.commit(async (tx) => spendWebCall(await tx.doc(WebBudget), now()), context);
				const text = await answer(request, { key: kagiKey, fetch: send, signal: context.abortSignal });
				return { output: [{ type: "text", text }], isError: false };
			} catch (error) {
				return failure((error as Error).message.replaceAll(kagiKey, "[key]"));
			}
		},
	});
}

export const webTool = createWebTool();
