const API = "https://kagi.com/api/v1";
const TIMEOUT_MS = 20_000;
export const MAX_RESULTS = 5;
export const MAX_SNIPPET_CHARS = 300;
export const MAX_TITLE_CHARS = 150;
export const MAX_URL_CHARS = 500;
export const MAX_REASON_CHARS = 200;

export type KagiClient = { key: string; fetch?: typeof fetch; signal?: AbortSignal | undefined };
export type SearchResult = { title: string; url: string; snippet?: string; time?: string };

type ErrorBody = { errors?: { message?: string; code?: string }[] };

async function call<T>(path: string, body: object, { key, fetch: send = fetch, signal }: KagiClient): Promise<T> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const response = await send(`${API}${path}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	const json = (await response.json().catch(() => ({}))) as T & ErrorBody;
	if (!response.ok) {
		const [error] = json.errors ?? [];
		throw new Error(
			`kagi refused it (HTTP ${response.status}): ${shorten(error?.message ?? error?.code ?? "no reason given", MAX_REASON_CHARS)}`,
		);
	}
	return json;
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Kagi's snippets bold the query's words with HTML; IRC wants plain text. */
export function plainText(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

type RawResult = { title?: string; url?: string; snippet?: string; time?: string };

export async function search(query: string, client: KagiClient): Promise<SearchResult[]> {
	const { data } = await call<{ data?: { search?: RawResult[] } }>("/search", { query, limit: MAX_RESULTS }, client);
	return (data?.search ?? []).slice(0, MAX_RESULTS).flatMap(({ title, url, snippet, time }) =>
		url === undefined || url.length > MAX_URL_CHARS
			? []
			: [
					{
						title: shorten(plainText(title ?? ""), MAX_TITLE_CHARS),
						url,
						...(snippet ? { snippet: shorten(plainText(snippet), MAX_SNIPPET_CHARS) } : {}),
						...(time ? { time } : {}),
					},
				],
	);
}

/** The page at `url` as markdown, fetched by Kagi rather than from this machine. */
export async function extract(url: string, client: KagiClient): Promise<string> {
	const { data } = await call<{ data?: { markdown?: string; error?: string }[] }>(
		"/extract",
		{ pages: [{ url }] },
		client,
	);
	const [page] = data ?? [];
	if (!page?.markdown)
		throw new Error(`kagi couldn't read that page${page?.error ? `: ${shorten(page.error, MAX_REASON_CHARS)}` : ""}`);
	return page.markdown;
}
