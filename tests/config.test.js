import assert from "node:assert/strict"
import test from "node:test"
import { normalizeImportSource, normalizeSource } from "../src/config.js"

test("a plain string source gets weight 1", () => {
	const source = normalizeSource("C:/memory")
	assert.equal(source.path, "C:/memory")
	assert.equal(source.weight, 1)
})

test("an object source keeps its weight", () => {
	assert.equal(normalizeSource({ path: "C:/imported", weight: 0.5 }).weight, 0.5)
})

test("a source without a path is rejected", () => {
	assert.throws(() => normalizeSource({ weight: 2 }), /path/)
})

test("importSources entries normalize like sources but carry no weight", () => {
	assert.equal(normalizeImportSource("C:/transcripts").path, "C:/transcripts")
	assert.equal(normalizeImportSource({ path: "C:/transcripts" }).weight, undefined)
	assert.throws(() => normalizeImportSource({}), /path/)
})
