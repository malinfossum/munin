import assert from "node:assert/strict"
import test from "node:test"
import { dot, keywordScore, rankChunks, recencyBoost, stem, tokenize } from "../src/search.js"

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

test("weight orders results but never gates them", () => {
	const chunks = [{ heading: "imported", vector: [1, 0], text: "", weight: 0.25 }]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, {
		...options,
		minScore: 0.3,
	})
	assert.equal(results.length, 1, "a strong match must survive its own low weight")
})

test("minScore still gates a weak match at full weight", () => {
	const chunks = [{ heading: "weak", vector: [0.3, 0.954], text: "", weight: 1 }]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, {
		...options,
		minScore: 0.3,
	})
	assert.equal(results.length, 0)
})

// Imported prose matches loosely, so it must clear importedMinScore —
// otherwise transcript chatter answers questions it has no answer to.
test("imported chunks clear a higher bar than curated ones", () => {
	const chunks = [
		{ heading: "imported", vector: [0.6, 0.8], text: "", weight: 0.25, imported: true },
		{ heading: "curated", vector: [0.6, 0.8], text: "", weight: 1 },
	]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, {
		...options,
		minScore: 0.3,
		importedMinScore: 0.5,
	})
	assert.deepEqual(
		results.map((result) => result.heading),
		["curated"]
	)
})

test("a stricter minScore is never loosened for imported chunks", () => {
	const chunks = [
		{ heading: "imported", vector: [0.8, 0.6], text: "", weight: 0.25, imported: true },
	]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, {
		...options,
		minScore: 0.6,
		importedMinScore: 0.5,
	})
	assert.equal(results.length, 0, "importedMinScore must not undercut minScore")
})

// The rank-down guarantee: because the heaviest imported chunk (0.25 x
// 1.05) still scores below any curated chunk that clears the gate,
// imported text can fill leftover slots but never displace curated memory.
test("every curated hit outranks every imported hit", () => {
	const chunks = [
		{ heading: "imported-perfect", vector: [1, 0], text: "", weight: 0.25 },
		{ heading: "curated-mediocre", vector: [0.6, 0.8], text: "", weight: 1 },
	]
	const results = rankChunks({ vector: [1, 0], text: "" }, chunks, {
		...options,
		minScore: 0.3,
	})
	assert.deepEqual(
		results.map((result) => result.heading),
		["curated-mediocre", "imported-perfect"]
	)
})

const slotOptions = { ...options, topK: 3, minScore: 0.3, importedMinScore: 0.5 }
const curatedChunk = (heading) => ({ heading, vector: [1, 0], text: "", weight: 1 })
const importedChunk = (heading) => ({
	heading,
	vector: [1, 0],
	text: "",
	weight: 0.25,
	imported: true,
})
const mixed = [
	curatedChunk("c1"),
	curatedChunk("c2"),
	curatedChunk("c3"),
	curatedChunk("c4"),
	importedChunk("i1"),
	importedChunk("i2"),
	importedChunk("i3"),
]

// Weight-for-ordering alone left imported content unreachable: curated hits
// filled every topK slot. importedTopK adds slots rather than taking them,
// so curated recall is never traded away for transcript text.
test("imported hits take reserved slots after the curated ones", () => {
	const results = rankChunks({ vector: [1, 0], text: "" }, mixed, {
		...slotOptions,
		importedTopK: 2,
	})
	assert.deepEqual(
		results.map((result) => result.heading),
		["c1", "c2", "c3", "i1", "i2"]
	)
})

test("reserved slots are extra, never taken from the curated ones", () => {
	const withSlots = rankChunks({ vector: [1, 0], text: "" }, mixed, {
		...slotOptions,
		importedTopK: 2,
	})
	const withoutSlots = rankChunks({ vector: [1, 0], text: "" }, mixed, slotOptions)
	assert.deepEqual(
		withSlots.filter((result) => result.imported !== true),
		withoutSlots
	)
})

// Proactive recall's hard chunk cap is spec'd (M5), so the context path
// passes importedTopK 0 and must get exactly topK back.
test("importedTopK 0 leaves the result set untouched", () => {
	const results = rankChunks({ vector: [1, 0], text: "" }, mixed, {
		...slotOptions,
		importedTopK: 0,
	})
	assert.equal(results.length, 3)
	assert.equal(
		results.some((result) => result.imported === true),
		false
	)
})

test("an imported hit below its gate never takes a reserved slot", () => {
	const weak = [curatedChunk("c1"), { ...importedChunk("i1"), vector: [0.6, 0.8] }]
	const results = rankChunks({ vector: [1, 0], text: "" }, weak, {
		...slotOptions,
		importedTopK: 2,
	})
	assert.deepEqual(
		results.map((result) => result.heading),
		["c1"]
	)
})

test("stem collapses inflected forms to a shared stem", () => {
	assert.equal(stem("injecting"), "inject")
	assert.equal(stem("injected"), "inject")
	assert.equal(stem("injection"), "inject")
	assert.equal(stem("injections"), "inject")
	assert.equal(stem("guardrails"), "guardrail")
	assert.equal(stem("memories"), "memory")
	assert.equal(stem("prompts"), "prompt")
})

test("stem leaves short words, ss-words and norwegian words alone", () => {
	assert.equal(stem("was"), "was")
	assert.equal(stem("less"), "less")
	assert.equal(stem("blåbær"), "blåbær")
	assert.equal(stem("kenaz"), "kenaz")
})

test("inflection differences still earn keyword credit", () => {
	const chunks = [
		chunk("guardrails", [0.5, 0.86], "guardrails for injection of memories into a prompt"),
		chunk("other", [0.6, 0.8], "nothing relevant"),
	]
	const results = rankChunks({ vector: [1, 0], text: "injecting memory prompts" }, chunks, options)
	assert.equal(results[0].heading, "guardrails")
})

test("dot product of normalized vectors is cosine similarity", () => {
	assert.equal(dot([1, 0], [1, 0]), 1)
	assert.equal(dot([1, 0], [0, 1]), 0)
})
