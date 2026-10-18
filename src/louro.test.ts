import assert from "node:assert/strict";
import { test } from "node:test";
import { louroEnv } from "./louro.ts";

test("louro gets the environment without the model's key", () => {
	const env = {
		HOME: "/Users/luiz",
		PATH: "/run/current-system/sw/bin:/usr/bin",
		XDG_RUNTIME_DIR: "/run/user/501",
		LITELLM_API_KEY: "sk-litellm-3f9a2c71d8e4",
	};
	assert.deepEqual(louroEnv(env), {
		HOME: "/Users/luiz",
		PATH: "/run/current-system/sw/bin:/usr/bin",
		XDG_RUNTIME_DIR: "/run/user/501",
	});
	assert.equal(env.LITELLM_API_KEY, "sk-litellm-3f9a2c71d8e4");
});
