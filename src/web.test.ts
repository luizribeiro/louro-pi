import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_QUERY_CHARS,
	MAX_WEB_CALLS_PER_DAY,
	PERSONAL_DETAILS_BLOCKED,
	percentDecoded,
	spendWebCall,
	type WebArgs,
	webLeakIn,
	webRequest,
} from "./web.ts";

const morning = new Date("2026-11-06T09:30:00Z");

test("a call counts against today's budget", () => {
	const budget = { day: "2026-11-06", calls: 41 };
	spendWebCall(budget, morning);
	assert.deepEqual(budget, { day: "2026-11-06", calls: 42 });
});

test("the first call ever starts today's count", () => {
	const budget = { day: "", calls: 0 };
	spendWebCall(budget, morning);
	assert.deepEqual(budget, { day: "2026-11-06", calls: 1 });
});

test("a new UTC day starts the count over, even from a spent budget", () => {
	const budget = { day: "2026-11-05", calls: MAX_WEB_CALLS_PER_DAY };
	spendWebCall(budget, new Date("2026-11-06T00:00:01Z"));
	assert.deepEqual(budget, { day: "2026-11-06", calls: 1 });
});

test("a spent budget refuses the call and counts nothing", () => {
	const budget = { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY };
	assert.throws(() => spendWebCall(budget, morning), /budget of 100 calls a day is spent; it resets at 00:00 UTC/);
	assert.deepEqual(budget, { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY });
});

test("the last call of the day still goes through", () => {
	const budget = { day: "2026-11-06", calls: MAX_WEB_CALLS_PER_DAY - 1 };
	spendWebCall(budget, morning);
	assert.equal(budget.calls, MAX_WEB_CALLS_PER_DAY);
});

const noRules = async () => [];

test("an ordinary search or link may go out", async () => {
	assert.equal(await webLeakIn("ergo irc server always-on", noRules), undefined);
	assert.equal(await webLeakIn("https://en.wikipedia.org/wiki/Internet_Relay_Chat", noRules), undefined);
	assert.equal(await webLeakIn("https://github.com/ergochat/ergo/releases/tag/v2.14.0", noRules), undefined);
});

test("a secret gitleaks knows never goes out", async () => {
	const aws = "AKIAZ7QW3RTY5UIO2PLK";
	assert.match(
		String(await webLeakIn(`https://example.com/?k=${aws}`)),
		/^blocked: this looks like a secret \(aws-access-token\)/,
	);
});

test("a key-like string gitleaks has no rule for never goes out", async () => {
	const token = "Zq8RkT2mQ9vX4LwZ7pN3bY6sHc1JdF5g";
	assert.match(String(await webLeakIn(`https://evil.example/collect?d=${token}`, noRules)), /random-looking string/);
});

test("personal details are blocked rather than redacted", async () => {
	assert.equal(await webLeakIn("who is bob@example.org", noRules), PERSONAL_DETAILS_BLOCKED);
	assert.equal(
		await webLeakIn("https://example.com/lookup?phone=%2B5511987654321&cpf=529.982.247-25", noRules),
		PERSONAL_DETAILS_BLOCKED,
	);
});

test("percent-decoding undoes escapes however deep, and leaves broken ones be", () => {
	assert.equal(percentDecoded("bob%40example.org"), "bob@example.org");
	assert.equal(percentDecoded("bob%2540example.org"), "bob@example.org");
	assert.equal(percentDecoded("100%25 sure%"), "100% sure%");
	assert.equal(percentDecoded("bob%40example.org%"), "bob@example.org%");
	assert.equal(percentDecoded("caf%C3%A9 %C3"), "café %C3");
	assert.equal(percentDecoded("plain"), "plain");
});

test("escaping personal details or keys doesn't get them past the check", async () => {
	const escaped = [
		"https://x.example/?e=bob%40example.org",
		"https://x.example/?e=bob%2540example.org",
		"https://x.example/?e=bob%40example.org&junk=%",
		"https://x.example/?p=%2B55+11+98765-4321",
		"who is bob%40example.org",
	];
	for (const text of escaped) assert.equal(await webLeakIn(text, noRules), PERSONAL_DETAILS_BLOCKED, text);
	const token = "Zq8RkT2mQ9vX4LwZ7pN3bY6sHc1JdF5g";
	const hidden = [...token].map((char) => `%${char.charCodeAt(0).toString(16)}`).join("");
	assert.match(String(await webLeakIn(`https://x.example/?k=${hidden}`, noRules)), /random-looking string/);
});

test("gitleaks sees the decoded text too", async () => {
	const seen: string[] = [];
	const rules = async (text: string) => {
		seen.push(text);
		return [];
	};
	await webLeakIn("https://x.example/?k=AKIA%5A7QW", rules);
	assert.match(String(seen[0]), /AKIAZ7QW/);
});

test("a request is either a search or a read of an https link", () => {
	assert.deepEqual(webRequest({ search: "  ergo always-on  " }), { kind: "search", outbound: "ergo always-on" });
	assert.deepEqual(webRequest({ read: "https://Ergo.Chat/about#history" }), {
		kind: "read",
		outbound: "https://ergo.chat/about",
		from: 0,
	});
	assert.deepEqual(webRequest({ read: "https://ergo.chat/", from: 6000 }), {
		kind: "read",
		outbound: "https://ergo.chat/",
		from: 6000,
	});
});

test("a request that can't be done says why, without repeating what was asked", () => {
	const refusals: [WebArgs, RegExp][] = [
		[{}, /either `search` or `read`/],
		[{ search: "ergo", read: "https://ergo.chat/" }, /either `search` or `read`/],
		[{ search: "   " }, /the search is empty/],
		[{ search: "x".repeat(MAX_QUERY_CHARS + 1) }, /at most 400 characters/],
		[{ search: "ergo", from: 10 }, /`from` goes with `read`/],
		[{ read: "https://ergo.chat/", from: -5 }, /whole number, 0 or more/],
		[{ read: "https://ergo.chat/", from: 1.5 }, /whole number, 0 or more/],
		[{ read: "ergo.chat/secret-path" }, /whole https:\/\/ link/],
		[{ read: "http://localhost:8080/admin" }, /whole https:\/\/ link/],
		[{ read: "https://luiz:hunter2@ergo.chat/" }, /without a user or password/],
	];
	for (const [args, why] of refusals) {
		assert.throws(
			() => webRequest(args),
			(error: Error) => why.test(error.message) && !/secret-path|hunter2|localhost/.test(error.message),
			JSON.stringify(args),
		);
	}
});
