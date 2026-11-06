import assert from "node:assert/strict";
import { test } from "node:test";
import { louroEnv } from "./louro.ts";

test("louro gets the environment without the bot's API keys", () => {
	const env = {
		HOME: "/Users/luiz",
		PATH: "/run/current-system/sw/bin:/usr/bin",
		XDG_RUNTIME_DIR: "/run/user/501",
		LITELLM_API_KEY: "sk-litellm-3f9a2c71d8e4",
		KAGI_API_KEY: "kagi-7Qm2Xv9pL4sT8wRz",
	};
	assert.deepEqual(louroEnv(env), {
		HOME: "/Users/luiz",
		PATH: "/run/current-system/sw/bin:/usr/bin",
		XDG_RUNTIME_DIR: "/run/user/501",
	});
	assert.equal(env.LITELLM_API_KEY, "sk-litellm-3f9a2c71d8e4");
	assert.equal(env.KAGI_API_KEY, "kagi-7Qm2Xv9pL4sT8wRz");
});
