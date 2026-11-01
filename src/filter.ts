import { redactPii } from "./pii.ts";
import { secretIn } from "./secrets.ts";

export type Verdict = { send: string; note?: string } | { block: string };

/** Secrets always block; personal details are redacted unless `piiAllowed`. */
export function screen(text: string, gitleaksRules: readonly string[], piiAllowed: boolean): Verdict {
	const secret = gitleaksRules.length > 0 ? `a secret (${gitleaksRules.join(", ")})` : secretIn(text);
	if (secret) return { block: `blocked: this looks like ${secret}; say it without that part, and don't resend it` };
	if (piiAllowed) return { send: text };
	const { text: redacted, found } = redactPii(text);
	if (found.length === 0) return { send: text };
	const labels = found.map((label) => `[${label}]`).join(", ");
	return { send: redacted, note: `redacted personal details; people saw ${labels} in their place` };
}

/** Personal details may go only in a DM to one of `accounts`, as louro's environment names the target. */
export function piiAllowedFor(env: NodeJS.ProcessEnv, accounts: readonly string[]): boolean {
	return env.LOURO_CHANNEL === undefined && env.LOURO_ACCOUNT !== undefined && accounts.includes(env.LOURO_ACCOUNT);
}
