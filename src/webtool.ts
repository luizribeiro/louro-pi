import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { capCalls, failure } from "./calls.ts";
import { gitleaksRules } from "./gitleaks.ts";
import { extract, type KagiClient, search } from "./kagi.ts";
import { linksIn, normalLink, rememberLinks, SeenLinks } from "./links.ts";
import {
	MAX_WEB_CALLS_PER_DAY,
	PAGE_WINDOW_CHARS,
	pageWindow,
	renderPage,
	spendWebCall,
	untrusted,
	WebBudget,
	type WebRequest,
	webLeakIn,
	webRequest,
} from "./web.ts";

export const NOT_SET_UP = "the web isn't set up: louro-pi has no KAGI_API_KEY";
export const UNSEEN_LINK =
	"you can read only a link you've seen in chat, in search results or on a page you read; search for it first";
// Enough to page back and forth through a few pages without paying for them again.
export const CACHED_PAGES = 8;

export type WebDeps = {
	key?: () => string | undefined;
	fetch?: typeof fetch;
	rules?: typeof gitleaksRules;
	now?: () => Date;
};

/** What to show the model, the links it may now read, and the page fetched, if any. */
type Answer = { text: string; links: string[]; page?: string };

/** Recently read pages by link, oldest first. */
function pageCache() {
	const pages = new Map<string, string>();
	return {
		get: (url: string) => pages.get(url),
		set(url: string, markdown: string) {
			pages.delete(url);
			pages.set(url, markdown);
			for (const oldest of pages.keys()) if (pages.size > CACHED_PAGES) pages.delete(oldest);
		},
	};
}

async function answer(request: WebRequest, client: KagiClient, cached: string | undefined): Promise<Answer> {
	if (request.kind === "search") {
		const results = await search(request.outbound, client);
		return {
			text: untrusted({ query: request.outbound, results }),
			links: results.flatMap((result) => normalLink(result.url) ?? []),
		};
	}
	const page = cached ?? (await extract(request.outbound, client));
	return {
		text: renderPage(request.outbound, page, request.from),
		links: linksIn(pageWindow(page, request.from)),
		page,
	};
}

export function createWebTool({
	key = () => process.env.KAGI_API_KEY,
	fetch: send = fetch,
	rules = gitleaksRules,
	now = () => new Date(),
}: WebDeps = {}) {
	const pages = pageCache();
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
				const cached = request.kind === "read" ? pages.get(request.outbound) : undefined;
				await api.commit(async (tx) => {
					if (request.kind === "read" && !(await tx.doc(SeenLinks)).links.includes(request.outbound)) {
						throw new Error(UNSEEN_LINK);
					}
					if (cached === undefined) spendWebCall(await tx.doc(WebBudget), now());
				}, context);
				const client = { key: kagiKey, fetch: send, signal: context.abortSignal };
				const { text, links, page } = await answer(request, client, cached);
				if (page !== undefined) pages.set(request.outbound, page);
				await api.commit(async (tx) => rememberLinks(await tx.doc(SeenLinks), links), context);
				return { output: [{ type: "text", text }], isError: false };
			} catch (error) {
				return failure((error as Error).message.replaceAll(kagiKey, "[key]"));
			}
		},
	});
}

export const webTool = createWebTool();
