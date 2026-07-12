import assert from "node:assert/strict"
import test from "node:test"
import { dot, rankChunks } from "../src/search.js"

const chunks = [
	{ heading: "exact", vector: [1, 0] },
	{ heading: "unrelated", vector: [0, 1] },
	{ heading: "close", vector: [0.8, 0.6] },
]

test("ranks by similarity, best first", () => {
	const results = rankChunks([1, 0], chunks, { topK: 5, minScore: 0 })
	assert.deepEqual(
		results.map((chunk) => chunk.heading),
		["exact", "close", "unrelated"]
	)
})

test("minScore filters out weak matches", () => {
	const results = rankChunks([1, 0], chunks, { topK: 5, minScore: 0.5 })
	assert.deepEqual(
		results.map((chunk) => chunk.heading),
		["exact", "close"]
	)
})

test("topK caps the result count", () => {
	const results = rankChunks([1, 0], chunks, { topK: 1, minScore: 0 })
	assert.equal(results.length, 1)
	assert.equal(results[0].heading, "exact")
})

test("dot product of normalized vectors is cosine similarity", () => {
	assert.equal(dot([1, 0], [1, 0]), 1)
	assert.equal(dot([1, 0], [0, 1]), 0)
})
