import type { AgentEvent } from "@earendil-works/pi-durable";
import { formatResult } from "./command.ts";
import type { LouroResult } from "./louro.ts";
import { type ReplyTracker, replyTracker } from "./reply.ts";

export type TypingState = "active" | "done";

// IRCv3 typing: clients drop an `active` that isn't renewed within 6s, so senders renew it every 3s.
export const TYPING_REFRESH_MS = 3_000;

export type TypingIndicator = Pick<ReplyTracker, "expect"> & { see(events: readonly AgentEvent[]): void };

/** Follows a conversation's events, showing `active` in each target while the bot is about to reply there, then `done`. */
export function typingIndicator(show: (target: string, state: TypingState) => void): TypingIndicator {
	const tracker = replyTracker();
	let shown = new Set<string>();
	let refresh: NodeJS.Timeout | undefined;
	const update = () => {
		const replyingTo = tracker.replyingTo;
		for (const target of replyingTo) if (!shown.has(target)) show(target, "active");
		for (const target of shown) if (!replyingTo.has(target)) show(target, "done");
		shown = new Set(replyingTo);
		if (shown.size === 0) {
			clearInterval(refresh);
			refresh = undefined;
		} else {
			// Shutdown shouldn't wait on it; a stale indicator expires on its own.
			refresh ??= setInterval(() => {
				for (const target of shown) show(target, "active");
			}, TYPING_REFRESH_MS).unref();
		}
	};
	return {
		expect(id, targets) {
			tracker.expect(id, targets);
			update();
		},
		see(events) {
			for (const event of events) tracker.see(event);
			update();
		},
	};
}

// louro's exits for what retrying won't change: not allowed, and unsupported by the server.
const LASTING_REFUSALS = new Set([5, 7]);

/** Shows each state with `run`, warning about failures, and stops for good in a target once louro refuses it there. */
export function typingSender(
	run: (target: string, state: TypingState) => Promise<LouroResult>,
	warn: (line: string) => void,
): (target: string, state: TypingState) => Promise<void> {
	const refused = new Set<string>();
	let sent = Promise.resolve();
	const send = async (target: string, state: TypingState) => {
		if (refused.has(target)) return;
		const { error, stdout, stderr } = await run(target, state);
		if (!error) return;
		const lasting = LASTING_REFUSALS.has(Number(error.code));
		if (lasting) refused.add(target);
		warn(
			`! typing ${state} in ${target} failed${lasting ? ", giving up" : ""}: ${formatResult(error, stdout, stderr)}`,
		);
	};
	// One at a time, so a slow `active` can't land after the `done` that followed it.
	return (target, state) => {
		sent = sent.then(() => send(target, state));
		return sent;
	};
}
