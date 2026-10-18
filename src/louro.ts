import { execFile } from "node:child_process";
import type { ExecError } from "./command.ts";

const LOURO_BIN = process.env.LOURO_BIN ?? "louro";

/** louro never needs the model's key, and a louro bug could leak what it is given. */
export function louroEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const { LITELLM_API_KEY: _, ...rest } = env;
	return rest;
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
