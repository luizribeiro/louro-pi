import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gitleaksRules } from "./gitleaks.ts";

const GITHUB = "ghp_R8kT2mQ9vX4LwZ7pN3bY6sHc1JdF5gA0eUqo";
const AWS = "AKIAZ7QW3RTY5UIO2PLK";
const SLACK = "xoxb-2048123456-4096123456789-Zq8RkT2mQ9vX4LwZ7pN3bY6s";
const JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJsdWl6IiwiaWF0IjoxNzkzMzk0NDk1fQ.Zq8RkT2mQ9vX4LwZ7pN3bY6sHc1JdF5gA0eUqoT3Blb";

test("gitleaks names the rules each realistic token trips, and none for chat", async () => {
	assert.deepEqual(await gitleaksRules(`luiz: here ${GITHUB}`), ["github-pat"]);
	assert.deepEqual(await gitleaksRules(`aws ${AWS}`), ["aws-access-token"]);
	assert.deepEqual(await gitleaksRules(SLACK), ["slack-bot-token"]);
	assert.deepEqual(await gitleaksRules(`Authorization: Bearer ${JWT}`), ["jwt"]);
	assert.deepEqual(await gitleaksRules("luiz: lol yeah, the ergo upgrade went fine\nsee you at 9"), []);
	assert.deepEqual(await gitleaksRules(""), []);
});

/** A directory whose `gitleaks` runs `script`, put first on PATH while `run` runs. */
async function withFakeGitleaks(script: string, run: () => Promise<void>) {
	const bin = await mkdtemp(join(tmpdir(), "louro-pi-gitleaks-"));
	await writeFile(join(bin, "gitleaks"), `#!/bin/sh\n${script}\n`);
	await chmod(join(bin, "gitleaks"), 0o755);
	const path = process.env.PATH;
	process.env.PATH = `${bin}:${path}`;
	try {
		await run();
	} finally {
		process.env.PATH = path;
	}
}

test("gitleaks that hangs, prints garbage, or fails makes the scan throw", async () => {
	await withFakeGitleaks("sleep 10", () =>
		assert.rejects(gitleaksRules("hi", 200), { killed: true, signal: "SIGTERM" }),
	);
	await withFakeGitleaks("echo not json", () => assert.rejects(gitleaksRules("hi"), SyntaxError));
	await withFakeGitleaks("echo '[]'; exit 2", () => assert.rejects(gitleaksRules("hi")));
	await withFakeGitleaks("exit 0", () => assert.rejects(gitleaksRules("hi".repeat(100_000))));
});
