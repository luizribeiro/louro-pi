import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type Conversation,
	type ConversationId,
	createRegistry,
	Harness,
	watchEvents,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { formatResult } from "./command.ts";
import { agentChange, harnessSettings, litellmModels } from "./config.ts";
import { Conversations, conversationFor, type Route } from "./conversations.ts";
import { runLouro } from "./louro.ts";
import { privateStatePath } from "./state.ts";
import type { Scope } from "./target.ts";
import { louroExtension, louroTool } from "./tool.ts";
import { formatEvent, labeled } from "./view.ts";
import { forwardEvents, WAIT_ARGS } from "./wait.ts";

// Margin over wait's own 60s timeout plus its settle time, so only a hung louro gets killed.
const WAIT_TIMEOUT_MS = 90_000;
const SYSTEM_PATH = process.env.LOURO_PI_SYSTEM ?? new URL("../SYSTEM.md", import.meta.url);

async function primer(): Promise<string> {
	const { error, stdout, stderr } = await runLouro(["--help"], 10_000);
	if (error) throw new Error(`louro --help failed: ${formatResult(error, stdout, stderr)}`);
	return stdout;
}

const extension = louroExtension(await readFile(SYSTEM_PATH, "utf8"), await primer());
const registry = createRegistry();
registry.install(extension);

const harness = await Harness.open(
	await openNodeSqliteStorage(await privateStatePath()),
	{
		models: litellmModels(),
		registry,
		settings: harnessSettings(extension),
		onReport: (error) => console.error(`! ${error}`),
	},
	BACKGROUND_CONTEXT,
);
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
harness.closed.then((end) => {
	if (end.reason === "failed") {
		console.error(`! storage failed: ${end.error}`);
		process.exitCode = 1;
		stop();
	}
});

const opened = new Map<ConversationId, { conversation: Conversation; scope: Scope }>();

async function open(id: ConversationId, scope: Scope): Promise<Conversation> {
	const known = opened.get(id);
	if (known) {
		known.scope = scope;
		return known.conversation;
	}
	const conversation = await harness.conversation(id, BACKGROUND_CONTEXT);
	if (!conversation) throw new Error(`conversation ${id} is missing`);
	await conversation.configure(agentChange(extension, louroTool), BACKGROUND_CONTEXT);
	const entry = { conversation, scope };
	opened.set(id, entry);
	const events = await watchEvents(harness, id, BACKGROUND_CONTEXT);
	events.start(async (batch) => {
		for (const line of batch.flatMap(formatEvent)) console.log(labeled(entry.scope, line));
	});
	return conversation;
}

async function conversationOf(route: Route): Promise<Conversation> {
	const id = await harness.commit((tx) => conversationFor(tx, route), BACKGROUND_CONTEXT);
	return open(id, route.scope);
}

const known = await harness.snapshot(Conversations, BACKGROUND_CONTEXT);
for (const { id, scope } of Object.values(known?.byKey ?? {})) await open(id, scope);
harness.resume();

await forwardEvents(
	{
		wait: (signal) => runLouro(WAIT_ARGS, WAIT_TIMEOUT_MS, signal),
		newId: randomUUID,
		// Admission is owed once louro handed the batch over, so shutdown must not abort it.
		submit: async (route, input) => (await conversationOf(route)).submit(input, BACKGROUND_CONTEXT),
		sleep: (ms, signal) => sleep(ms, undefined, { signal }).catch(() => {}),
		print: console.log,
		warn: console.error,
	},
	shutdown.signal,
);
await harness.close(BACKGROUND_CONTEXT);
