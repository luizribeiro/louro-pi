import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { botConversation } from "./conversations.ts";
import { openHarness } from "./fixtures.ts";

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
