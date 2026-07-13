import assert from "node:assert/strict"
import test from "node:test"
import { dot, keywordScore, rankChunks, recencyBoost, tokenize } from "../src/search.js"

const options = {
	topK: 5,
	minScore: 0,
	semanticWeight: 0.7,
	keywordWeight: 0.3,
	recencyWeight: 0,
	recencyHalfLifeDays: 90,
	today: "2026-07-13",
}
const chunk = (heading, vector, text = "") => ({ heading, vector, text })
const semanticOnly = [
	chunk("exact", [1, 0]),
	chunk("unrelated", [0, 1]),
	chunk("close", [0.8, 0.6]),
]

test("ranks by similarity, best first", () => {
	const results = rankChunks({ vector: [1, 0], text: "" }, semanticOnly, options)
	assert.deepEqual(
		results.map((result) => result.heading),
		["exact", "close", "unrelated"]
	)
})

test("minScore filters out weak matches", () => {
	const results = rankChunks({ vector: [1, 0], text: "" }, semanticOnly, {
		...options,
		minScore: 0.5,
	})
	assert.deepEqual(
		results.map((result) => result.heading),
		["exact", "close"]
	)
})

test("topK caps the result count", () => {
	const results = rankChunks({ vector: [1, 0], text: "" }, semanticOnly, { ...options, topK: 1 })
	assert.equal(results.length, 1)
	assert.equal(results[0].heading, "exact")
})

test("a rare proper noun outranks semantic-only matches", () => {
	const chunks = [
		chunk("naming", [0.5, 0.86], "the kenaz project uses runes"),
		chunk("other-a", [0.9, 0.43], "nothing relevant"),
		chunk("other-b", [0.88, 0.47], "nothing relevant either"),
	]
	const results = rankChunks({ vector: [1, 0], text: "kenaz" }, chunks, options)
	assert.equal(results[0].heading, "naming")
})

test("keywordScore weighs rare terms above common ones", () => {
	const idf = new Map([
		["kenaz", 2],
		["the", 0.1],
	])
	const rareHit = keywordScore(["kenaz", "the"], idf, new Set(["kenaz"]))
	const commonHit = keywordScore(["kenaz", "the"], idf, new Set(["the"]))
	assert.ok(rareHit > commonHit)
})

test("tokenize lowercases, dedupes and keeps norwegian letters", () => {
	assert.deepEqual(tokenize("Blåbær blåbær fable-mode 42"), ["blåbær", "fable-mode", "42"])
})

test("recencyBoost halves at each half-life", () => {
	assert.equal(recencyBoost("2026-07-13", "2026-07-13", 90), 1)
	assert.ok(Math.abs(recencyBoost("2026-04-14", "2026-07-13", 90) - 0.5) < 0.01)
	assert.equal(recencyBoost(undefined, "2026-07-13", 90), 0)
})

test("recency boost breaks ties toward newer chunks", () => {
	const chunks = [
		{ heading: "old", vector: [1, 0], text: "", date: "2024-01-01" },
		{ heading: "new", vector: [1, 0], text: "", date: "2026-07-13" },
	]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, {
		...options,
		recencyWeight: 0.05,
	})
	assert.equal(results[0].heading, "new")
})

test("source weight multiplies the final score", () => {
	const chunks = [
		{ heading: "imported", vector: [1, 0], text: "", weight: 0.5 },
		{ heading: "curated", vector: [0.9, 0.43], text: "", weight: 1 },
	]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, options)
	assert.equal(results[0].heading, "curated")
})

test("dot product of normalized vectors is cosine similarity", () => {
	assert.equal(dot([1, 0], [1, 0]), 1)
	assert.equal(dot([1, 0], [0, 1]), 0)
})
