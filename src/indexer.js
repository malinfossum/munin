import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { chunkMarkdown } from "./chunker.js"
import { loadIndex, saveIndex } from "./store.js"

const EMBED_BATCH = 16

// Reads every markdown file under the configured sources, chunks them,
// embeds new or changed chunks (unchanged ones reuse their stored vector),
// and writes the result to data/index.json. Sources are only ever read.
export async function buildIndex(config, embed) {
	const previous = await loadIndex(config.dataDir)
	const reusable = new Map()
	if (
		previous?.meta.model === config.model &&
		previous?.meta.modelRevision === config.modelRevision
	) {
		for (const chunk of previous.chunks) reusable.set(chunk.hash, chunk.vector)
	}

	const chunks = []
	const skipped = []
	let fileCount = 0
	for (const source of config.sources) {
		const found = await findMarkdownFiles(source.path)
		skipped.push(...found.skipped)
		for (const filePath of found.files) {
			fileCount++
			const text = await readFile(filePath, "utf8")
			const { mtime } = await stat(filePath)
			const chunkMeta = {
				file: relativeName(source.path, filePath),
				date: mtime.toISOString().slice(0, 10),
			}
			for (const chunk of chunkMarkdown(text, chunkMeta)) {
				chunk.hash = hashChunk(chunk)
				chunk.weight = source.weight
				// Provenance travels with the chunk: proactive recall (spec M5) must
				// exclude imported text without guessing from paths or weights.
				chunk.imported = source.imported === true
				chunks.push(chunk)
			}
		}
	}

	const pending = chunks.filter((chunk) => !reusable.has(chunk.hash))
	for (let i = 0; i < pending.length; i += EMBED_BATCH) {
		const batch = pending.slice(i, i + EMBED_BATCH)
		const vectors = await embed(batch.map((chunk) => `${chunk.heading}\n${chunk.text}`))
		batch.forEach((chunk, j) => {
			chunk.vector = vectors[j]
		})
	}
	for (const chunk of chunks) {
		if (!chunk.vector) chunk.vector = reusable.get(chunk.hash)
	}

	const meta = {
		schema: 2,
		model: config.model,
		modelRevision: config.modelRevision,
		indexedAt: new Date().toISOString(),
		files: fileCount,
		chunks: chunks.length,
	}
	await saveIndex(config.dataDir, meta, chunks)
	return { files: fileCount, chunks: chunks.length, embedded: pending.length, skipped }
}

// A source may name one file rather than a folder, and then
// path.relative() is empty — fall back to the basename so citations
// stay readable.
function relativeName(sourcePath, filePath) {
	const relative = path.relative(sourcePath, filePath)
	return (relative || path.basename(filePath)).replaceAll("\\", "/")
}

function hashChunk(chunk) {
	return createHash("sha256").update(`${chunk.heading}\n${chunk.text}`).digest("hex")
}

// Links are reported as skipped, not followed — following them risks
// walking into loops or out of the configured sources.
export async function findMarkdownFiles(dir) {
	// A source may point at a single markdown file. Naming a whole repo
	// root instead would drag in data/ and node_modules — and re-index
	// imported transcripts as curated, the provenance mix-up M5 guards
	// against — so one file has to be addressable on its own.
	// stat, not lstat: a configured source root may itself be a junction
	// (~/.claude/memory is one) and must still be walked. Links found
	// *inside* a source are skipped by the entry loop below.
	const info = await stat(dir)
	if (!info.isDirectory()) {
		return { files: dir.endsWith(".md") ? [dir] : [], skipped: [] }
	}
	const files = []
	const skipped = []
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue
		const fullPath = path.join(dir, entry.name)
		if (entry.isSymbolicLink()) {
			skipped.push(fullPath)
		} else if (entry.isDirectory()) {
			const nested = await findMarkdownFiles(fullPath)
			files.push(...nested.files)
			skipped.push(...nested.skipped)
		} else if (entry.name.endsWith(".md")) {
			files.push(fullPath)
		}
	}
	return { files, skipped }
}
