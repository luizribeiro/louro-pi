import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId, SubmissionId, TaskId } from "@earendil-works/pi-durable";
import {
	CALLS_BEFORE_ENDING_RUN,
	callCounter,
	louroExtension,
	louroTool,
	MAX_CALLS_PER_RUN,
	MAX_COMMAND_LENGTH,
	TOO_MANY_CALLS,
	WAIT_NOTE,
} from "./tool.ts";

const SYSTEM = "You are louro, a bot on IRC.\n";
const PRIMER = "louro connects you to IRC as a bot.\n\nRun `louro <command> --help` for a command's flags.\n";

let runs = 0;

/** The tool's api inside a new run, as pi-durable's live document shows it. */
function inNewRun() {
	const live = { run: { taskId: 30 as TaskId, inputs: [++runs as SubmissionId] } };
	return { conversationId: 1 as ConversationId, snapshot: async () => live } as unknown as Parameters<
		typeof louroTool.execute
	>[1];
}

test("the extension has only the louro tool and one untagged prompt", async () => {
	const extension = louroExtension(SYSTEM, PRIMER);
	assert.deepEqual(
		extension.tools?.map((tool) => tool.name),
		["louro"],
	);
	const [prompt, ...rest] = extension.sections ?? [];
	assert.equal(rest.length, 0);
	assert.equal(prompt?.tag, false);
	const input = { conversationId: 1 as ConversationId } as Parameters<NonNullable<typeof prompt>["render"]>[0];
	assert.equal(
		await prompt?.render(input, BACKGROUND_CONTEXT),
		`You are louro, a bot on IRC.\n\nlouro connects you to IRC as a bot.\n\nRun \`louro <command> --help\` for a command's flags.\n\n${WAIT_NOTE}`,
	);
});

test("rejects a disallowed command without running louro", async () => {
	const api = inNewRun();
	for (const command of ["louro wait --timeout 60", "louro quit", "louro status; ls"]) {
		const result = await louroTool.execute({ command }, api, BACKGROUND_CONTEXT);
		assert.equal(result.isError, true, command);
		assert.match(JSON.stringify(result.output), /not allowed/, command);
	}
});

test("rejects a command over the length limit without running louro", async () => {
	const api = inNewRun();
	const command = `louro send '#bots' '${"spam ".repeat(400)}'`;
	const result = await louroTool.execute({ command }, api, BACKGROUND_CONTEXT);
	assert.equal(result.isError, true);
	assert.deepEqual(result.output, [
		{ type: "text", text: `command is ${command.length} characters; the limit is ${MAX_COMMAND_LENGTH}` },
	]);
});

test("allows 8 calls per run, refuses 4 more, then ends the run", () => {
	assert.equal(MAX_CALLS_PER_RUN, 8);
	assert.equal(CALLS_BEFORE_ENDING_RUN, 12);
	const count = callCounter();
	const verdicts = Array.from({ length: 14 }, () => count("run-1"));
	assert.deepEqual(verdicts, [...Array(8).fill("run"), ...Array(4).fill("refuse"), "end", "end"]);
	assert.equal(count("run-2"), "run");
	assert.equal(count("run-2"), "run");
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
