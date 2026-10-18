import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { louroExtension, louroTool, WAIT_NOTE } from "./tool.ts";

const SYSTEM = "You are louro, a bot on IRC.\n";
const PRIMER = "louro connects you to IRC as a bot.\n\nRun `louro <command> --help` for a command's flags.\n";

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
	const api = {} as Parameters<typeof louroTool.execute>[1];
	for (const command of ["louro wait --timeout 60", "louro quit", "louro status; ls"]) {
		const result = await louroTool.execute({ command }, api, BACKGROUND_CONTEXT);
		assert.equal(result.isError, true, command);
		assert.match(JSON.stringify(result.output), /not allowed/, command);
	}
});
