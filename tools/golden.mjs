#!/usr/bin/env node
// Runs the golden recall questions through the real CLI and reports
// pass/fail. Questions live in data/golden-questions.json (gitignored —
// they quote private memory). The query goes to execFile as an argv
// array, never a shell string.
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const root = fileURLToPath(new URL("..", import.meta.url))
const cli = path.join(root, "src", "cli.js")
const questionsPath = path.join(root, "data", "golden-questions.json")

const questions = JSON.parse(await readFile(questionsPath, "utf8"))
let passed = 0

for (const [i, entry] of questions.entries()) {
	const { stdout } = await run(process.execPath, [cli, "search", "--json", entry.question])
	const results = JSON.parse(stdout)
	const hit = entry.expect && results.find((r) => `${r.file} § ${r.heading}`.includes(entry.expect))
	const ok = entry.expectNone ? results.length === 0 : Boolean(hit)
	if (ok) passed++
	const top = results[0]
		? `${results[0].file} § ${results[0].heading} (${results[0].score.toFixed(2)})`
		: "no match"
	console.log(`${ok ? "PASS" : "FAIL"} [${i + 1}] ${entry.question}`)
	console.log(
		`     top: ${top}${entry.expectNone ? " — expected none" : ` — expect: ${entry.expect}`}`
	)
}

console.log(`\n${passed}/${questions.length} passed`)
process.exitCode = passed === questions.length ? 0 : 1
