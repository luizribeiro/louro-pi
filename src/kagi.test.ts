import assert from "node:assert/strict";
import { test } from "node:test";
import { extract, MAX_RESULTS, MAX_SNIPPET_CHARS, plainText, search } from "./kagi.ts";

const KEY = "kagi-7Qm2Xv9pL4sT8wRz";

type Sent = { url: string; init: RequestInit };

/** A fetch that answers every call with `status` and `body`, keeping what it was sent. */
function fakeFetch(status: number, body: unknown) {
	const sent: Sent[] = [];
	const send = async (url: string | URL | Request, init?: RequestInit) => {
		sent.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	};
	return { sent, fetch: send as typeof fetch };
}

const ergo = {
	url: "https://ergo.chat/",
	title: "Ergo IRC Server",
	snippet: "<strong>Ergo</strong> IRC <strong>Server</strong> Modern IRC software &amp; communities",
};

test("plainText drops tags, decodes entities and folds whitespace", () => {
	assert.equal(
		plainText("<strong>Ergo</strong> &amp; papo&#39;s\n  <em>bouncer</em> &lt;3"),
		"Ergo & papo's bouncer <3",
	);
});

test("search posts the query with the key and returns plain results", async () => {
	const { sent, fetch } = fakeFetch(200, {
		meta: { trace: "ff35" },
		data: {
			search: [ergo, { url: "https://github.com/ergochat/ergo", title: "ergochat/ergo", time: "2026-10-01T00:00:00Z" }],
			interesting_finds: [{ url: "https://news.ycombinator.com/", title: "Show HN" }],
		},
	});
	const results = await search("ergo irc server", { key: KEY, fetch });
	assert.deepEqual(results, [
		{
			title: "Ergo IRC Server",
			url: "https://ergo.chat/",
			snippet: "Ergo IRC Server Modern IRC software & communities",
		},
		{ title: "ergochat/ergo", url: "https://github.com/ergochat/ergo", time: "2026-10-01T00:00:00Z" },
	]);
	const [call] = sent;
	assert.equal(call?.url, "https://kagi.com/api/v1/search");
	assert.equal(call?.init.method, "POST");
	assert.deepEqual(call?.init.headers, { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
	assert.deepEqual(JSON.parse(String(call?.init.body)), { query: "ergo irc server", limit: MAX_RESULTS });
});

test("search keeps at most MAX_RESULTS results and shortens long snippets", async () => {
	const many = Array.from({ length: 9 }, (_, i) => ({
		...ergo,
		url: `https://ergo.chat/${i}`,
		snippet: "x".repeat(900),
	}));
	const results = await search("ergo", { key: KEY, fetch: fakeFetch(200, { data: { search: many } }).fetch });
	assert.equal(results.length, MAX_RESULTS);
	assert.equal(results[0]?.snippet?.length, MAX_SNIPPET_CHARS);
	assert.ok(results[0]?.snippet?.endsWith("…"));
});

test("search with no results is an empty list", async () => {
	assert.deepEqual(await search("zzqx", { key: KEY, fetch: fakeFetch(200, { data: {} }).fetch }), []);
});

test("a refused call says why, without the key", async () => {
	const { fetch } = fakeFetch(400, {
		data: null,
		errors: [{ code: "search.query_empty", message: "Query cannot be empty" }],
	});
	await assert.rejects(search("", { key: KEY, fetch }), (error: Error) => {
		assert.equal(error.message, "kagi refused it (HTTP 400): Query cannot be empty");
		assert.doesNotMatch(error.message, new RegExp(KEY));
		return true;
	});
});

test("a refusal without a JSON body still says it was refused", async () => {
	const send = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
	await assert.rejects(search("ergo", { key: KEY, fetch: send }), /kagi refused it \(HTTP 502\): no reason given/);
});

test("extract posts the page and returns its markdown", async () => {
	const { sent, fetch } = fakeFetch(200, {
		data: [{ url: "https://en.wikipedia.org/wiki/IRC", markdown: "# IRC\n\nProtocol for real-time chat" }],
	});
	assert.equal(
		await extract("https://en.wikipedia.org/wiki/IRC", { key: KEY, fetch }),
		"# IRC\n\nProtocol for real-time chat",
	);
	assert.equal(sent[0]?.url, "https://kagi.com/api/v1/extract");
	assert.deepEqual(JSON.parse(String(sent[0]?.init.body)), { pages: [{ url: "https://en.wikipedia.org/wiki/IRC" }] });
});

test("a page kagi couldn't read is an error, with its reason when it gives one", async () => {
	const silent = fakeFetch(200, { data: [{ url: "https://ergo.chat/" }] }).fetch;
	await assert.rejects(
		extract("https://ergo.chat/", { key: KEY, fetch: silent }),
		/^Error: kagi couldn't read that page$/,
	);
	const explained = fakeFetch(200, { data: [{ url: "https://ergo.chat/", error: "timed out" }] }).fetch;
	await assert.rejects(
		extract("https://ergo.chat/", { key: KEY, fetch: explained }),
		/couldn't read that page: timed out/,
	);
});

test("the caller's abort cancels the call", async () => {
	const controller = new AbortController();
	const send = ((_: string, init: RequestInit) =>
		new Promise((_resolve, reject) =>
			init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
		)) as typeof fetch;
	const pending = search("ergo", { key: KEY, fetch: send, signal: controller.signal });
	controller.abort(new Error("run ended"));
	await assert.rejects(pending, /run ended/);
});
