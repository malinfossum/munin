import assert from "node:assert/strict"
import test from "node:test"
import { parseHookPrompt, shouldSkipPrompt } from "../src/context.js"

test("hook JSON yields its prompt field", () => {
	const stdin = JSON.stringify({ session_id: "abc", prompt: "why did we pick session cookies" })
	assert.equal(parseHookPrompt(stdin), "why did we pick session cookies")
})

test("plain text stdin is accepted as the prompt (hand-testing path)", () => {
	assert.equal(parseHookPrompt("  plain words here  "), "plain words here")
})

test("empty stdin and JSON without a prompt yield null", () => {
	assert.equal(parseHookPrompt(""), null)
	assert.equal(parseHookPrompt("   "), null)
	assert.equal(parseHookPrompt(JSON.stringify({ session_id: "abc" })), null)
	assert.equal(parseHookPrompt(JSON.stringify({ prompt: "   " })), null)
})

test("short prompts are skipped, 15+ word prompts are not", () => {
	assert.equal(shouldSkipPrompt("fix the bug"), true)
	const long = Array.from({ length: 15 }, (_, i) => `word${i}`).join(" ")
	assert.equal(shouldSkipPrompt(long), false)
	assert.equal(shouldSkipPrompt(`${long.split(" ").slice(0, 14).join(" ")}`), true)
})

test("slash commands are skipped regardless of length", () => {
	const long = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ")
	assert.equal(shouldSkipPrompt(`/recap ${long}`), true)
})
