import assert from "node:assert/strict"
import test from "node:test"
import { chunkMarkdown } from "../src/chunker.js"

const meta = { file: "notes.md", date: "2026-07-12" }

test("splits by headings and keeps the heading text", () => {
	const chunks = chunkMarkdown("# One\nfirst\n## Two\nsecond", meta)
	assert.equal(chunks.length, 2)
	assert.equal(chunks[0].heading, "One")
	assert.equal(chunks[0].text, "first")
	assert.equal(chunks[1].heading, "Two")
	assert.equal(chunks[1].text, "second")
})

test("text before the first heading becomes an intro chunk", () => {
	const chunks = chunkMarkdown("intro line\n# One\nbody", meta)
	assert.equal(chunks[0].heading, "(intro)")
	assert.equal(chunks[0].text, "intro line")
})

test("empty sections are skipped", () => {
	const chunks = chunkMarkdown("# Empty\n\n# Full\ncontent", meta)
	assert.equal(chunks.length, 1)
	assert.equal(chunks[0].heading, "Full")
})

test("chunks carry file and date metadata", () => {
	const [chunk] = chunkMarkdown("# H\nbody", meta)
	assert.equal(chunk.file, "notes.md")
	assert.equal(chunk.date, "2026-07-12")
})
