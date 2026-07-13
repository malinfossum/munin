import assert from "node:assert/strict"
import test from "node:test"
import { normalizeSource } from "../src/config.js"

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
