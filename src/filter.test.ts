import assert from "node:assert/strict";
import { test } from "node:test";
import { piiAllowedFor, screen } from "./filter.ts";

const GITHUB = "ghp_R8kT2mQ9vX4LwZ7pN3bY6sHc1JdF5gA0eUqo";
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
