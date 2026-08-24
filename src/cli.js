#!/usr/bin/env node
import { loadConfig } from "./config.js"
import {
	buildContextBlock,
	filterInjectable,
	parseHookPrompt,
	shouldSkipPrompt,
} from "./context.js"
import { createEmbedder } from "./embedder.js"
import { runImport } from "./importer.js"
import { buildIndex } from "./indexer.js"
import { rankChunks } from "./search.js"
import { loadIndex } from "./store.js"

const PREVIEW_LENGTH = 220

const [command, ...args] = process.argv.slice(2)

try {
	if (command === "index") await runIndex()
	else if (command === "search") await runSearch(args)
	else if (command === "status") await runStatus()
	else if (command === "import") await runImportCommand()
	else if (command === "context") await runContext()
	else printUsage()
} catch (error) {
	console.error(`munin: ${error.message}`)
	process.exitCode = 1
}

async function runIndex() {
	const config = await loadConfig()
	console.log("Loading embedding model (first run downloads it, ~30 MB)…")
	const embed = await createEmbedder(config)
	const stats = await buildIndex(config, embed)
	for (const skippedPath of stats.skipped) {
		console.warn(`warning: skipped link (not followed): ${skippedPath}`)
	}
	console.log(
		`Indexed ${stats.chunks} chunks from ${stats.files} files (${stats.embedded} embedded, ${stats.chunks - stats.embedded} reused).`
	)
}

async function runSearch(args) {
	const asJson = args.includes("--json")
	const query = args
		.filter((arg) => arg !== "--json")
		.join(" ")
		.trim()
	if (!query) throw new Error('usage: munin search "your question"')

	const config = await loadConfig()
	const index = await loadIndex(config.dataDir)
	if (!index) throw new Error('no index yet — run "munin index" first')
	if (index.meta.model !== config.model || index.meta.modelRevision !== config.modelRevision) {
		throw new Error(
			'the index was built with a different model or revision — run "munin index" to rebuild'
		)
	}

	const embed = await createEmbedder(config)
	const [queryVector] = await embed([query])
	const today = new Date().toISOString().slice(0, 10)
	const results = rankChunks({ vector: queryVector, text: query }, index.chunks, {
		...config,
		today,
	})

	if (asJson) {
		console.log(JSON.stringify(results.map(toResult), null, 2))
		return
	}
	if (results.length === 0) {
		console.log("No confident match.")
		return
	}
	results.forEach((chunk, i) => {
		console.log(
			`[${i + 1}] ${chunk.file} § ${chunk.heading} (${chunk.date}, ${chunk.score.toFixed(2)})`
		)
		console.log(`    ${preview(chunk.text)}\n`)
	})
}

async function runImportCommand() {
	const config = await loadConfig()
	const stats = await runImport(config)
	for (const failedPath of stats.failed) {
		console.warn(`warning: failed to import: ${failedPath}`)
	}
	console.log(
		`Imported ${stats.written} sessions (${stats.unchanged} unchanged, ${stats.skipped} empty, ${stats.failed.length} failed).`
	)
	if (stats.failed.length > 0) {
		console.warn("sentinel not updated — fix the failures and re-run")
		process.exitCode = 1
	}
	console.log('Run "munin index" to make the imported sessions searchable.')
}

// Proactive recall (spec M5). Fail-safe means silent: always exit 0, never a
// character of output on any failure, never a download — a broken index
// must not block or nag the prompt it rides on.
async function runContext() {
	try {
		// stdout errors arrive as async stream events the try/catch can't see —
		// an unlistened EPIPE would crash non-zero and break the exit-0 contract.
		process.stdout.on("error", () => {})
		if (process.stdin.isTTY) return
		const prompt = parseHookPrompt(await readStdin())
		if (!prompt || shouldSkipPrompt(prompt)) return
		const config = await loadConfig()
		const index = await loadIndex(config.dataDir)
		// schema 2 = imported provenance present; older indexes can't
		// enforce curated-only, so they inject nothing until re-indexed.
		if (index?.meta.schema !== 2) return
		if (index.meta.model !== config.model || index.meta.modelRevision !== config.modelRevision)
			return
		const embed = await createEmbedder(config, { offlineOnly: true })
		const [vector] = await embed([prompt])
		const today = new Date().toISOString().slice(0, 10)
		const results = rankChunks({ vector, text: prompt }, filterInjectable(index.chunks, config), {
			...config,
			topK: config.contextMaxChunks,
			minScore: config.contextMinScore,
			today,
		})
		if (results.length === 0) return
		process.stdout.write(buildContextBlock(results))
	} catch {
		// any Munin error → no injection; the prompt proceeds untouched
	}
}

async function readStdin() {
	let data = ""
	process.stdin.setEncoding("utf8")
	for await (const piece of process.stdin) data += piece
	return data
}

async function runStatus() {
	const config = await loadConfig()
	const index = await loadIndex(config.dataDir)
	if (!index) {
		console.log('No index yet — run "munin index" first.')
		return
	}
	const { model, modelRevision, indexedAt, files, chunks } = index.meta
	console.log(`Model:    ${model}`)
	console.log(`Revision: ${modelRevision ?? "(not recorded)"}`)
	console.log(`Indexed:  ${indexedAt}`)
	console.log(`Files:    ${files}`)
	console.log(`Chunks:   ${chunks}`)
}

function toResult({ file, heading, date, score, semantic, keyword, text }) {
	return { file, heading, date, score, semantic, keyword, text }
}

function preview(text) {
	const flat = text.replaceAll(/\s+/g, " ")
	return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat
}

function printUsage() {
	console.log("Munin — recall by meaning, cited by source.\n")
	console.log("  munin index             build or refresh the search index")
	console.log('  munin search "query"    find memories by meaning (--json for raw output)')
	console.log("  munin status            show what the index contains")
	console.log(
		"  munin import            convert configured session transcripts into data/ (opt-in)"
	)
	console.log(
		"  munin context           UserPromptSubmit hook endpoint (hook JSON on stdin; silent on failure)"
	)
	process.exitCode = command ? 1 : 0
}
