import assert from "node:assert/strict";
import { test } from "node:test";
import { formatResult, parseCommand } from "./command.ts";

test("splits the primer's commands into louro's argv", () => {
	assert.deepEqual(parseCommand("louro status"), ["status"]);
	assert.deepEqual(parseCommand("louro wait --timeout 60"), ["wait", "--timeout", "60"]);
	assert.deepEqual(parseCommand("louro send '#lounge' 'a short reply'"), ["send", "#lounge", "a short reply"]);
});

test("follows sh quoting rules", () => {
	assert.deepEqual(parseCommand(`louro send "#bots" "it's \\"fine\\", costs \\$5"`), [
		"send",
		"#bots",
		`it's "fine", costs $5`,
	]);
	assert.deepEqual(parseCommand(`louro send maria it\\'s\\ ok`), ["send", "maria", "it's ok"]);
	assert.deepEqual(parseCommand(`louro send '#bots' 'a; b | c && $(d)'`), ["send", "#bots", "a; b | c && $(d)"]);
	assert.deepEqual(parseCommand("louro send '#bots' 'line one\nline two'"), ["send", "#bots", "line one\nline two"]);
	assert.deepEqual(parseCommand("louro send '#bots' ''"), ["send", "#bots", ""]);
});

test("rejects anything but louro", () => {
	assert.throws(() => parseCommand("ls ~"), /only louro commands/);
	assert.throws(() => parseCommand("status"), /only louro commands/);
	assert.throws(() => parseCommand("/usr/bin/louro status"), /only louro commands/);
	assert.throws(() => parseCommand(""), /only louro commands/);
});

test("rejects shell operators outside single quotes", () => {
	for (const line of [
		"louro status; ls",
		"louro status && cat ~/.ssh/id_rsa",
		"louro wait | head",
		"louro status > out",
		"louro send '#bots' $(whoami)",
		"louro send '#bots' `whoami`",
		'louro send "#bots" "$HOME"',
		"louro status\nls",
		"louro status &",
	]) {
		assert.throws(() => parseCommand(line), /not allowed/, line);
	}
});

test("rejects an unterminated quote", () => {
	assert.throws(() => parseCommand("louro send '#bots' 'oops"), /unterminated ' quote/);
});

test("allows only the agent's subcommands", () => {
	assert.deepEqual(parseCommand("louro"), []);
	assert.deepEqual(parseCommand("louro --help"), ["--help"]);
	assert.deepEqual(parseCommand("louro send --help"), ["send", "--help"]);
	assert.deepEqual(parseCommand("louro history '#bots'"), ["history", "#bots"]);
	for (const line of [
		"louro connect --config /Users/luiz/.ssh/known_hosts",
		"louro quit",
		"louro --socket /tmp/x status",
		"louro --config x connect",
		"louro conn",
	]) {
		assert.throws(() => parseCommand(line), /is not allowed/, line);
	}
});

test("rejects --socket anywhere", () => {
	assert.throws(() => parseCommand("louro status --socket /run/docker.sock"), /--socket is not allowed/);
	assert.throws(() => parseCommand("louro send --socket=/tmp/x '#bots' hi"), /--socket is not allowed/);
});

test("help forms naming connect or quit only print help", () => {
	assert.deepEqual(parseCommand("louro help connect"), ["help", "connect"]);
	assert.deepEqual(parseCommand("louro --help connect --config /etc/passwd"), [
		"--help",
		"connect",
		"--config",
		"/etc/passwd",
	]);
	assert.deepEqual(parseCommand("louro send -- connect x"), ["send", "--", "connect", "x"]);
});

test("quoting that joins words into louro or a subcommand matches sh", () => {
	assert.deepEqual(parseCommand(`l'o'uro "sta"tus`), ["status"]);
	assert.deepEqual(parseCommand("lou\\ro sta\\tus"), ["status"]);
	assert.throws(() => parseCommand("'louro ' status"), /only louro commands/);
	assert.throws(() => parseCommand("louro 'status '"), /is not allowed/);
});

test("only space and tab separate words", () => {
	for (const line of ["louro status", "louro status\r", "louro status", "louro stat​us", "louro\vstatus"]) {
		assert.throws(() => parseCommand(line), /only louro commands|is not allowed/, JSON.stringify(line));
	}
	assert.deepEqual(parseCommand("louro send '#x' hi --socket /x"), ["send", "#x", "hi --socket /x"]);
});

test("subcommands are case-sensitive and exact", () => {
	for (const line of ["louro Connect", "louro QUIT", "louro -- connect", "louro --version"]) {
		assert.throws(() => parseCommand(line), /is not allowed/, line);
	}
});

test("rejects --socket however it is quoted or escaped, even as text", () => {
	for (const line of [
		"louro status '--socket' /x",
		"louro status --so''cket /x",
		"louro status --so\\cket=/x",
		"louro status --socket\t/x",
		"louro send '#x' -- --socket",
	]) {
		assert.throws(() => parseCommand(line), /--socket is not allowed/, line);
	}
});

test("leaves shell-only syntax as literal text", () => {
	assert.deepEqual(parseCommand("louro send ~ *.{a,b} #c"), ["send", "~", "*.{a,b}", "#c"]);
	assert.deepEqual(parseCommand("louro send '#x' a\\\nb"), ["send", "#x", "a\nb"]);
	assert.deepEqual(parseCommand("louro status \\"), ["status", "\\"]);
	assert.throws(() => parseCommand("louro send '#x' $'\\x41'"), /"\$" is not allowed/);
});

test("formats louro's result with a one-line exit status", () => {
	const sent = '{"sent":true,"target":"#bots"}\n';
	assert.equal(formatResult(null, sent, ""), 'exit: 0\n{"sent":true,"target":"#bots"}');
	assert.equal(
		formatResult(
			{ code: 3, message: "Command failed" },
			'{"error":{"code":"no_session"}}\n',
			"louro: could not reach louro\n",
		),
		'exit: 3\n{"error":{"code":"no_session"}}\nlouro: could not reach louro',
	);
	assert.equal(
		formatResult({ code: null, signal: "SIGTERM", message: "Command failed: louro wait\n" }, "", ""),
		"exit: killed:SIGTERM",
	);
	assert.equal(formatResult({ code: "ENOENT", message: "spawn louro ENOENT" }, "", ""), "exit: ENOENT");
});
