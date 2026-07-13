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
				file: path.relative(source.path, filePath).replaceAll("\\", "/"),
				date: mtime.toISOString().slice(0, 10),
			}
			for (const chunk of chunkMarkdown(text, chunkMeta)) {
				chunk.hash = hashChunk(chunk)
				chunk.weight = source.weight
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
		model: config.model,
		modelRevision: config.modelRevision,
		indexedAt: new Date().toISOString(),
		files: fileCount,
		chunks: chunks.length,
	}
	await saveIndex(config.dataDir, meta, chunks)
	return { files: fileCount, chunks: chunks.length, embedded: pending.length, skipped }
}

function hashChunk(chunk) {
	return createHash("sha256").update(`${chunk.heading}\n${chunk.text}`).digest("hex")
}

// Links are reported as skipped, not followed — following them risks
// walking into loops or out of the configured sources.
export async function findMarkdownFiles(dir) {
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
