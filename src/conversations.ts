import { type ConversationId, defineDoc, type Tx } from "@earendil-works/pi-durable";
import { casefold, type Scope } from "./target.ts";

/** Where a `louro wait` event belongs: its channel's conversation, or its sender's DMs. */
export type Route = { key: string; scope: Scope };

type Event = {
	[field: string]: unknown;
	private?: unknown;
	target?: unknown;
	from?: { nick?: unknown; account?: unknown };
};

/**
 * Only an event louro marks public goes to a channel. Anything else with a sender, a DM or an invite, goes to the
 * sender's DMs; events with neither, like louro's own connection reports, belong to no conversation.
 */
export function routeOf(event: Event): Route | undefined {
	if (event.private === false && typeof event.target === "string") {
		return { key: casefold(event.target), scope: { kind: "channel", name: event.target } };
	}
	const { nick, account } = event.from ?? {};
	if (typeof nick !== "string") return undefined;
	// An account is proof of who sent it; a bare nick is not, so the two never share a conversation.
	const key = typeof account === "string" ? `account:${casefold(account)}` : `nick:${casefold(nick)}`;
	return { key, scope: { kind: "dm", partner: nick } };
}

type Known = { byKey: Record<string, { id: ConversationId; scope: Scope }> };

export const Conversations = defineDoc<Known>({
	kind: "louro.conversations",
	version: 1,
	scope: "session",
	initial: () => ({ byKey: {} }),
});

/** The route's conversation, created on first use; a DM's partner follows the nick of their latest message. */
export async function conversationFor(tx: Tx, { key, scope }: Route): Promise<ConversationId> {
	const { byKey } = await tx.doc(Conversations);
	const id = byKey[key]?.id ?? (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
	byKey[key] = { id, scope };
	return id;
}

export function scopeOf(conversations: Readonly<Known> | undefined, id: ConversationId): Scope | undefined {
	return Object.values(conversations?.byKey ?? {}).find((conversation) => conversation.id === id)?.scope;
}
