import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Returns the database path, in a directory only the user can enter, even one an older version created. */
export async function privateStatePath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
	const state = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	const path = join(state, "louro-pi", "louro.sqlite");
	await mkdir(dirname(path), { recursive: true });
	await chmod(dirname(path), 0o700);
	return path;
}
