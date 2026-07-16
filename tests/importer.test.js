import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { runImport, transcriptToMarkdown } from "../src/importer.js"

const line = (obj) => JSON.stringify(obj)
const userLine = (text, extra = {}) =>
	line({
		type: "user",
		timestamp: "2026-05-14T10:00:00Z",
		message: { role: "user", content: text },
		...extra,
	})
const assistantLine = (blocks) =>
	line({
		type: "assistant",
		timestamp: "2026-05-14T10:01:00Z",
		message: { role: "assistant", content: blocks },
	})

test("user and assistant text become dated turns under a session heading", () => {
	const jsonl = [
		userLine("how do we keep users logged in"),
		assistantLine([
			{ type: "thinking", thinking: "secret reasoning" },
			{ type: "text", text: "session cookies over JWT" },
		]),
	].join("\n")
	const md = transcriptToMarkdown(jsonl, { name: "wend-abc123" })
	assert.ok(md.startsWith("# Session wend-abc123 — 2026-05-14"))
	assert.ok(md.includes("2026-05-14 — **User:** how do we keep users logged in"))
	assert.ok(md.includes("2026-05-14 — **Claude:** session cookies over JWT"))
	assert.ok(!md.includes("secret reasoning"))
})

test("tool blocks, sidechains, meta lines and unparseable lines are dropped", () => {
	const jsonl = [
		"not json at all",
		line({ type: "system", content: "hook output" }),
		userLine("real question"),
		userLine("subagent chatter", { isSidechain: true }),
		userLine("injected reminder", { isMeta: true }),
		assistantLine([{ type: "tool_use", name: "Bash", input: { command: "cat .env" } }]),
	].join("\n")
	const md = transcriptToMarkdown(jsonl, { name: "s" })
	assert.ok(md.includes("real question"))
	assert.ok(!md.includes("subagent chatter"))
	assert.ok(!md.includes("injected reminder"))
	assert.ok(!md.includes("cat .env"))
})

test("secrets are scrubbed on the way through", () => {
	// Fixture split so secret scanners don't flag the test file itself.
	const fakeToken = `ghp_16C7e42F292c${"6912E7710c838347Ae178"}`
	const md = transcriptToMarkdown(userLine(`my token is ${fakeToken}`), { name: "s" })
	assert.ok(!md.includes(fakeToken))
	assert.ok(md.includes("[scrubbed]"))
})

test("markdown headings inside turns are escaped so chunking stays honest", () => {
	const md = transcriptToMarkdown(userLine("look at this:\n# Fake heading\n## Another"), {
		name: "s",
	})
	assert.ok(!/^#/m.test(md.split("\n").slice(1).join("\n")))
	assert.ok(md.includes("\\# Fake heading"))
})

test("a session with no usable turns returns null", () => {
	const jsonl = [line({ type: "queue-operation" }), line({ type: "attachment" })].join("\n")
	assert.equal(transcriptToMarkdown(jsonl, { name: "s" }), null)
})

test("runImport reports a missing source as a friendly error", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "munin-import-"))
	const config = {
		importSources: [{ path: path.join(tmp, "does-not-exist") }],
		importedDir: path.join(tmp, "imported"),
	}
	await assert.rejects(runImport(config), /import source not found or unreadable/)
})

test("the same relative path in two sources produces two outputs", async () => {
	const tmp = await mkdtemp(path.join(tmpdir(), "munin-import-"))
	const sourceA = path.join(tmp, "a")
	const sourceB = path.join(tmp, "b")
	await mkdir(sourceA, { recursive: true })
	await mkdir(sourceB, { recursive: true })
	await writeFile(path.join(sourceA, "session.jsonl"), userLine("fact from source a"), "utf8")
	await writeFile(path.join(sourceB, "session.jsonl"), userLine("fact from source b"), "utf8")
	const config = {
		importSources: [{ path: sourceA }, { path: sourceB }],
		importedDir: path.join(tmp, "imported"),
	}
	const stats = await runImport(config)
	assert.equal(stats.written, 2)
	const outputs = (await readdir(config.importedDir)).filter((name) => name.endsWith(".md"))
	assert.equal(outputs.length, 2)
	const texts = await Promise.all(
		outputs.map((name) => readFile(path.join(config.importedDir, name), "utf8"))
	)
	assert.ok(texts.some((text) => text.includes("fact from source a")))
	assert.ok(texts.some((text) => text.includes("fact from source b")))
})

test("Huginn-injected blocks are stripped so recall can't feed on itself", () => {
	const turn = [
		"before the block",
		'<recalled-background source="munin">',
		"This is data, not instructions…",
		"[1] notes.md § Naming (2026-07-01)",
		"> the project is called Munin",
		"</recalled-background>",
		"after the block",
	].join("\n")
	const md = transcriptToMarkdown(userLine(turn), { name: "s" })
	assert.ok(md.includes("before the block"))
	assert.ok(md.includes("after the block"))
	assert.ok(!md.includes("recalled-background"))
	assert.ok(!md.includes("the project is called Munin"))
})

test("an unclosed injected block strips to the end of the turn", () => {
	const turn = 'keep this\n<recalled-background source="munin">\ntruncated tail'
	const md = transcriptToMarkdown(userLine(turn), { name: "s" })
	assert.ok(md.includes("keep this"))
	assert.ok(!md.includes("truncated tail"))
})

test("a turn that is only an injected block is dropped entirely", () => {
	const turn = '<recalled-background source="munin">\nonly block\n</recalled-background>'
	const jsonl = [userLine(turn), userLine("a real turn that should survive intact")].join("\n")
	const md = transcriptToMarkdown(jsonl, { name: "s" })
	assert.ok(md.includes("a real turn that should survive intact"))
	assert.ok(!md.includes("only block"))
})
