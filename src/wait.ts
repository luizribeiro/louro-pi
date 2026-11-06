import type { InputSubmissionDraft } from "@earendil-works/pi-durable";
import { formatResult } from "./command.ts";
import { linksIn } from "./links.ts";
import type { LouroResult } from "./louro.ts";
import { formatBatch, formatReport } from "./view.ts";

// MAX_BATCH_BYTES splits its budget across the batch's events, so the batch size must stay bounded.
const MAX_EVENTS = 20;
export const WAIT_ARGS = ["wait", "--timeout", "60", "--max", String(MAX_EVENTS)];
const BACKOFF_MS = 5_000;

export const MAX_BATCH_BYTES = 16 * 1024;
export const TRIMMED = "…[trimmed]";

type Event = {
	[field: string]: unknown;
	type?: unknown;
	private?: unknown;
	target?: unknown;
	from?: { nick?: unknown };
	text?: unknown;
	mentions_me?: unknown;
};
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

/** Where a reply to an event goes: its channel if louro marks it public, else whoever sent the DM or invite. */
export function replyTargetOf(event: Event): string | undefined {
	if (event.private === false && typeof event.target === "string") return event.target;
	return typeof event.from?.nick === "string" ? event.from.nick : undefined;
}

const isReport = (event: Event) => event.type === "connection";

const uniqueTargets = (events: Event[]) => [...new Set(events.flatMap((event) => replyTargetOf(event) ?? []))];

/**
 * `replyTargets` are where louro says an event names the bot or is a DM, so a reply is likely there; `links` are the
 * https links people wrote, which the bot may then read.
 */
export type Delivery = {
	input: InputSubmissionDraft;
	count: number;
	from: string[];
	replyTargets: string[];
	links: string[];
};

export type WaitStep =
	| { kind: "submit"; delivery: Delivery | undefined; reports: Event[] }
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
	const events = batch.events.filter((event) => !isReport(event));
	const delivery =
		events.length === 0
			? undefined
			: {
					count: events.length,
					from: uniqueTargets(events),
					replyTargets: uniqueTargets(events.filter((event) => event.mentions_me === true)),
					links: events.flatMap((event) => (typeof event.text === "string" ? linksIn(event.text) : [])),
					input: {
						type: "input",
						content: renderBatch({ notice: batch.notice, events }),
						// Unique per batch: louro restarts its cursor at 0, and pi-durable silently drops a request id it has seen.
						requestId: `louro-wait-${newId()}`,
						whenBusy: "followUp",
					} as const,
				};
	return { kind: "submit", delivery, reports: batch.events.filter(isReport) };
}

export type WaitLoop = {
	wait(signal: AbortSignal): Promise<LouroResult>;
	newId(): string;
	submit(delivery: Delivery): Promise<unknown>;
	sleep(ms: number, signal: AbortSignal): Promise<void>;
	print(line: string): void;
	warn(line: string): void;
};

/** Forwards every louro batch to the bot's conversation until `signal` aborts. */
export async function forwardEvents(loop: WaitLoop, signal: AbortSignal): Promise<void> {
	const backOff = async (reason: string) => {
		loop.warn(`! ${reason}; retrying in ${BACKOFF_MS / 1000}s`);
		await loop.sleep(BACKOFF_MS, signal);
	};
	// louro moved its cursor when wait returned, so a batch it handed over must be admitted before waiting again.
	const submitUntilAdmitted = async (delivery: Delivery) => {
		for (;;) {
			try {
				await loop.submit(delivery);
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
			for (const event of step.reports) loop.print(formatReport(event));
			if (step.delivery) {
				loop.print(formatBatch(step.delivery.count, step.delivery.from));
				await submitUntilAdmitted(step.delivery);
			}
		} else if (signal.aborted) {
			return;
		} else if (step.kind === "backoff") {
			await backOff(`louro wait: ${step.reason}`);
		}
	}
}
