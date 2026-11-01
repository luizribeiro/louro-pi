import assert from "node:assert/strict";
import { test } from "node:test";
import { secretIn } from "./secrets.ts";

const RANDOM = "kP9vXq2LmZ7tRw4NbY8sHc3J";
const ASSIGNED = "a password or key assigned to a name";
const RANDOM_LOOKING = "a long random-looking string, like a key or token";

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

test("finds long random-looking strings: alone, in a link, split by slashes, or on a later line", () => {
	finds(RANDOM_LOOKING, [
		`here: ${RANDOM}`,
		`https://example.com/share/${RANDOM}?dl=1`,
		"see docs.google.com/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
		"aws secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		"sk-proj-Zq8RkT2mQ9vX4LwZ7pN3bY6sHc1JdF5gA0eUqoT3BlbkFJZq8RkT2mQ9vX4LwZ7pN3bY6s",
		`luiz: sure\nhere it is\n${RANDOM}`,
	]);
});

test("judges only the parts of a link, so share links pass and a key inside one doesn't", () => {
	finds(undefined, [
		"https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=a1b2c3d4e5f6",
		"https://youtu.be/dQw4w9WgXcQ?si=Ab3dE5gH7jK9mN1p",
		"https://github.com/luizribeiro/louro-pi/commit/0db7b33",
	]);
	finds(RANDOM_LOOKING, [
		"https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
	]);
});

test("a password written in plain words passes, the price of keeping prose", () => {
	finds(undefined, ["the password is hunter2hunter"]);
});

test("keeps hashes, ids, code names and slugs", () => {
	finds(undefined, [
		"commit 7325117178a5964724bf0edd5608c34be5de7ea9",
		"sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		"uuid 0b6f2c1e-8a4d-4f7e-9c3b-5d2a1e6f7a90",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"Supercalifragilisticexpialidocious2026",
		"louro-timer-1-2026-10-31T12:00:00.000Z",
		"github.com/luizribeiro/louro-pi/blob/main/src/idle.test.ts",
		"ProcessUserAuthenticationToken2Handler",
		"test_handles_UTF8_input_with_Emoji_chars",
		"blog.example.com/Some-Very-Long-Title-2024-Edition-Final",
		"XMLHttpRequestEventTarget2D and getElementsByTagNameNS2DContext",
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1a",
		"",
	]);
});

test("lowercase hex keys pass on purpose, since git and file hashes look the same", () => {
	finds(undefined, ["key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"]);
});

test("stays fast on long hostile input", () => {
	const started = performance.now();
	for (const text of ["a".repeat(1000), "Aa1".repeat(333), "password".repeat(125), "x=".repeat(500)]) secretIn(text);
	assert.ok(performance.now() - started < 200);
});
