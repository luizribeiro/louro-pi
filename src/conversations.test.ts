import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Conversations, conversationFor, routeOf, scopeOf } from "./conversations.ts";

const luiz = { nick: "luiz", account: "luiz", away: false, bot: false };
const chat = { type: "message", time: "2026-10-17T21:04:11.392Z", msgid: "4y8kq7j2c9mnz", origin: "live" };

test("routes channel chat to its channel, casefolded", () => {
	const message = { ...chat, target: "#Bots", private: false, from: luiz, text: "louro: hi" };
	assert.deepEqual(routeOf(message), {
		key: "#bots",
		scope: { kind: "channel", name: "#Bots" },
	});
});

test("routes a DM by the sender's account, and drops one from a sender who isn't logged in", () => {
	const dm = { ...chat, target: "Luiz_", private: true, text: "the secret word is papaya" };
	assert.deepEqual(routeOf({ ...dm, from: { ...luiz, nick: "Luiz_", account: "Luiz" } }), {
		key: "account:luiz",
		scope: { kind: "dm", partner: "Luiz_" },
	});
	assert.equal(routeOf({ ...dm, target: "luiz", from: { ...luiz, account: null } }), undefined);
	assert.equal(routeOf({ ...dm, target: "luiz", from: { nick: "luiz" } }), undefined);
});

test("routes an invite to the inviter's DMs and louro's connection reports nowhere", () => {
	const invite = { type: "invite", time: chat.time, from: luiz, channel: "#lounge", untrusted: true };
	const connection = { type: "connection", time: chat.time, state: "disconnected", retry_in: 5 };
	assert.deepEqual(routeOf(invite), { key: "account:luiz", scope: { kind: "dm", partner: "luiz" } });
	assert.equal(routeOf(connection), undefined);
});

test("only an event marked public reaches a channel", () => {
	for (const flag of [true, undefined, "false"]) {
		const message = { ...chat, target: "#bots", private: flag, from: luiz, text: "psst" };
		assert.equal(routeOf(message)?.scope.kind, "dm", String(flag));
	}
});

async function openHarness(path: string) {
	const storage = await openNodeSqliteStorage(path);
	return Harness.open(storage, { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
}

test("keeps one conversation per target across restarts, and finds each one's scope", async () => {
	const path = join(await mkdtemp(join(tmpdir(), "louro-pi-conversations-")), "louro.sqlite");
	const bots = { key: "#bots", scope: { kind: "channel", name: "#bots" } } as const;
	const luizDm = (partner: string) => ({ key: "account:luiz", scope: { kind: "dm", partner } }) as const;

	let harness = await openHarness(path);
	const claim = (route: Parameters<typeof conversationFor>[1]) =>
		harness.commit((tx) => conversationFor(tx, route), BACKGROUND_CONTEXT);
	const botsId = await claim(bots);
	const luizId = await claim(luizDm("luiz"));
	assert.notEqual(botsId, luizId);
	assert.equal(await claim(bots), botsId);
	await harness.close(BACKGROUND_CONTEXT);

	harness = await openHarness(path);
	assert.equal(await claim(luizDm("luiz_")), luizId);
	const conversations = await harness.snapshot(Conversations, BACKGROUND_CONTEXT);
	assert.deepEqual(scopeOf(conversations, botsId), { kind: "channel", name: "#bots" });
	assert.deepEqual(scopeOf(conversations, luizId), { kind: "dm", partner: "luiz_" });
	assert.equal(scopeOf(conversations, (luizId + 100) as typeof luizId), undefined);
	assert.equal(scopeOf(undefined, botsId), undefined);
	await harness.close(BACKGROUND_CONTEXT);
});
