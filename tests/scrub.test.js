import assert from "node:assert/strict"
import test from "node:test"
import { scrubSecrets, stripPrivate } from "../src/scrub.js"

const scrubbed = (text) => scrubSecrets(text).includes("[scrubbed]")

test("provider key prefixes are scrubbed", () => {
	assert.ok(scrubbed("my key is sk-ant-api03-abcdef1234567890abcdef"))
	// Realistic-shaped fixtures are split so secret scanners (e.g. GitHub
	// push protection) don't flag the test file itself as a leak.
	assert.ok(scrubbed(`token ghp_16C7e42F292c${"6912E7710c838347Ae178B4a"}`))
	assert.ok(scrubbed("github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz"))
	assert.ok(scrubbed(`slack xoxb-123456789012-${"abcdefghijklmnop"}`))
	assert.ok(scrubbed("aws AKIAIOSFODNN7EXAMPLE"))
	assert.ok(scrubbed(`google AIzaSyA-abcdefghijk${"lmnopqrstuvwxyz12345"}`))
})

test("jwt and pem blocks are scrubbed", () => {
	assert.ok(scrubbed("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc123def456"))
	const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nlines\n-----END RSA PRIVATE KEY-----"
	const out = scrubSecrets(pem)
	assert.ok(out.includes("[scrubbed]"))
	assert.ok(!out.includes("MIIEow"))
})

test("assignments keep the key and scrub the value", () => {
	const out = scrubSecrets("set PASSWORD=hunter2secret and api_key: abc123xyz789")
	assert.ok(out.includes("PASSWORD"))
	assert.ok(!out.includes("hunter2secret"))
	assert.ok(!out.includes("abc123xyz789"))
})

test("long opaque tokens are scrubbed, prose is not", () => {
	assert.ok(scrubbed("hash 751bff37182d3f1213fa05d7196b954e230abad9"))
	const prose = "We renamed the folders and updated the gitignore patterns accordingly."
	assert.equal(scrubSecrets(prose), prose)
})

test("url credentials are scrubbed, the host survives", () => {
	const out = scrubSecrets("db is postgres://malin:hunter2secret@localhost:5432/app")
	assert.ok(!out.includes("hunter2secret"))
	assert.ok(!out.includes("malin:"))
	assert.ok(out.includes("localhost:5432/app"))
})

test("bearer header values are scrubbed", () => {
	const out = scrubSecrets("Authorization: Bearer abc12345token99")
	assert.ok(!out.includes("abc12345token99"))
})

test("npm auth tokens are scrubbed", () => {
	const out = scrubSecrets("//registry.npmjs.org/:_authToken=npm_a1b2c3d4e5")
	assert.ok(!out.includes("npm_a1b2c3d4e5"))
})

test("underscore provider keys are scrubbed", () => {
	assert.ok(scrubbed("stripe sk_live_51HAbCdEfGhIjKlMnOp"))
})

test("env-style prefixed assignments keep the name and scrub the value", () => {
	const out = scrubSecrets('GITHUB_TOKEN=ghx9AbCdEf12345 and $env:MY_API_SECRET = "topsecret99"')
	assert.ok(out.includes("GITHUB_TOKEN"))
	assert.ok(out.includes("MY_API_SECRET"))
	assert.ok(!out.includes("ghx9AbCdEf12345"))
	assert.ok(!out.includes("topsecret99"))
	assert.ok(!scrubSecrets("DB_PASSWORD=hunter2again").includes("hunter2again"))
})

test("bare bearer tokens are scrubbed, short prose after bearer is not", () => {
	assert.ok(!scrubSecrets("sent Bearer abc123def456ghi789 today").includes("abc123def456ghi789"))
	const prose = "the bearer of bad news"
	assert.equal(scrubSecrets(prose), prose)
})

test("norwegian text and normal code words survive", () => {
	const text = "Blåbærsyltetøy på skiva — const handleSubmit = () => {}"
	assert.equal(scrubSecrets(text), text)
})

// Synthetic fixtures: month + 80 marks a synthetic fødselsnummer, which is
// never issued to a real person. Card numbers are published test cards.
test("checksum-valid norwegian id and account numbers are scrubbed", () => {
	assert.ok(!scrubSecrets("fnr 01819010001 i søknaden").includes("01819010001"))
	assert.ok(!scrubSecrets("fødselsnummer: 158299 10087").includes("10087"))
	assert.ok(!scrubSecrets("kontonr 1234.56.10004 til husleie").includes("10004"))
	assert.ok(!scrubSecrets("konto 1234 56 10004").includes("10004"))
	assert.ok(!scrubSecrets("raw 12345610004").includes("12345610004"))
})

test("card numbers that pass luhn are scrubbed", () => {
	assert.ok(!scrubSecrets("card 4111 1111 1111 1111 exp").includes("1111 1111"))
	assert.ok(!scrubSecrets("card 4111-1111-1111-1111").includes("1111-1111"))
	assert.ok(!scrubSecrets("card 4111111111111111").includes("4111111111111111"))
	assert.ok(!scrubSecrets("amex 3782 822463 10005").includes("822463"))
})

test("a trailing number after a card does not hide it", () => {
	const out = scrubSecrets("paid with 4111 1111 1111 1111 12 kr")
	assert.ok(!out.includes("4111"))
	assert.ok(out.includes("12 kr"))
})

test("numbers that fail the checksum or the shape survive", () => {
	for (const text of [
		"order 12345678901 shipped",
		"card 4111 1111 1111 1112",
		"call +47 912 34 567 today",
		"released 2026-10-07 as 1.2.3",
		"scores 10 20 30 40 50 61 72",
		"timestamp 1759831234567",
	]) {
		assert.equal(scrubSecrets(text), text)
	}
})

test("private blocks are stripped, the text around them survives", () => {
	const out = stripPrivate("before <private>my fnr and bank</private> after")
	assert.equal(out, "before  after")
	assert.equal(stripPrivate("a <PRIVATE>x</Private> b <private>y</private> c"), "a  b  c")
	assert.equal(stripPrivate("keep\n<private>\nmulti\nline\n</private>\nend"), "keep\n\nend")
})

test("an unclosed private block strips to the end", () => {
	assert.equal(stripPrivate("keep this <private>but not this\nor this"), "keep this ")
})
