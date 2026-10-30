import type { AgentEvent, SubmissionId } from "@earendil-works/pi-durable";
import { parseCommand } from "./command.ts";

type Block = { type: string; arguments?: { command?: unknown } };

/** ASCII casemapping, as louro and Ergo use; folding more, like rfc1459's `[]\~`, would let `{luiz}` pass for `[luiz]`. */
export function casefold(name: string): string {
	return name.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

const commandOf = (block: Block) => (block.type === "toolCall" ? String(block.arguments?.command ?? "") : "");

/** A command's words, closing a quote a half-written command left open. */
function wordsOf(command: string): string[] | undefined {
	for (const closing of ["", "'", '"']) {
		try {
			return parseCommand(command + closing);
		} catch {}
	}
	return undefined;
}

/** Where a `louro send` goes, casefolded; only once its text has begun, so a half-written target never counts. */
export function sendTarget(command: unknown): string | undefined {
	if (typeof command !== "string") return undefined;
	const [name, ...args] = wordsOf(command) ?? [];
	if (name !== "send") return undefined;
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === "--reply-to") i++;
		else if (!arg.startsWith("-")) positionals.push(arg);
	}
	const [target] = positionals;
	return target !== undefined && positionals.length > 1 ? casefold(target) : undefined;
}

export type ReplyTracker = {
	/**
	 * Marks an input that asks for a reply in `targets`, like a DM or a mention, so its run counts as replying there
	 * from the start. Each input louro-pi submits is a follow-up, so it gets a run of its own, whose end forgets it.
	 */
	expect(id: SubmissionId, targets: readonly string[]): void;
	see(event: AgentEvent): void;
	/**
	 * Where the bot is about to say something, casefolded: an expected input's targets while its run hasn't sent there,
	 * and wherever it's writing or running a send.
	 */
	readonly replyingTo: ReadonlySet<string>;
};

export function replyTracker(): ReplyTracker {
	const expected = new Map<SubmissionId, Set<string>>();
	let run: readonly SubmissionId[] | undefined;
	const replied = new Set<string>();
	const commands = new Map<number, string>();
	const sends = new Map<string, string>();

	const reset = (inputs: readonly SubmissionId[] | undefined) => {
		run = inputs;
		replied.clear();
		commands.clear();
		sends.clear();
	};

	return {
		expect: (id, targets) => void expected.set(id, new Set(targets.map(casefold))),
		see(event) {
			switch (event.type) {
				case "run_start":
					return reset(event.inputs);
				case "run_end":
					for (const id of event.inputs) expected.delete(id);
					return reset(undefined);
				case "snapshot":
					if (event.run?.inputs.join() !== run?.join()) reset(event.run?.inputs);
					return;
				// A retry's new message replaces a partial that may have been writing a send.
				case "message_start":
					return commands.clear();
				case "message_update":
					for (const change of event.changes) {
						if (change.type === "toolcall_start" || change.type === "block") {
							commands.set(change.contentIndex, commandOf(change.block));
						} else if (change.type === "toolcall_delta" && change.path.join() === "command") {
							commands.set(change.contentIndex, (commands.get(change.contentIndex) ?? "") + change.delta);
						} else if (change.type === "message") {
							commands.clear();
							for (const [index, block] of change.message.content.entries()) commands.set(index, commandOf(block));
						}
					}
					return;
				case "tool_execution_start": {
					const target = sendTarget(event.args.command);
					if (target !== undefined) sends.set(event.toolCallId, target);
					return;
				}
				case "tool_execution_end": {
					const target = sends.get(event.toolCallId);
					if (target === undefined) return;
					sends.delete(event.toolCallId);
					replied.add(target);
					commands.clear();
					return;
				}
			}
		},
		get replyingTo() {
			if (run === undefined) return new Set<string>();
			const awaited = run.flatMap((id) => [...(expected.get(id) ?? [])]).filter((target) => !replied.has(target));
			const writing = [...commands.values()].flatMap((command) => sendTarget(command) ?? []);
			return new Set([...awaited, ...writing, ...sends.values()]);
		},
	};
}
