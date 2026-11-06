import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness, PromptInput } from "@earendil-works/pi-durable";
import { MAX_CALLS_PER_RUN, TOO_MANY_CALLS } from "./calls.ts";
import { inNewRun, openHarness } from "./fixtures.ts";
import {
	editMemory,
	MAX_MEMORY_CHARS,
	MAX_NOTE_CHARS,
	MEMORY_HEADER,
	Memory,
	memorySection,
	memoryTool,
	type Note,
	renderMemory,
} from "./memory.ts";
import { louroTool } from "./tool.ts";

const AT = "2026-10-30T18:41:56.787Z";

function memoryOf(...texts: string[]) {
	return { notes: texts.map((text, i) => ({ id: i + 1, text, at: AT })), nextId: texts.length + 1 };
}

test("remembers notes under new ids, on one line each", () => {
	const memory = memoryOf("luiz is building wasm-junction, a wasmtime wrapper for chap");
	const result = editMemory(memory, { remember: ["maria  prefers\nPortuguese", "#lounge is humans-only"] }, AT);
	assert.deepEqual(memory.notes.slice(1), [
		{ id: 2, text: "maria prefers Portuguese", at: AT },
		{ id: 3, text: "#lounge is humans-only", at: AT },
	]);
	assert.equal(memory.nextId, 4);
	const used = memory.notes.reduce((total, note) => total + note.text.length, 0);
	assert.equal(result, `remembered #2\nremembered #3\n${used}/${MAX_MEMORY_CHARS} characters used`);
});

test("merges notes by forgetting and remembering in one edit, never reusing an id", () => {
	const memory = memoryOf(
		"luiz is building wasm-junction",
		"wasm-junction taint-tracks private data",
		"juniper is a bot",
	);
	const result = editMemory(
		memory,
		{ forget: [1, 2], remember: ["luiz is building wasm-junction, which taint-tracks private data"] },
		AT,
	);
	assert.deepEqual(
		memory.notes.map((note) => note.id),
		[3, 4],
	);
	assert.match(result, /^forgot #1\nforgot #2\nremembered #4\n/);
	assert.match(editMemory(memory, { forget: [4, 4] }, AT), /^forgot #4\n\d+\//);
	editMemory(memory, { remember: ["juniper summarizes #lounge daily"] }, AT);
	assert.deepEqual(
		memory.notes.map((note) => note.id),
		[3, 5],
	);
});

test("refuses a bad edit and changes nothing", () => {
	const full = "x".repeat(MAX_NOTE_CHARS);
	const cases: [Parameters<typeof editMemory>[1], RegExp][] = [
		[{}, /give notes to remember or note ids to forget/],
		[{ remember: [], forget: [] }, /give notes to remember/],
		[{ forget: [1, 9] }, /no note #9/],
		[{ remember: ["fine", "  \n "] }, /can't be empty/],
		[{ remember: [`${full}!`] }, /at most 500 characters/],
		[{ remember: Array(Math.ceil(MAX_MEMORY_CHARS / MAX_NOTE_CHARS)).fill(full) }, /merge or forget notes first/],
	];
	for (const [edit, reason] of cases) {
		const memory = memoryOf("luiz is building wasm-junction");
		const before = structuredClone(memory);
		assert.throws(() => editMemory(memory, edit, AT), reason, JSON.stringify(edit).slice(0, 80));
		assert.deepEqual(memory, before);
	}
});

test("shows the notes with their ids and dates, or that there are none", () => {
	const notes: Note[] = [
		{ id: 3, text: "luiz is building wasm-junction", at: AT },
		{ id: 7, text: "maria prefers Portuguese", at: "2026-11-02T09:00:00.000Z" },
	];
	assert.equal(
		renderMemory(notes),
		`${MEMORY_HEADER}\n#3 (2026-10-30) luiz is building wasm-junction\n#7 (2026-11-02) maria prefers Portuguese`,
	);
	assert.equal(renderMemory([]), `${MEMORY_HEADER}\nYou have no notes yet.`);
});

const render = (harness: Harness) =>
	memorySection.render({ read: harness } as unknown as PromptInput, BACKGROUND_CONTEXT);

test("the tool keeps notes across restarts, and the prompt shows them", async () => {
	const path = join(await mkdtemp(join(tmpdir(), "louro-pi-memory-")), "louro.sqlite");
	let harness = await openHarness(path);
	assert.equal(await render(harness), `${MEMORY_HEADER}\nYou have no notes yet.`);
	const remembered = await memoryTool.execute(
		{ remember: ["luiz is building wasm-junction"] },
		inNewRun(harness),
		BACKGROUND_CONTEXT,
	);
	assert.equal(remembered.isError, false);
	assert.match(JSON.stringify(remembered.output), /remembered #1/);
	await harness.close(BACKGROUND_CONTEXT);

	harness = await openHarness(path);
	assert.match(String(await render(harness)), /\n#1 \(\d{4}-\d\d-\d\d\) luiz is building wasm-junction$/);
	const refused = await memoryTool.execute({ forget: [2] }, inNewRun(harness), BACKGROUND_CONTEXT);
	assert.deepEqual(refused, { output: [{ type: "text", text: "no note #2" }], isError: true });
	assert.equal((await harness.snapshot(Memory, BACKGROUND_CONTEXT))?.notes.length, 1);
	await harness.close(BACKGROUND_CONTEXT);
});

test("memory edits count against the same per-run cap as louro calls", async () => {
	const harness = await openHarness(join(await mkdtemp(join(tmpdir(), "louro-pi-memory-")), "louro.sqlite"));
	const api = inNewRun(harness);
	for (let i = 0; i < MAX_CALLS_PER_RUN; i++)
		await louroTool.execute({ command: "louro status; ls" }, api, BACKGROUND_CONTEXT);
	assert.deepEqual(await memoryTool.execute({ remember: ["luiz likes parrots"] }, api, BACKGROUND_CONTEXT), {
		output: [{ type: "text", text: TOO_MANY_CALLS }],
		isError: true,
	});
	assert.deepEqual((await harness.snapshot(Memory, BACKGROUND_CONTEXT))?.notes ?? [], []);
	await harness.close(BACKGROUND_CONTEXT);
});
