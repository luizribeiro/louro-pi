import type { AgentEvent, SubmissionId } from "@earendil-works/pi-durable";

type Block = { type: string; arguments?: { command?: unknown } };

const isSend = (command: unknown) => typeof command === "string" && /^\s*louro\s+send\b/.test(command);
const commandOf = (block: Block) => (block.type === "toolCall" ? String(block.arguments?.command ?? "") : "");

export type ReplyTracker = {
	/**
	 * Marks an input that asks for a reply, like a DM or a mention, so its run counts as replying from the start. Each
	 * input louro-pi submits is a follow-up, so it gets a run of its own, whose end forgets it.
	 */
	expect(id: SubmissionId): void;
	see(event: AgentEvent): void;
	/** Whether the bot is about to say something: in a run for an expected input until it first sends, or writing a send. */
	readonly replying: boolean;
};

export function replyTracker(): ReplyTracker {
	const expected = new Set<SubmissionId>();
	let run: readonly SubmissionId[] | undefined;
	let replied = false;
	const commands = new Map<number, string>();
	const sends = new Set<string>();

	const reset = (inputs: readonly SubmissionId[] | undefined) => {
		run = inputs;
		replied = false;
		commands.clear();
		sends.clear();
	};

	return {
		expect: (id) => void expected.add(id),
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
				case "tool_execution_start":
					if (!isSend(event.args.command)) return;
					sends.add(event.toolCallId);
					return;
				case "tool_execution_end":
					if (!sends.delete(event.toolCallId)) return;
					replied = true;
					commands.clear();
					return;
			}
		},
		get replying() {
			if (run === undefined) return false;
			const writing = sends.size > 0 || [...commands.values()].some(isSend);
			return writing || (!replied && run.some((id) => expected.has(id)));
		},
	};
}
