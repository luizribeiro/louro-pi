export type Scope = { kind: "channel"; name: string } | { kind: "dm"; partner: string };

/** ASCII casemapping, as louro and Ergo use; folding more, like rfc1459's `[]\~`, would let `{luiz}` pass for `[luiz]`. */
export function casefold(name: string): string {
	return name.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** The channel or DM partner a conversation talks to. */
export function targetOf(scope: Scope): string {
	return scope.kind === "channel" ? scope.name : scope.partner;
}
