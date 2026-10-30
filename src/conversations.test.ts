import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { botConversation } from "./conversations.ts";

async function openHarness(path: string) {
	const storage = await openNodeSqliteStorage(path);
	return Harness.open(storage, { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
}

test("keeps the bot's one conversation across restarts", async () => {
	const path = join(await mkdtemp(join(tmpdir(), "louro-pi-conversations-")), "louro.sqlite");
	let harness = await openHarness(path);
	const claim = () => harness.commit(botConversation, BACKGROUND_CONTEXT);
	const id = await claim();
	assert.equal(await claim(), id);
	await harness.close(BACKGROUND_CONTEXT);

	harness = await openHarness(path);
	assert.equal(await claim(), id);
	await harness.close(BACKGROUND_CONTEXT);
});
