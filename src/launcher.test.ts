import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const LAUNCHER = join(import.meta.dirname, "..", "louro-pi");

async function writeScript(path: string, body: string) {
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
}

/** Runs louro-pi against a fake louro whose `status` exits with `statusCode`. */
async function launch(statusCode: number) {
	const dir = await mkdtemp(join(tmpdir(), "louro-pi-launcher-"));
	const src = join(dir, "src");
	const bin = join(dir, "bin");
	const log = join(dir, "log");
	await mkdir(join(src, "src"), { recursive: true });
	await mkdir(join(src, "secrets"));
	await mkdir(bin);
	await writeFile(join(src, "louro.toml"), '[filter]\noutgoing = ["/bin/true"]\n');
	await writeFile(join(src, "secrets", "louro.yaml"), "password: x\n");
	await writeFile(join(src, "src", "main.ts"), `require("node:fs").appendFileSync(${JSON.stringify(log)}, "main\\n");`);
	await writeScript(
		join(bin, "louro"),
		`case "$1" in
  status) echo "louro: could not reach louro (louro isn't running)" >&2; exit ${statusCode} ;;
  connect) echo "connect $(cat password)" >> "${log}" ;;
esac`,
	);
	await writeScript(join(bin, "sops"), "printf hunter2");
	const run = spawnSync("bash", [LAUNCHER], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOURO_PI_SRC: src, LITELLM_API_KEY: "k" },
	});
	const steps = await readFile(log, "utf8").catch(() => "");
	await rm(dir, { recursive: true, force: true });
	return { status: run.status, stderr: run.stderr, steps: steps.trim().split("\n").filter(Boolean) };
}

test("a louro that isn't running gets connected quietly before the bot starts", async () => {
	const run = await launch(3);
	assert.equal(run.status, 0);
	assert.deepEqual(run.steps, ["connect hunter2", "main"]);
	assert.doesNotMatch(run.stderr, /could not reach louro/);
});

test("a louro that is already running goes straight to the bot", async () => {
	const run = await launch(0);
	assert.equal(run.status, 0);
	assert.deepEqual(run.steps, ["main"]);
	assert.equal(run.stderr, "");
});

test("a broken louro status stops the launch with its exit code", async () => {
	const run = await launch(127);
	assert.equal(run.status, 127);
	assert.deepEqual(run.steps, []);
	assert.match(run.stderr, /could not reach louro/);
	assert.match(run.stderr, /`louro status` failed with exit 127/);
});
