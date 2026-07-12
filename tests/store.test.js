import assert from "node:assert/strict"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { loadIndex, saveIndex } from "../src/store.js"

test("save and load round-trip", async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), "munin-test-"))
	t.after(() => rm(dir, { recursive: true, force: true }))

	const meta = { model: "test-model", chunks: 1 }
	const chunks = [{ file: "a.md", heading: "H", text: "body", vector: [0.1, 0.2] }]
	await saveIndex(dir, meta, chunks)

	const index = await loadIndex(dir)
	assert.deepEqual(index.meta, meta)
	assert.deepEqual(index.chunks, chunks)
})

test("saveIndex replaces an existing index and leaves no temp file", async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), "munin-test-"))
	t.after(() => rm(dir, { recursive: true, force: true }))

	await saveIndex(dir, { version: 1 }, [])
	await saveIndex(dir, { version: 2 }, [])

	const index = await loadIndex(dir)
	assert.equal(index.meta.version, 2)
	const entries = await readdir(dir)
	assert.deepEqual(entries, ["index.json"])
})

test("loadIndex returns null when no index exists", async () => {
	const index = await loadIndex(path.join(tmpdir(), "munin-does-not-exist"))
	assert.equal(index, null)
})
