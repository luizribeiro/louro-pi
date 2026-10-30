import { Type } from "@earendil-works/pi-ai";
import { defineDoc, defineTool, section } from "@earendil-works/pi-durable";
import { commitEdit } from "./calls.ts";

export type Note = { id: number; text: string; at: string };
type Memory = { notes: Note[]; nextId: number };

export const MAX_NOTE_CHARS = 500;
// About 2k tokens, so the notes stay a small part of every request.
export const MAX_MEMORY_CHARS = 8000;

export const Memory = defineDoc<Memory>({
	kind: "louro.memory",
	version: 1,
	scope: "session",
	initial: () => ({ notes: [], nextId: 1 }),
});

export type MemoryEdit = { remember?: string[] | undefined; forget?: number[] | undefined };

const size = (notes: readonly Note[]) => notes.reduce((total, note) => total + note.text.length, 0);

/** Forgets, then remembers, all or nothing; returns what changed, or throws why nothing did. */
export function editMemory(memory: Memory, { remember = [], forget: ids = [] }: MemoryEdit, at: string): string {
	const forget = [...new Set(ids)];
	if (remember.length === 0 && forget.length === 0) throw new Error("give notes to remember or note ids to forget");
	const unknown = forget.filter((id) => !memory.notes.some((note) => note.id === id));
	if (unknown.length > 0) throw new Error(`no note ${unknown.map((id) => `#${id}`).join(", ")}`);
	const texts = remember.map((text) => text.replace(/\s+/g, " ").trim());
	if (texts.some((text) => text === "")) throw new Error("a note can't be empty");
	const long = texts.find((text) => text.length > MAX_NOTE_CHARS);
	if (long) throw new Error(`a note may be at most ${MAX_NOTE_CHARS} characters; shorten "${long.slice(0, 40)}…"`);
	const kept = memory.notes.filter((note) => !forget.includes(note.id));
	const added = texts.map((text, i) => ({ id: memory.nextId + i, text, at }));
	const notes = [...kept, ...added];
	if (size(notes) > MAX_MEMORY_CHARS) {
		throw new Error(`memory would hold ${size(notes)} of ${MAX_MEMORY_CHARS} characters; merge or forget notes first`);
	}
	memory.notes = notes;
	memory.nextId += added.length;
	return [
		...forget.map((id) => `forgot #${id}`),
		...added.map((note) => `remembered #${note.id}`),
		`${size(notes)}/${MAX_MEMORY_CHARS} characters used`,
	].join("\n");
}

export const MEMORY_HEADER =
	"Your long-term notes, kept across restarts with the memory tool. Keep what's worth knowing later: who people are, what they're working on, what they asked you to remember. Keep notes true and short, and merge or forget stale ones.";

export function renderMemory(notes: readonly Note[]): string {
	const lines = notes.map((note) => `#${note.id} (${note.at.slice(0, 10)}) ${note.text}`);
	return [MEMORY_HEADER, ...(lines.length > 0 ? lines : ["You have no notes yet."])].join("\n");
}

export const memorySection = section("memory", async ({ read }, context) =>
	renderMemory((await read.snapshot(Memory, context))?.notes ?? []),
);

export const memoryTool = defineTool({
	name: "memory",
	description:
		"Edit your long-term notes, which you see in <memory> on every turn. `remember` adds notes; `forget` drops notes by id. Both at once replace notes, such as merging #3 and #5 into one.",
	parameters: Type.Object({
		remember: Type.Optional(Type.Array(Type.String(), { description: "New notes, one fact each" })),
		forget: Type.Optional(Type.Array(Type.Integer(), { description: "Ids of notes to drop, like 3 for #3" })),
	}),
	execute: (edit, api, context) =>
		commitEdit(api, context, async (tx) => editMemory(await tx.doc(Memory), edit, new Date().toISOString())),
});
