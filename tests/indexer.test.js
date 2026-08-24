import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { buildIndex, findMarkdownFiles } from "../src/indexer.js"

async function makeTree() {
	const dir = await mkdtemp(path.join(tmpdir(), "munin-walk-"))
	await writeFile(path.join(dir, "top.md"), "# Top")
	await writeFile(path.join(dir, "ignore.txt"), "not markdown")
	await writeFile(path.join(dir, ".hidden.md"), "# Hidden")
	await mkdir(path.join(dir, "sub"))
	await writeFile(path.join(dir, "sub", "nested.md"), "# Nested")
	return dir
}

test("finds markdown recursively, ignores dotfiles and non-markdown", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))

	const { files, skipped } = await findMarkdownFiles(dir)
	assert.deepEqual(files.map((file) => path.relative(dir, file)).sort(), [
		"sub" + path.sep + "nested.md",
		"top.md",
	])
	assert.deepEqual(skipped, [])
})

// A source may name one markdown file, not just a folder: pointing at a
// repo root would drag in data/ and node_modules, and re-index imported
// transcripts as curated — the exact provenance mix-up M5 guards against.
test("a single markdown file works as a source", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))

	const { files, skipped } = await findMarkdownFiles(path.join(dir, "top.md"))
	assert.deepEqual(files, [path.join(dir, "top.md")])
	assert.deepEqual(skipped, [])
})

// ~/.claude/memory is a junction, so a source root that is itself a link
// must still be walked — only links found inside a source are skipped.
test("a linked source root is still walked", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))
	const link = path.join(path.dirname(dir), `${path.basename(dir)}-link`)
	try {
		await symlink(dir, link, "junction")
	} catch {
		t.skip("cannot create links in this environment")
		return
	}
	t.after(() => rm(link, { recursive: true, force: true }))

	const { files } = await findMarkdownFiles(link)
	assert.equal(files.length, 2)
})

test("a non-markdown file as a source contributes nothing", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))

	const { files } = await findMarkdownFiles(path.join(dir, "ignore.txt"))
	assert.deepEqual(files, [])
})

test("a file source names its chunks by basename", async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), "munin-file-source-"))
	t.after(() => rm(dir, { recursive: true, force: true }))
	const doc = path.join(dir, "SPEC.md")
	await writeFile(doc, "# Spec\nthe rules")
	const config = {
		model: "test-model",
		modelRevision: "main",
		dataDir: path.join(dir, "data"),
		sources: [{ path: doc, weight: 1 }],
	}
	await buildIndex(config, async (texts) => texts.map(() => [1, 0]))
	const index = JSON.parse(await readFile(path.join(dir, "data", "index.json"), "utf8"))
	assert.deepEqual(
		index.chunks.map((chunk) => chunk.file),
		["SPEC.md"]
	)
})

test("links are reported as skipped, not followed", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))

	try {
		await symlink(path.join(dir, "sub"), path.join(dir, "linked"), "junction")
	} catch {
		t.skip("cannot create links in this environment")
		return
	}

	const { files, skipped } = await findMarkdownFiles(dir)
	assert.equal(
		files.some((file) => file.includes("linked")),
		false
	)
	assert.deepEqual(
		skipped.map((entry) => path.relative(dir, entry)),
		["linked"]
	)
})

test("chunks carry imported provenance and the index reports schema 2", async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), "munin-index-"))
	t.after(() => rm(dir, { recursive: true, force: true }))
	const curated = path.join(dir, "memory")
	const imported = path.join(dir, "imported")
	await mkdir(curated)
	await mkdir(imported)
	await writeFile(path.join(curated, "notes.md"), "# Notes\nfacts")
	await writeFile(path.join(imported, "session.md"), "# Session\nchatter")
	const config = {
		model: "test-model",
		modelRevision: "main",
		dataDir: path.join(dir, "data"),
		sources: [
			{ path: curated, weight: 1 },
			{ path: imported, weight: 0.25, imported: true },
		],
	}
	const embed = async (texts) => texts.map(() => [1, 0])
	await buildIndex(config, embed)
	const index = JSON.parse(await readFile(path.join(dir, "data", "index.json"), "utf8"))
	assert.equal(index.meta.schema, 2)
	const byFile = Object.fromEntries(index.chunks.map((chunk) => [chunk.file, chunk.imported]))
	assert.equal(byFile["notes.md"], false)
	assert.equal(byFile["session.md"], true)
})
