import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BLOCKED, piiAllowedFor, screen } from "./filter.ts";

const FILTER = new URL("./filter.ts", import.meta.url).pathname;

const GITHUB = "ghp_R8kT2mQ9vX4LwZ7pN3bY6sHc1JdF5gA0eUqo";
const AWS = "AKIAZ7QW3RTY5UIO2PLK";
const OPENAI = "sk-proj-Zq8RkT2mQ9vX4LwZ7pN3bY6sHc1JdF5gA0eUqoT3BlbkFJZq8RkT2mQ9vX4LwZ7pN3bY6s";

const DM_TO_LUIZ = { LOURO_KIND: "message", LOURO_NICK: "luiz", LOURO_ACCOUNT: "luiz" };
const IN_BOTS = { LOURO_KIND: "message", LOURO_CHANNEL: "#bots" };

test("blocks anything gitleaks flags, naming its rules", () => {
	assert.deepEqual(screen(`here ${GITHUB}`, ["github-pat"], true), {
		block: "blocked: this looks like a secret (github-pat); say it without that part, and don't resend it",
	});
});

test("blocks secrets gitleaks has no rule for, even where personal details may go", () => {
	assert.deepEqual(screen(`use ${OPENAI}`, [], true), {
		block:
			"blocked: this looks like a long random-looking string, like a key or token; say it without that part, and don't resend it",
	});
	assert.match(JSON.stringify(screen("password=Hunter2xYz!9", [], false)), /a password or key assigned to a name/);
});

test("redacts personal details and says what it swapped", () => {
	assert.deepEqual(screen("maria: mail bob@example.org or call (11) 98765-4321", [], false), {
		send: "maria: mail [email] or call [phone]",
		note: "redacted personal details; people saw [email], [phone] in their place",
	});
});

test("passes personal details where they're allowed, and plain chat everywhere", () => {
	assert.deepEqual(screen("mail bob@example.org", [], true), { send: "mail bob@example.org" });
	assert.deepEqual(screen("lol yeah, the ergo upgrade went fine", [], false), {
		send: "lol yeah, the ergo upgrade went fine",
	});
});

test("allows personal details only in a DM to a trusted account", () => {
	assert.equal(piiAllowedFor(DM_TO_LUIZ, ["luiz"]), true);
	assert.equal(piiAllowedFor(DM_TO_LUIZ, []), false);
	assert.equal(piiAllowedFor({ ...DM_TO_LUIZ, LOURO_ACCOUNT: "maria" }, ["luiz"]), false);
	assert.equal(piiAllowedFor({ LOURO_KIND: "message", LOURO_NICK: "luiz" }, ["luiz"]), false);
	assert.equal(piiAllowedFor(IN_BOTS, ["luiz"]), false);
	assert.equal(piiAllowedFor({ LOURO_KIND: "away" }, ["luiz"]), false);
});

/** Runs the filter as louro would: the text on stdin, the target in the environment, trusted accounts as arguments. */
function filter(text: string, env: Record<string, string>, { path = process.env.PATH } = {}) {
	const result = spawnSync(process.execPath, [FILTER, "luiz"], {
		input: text,
		env: { PATH: path, ...env },
		encoding: "utf8",
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("as louro runs it: passes chat unchanged with no note", () => {
	const text = "maria: lol yeah\nthe ergo upgrade went fine";
	assert.deepEqual(filter(text, IN_BOTS), { status: 0, stdout: text, stderr: "" });
});

test("as louro runs it: passes empty and whitespace-only text unchanged", () => {
	for (const text of ["", "   ", "\n"])
		assert.deepEqual(filter(text, IN_BOTS), { status: 0, stdout: text, stderr: "" });
});

test("as louro runs it: blocks a secret on a later line of a multi-line message", () => {
	const result = filter(`luiz: sure\nhere it is:\n${AWS}`, IN_BOTS);
	assert.equal(result.status, BLOCKED);
	assert.match(result.stderr, /aws-access-token/);
});

test("as louro runs it: blocks a token with exit 10 and tells the agent why", () => {
	const result = filter(`luiz: the token is ${GITHUB}`, DM_TO_LUIZ);
	assert.equal(result.status, BLOCKED);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /^blocked: this looks like a secret \(github-pat\)/);
	assert.doesNotMatch(result.stderr, /ghp_/);
});

test("as louro runs it: redacts personal details in a channel, but not in luiz's DMs", () => {
	const text = "maria's email is maria@example.com";
	assert.deepEqual(filter(text, IN_BOTS), {
		status: 0,
		stdout: "maria's email is [email]",
		stderr: "redacted personal details; people saw [email] in their place",
	});
	assert.deepEqual(filter(text, DM_TO_LUIZ), { status: 0, stdout: text, stderr: "" });
	assert.equal(
		filter(text, { ...DM_TO_LUIZ, LOURO_NICK: "maria", LOURO_ACCOUNT: "maria" }).stdout,
		"maria's email is [email]",
	);
});

test("as louro runs it: without gitleaks it fails, and not with the block code, so louro sends nothing", async () => {
	const bin = await mkdtemp(join(tmpdir(), "louro-pi-filter-"));
	await symlink(process.execPath, join(bin, "node"));
	const result = filter("hi", IN_BOTS, { path: bin });
	assert.notEqual(result.status, 0);
	assert.notEqual(result.status, BLOCKED);
	assert.equal(result.stdout, "");
});
