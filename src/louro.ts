import { execFile } from "node:child_process";
import type { ExecError } from "./command.ts";

const LOURO_BIN = process.env.LOURO_BIN ?? "louro";

const BOT_KEYS = ["LITELLM_API_KEY", "KAGI_API_KEY"];

/** louro never needs the bot's API keys, and a louro bug could leak what it is given. */
export function louroEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([name]) => !BOT_KEYS.includes(name)));
}

export type LouroResult = { error: ExecError | null; stdout: string; stderr: string };

export function runLouro(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<LouroResult> {
	return new Promise((resolve) => {
		execFile(LOURO_BIN, args, { timeout: timeoutMs, signal, env: louroEnv(process.env) }, (error, stdout, stderr) => {
			resolve({ error, stdout, stderr });
			// louro send - reads stdin; an open pipe would hang it until the timeout.
		}).stdin?.end();
	});
}
