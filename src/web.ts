import { defineDoc } from "@earendil-works/pi-durable";
import { screen } from "./filter.ts";
import { gitleaksRules } from "./gitleaks.ts";

// Kagi bills each call; 100 a day stays around a dollar.
export const MAX_WEB_CALLS_PER_DAY = 100;

type WebBudget = { day: string; calls: number };

export const WebBudget = defineDoc<WebBudget>({
	kind: "louro.web",
	version: 1,
	scope: "session",
	initial: () => ({ day: "", calls: 0 }),
});

/** Counts one call against today's budget (UTC), or throws once today's is spent. */
export function spendWebCall(budget: WebBudget, now: Date): void {
	const today = now.toISOString().slice(0, 10);
	if (budget.day !== today) {
		budget.day = today;
		budget.calls = 0;
	}
	if (budget.calls >= MAX_WEB_CALLS_PER_DAY) {
		throw new Error(`the web budget of ${MAX_WEB_CALLS_PER_DAY} calls a day is spent; it resets at 00:00 UTC`);
	}
	budget.calls++;
}

export const PERSONAL_DETAILS_BLOCKED =
	"blocked: this has personal details, and searches and links go out to Kagi and other sites; leave them out";

const decodeRun = (run: string) => {
	try {
		return decodeURIComponent(run);
	} catch {
		return run;
	}
};

/** `text` with its %-escapes undone, however many times over, so an escaped `@` or key reads as itself; a stray `%` stops nothing. */
export function percentDecoded(text: string): string {
	let decoded = text;
	for (let round = 0; round < 5; round++) {
		const next = decoded.replace(/(?:%[0-9A-Fa-f]{2})+/g, decodeRun);
		if (next === decoded) break;
		decoded = next;
	}
	return decoded;
}

/** Why `text` mustn't go out to the web, or undefined: secrets never, and personal details neither, since it's no DM. */
export async function webLeakIn(text: string, rules = gitleaksRules): Promise<string | undefined> {
	const decoded = percentDecoded(text);
	const readings = [...new Set([text, decoded, decoded.replaceAll("+", " ")])].join("\n");
	const verdict = screen(readings, await rules(readings), false);
	if ("block" in verdict) return verdict.block;
	return verdict.note === undefined ? undefined : PERSONAL_DETAILS_BLOCKED;
}
