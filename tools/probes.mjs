#!/usr/bin/env node
// Runs the proactive-recall probes through the real CLI. Probes live in
// data/context-probes.json (gitignored — they quote private memory).
// Probes with "expect" must surface that citation in the injected block;
// probes without it must inject nothing — the Q10 honesty pattern
// extended to injection. The prompt travels as JSON on stdin, never in a
// shell string.
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const cli = path.join(root, "src", "cli.js")
const probes = JSON.parse(await readFile(path.join(root, "data", "context-probes.json"), "utf8"))
let passed = 0

for (const [i, probe] of probes.entries()) {
	const stdout = execFileSync(process.execPath, [cli, "context"], {
		input: JSON.stringify({ prompt: probe.prompt }),
		encoding: "utf8",
	})
	const ok = probe.expect ? stdout.includes(probe.expect) : stdout === ""
	if (ok) passed++
	console.log(`${ok ? "PASS" : "FAIL"} [${i + 1}] ${probe.prompt.slice(0, 60)}…`)
	if (!ok) {
		const got = stdout ? stdout.replaceAll("\n", " ").slice(0, 120) : "(no injection)"
		console.log(`     got: ${got}`)
		console.log(`     expected: ${probe.expect ?? "no injection"}`)
	}
}

console.log(`\n${passed}/${probes.length} passed`)
process.exitCode = passed === probes.length ? 0 : 1
