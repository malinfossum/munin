#!/usr/bin/env node
import { loadConfig } from "./config.js"
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
	process.exitCode = command ? 1 : 0
}
