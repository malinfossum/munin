import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { scrubSecrets } from "./scrub.js"

const SENTINEL = ".sentinel.json"

// Huginn-mode injections land in transcripts; importing them back would
// let injected chunks boost their own future ranking (spec M5: no
// re-import feedback loop). An unclosed block strips to the end of the
// turn — safer to drop too much than to re-index injected memory.
// Case-sensitive on purpose: Munin only ever emits exact lowercase tags, and
// escapeWrapperTags neutralizes any cased variant before it can reach a block.
export function stripInjectedBlocks(text) {
	return text
		.replaceAll(/<recalled-background source="munin">[\s\S]*?(<\/recalled-background>|$)/g, "")
		.trim()
}

// Converts one Claude Code session transcript (JSONL) into dated markdown.
// Only user text and assistant text blocks survive: thinking, tool calls,
// tool results, images, sidechain (subagent) and meta lines are dropped
// before scrubbing, so pasted keys in terminal output never reach the
// pipeline. Every turn is prefixed with its date so sub-chunk windows
// keep an honest inline date (recency must not come from import mtime).
export function transcriptToMarkdown(jsonlText, { name }) {
	const turns = []
	let sessionDate = null
	for (const raw of jsonlText.split("\n")) {
		if (!raw.trim()) continue
		let entry
		try {
			entry = JSON.parse(raw)
		} catch {
			continue
		}
		if (entry.type !== "user" && entry.type !== "assistant") continue
		if (entry.isSidechain === true || entry.isMeta === true) continue
		const text = stripInjectedBlocks(extractText(entry.message?.content))
		if (!text) continue
		const date = String(entry.timestamp ?? "").slice(0, 10) || null
		if (sessionDate === null && date) sessionDate = date
		const speaker = entry.type === "user" ? "User" : "Claude"
		// Escape markdown headings inside turns: a quoted "# title" must not
		// become a real chunk heading downstream (it would strand the window
		// under a fake heading with no inline date).
		const safe = scrubSecrets(text).replaceAll(/^(#{1,4}\s)/gm, "\\$1")
		turns.push(`${date ? `${date} — ` : ""}**${speaker}:** ${safe}`)
	}
	if (turns.length === 0) return null
	const heading = `# Session ${name}${sessionDate ? ` — ${sessionDate}` : ""}`
	return `${heading}\n\n${turns.join("\n\n")}\n`
}

// One-time-with-resume import: unchanged files (per the sentinel) are
// skipped; the sentinel is rewritten only after a fully successful run,
// so a crashed import redoes its work instead of half-counting it.
export async function runImport(config) {
	if (config.importSources.length === 0) {
		throw new Error(
			'no import sources configured — add "importSources" to munin.config.json (import is opt-in)'
		)
	}
	await mkdir(config.importedDir, { recursive: true })
	const sentinelPath = path.join(config.importedDir, SENTINEL)
	const previous = await readSentinel(sentinelPath)
	const files = { ...previous }
	const stats = { written: 0, skipped: 0, unchanged: 0, failed: [] }

	for (const [sourceIndex, source] of config.importSources.entries()) {
		let transcripts
		try {
			transcripts = await findTranscripts(source.path)
		} catch {
			throw new Error(`import source not found or unreadable: ${source.path}`)
		}
		for (const filePath of transcripts) {
			// The ledger keys on the full path and outputs are prefixed per
			// source, so the same relative path in two sources cannot collide.
			const ledgerKey = filePath.replaceAll("\\", "/")
			const relPath = path.relative(source.path, filePath).replaceAll("\\", "/")
			try {
				const { size, mtimeMs } = await stat(filePath)
				if (previous[ledgerKey]?.size === size && previous[ledgerKey]?.mtimeMs === mtimeMs) {
					stats.unchanged++
					continue
				}
				const markdown = transcriptToMarkdown(await readFile(filePath, "utf8"), {
					name: path.basename(filePath, ".jsonl").slice(0, 8),
				})
				if (!markdown) {
					stats.skipped++
					continue
				}
				const flat = `${relPath.replaceAll("/", "--")}.md`
				const outPath = path.join(
					config.importedDir,
					sourceIndex === 0 ? flat : `src${sourceIndex}--${flat}`
				)
				await writeFile(`${outPath}.tmp`, markdown, "utf8")
				await rename(`${outPath}.tmp`, outPath)
				files[ledgerKey] = { size, mtimeMs }
				stats.written++
			} catch {
				stats.failed.push(relPath)
			}
		}
	}
	if (stats.failed.length === 0) {
		await writeFile(
			`${sentinelPath}.tmp`,
			JSON.stringify({ importedAt: new Date().toISOString(), files }, null, "\t"),
			"utf8"
		)
		await rename(`${sentinelPath}.tmp`, sentinelPath)
	}
	return stats
}

// Transcripts sit at the top of each import source or one directory down
// (Claude Code keeps them per-project); links are never followed.
async function findTranscripts(dir) {
	const found = []
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full)
		else if (entry.isDirectory()) {
			for (const sub of await readdir(full, { withFileTypes: true })) {
				if (sub.isFile() && sub.name.endsWith(".jsonl")) found.push(path.join(full, sub.name))
			}
		}
	}
	return found
}

async function readSentinel(sentinelPath) {
	try {
		return JSON.parse(await readFile(sentinelPath, "utf8")).files ?? {}
	} catch {
		return {}
	}
}

function extractText(content) {
	if (typeof content === "string") return content.trim()
	if (!Array.isArray(content)) return ""
	return content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim()
}
