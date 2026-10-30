import assert from "node:assert/strict";
import { test } from "node:test";
import { casefold, targetOf } from "./target.ts";

test("casefolds ASCII letters only", () => {
	assert.equal(casefold("#Bots[1]\\~"), "#bots[1]\\~");
	assert.equal(casefold("Luiz"), "luiz");
	assert.equal(casefold("#Ação"), "#ação");
});

test("a conversation talks to its channel or DM partner", () => {
	assert.equal(targetOf({ kind: "channel", name: "#bots" }), "#bots");
	assert.equal(targetOf({ kind: "dm", partner: "luiz" }), "luiz");
});
