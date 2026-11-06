import { defineDoc } from "@earendil-works/pi-durable";

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
