import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import {
	type ConversationId,
	createRegistry,
	Harness,
	LiveDoc,
	type SubmissionId,
	type TaskId,
	type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

/** A harness on the sqlite file at `path`, or on a fresh one. */
export async function openHarness(path?: string): Promise<Harness> {
	const file = path ?? (await freshStatePath());
	const storage = await openNodeSqliteStorage(file);
	return Harness.open(storage, { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
}

export async function freshStatePath(): Promise<string> {
	return join(await mkdtemp(join(tmpdir(), "louro-pi-")), "louro.sqlite");
}

let runs = 0;

/** A tool's api inside a new run of the conversation, committing to `harness` like pi-durable does. */
export function inNewRun(harness?: Harness): ToolExecutionApi {
	const live = { run: { taskId: 30 as TaskId, inputs: [++runs as SubmissionId] } };
	return {
		conversationId: 1 as ConversationId,
		snapshot: async (token: unknown) => (token === LiveDoc ? live : undefined),
		...(harness ? { commit: harness.commit.bind(harness) } : {}),
	} as unknown as ToolExecutionApi;
}
