import type { Message } from "@earendil-works/pi-ai";
import type { AgentEvent, EntryRecord } from "@earendil-works/pi-durable";

const MAX_LINE = 300;

export function oneLine(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
}

type Of<R extends Message["role"]> = Extract<Message, { role: R }>;

function messageOf<R extends Message["role"]>(entry: EntryRecord | undefined, role: R): Of<R> | undefined {
	return entry?.model?.find((message): message is Of<R> => message.role === role);
}

function textOf(message: Of<"assistant" | "toolResult"> | undefined): string {
	return oneLine((message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join(" "));
}

export function formatBatch(count: number): string {
	return `< ${count} event${count === 1 ? "" : "s"}`;
}

export function formatEvent(event: AgentEvent): string[] {
	switch (event.type) {
		case "tool_execution_start":
			return [`$ ${event.args.command}`];
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
