import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { privateStatePath } from "./state.ts";

const stateHome = () => mkdtemp(join(tmpdir(), "louro-pi-state-"));
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

test("puts the database under XDG_STATE_HOME in a directory only the user can enter", async () => {
	const home = await stateHome();
	const path = await privateStatePath({ XDG_STATE_HOME: home });
	assert.equal(path, join(home, "louro-pi", "louro.sqlite"));
	assert.equal(await modeOf(dirname(path)), 0o700);
});

test("closes a state directory that is already world-readable", async () => {
	const home = await stateHome();
	await mkdir(join(home, "louro-pi"), { mode: 0o755 });
	const path = await privateStatePath({ XDG_STATE_HOME: home });
	assert.equal(await modeOf(dirname(path)), 0o700);
});
