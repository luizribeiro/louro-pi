import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type ConversationId, LiveDoc, type SubmissionId, type TaskId } from "@earendil-works/pi-durable";
import {
	CALLS_BEFORE_ENDING_RUN,
	callCounter,
	louroExtension,
	louroTool,
	MAX_CALLS_PER_RUN,
	SCOPE_NOTE,
	TOO_MANY_CALLS,
	WAIT_NOTE,
} from "./tool.ts";

const SYSTEM = "You are louro, a bot on IRC.\n";
const PRIMER = "louro connects you to IRC as a bot.\n\nRun `louro <command> --help` for a command's flags.\n";

let runs = 0;

const BOTS = 1 as ConversationId;
const LUIZ = 2 as ConversationId;
const ROOT = 3 as ConversationId;

const conversations = {
	byKey: {
		"#bots": { id: BOTS, scope: { kind: "channel", name: "#bots" } },
		"account:luiz": { id: LUIZ, scope: { kind: "dm", partner: "luiz" } },
	},
};

/** The tool's api inside a new run of a conversation, as pi-durable's documents show it. */
function inNewRun(conversationId = BOTS) {
	const live = { run: { taskId: 30 as TaskId, inputs: [++runs as SubmissionId] } };
	const snapshot = async (token: unknown) => (token === LiveDoc ? live : conversations);
	return { conversationId, snapshot } as unknown as Parameters<typeof louroTool.execute>[1];
}

async function refusal(command: string, api: ReturnType<typeof inNewRun>) {
	const result = await louroTool.execute({ command }, api, BACKGROUND_CONTEXT);
	assert.equal(result.isError, true, command);
	return JSON.stringify(result.output);
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
		`You are louro, a bot on IRC.\n\nlouro connects you to IRC as a bot.\n\nRun \`louro <command> --help\` for a command's flags.\n\n${WAIT_NOTE}\n\n${SCOPE_NOTE}`,
	);
});

test("rejects a disallowed command without running louro", async () => {
	const api = inNewRun();
	for (const command of ["louro wait --timeout 60", "louro quit", "louro status; ls"]) {
		assert.match(await refusal(command, api), /not allowed/, command);
	}
});

test("refuses a command aimed past its conversation's target without running louro", async () => {
	assert.match(await refusal("louro send luiz 'the secret word?'", inNewRun(BOTS)), /this conversation is #bots/);
	assert.match(await refusal("louro history luiz", inNewRun(BOTS)), /this conversation is #bots/);
	assert.match(await refusal("louro send '#bots' 'papaya'", inNewRun(LUIZ)), /your DMs with luiz/);
	assert.match(await refusal("louro status", inNewRun(ROOT)), /no IRC channel or DM partner/);
});

test("allows 8 calls per run, refuses 4 more, then ends the run", () => {
	assert.equal(MAX_CALLS_PER_RUN, 8);
	assert.equal(CALLS_BEFORE_ENDING_RUN, 12);
	const count = callCounter();
	const verdicts = Array.from({ length: 14 }, () => count(BOTS, "run-1"));
	assert.deepEqual(verdicts, [...Array(8).fill("run"), ...Array(4).fill("refuse"), "end", "end"]);
	assert.equal(count(BOTS, "run-2"), "run");
	assert.equal(count(BOTS, "run-2"), "run");
});

test("counts each conversation's runs on their own, even when they interleave", () => {
	const count = callCounter();
	for (let i = 0; i < MAX_CALLS_PER_RUN; i++) {
		assert.equal(count(BOTS, "run-1"), "run");
		assert.equal(count(LUIZ, "run-2"), "run");
	}
	assert.equal(count(BOTS, "run-1"), "refuse");
	assert.equal(count(LUIZ, "run-2"), "refuse");
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
