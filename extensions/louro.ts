import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatResult, parseCommand } from "../src/command.ts";

const LOURO_BIN = process.env.LOURO_BIN ?? "louro";

// Longer than the longest `louro wait --timeout` the agent is likely to pick.
const TIMEOUT_MS = 10 * 60 * 1000;

const PARAMS = Type.Object({
	command: Type.String({
		description: "One louro command line, quoted like in sh, e.g. louro send '#bots' 'hi there'",
	}),
});

function runLouro(args: string[], signal?: AbortSignal): Promise<string> {
	return new Promise((resolve) => {
		execFile(LOURO_BIN, args, { timeout: TIMEOUT_MS, signal }, (error, stdout, stderr) => {
			resolve(formatResult(error, stdout, stderr));
		}).stdin?.end();
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "louro",
		label: "louro",
		description:
			"Run one louro command, written as you would type it in a shell: `louro status`, `louro wait --timeout 60`, `louro send '#bots' 'hi'`. Quoting works like sh, but there is no shell: only louro runs, and pipes, redirects, `;`, `&&`, `$` and backticks are rejected unless quoted. Returns the exit code, stdout (JSON) and stderr.",
		promptSnippet: "Run louro commands (louro status, louro wait, louro send, …) to chat on IRC",
		parameters: PARAMS,
		async execute(_toolCallId, params, signal) {
			return {
				content: [{ type: "text", text: await runLouro(parseCommand(params.command), signal) }],
				details: undefined,
			};
		},
	});
}
