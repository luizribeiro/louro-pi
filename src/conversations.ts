import { type ConversationId, defineDoc, type Tx } from "@earendil-works/pi-durable";

export const BotConversation = defineDoc<{ id?: ConversationId }>({
	kind: "louro.conversation",
	version: 1,
	scope: "session",
	initial: () => ({}),
});

/** The one conversation that hears every channel and DM, created on first use. */
export async function botConversation(tx: Tx): Promise<ConversationId> {
	const known = await tx.doc(BotConversation);
	known.id ??= (await tx.createConversation({ ownership: { kind: "ownerless" } })).id;
	return known.id;
}
