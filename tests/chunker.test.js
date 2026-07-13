import assert from "node:assert/strict"
import test from "node:test"
import { chunkMarkdown, latestInlineDate, splitLongText } from "../src/chunker.js"

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

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ")

test("short sections stay a single chunk", () => {
	assert.deepEqual(splitLongText("just a few words", 200, 40), ["just a few words"])
})

test("long sections split into overlapping windows", () => {
	assert.deepEqual(splitLongText(words(10), 4, 2), [
		"w0 w1 w2 w3",
		"w2 w3 w4 w5",
		"w4 w5 w6 w7",
		"w6 w7 w8 w9",
	])
})

test("every word of a long section lands in some window", () => {
	const seen = new Set(splitLongText(words(11), 4, 2).flatMap((part) => part.split(" ")))
	assert.equal(seen.size, 11)
})

test("splitLongText rejects an overlap that cannot advance", () => {
	assert.throws(() => splitLongText("some words here", 4, 4), /overlap/)
})

test("a long section becomes several chunks under the same heading", () => {
	const chunks = chunkMarkdown(`# Long\n${words(10)}`, meta, { maxWords: 4, overlapWords: 2 })
	assert.equal(chunks.length, 4)
	assert.ok(chunks.every((chunk) => chunk.heading === "Long"))
})

test("chunk date comes from the latest inline entry date", () => {
	const chunks = chunkMarkdown("# Log\n2026-01-05 — old fact\n2026-03-20 — newer fact", meta)
	assert.equal(chunks[0].date, "2026-03-20")
})

test("file date is the fallback when no inline date exists", () => {
	const chunks = chunkMarkdown("# H\nno dates here", meta)
	assert.equal(chunks[0].date, "2026-07-12")
})

test("latestInlineDate ignores non-date numbers", () => {
	assert.equal(latestInlineDate("version 2026 and 12-31 but 2026-05-14 — real"), "2026-05-14")
	assert.equal(latestInlineDate("nothing dated"), null)
})
