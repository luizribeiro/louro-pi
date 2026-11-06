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

const UNREACHABLE = "louro: could not reach louro (louro isn't running)";
const MISMATCH = `{"error": {"code": "version_mismatch", "message": "the louro client and daemon speak different protocol versions"}}`;

type FakeLouro = { statusCode: number; statusStdout?: string; statusStderr?: string; connectCode?: number };

/** Runs louro-pi against a fake louro whose `status` prints the given output and exits with `statusCode`. */
async function launch({ statusCode, statusStdout = "", statusStderr = UNREACHABLE, connectCode = 0 }: FakeLouro) {
	const dir = await mkdtemp(join(tmpdir(), "louro-pi-launcher-"));
	const src = join(dir, "src");
	const bin = join(dir, "bin");
	const log = join(dir, "log");
	const stdoutFile = join(dir, "status-stdout");
	const stderrFile = join(dir, "status-stderr");
	await writeFile(stdoutFile, statusStdout);
	await writeFile(stderrFile, statusStderr);
	await mkdir(join(src, "src"), { recursive: true });
	await mkdir(join(src, "secrets"));
	await mkdir(bin);
	await writeFile(join(src, "louro.toml"), '[filter]\noutgoing = ["/bin/true"]\n');
	await writeFile(join(src, "secrets", "louro.yaml"), "password: x\n");
	await writeFile(join(src, "src", "main.ts"), `require("node:fs").appendFileSync(${JSON.stringify(log)}, "main\\n");`);
	await writeScript(
		join(bin, "louro"),
		`case "$1" in
  status) cat "${stdoutFile}"; cat "${stderrFile}" >&2; exit ${statusCode} ;;
  connect)
    case " $* " in *" --replace "*) mode=" --replace" ;; esac
    echo "connect$mode $(cat password)" >> "${log}"
    exit ${connectCode} ;;
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
	const run = await launch({ statusCode: 3 });
	assert.equal(run.status, 0);
	assert.deepEqual(run.steps, ["connect hunter2", "main"]);
	assert.doesNotMatch(run.stderr, /could not reach louro/);
});

test("a louro that is already running goes straight to the bot", async () => {
	const run = await launch({ statusCode: 0 });
	assert.equal(run.status, 0);
	assert.deepEqual(run.steps, ["main"]);
	assert.equal(run.stderr, "");
});

test("a broken louro status stops the launch with its exit code", async () => {
	const run = await launch({ statusCode: 127 });
	assert.equal(run.status, 127);
	assert.deepEqual(run.steps, []);
	assert.match(run.stderr, /could not reach louro/);
	assert.match(run.stderr, /`louro status` failed with exit 127/);
});

test("a louro from an older build gets replaced before the bot starts", async () => {
	const run = await launch({ statusCode: 11, statusStdout: MISMATCH });
	assert.equal(run.status, 0);
	assert.deepEqual(run.steps, ["connect --replace hunter2", "main"]);
	assert.doesNotMatch(run.stderr, /version_mismatch/);
});

test("a louro that can't be replaced stops the launch with connect's exit code", async () => {
	const run = await launch({ statusCode: 11, statusStdout: MISMATCH, connectCode: 3 });
	assert.equal(run.status, 3);
	assert.deepEqual(run.steps, ["connect --replace hunter2"]);
});

test("any other louro status failure with exit 1 still stops the launch", async () => {
	const run = await launch({ statusCode: 1 });
	assert.equal(run.status, 1);
	assert.deepEqual(run.steps, []);
	assert.match(run.stderr, /`louro status` failed with exit 1/);
});

test("a louro that fails to connect stops the launch with its exit code", async () => {
	const run = await launch({ statusCode: 3, connectCode: 2 });
	assert.equal(run.status, 2);
	assert.deepEqual(run.steps, ["connect hunter2"]);
});
