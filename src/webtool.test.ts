import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness, ToolExecutionResult } from "@earendil-works/pi-durable";
import { MAX_CALLS_PER_RUN, TOO_MANY_CALLS } from "./calls.ts";
import { freshStatePath, inNewRun, openHarness } from "./fixtures.ts";
import { linksIn, rememberLinks, SeenLinks } from "./links.ts";
import { MAX_WEB_CALLS_PER_DAY, PAGE_WINDOW_CHARS, PERSONAL_DETAILS_BLOCKED, UNTRUSTED, WebBudget } from "./web.ts";
import { createWebTool, NOT_SET_UP, UNSEEN_LINK, type WebDeps } from "./webtool.ts";

const KEY = "kagi-7Qm2Xv9pL4sT8wRz";
const MORNING = new Date("2026-11-06T09:30:00Z");
const SEARCH_REPLY = {
	data: {
		search: [
			{ url: "https://ergo.chat/", title: "Ergo IRC Server", snippet: "<strong>Ergo</strong> is a modern IRCd" },
		],
	},
};

type Reply = { status?: number; body: unknown };
type Sent = { url: string; init: RequestInit };

const noRules = async () => [];

type Args = Parameters<ReturnType<typeof createWebTool>["execute"]>[0];

/** The web tool on a state store, with a fake Kagi that answers `reply` and keeps what it was sent. */
async function withWebTool(
	reply: Reply,
	use: (tool: {
		run: (args: Args) => Promise<ToolExecutionResult>;
		sent: Sent[];
		spent: () => Promise<number>;
		harness: Harness;
		deps: WebDeps;
	}) => Promise<void>,
	{ path, ...deps }: WebDeps & { path?: string } = {},
) {
	const harness = await openHarness(path);
	try {
		const sent: Sent[] = [];
		const fetch = (async (url: string, init: RequestInit) => {
			sent.push({ url, init });
			return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
		}) as typeof globalThis.fetch;
		const all = { key: () => KEY, fetch, rules: noRules, now: () => MORNING, ...deps };
		const tool = createWebTool(all);
		const api = inNewRun(harness);
		const run = (args: Args) => tool.execute(args, api, BACKGROUND_CONTEXT);
		const spent = async () => (await harness.snapshot(WebBudget, BACKGROUND_CONTEXT))?.calls ?? 0;
		await use({ run, sent, spent, harness, deps: all });
	} finally {
		await harness.close(BACKGROUND_CONTEXT);
	}
}

const textOf = ({ output }: ToolExecutionResult) => String((output?.[0] as { text?: string } | undefined)?.text);

test("a search returns marked, plain results, sends the key only as auth, and spends one call", async () => {
	await withWebTool({ body: SEARCH_REPLY }, async ({ run, sent, spent }) => {
		const result = await run({ search: "ergo irc" });
		assert.equal(result.isError, false);
		assert.deepEqual(JSON.parse(textOf(result)), {
			notice: UNTRUSTED,
			query: "ergo irc",
			results: [{ title: "Ergo IRC Server", url: "https://ergo.chat/", snippet: "Ergo is a modern IRCd" }],
		});
		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.url, "https://kagi.com/api/v1/search");
		assert.equal((sent[0]?.init.headers as Record<string, string> | undefined)?.Authorization, `Bearer ${KEY}`);
		assert.doesNotMatch(String(sent[0]?.init.body), new RegExp(KEY));
		assert.equal(await spent(), 1);
	});
});

test("without a key the tool says it isn't set up and calls nothing", async () => {
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, sent, spent }) => {
			assert.deepEqual(await run({ search: "ergo" }), { output: [{ type: "text", text: NOT_SET_UP }], isError: true });
			assert.deepEqual([sent, await spent()], [[], 0]);
		},
		{ key: () => undefined },
	);
});

test("bad arguments and leaks are refused before they cost anything", async () => {
	await withWebTool({ body: SEARCH_REPLY }, async ({ run, sent, spent }) => {
		assert.match(textOf(await run({})), /either `search` or `read`/);
		assert.equal(textOf(await run({ search: "bob%40example.org address" })), PERSONAL_DETAILS_BLOCKED);
		assert.deepEqual([sent, await spent()], [[], 0]);
	});
});

test("a gitleaks that can't run refuses the call rather than letting it out", async () => {
	const broken = async () => {
		throw new Error("spawn gitleaks ENOENT");
	};
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, sent }) => {
			const result = await run({ search: "ergo" });
			assert.deepEqual([result.isError, textOf(result)], [true, "spawn gitleaks ENOENT"]);
			assert.deepEqual(sent, []);
		},
		{ rules: broken },
	);
});

test("kagi's refusal comes back as the tool's error, and the call still counts", async () => {
	const reply = { status: 429, body: { errors: [{ code: "billing.limit", message: "Usage limit exhausted" }] } };
	await withWebTool(reply, async ({ run, spent }) => {
		const result = await run({ search: "ergo" });
		assert.deepEqual([result.isError, textOf(result)], [true, "kagi refused it (HTTP 429): Usage limit exhausted"]);
		assert.equal(await spent(), 1);
	});
});

test("an error that quotes the key never shows it to the model", async () => {
	const reply = { status: 401, body: { errors: [{ message: `bad token ${KEY}` }] } };
	await withWebTool(reply, async ({ run }) => {
		const text = textOf(await run({ search: "ergo" }));
		assert.doesNotMatch(text, new RegExp(KEY));
		assert.match(text, /bad token \[key\]/);
	});
});

test("a spent day's budget refuses calls, across restarts, until the next UTC day", async () => {
	const path = await freshStatePath();
	const spentHarness = await openHarness(path);
	await spentHarness.commit(async (tx) => {
		Object.assign(await tx.doc(WebBudget), { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY });
	}, BACKGROUND_CONTEXT);
	await spentHarness.close(BACKGROUND_CONTEXT);
	let now = MORNING;
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, sent }) => {
			assert.match(textOf(await run({ search: "ergo" })), /budget of 100 calls a day is spent/);
			assert.deepEqual(sent, []);
			now = new Date("2026-11-07T00:00:05Z");
			assert.equal((await run({ search: "ergo" })).isError, false);
			assert.equal(sent.length, 1);
		},
		{ path, now: () => now },
	);
});

test("calls racing for the day's last unit of budget let exactly one through", async () => {
	const path = await freshStatePath();
	const almost = await openHarness(path);
	await almost.commit(async (tx) => {
		Object.assign(await tx.doc(WebBudget), { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY - 1 });
	}, BACKGROUND_CONTEXT);
	await almost.close(BACKGROUND_CONTEXT);
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, sent, spent }) => {
			const results = await Promise.all([run({ search: "a" }), run({ search: "b" }), run({ search: "c" })]);
			assert.equal(results.filter((result) => !result.isError).length, 1);
			assert.equal(sent.length, 1);
			assert.equal(await spent(), MAX_WEB_CALLS_PER_DAY);
		},
		{ path },
	);
});

test("web calls count against the same per-run cap as the other tools", async () => {
	await withWebTool({ body: SEARCH_REPLY }, async ({ run, sent }) => {
		for (let i = 0; i < MAX_CALLS_PER_RUN; i++) await run({ search: `ergo ${i}` });
		assert.deepEqual(await run({ search: "one more" }), {
			output: [{ type: "text", text: TOO_MANY_CALLS }],
			isError: true,
		});
		assert.equal(sent.length, MAX_CALLS_PER_RUN);
	});
});

const MANUAL = `# Ergo manual\n\nSee [history](https://ergo.chat/manual.html#history) and https://github.com/ergochat/ergo.\n\n${"bouncer ".repeat(1500)}`;
const SEARCH_THEN_PAGE: Reply[] = [
	{ body: { data: { search: [{ url: "https://ergo.chat/manual.html#top", title: "Ergo manual" }] } } },
	{ body: { data: [{ url: "https://ergo.chat/manual.html", markdown: MANUAL }] } },
];

/** A fetch that answers each call with the next of `replies`, keeping what it was sent. */
function scripted(replies: Reply[], sent: Sent[]) {
	return (async (url: string, init: RequestInit) => {
		sent.push({ url, init });
		const reply = replies[Math.min(sent.length, replies.length) - 1] as Reply;
		return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
	}) as typeof globalThis.fetch;
}

const seenLinks = async (harness: Harness) => (await harness.snapshot(SeenLinks, BACKGROUND_CONTEXT))?.links ?? [];

test("a link the bot never saw can't be read, and costs nothing", async () => {
	await withWebTool({ body: SEARCH_REPLY }, async ({ run, sent, spent }) => {
		const result = await run({ read: "https://evil.example/collect?about=luiz" });
		assert.deepEqual([result.isError, textOf(result)], [true, UNSEEN_LINK]);
		assert.deepEqual([sent, await spent()], [[], 0]);
	});
});

test("a link from a search can be read, and the page's links can be read next", async () => {
	const sent: Sent[] = [];
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, spent, harness }) => {
			await run({ search: "ergo manual" });
			assert.deepEqual(await seenLinks(harness), ["https://ergo.chat/manual.html"]);
			const page = JSON.parse(textOf(await run({ read: "https://ergo.chat/manual.html" })));
			assert.deepEqual([page.notice, page.from, page.next], [UNTRUSTED, 0, PAGE_WINDOW_CHARS]);
			assert.ok(page.text.startsWith("# Ergo manual"));
			assert.deepEqual(
				sent.map((call) => call.url),
				["https://kagi.com/api/v1/search", "https://kagi.com/api/v1/extract"],
			);
			assert.equal(await spent(), 2);
			assert.deepEqual((await seenLinks(harness)).slice(-1), ["https://github.com/ergochat/ergo"]);
		},
		{ fetch: scripted(SEARCH_THEN_PAGE, sent) },
	);
});

test("going on through a page read lately costs nothing more", async () => {
	const sent: Sent[] = [];
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, spent }) => {
			await run({ search: "ergo manual" });
			await run({ read: "https://ergo.chat/manual.html" });
			const rest = JSON.parse(
				textOf(await run({ read: "https://ergo.chat/manual.html#faq", from: PAGE_WINDOW_CHARS })),
			);
			assert.equal(rest.text, MANUAL.slice(PAGE_WINDOW_CHARS, 2 * PAGE_WINDOW_CHARS));
			assert.equal(sent.length, 2);
			assert.equal(await spent(), 2);
		},
		{ fetch: scripted(SEARCH_THEN_PAGE, sent) },
	);
});

test("a link pasted in chat can be read once it's remembered", async () => {
	const sent: Sent[] = [];
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, harness }) => {
			await harness.commit(async (tx) => {
				rememberLinks(await tx.doc(SeenLinks), linksIn("luiz: louro, what's https://ergo.chat/manual.html about?"));
			}, BACKGROUND_CONTEXT);
			assert.equal((await run({ read: "https://ergo.chat/manual.html" })).isError, false);
		},
		{ fetch: scripted(SEARCH_THEN_PAGE.slice(1), sent) },
	);
});

test("a page kagi can't read still counts against the budget", async () => {
	const sent: Sent[] = [];
	const replies = [SEARCH_THEN_PAGE[0] as Reply, { body: { data: [{ url: "https://ergo.chat/manual.html" }] } }];
	await withWebTool(
		{ body: SEARCH_REPLY },
		async ({ run, spent }) => {
			await run({ search: "ergo manual" });
			const result = await run({ read: "https://ergo.chat/manual.html" });
			assert.deepEqual([result.isError, textOf(result)], [true, "kagi couldn't read that page"]);
			assert.equal(await spent(), 2);
		},
		{ fetch: scripted(replies, sent) },
	);
});
