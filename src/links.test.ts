import assert from "node:assert/strict";
import { test } from "node:test";
import { linksIn, MAX_SEEN_LINKS, normalLink, rememberLinks } from "./links.ts";

test("a link is kept normalized and without its fragment", () => {
	assert.equal(normalLink("https://Ergo.Chat/about#history"), "https://ergo.chat/about");
	assert.equal(normalLink("https://ergo.chat"), "https://ergo.chat/");
	assert.equal(normalLink("https://bücher.example/"), "https://xn--bcher-kva.example/");
});

test("only plain https links count", () => {
	for (const text of [
		"http://ergo.chat/",
		"ergo.chat",
		"file:///etc/passwd",
		"https://bob:hunter2@ergo.chat/",
		"https://",
	]) {
		assert.equal(normalLink(text), undefined, text);
	}
});

test("finds the links in chat and in markdown, without the punctuation around them", () => {
	const chat =
		"louro: read https://ergo.chat/about. also (https://github.com/ergochat/ergo/releases), http://old.example/";
	assert.deepEqual(linksIn(chat), ["https://ergo.chat/about", "https://github.com/ergochat/ergo/releases"]);
	const markdown = "See [the manual](https://ergo.chat/manual.html#history) and **https://ergo.chat/faq**.";
	assert.deepEqual(linksIn(markdown), ["https://ergo.chat/manual.html", "https://ergo.chat/faq"]);
	assert.deepEqual(linksIn("no links here, just https:// talk"), []);
	const wiki =
		"(see https://en.wikipedia.org/wiki/IRC_(disambiguation)), [irc](https://en.wikipedia.org/wiki/IRC_(protocol))";
	assert.deepEqual(linksIn(wiki), [
		"https://en.wikipedia.org/wiki/IRC_(disambiguation)",
		"https://en.wikipedia.org/wiki/IRC_(protocol)",
	]);
});

test("remembering moves a link to the newest and keeps it once", () => {
	const seen = { links: ["https://a.example/", "https://b.example/"] };
	rememberLinks(seen, ["https://a.example/", "https://c.example/", "https://c.example/"]);
	assert.deepEqual(seen.links, ["https://b.example/", "https://a.example/", "https://c.example/"]);
});

test("only the latest links are kept", () => {
	const seen = { links: Array.from({ length: MAX_SEEN_LINKS }, (_, i) => `https://old.example/${i}`) };
	rememberLinks(seen, ["https://new.example/"]);
	assert.equal(seen.links.length, MAX_SEEN_LINKS);
	assert.equal(seen.links[0], "https://old.example/1");
	assert.equal(seen.links.at(-1), "https://new.example/");
});

test("remembering nothing changes nothing", () => {
	const seen = { links: ["https://a.example/"] };
	rememberLinks(seen, []);
	assert.deepEqual(seen.links, ["https://a.example/"]);
});
