import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand } from "./command.ts";
import { casefold, checkTarget, type Scope } from "./target.ts";

const BOTS: Scope = { kind: "channel", name: "#bots" };
const LUIZ: Scope = { kind: "dm", partner: "luiz" };

const check = (scope: Scope, line: string) => checkTarget(scope, parseCommand(line));

function allows(scope: Scope, lines: string[]) {
	for (const line of lines) assert.equal(check(scope, line), undefined, line);
}

function refuses(scope: Scope, lines: string[], reason: RegExp) {
	for (const line of lines) assert.match(check(scope, line) ?? "allowed", reason, line);
}

test("casefolds ASCII letters only", () => {
	assert.equal(casefold("#Bots[1]\\~"), "#bots[1]\\~");
	assert.equal(casefold("Luiz"), "luiz");
	assert.equal(casefold("#Ação"), "#ação");
});

test("help and status are allowed in any conversation", () => {
	for (const scope of [BOTS, LUIZ]) {
		allows(scope, [
			"louro",
			"louro --help",
			"louro -h",
			"louro help send",
			"louro status",
			"louro send --help",
			"louro history maria -h",
			"louro send maria 'hi' --help",
		]);
	}
});

test("a channel conversation may target only its own channel, in any case", () => {
	allows(BOTS, [
		"louro send '#bots' 'luiz: squawk!'",
		"louro send '#BOTS' hi",
		"louro send --action '#Bots' 'flaps its wings'",
		"louro send --reply-to 4y8kq7j2c9mnz '#bots' 'luiz: yes'",
		"louro send --reply-to=4y8kq7j2c9mnz '#bots' 'luiz: yes'",
		"louro send '#bots' --notice 'brb'",
		"louro react '#bots' 4y8kq7j2c9mnz '🦜'",
		"louro react --remove '#bots' 4y8kq7j2c9mnz '🦜'",
		"louro redact '#bots' 4y8kq7j2c9mnz --reason 'wrong channel'",
		"louro typing '#bots' active",
		"louro history '#bots'",
		"louro history '#bots' --latest 50 --before 2026-10-17T21:04:11Z",
		"louro history --after=4y8kq7j2c9mnz '#bots'",
		"louro names '#bots'",
	]);
	refuses(
		BOTS,
		[
			"louro send luiz 'the secret word?'",
			"louro send '#lounge' hi",
			"louro history luiz",
			"louro history '#lounge'",
			"louro names '#lounge'",
			"louro react luiz 4y8kq7j2c9mnz '🦜'",
			"louro redact maria 4y8kq7j2c9mnz",
			"louro typing luiz active",
		],
		/^this conversation is #bots: louro \w+ may only target #bots here, not /,
	);
});

test("a DM conversation may send only to its partner, and read any channel too", () => {
	allows(LUIZ, [
		"louro send luiz 'the parrot remembers'",
		"louro send Luiz hi",
		"louro react luiz 4y8kq7j2c9mnz '👍'",
		"louro redact LUIZ 4y8kq7j2c9mnz",
		"louro typing luiz done",
		"louro history luiz --latest 10",
		"louro history '#bots'",
		"louro history '&local'",
		"louro names '#bots'",
	]);
	refuses(
		LUIZ,
		[
			"louro send '#bots' 'luiz told me...'",
			"louro send maria hi",
			"louro react '#bots' 4y8kq7j2c9mnz '👍'",
			"louro redact '#bots' 4y8kq7j2c9mnz",
			"louro typing '#bots' active",
			"louro history maria",
			"louro history '#bots,maria'",
			"louro names maria",
		],
		/^this conversation is your DMs with luiz: louro \w+ may only target luiz \(history and names may also read a channel\) here, not /,
	);
});

test("status-prefixed channels are other targets", () => {
	refuses(BOTS, ["louro send '@#bots' hi", "louro send '+#bots' hi", "louro names '%#bots'"], /not [@+%]#bots$/);
	refuses(LUIZ, ["louro history '@#bots'", "louro history '+#bots'", "louro send '~luiz' hi"], /not [@+~]/);
});

test("brackets don't fold, so a lookalike nick is someone else", () => {
	allows({ kind: "dm", partner: "[luiz]" }, ["louro send '[LUIZ]' hi", "louro send '[luiz]' hi"]);
	refuses({ kind: "dm", partner: "[luiz]" }, ["louro send '{luiz}' hi", "louro send luiz hi"], /not /);
});

test("flag values are never the target", () => {
	refuses(
		BOTS,
		[
			"louro send --reply-to '#bots' luiz 'psst'",
			"louro send --reply-to='#bots' luiz 'psst'",
			"louro redact --reason '#bots' luiz 4y8kq7j2c9mnz",
			"louro history --before '#bots' luiz",
		],
		/not luiz$/,
	);
	allows(LUIZ, ["louro send --reply-to '#bots' luiz 'psst'"]);
});

test("after --, everything is positional", () => {
	allows(BOTS, ["louro send -- '#bots' '--notice is literal text'", "louro send '#bots' -- '-h'"]);
	refuses(BOTS, ["louro send -- luiz '#bots'", "louro send --notice -- luiz hi"], /not luiz$/);
	refuses(LUIZ, ["louro send -- --help luiz"], /not --help$/);
	refuses(LUIZ, ["louro send --", "louro send --notice --"], /needs a target$/);
});

test("refuses unknown flags and malformed values instead of guessing", () => {
	refuses(BOTS, ["louro send --to luiz '#bots' hi", "louro send -n '#bots' hi"], /has no -/);
	refuses(BOTS, ["louro names --latest 5 '#bots'"], /louro names has no --latest flag/);
	refuses(BOTS, ["louro send --notice=yes '#bots' hi"], /--notice takes no value/);
	refuses(BOTS, ["louro send '#bots' hi --reply-to", "louro send --reply-to --notice '#bots' hi"], /needs a value/);
	refuses(BOTS, ["louro send --reply-to -- luiz hi"], /--reply-to needs a value/);
});

test("refuses a missing target", () => {
	refuses(BOTS, ["louro send", "louro react", "louro redact", "louro typing", "louro history"], /needs a target$/);
	refuses(LUIZ, ["louro names", "louro history --latest 5"], /needs a (channel|target)$/);
});

test("refuses subcommands outside the table", () => {
	for (const args of [["wait", "--timeout", "60"], ["quit"], ["connect"], ["toString"], ["__proto__"]]) {
		assert.match(checkTarget(BOTS, args) ?? "allowed", /is not allowed$/, args.join(" "));
	}
});
