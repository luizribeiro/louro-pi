import type { AgentEvent } from "@earendil-works/pi-durable";
import { formatResult } from "./command.ts";
import type { LouroResult } from "./louro.ts";
import { type ReplyTracker, replyTracker } from "./reply.ts";

export type TypingState = "active" | "done";

// IRCv3 typing: clients drop an `active` that isn't renewed within 6s, so senders renew it every 3s.
export const TYPING_REFRESH_MS = 3_000;

export type TypingIndicator = Pick<ReplyTracker, "expect"> & { see(events: readonly AgentEvent[]): void };

/** Follows a conversation's events, showing `active` while the bot is about to reply, then `done`. */
export function typingIndicator(show: (state: TypingState) => void): TypingIndicator {
	const tracker = replyTracker();
	let refresh: NodeJS.Timeout | undefined;
	const update = () => {
		if (tracker.replying === (refresh !== undefined)) return;
		if (tracker.replying) {
			show("active");
			// Shutdown shouldn't wait on it; a stale indicator expires on its own.
			refresh = setInterval(() => show("active"), TYPING_REFRESH_MS).unref();
		} else {
			clearInterval(refresh);
			refresh = undefined;
			show("done");
		}
	};
	return {
		expect(id) {
			tracker.expect(id);
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

/** Shows each state with `run`, warning about failures, and stops for good once louro refuses it. */
export function typingSender(
	run: (state: TypingState) => Promise<LouroResult>,
	warn: (line: string) => void,
): (state: TypingState) => Promise<void> {
	let refused = false;
	let sent = Promise.resolve();
	const send = async (state: TypingState) => {
		if (refused) return;
		const { error, stdout, stderr } = await run(state);
		if (!error) return;
		refused = LASTING_REFUSALS.has(Number(error.code));
		warn(`! typing ${state} failed${refused ? ", giving up" : ""}: ${formatResult(error, stdout, stderr)}`);
	};
	// One at a time, so a slow `active` can't land after the `done` that followed it.
	return (state) => {
		sent = sent.then(() => send(state));
		return sent;
	};
}
