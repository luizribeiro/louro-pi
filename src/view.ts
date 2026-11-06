import type { Message } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";

const MAX_LINE = 300;

export function oneLine(text: string): string {
	// \p{Cc} is C0, DEL and C1: untrusted text must not drive the terminal.
	const line = text
		.replace(/\s+/g, " ")
		.replace(/\p{Cc}/gu, "")
		.trim();
	return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
}

type Of<R extends Message["role"]> = Extract<Message, { role: R }>;

function messageOf<R extends Message["role"]>(entry: EntryRecord | undefined, role: R): Of<R> | undefined {
	return entry?.model?.find((message): message is Of<R> => message.role === role);
}

function textOf(message: Of<"assistant" | "toolResult"> | undefined): string {
	return oneLine((message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join(" "));
}

/** One of louro's connection reports, which only the live view gets. */
export function formatReport(event: object): string {
	return `~ ${oneLine(JSON.stringify(event))}`;
}

/** A batch the bot reads, and the channels and DM partners it came from. */
export function formatBatch(count: number, from: readonly string[]): string {
	const events = `< ${count} event${count === 1 ? "" : "s"}`;
	return from.length === 0 ? events : `${events} from ${oneLine(from.join(", "))}`;
}

type Args = Record<string, unknown>;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `- name #id` for each id dropped, then `+ name…` for each item added. */
function edits(name: string, dropped: unknown, added: unknown, describe: (item: unknown) => string): string[] {
	return [
		...list(dropped).map((id) => `- ${name} #${oneLine(String(id))}`),
		...list(added).map((item) => oneLine(`+ ${name}${describe(item)}`)),
	];
}

function whenOf({ in: after, at, every }: Args): string {
	const when = [after && `in ${after}`, at && `at ${at}`, every && `every ${every}`].filter(Boolean);
	return when.length > 0 ? ` ${when.join(" ")}` : "";
}

const louroLines = ({ command }: Args) => [`$ ${oneLine(String(command))}`];

function webLines({ search, read, from }: Args): string[] {
	if (search !== undefined) return [oneLine(`? web search: ${String(search)}`)];
	return [oneLine(`? web read: ${String(read)}${from ? ` from ${String(from)}` : ""}`)];
}

const TOOL_LINES: Record<string, (args: Args) => string[]> = {
	web: webLines,
	memory: ({ remember, forget }) => edits("memory", forget, remember, (text) => `: ${text}`),
	timer: ({ set, cancel }) =>
		edits("timer", cancel, set, (item) => {
			const setting = (item ?? {}) as Args;
			return `${whenOf(setting)}: ${setting.note ?? ""}`;
		}),
};

export function formatEvent(event: AgentEvent): string[] {
	switch (event.type) {
		case "tool_execution_start":
			return (TOOL_LINES[event.toolName] ?? louroLines)(event.args);
		case "tool_execution_end":
			return event.entry ? [`  ${textOf(messageOf(event.entry, "toolResult"))}`] : [];
		case "message_end": {
			const message = messageOf(event.entry, "assistant");
			const reply = textOf(message);
			return [
				...(reply ? [`> ${reply}`] : []),
				...(message?.errorMessage ? [`! ${oneLine(message.errorMessage)}`] : []),
			];
		}
		case "auto_retry_start":
			return [`! retry ${event.attempt}: ${oneLine(event.errorMessage)}`];
		case "task_failed":
			return [`! ${event.kind} failed: ${oneLine(event.message)}`];
		case "compaction_start":
			return [`~ compacting (${event.reason})`];
		case "compaction_end":
			return event.error ? [`! compaction failed: ${oneLine(event.error)}`] : [];
		default:
			return [];
	}
}
