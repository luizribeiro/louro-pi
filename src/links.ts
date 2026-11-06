import { defineDoc } from "@earendil-works/pi-durable";

export const MAX_SEEN_LINKS = 300;

type SeenLinks = { links: string[] };

/**
 * The https links the bot has come across in chat, search results and pages it read; it may read only these, so a
 * link it writes itself can't carry what it knows out to someone's server.
 */
export const SeenLinks = defineDoc<SeenLinks>({
	kind: "louro.links",
	version: 1,
	scope: "session",
	initial: () => ({ links: [] }),
});

/** A link as it's kept and compared: parsed, https only, with no fragment; undefined if it isn't one. */
export function normalLink(text: string): string | undefined {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.username || url.password) return undefined;
	url.hash = "";
	return url.href;
}

const LINK = /https:\/\/[^\s<>"'`]+/g;
// Prose punctuation that ends a sentence or a markdown link, not the link itself.
const TRAILING = /[.,;:!?\]}*_]+$/;

const count = (text: string, char: string) => text.split(char).length - 1;

/** The link without what ends the sentence around it; a `)` stays when it closes one the link opened. */
function trimmed(match: string): string {
	let link = match.replace(TRAILING, "");
	while (link.endsWith(")") && count(link, ")") > count(link, "(")) link = link.slice(0, -1).replace(TRAILING, "");
	return link;
}

/** The https links written out in `text`, normalized, in order. */
export function linksIn(text: string): string[] {
	return [...text.matchAll(LINK)].flatMap(([match]) => normalLink(trimmed(match)) ?? []);
}

/** Adds `links` as the newest, keeping each once and only the latest MAX_SEEN_LINKS. */
export function rememberLinks(seen: SeenLinks, links: readonly string[]): void {
	if (links.length === 0) return;
	const added = new Set(links);
	seen.links = [...seen.links.filter((link) => !added.has(link)), ...added].slice(-MAX_SEEN_LINKS);
}
