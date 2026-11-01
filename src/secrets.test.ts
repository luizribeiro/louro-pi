import assert from "node:assert/strict";
import { test } from "node:test";
import { secretIn } from "./secrets.ts";

const ASSIGNED = "a password or key assigned to a name";

const finds = (reason: string | undefined, texts: string[]) => {
	for (const text of texts) assert.equal(secretIn(text), reason, text);
};

test("finds private keys", () => {
	finds("a private key", ["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk", "-----BEGIN RSA PRIVATE KEY-----"]);
	finds(undefined, ["-----BEGIN PUBLIC KEY-----"]);
});

test("finds passwords and keys assigned to a name, in env, JSON and YAML shapes", () => {
	finds(ASSIGNED, [
		"try password=Hunter2xYz!9 on the box",
		"PASSWORD: correcthorse9",
		"export API_KEY='abcdef123'",
		"GITHUB_TOKEN=abcdef123456",
		"MY_PASSWORD=hunter22",
		'{"password": "hunter22"}',
		"db:\n  password: hunter22",
		"token = s3cr3tvalue",
		'client_secret:"zZ9zzzzz"',
		"pwd=letmein1",
		"PRIVATE_KEY=abcdef1234",
	]);
});

test("keeps talk about passwords that carries none", () => {
	finds(undefined, [
		"the password is in sops, ask luiz",
		"password: yes",
		"token: none",
		"your auth worked",
		"set a timer: 30m",
		"bypass: 30m",
		"tokens=many",
		"password: required",
		"token: expired yesterday",
		"the auth: failed again",
		"pwd: /home/luiz/projects",
	]);
});

test("a password written in plain words passes, the price of keeping prose", () => {
	finds(undefined, ["the password is hunter2hunter"]);
});

test("stays fast on long hostile input", () => {
	const started = performance.now();
	for (const text of ["a".repeat(1000), "Aa1".repeat(333), "password".repeat(125), "x=".repeat(500)]) secretIn(text);
	assert.ok(performance.now() - started < 200);
});
