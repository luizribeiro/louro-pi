import type { InputSubmissionDraft } from "@earendil-works/pi-durable";
import { formatResult } from "./command.ts";
import { type Route, routeOf } from "./conversations.ts";
import type { LouroResult } from "./louro.ts";
import { formatBatch, formatUnrouted, labeled } from "./view.ts";

// MAX_BATCH_BYTES splits its budget across each conversation's events, so the batch size must stay bounded.
const MAX_EVENTS = 20;
export const WAIT_ARGS = ["wait", "--timeout", "60", "--max", String(MAX_EVENTS)];
const BACKOFF_MS = 5_000;

export const MAX_BATCH_BYTES = 16 * 1024;
export const TRIMMED = "…[trimmed]";

type Event = Parameters<typeof routeOf>[0] & { text?: unknown };
type Batch = { notice?: string | undefined; events: Event[] };

const utf8Bytes = (text: string) => Buffer.byteLength(text);
const jsonBytes = (text: string) => utf8Bytes(JSON.stringify(text)) - 2;

function cutToBytes(text: string, max: number): string {
	let cut = "";
	let used = 0;
	for (const char of text) {
		used += jsonBytes(char);
		if (used > max) return `${cut}${TRIMMED}`;
		cut += char;
	}
	return cut;
}

/** The batch as the model reads it, each event's text trimmed so the whole stays under MAX_BATCH_BYTES. */
export function renderBatch({ notice, events }: Batch): string {
	const content = JSON.stringify({ notice, events });
	if (utf8Bytes(content) <= MAX_BATCH_BYTES) return content;
	const texts = events.map((event) => (typeof event.text === "string" ? jsonBytes(event.text) : 0));
	const overhead = utf8Bytes(content) - texts.reduce((sum, bytes) => sum + bytes, 0);
	const share = Math.floor((MAX_BATCH_BYTES - overhead) / events.length) - jsonBytes(TRIMMED);
	const trimmed = events.map((event) =>
		typeof event.text === "string" ? { ...event, text: cutToBytes(event.text, share) } : event,
	);
	return JSON.stringify({ notice, events: trimmed });
}

export type Delivery = { route: Route; input: InputSubmissionDraft; count: number };

export type WaitStep =
	| { kind: "submit"; deliveries: Delivery[]; unrouted: Event[] }
	| { kind: "idle" }
	| { kind: "backoff"; reason: string };

/** What to do with one `louro wait`; after a submit or an idle batch, wait again at once, `more` or not. */
export function nextStep({ error, stdout, stderr }: LouroResult, newId: () => string): WaitStep {
	if (error) return { kind: "backoff", reason: formatResult(error, stdout, stderr).replaceAll("\n", " ") };
	let batch: Batch | null;
	try {
		batch = JSON.parse(stdout);
	} catch {
		return { kind: "backoff", reason: `unreadable wait output: ${stdout.trim()}` };
	}
	if (!Array.isArray(batch?.events)) return { kind: "backoff", reason: `wait output has no events: ${stdout.trim()}` };
	if (batch.events.length === 0) return { kind: "idle" };
	const byKey = new Map<string, { route: Route; events: Event[] }>();
	const unrouted: Event[] = [];
	for (const event of batch.events) {
		const route = routeOf(event);
		const group = route && byKey.get(route.key);
		if (group) group.events.push(event);
		else if (route) byKey.set(route.key, { route, events: [event] });
		else unrouted.push(event);
	}
	const deliveries = [...byKey.values()].map(({ route, events }) => ({
		route,
		count: events.length,
		input: {
			type: "input",
			content: renderBatch({ notice: batch.notice, events }),
			// Unique per batch: louro restarts its cursor at 0, and pi-durable silently drops a request id it has seen.
			requestId: `louro-wait-${newId()}`,
			whenBusy: "followUp",
		} as const,
	}));
	return { kind: "submit", deliveries, unrouted };
}

export type WaitLoop = {
	wait(signal: AbortSignal): Promise<LouroResult>;
	newId(): string;
	submit(route: Route, input: InputSubmissionDraft): Promise<unknown>;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
	print(line: string): void;
	warn(line: string): void;
};

/** Forwards every louro batch, each event to its target's conversation, until `signal` aborts. */
export async function forwardEvents(loop: WaitLoop, signal: AbortSignal): Promise<void> {
	const backOff = async (reason: string) => {
		loop.warn(`! ${reason}; retrying in ${BACKOFF_MS / 1000}s`);
		await loop.sleep(BACKOFF_MS, signal);
	};
	// louro moved its cursor when wait returned, so a batch it handed over must be admitted before waiting again.
	const submitUntilAdmitted = async ({ route, input }: Delivery) => {
		for (;;) {
			try {
				await loop.submit(route, input);
				return;
			} catch (error) {
				if (signal.aborted) return;
				await backOff(`submit failed: ${error}`);
			}
		}
	};
	while (!signal.aborted) {
		const step = nextStep(await loop.wait(signal), loop.newId);
		if (step.kind === "submit") {
			for (const event of step.unrouted) loop.print(formatUnrouted(event));
			for (const delivery of step.deliveries) {
				loop.print(labeled(delivery.route.scope, formatBatch(delivery.count)));
				await submitUntilAdmitted(delivery);
			}
		} else if (signal.aborted) {
			return;
		} else if (step.kind === "backoff") {
			await backOff(`louro wait: ${step.reason}`);
		}
	}
}
