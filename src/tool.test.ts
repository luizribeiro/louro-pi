import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { CALLS_BEFORE_ENDING_RUN, MAX_CALLS_PER_RUN, TOO_MANY_CALLS } from "./calls.ts";
import { inNewRun } from "./fixtures.ts";
import { memorySection } from "./memory.ts";
import { timersSection } from "./timers.ts";
import { louroExtension, louroTool, ROOM_NOTE, WAIT_NOTE } from "./tool.ts";

const SYSTEM = "You are louro, a bot on IRC.\n";
const PRIMER = "louro connects you to IRC as a bot.\n\nRun `louro <command> --help` for a command's flags.\n";

async function refusal(command: string, api: ReturnType<typeof inNewRun>) {
	const result = await louroTool.execute({ command }, api, BACKGROUND_CONTEXT);
	assert.equal(result.isError, true, command);
	return JSON.stringify(result.output);
}

test("the extension has the louro, memory, timer and web tools, an untagged prompt, then the memory and timers", async () => {
	const extension = louroExtension(SYSTEM, PRIMER);
	assert.deepEqual(
		extension.tools?.map((tool) => tool.name),
		["louro", "memory", "timer", "web"],
	);
	const [prompt, memory, timers, ...rest] = extension.sections ?? [];
	assert.equal(rest.length, 0);
	assert.equal(memory, memorySection);
	assert.equal(timers, timersSection);
	assert.equal(prompt?.tag, false);
	const input = { conversationId: 1 as ConversationId } as Parameters<NonNullable<typeof prompt>["render"]>[0];
	assert.equal(
		await prompt?.render(input, BACKGROUND_CONTEXT),
		`You are louro, a bot on IRC.\n\nlouro connects you to IRC as a bot.\n\nRun \`louro <command> --help\` for a command's flags.\n\n${WAIT_NOTE}\n\n${ROOM_NOTE}`,
	);
});

test("rejects a disallowed command without running louro", async () => {
	const api = inNewRun();
	for (const command of ["louro wait --timeout 60", "louro quit", "louro status; ls"]) {
		assert.match(await refusal(command, api), /not allowed/, command);
	}
});

test("refuses louro calls past the cap and asks to end a run that keeps calling", async () => {
	const api = inNewRun();
	const call = () => louroTool.execute({ command: "louro quit" }, api, BACKGROUND_CONTEXT);
	for (let i = 0; i < MAX_CALLS_PER_RUN; i++) assert.match(JSON.stringify((await call()).output), /not allowed/);
	for (let i = MAX_CALLS_PER_RUN; i < CALLS_BEFORE_ENDING_RUN; i++) {
		assert.deepEqual(await call(), { output: [{ type: "text", text: TOO_MANY_CALLS }], isError: true });
	}
	assert.deepEqual(await call(), {
		output: [{ type: "text", text: TOO_MANY_CALLS }],
		isError: true,
		control: { terminate: true },
	});
	assert.match(
		JSON.stringify((await louroTool.execute({ command: "louro quit" }, inNewRun(), BACKGROUND_CONTEXT)).output),
		/not allowed/,
	);
});
