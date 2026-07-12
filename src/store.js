import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const INDEX_FILE = "index.json"

export async function loadIndex(dataDir) {
	let raw
	try {
		raw = await readFile(path.join(dataDir, INDEX_FILE), "utf8")
	} catch (error) {
		if (error.code === "ENOENT") return null
		throw new Error(`could not read the index (${error.code})`)
	}
	try {
		return JSON.parse(raw)
	} catch {
		throw new Error('the index file is corrupt — run "munin index" to rebuild it')
	}
}

// Write-then-rename so a crash mid-write can never corrupt the existing index.
export async function saveIndex(dataDir, meta, chunks) {
	await mkdir(dataDir, { recursive: true })
	const target = path.join(dataDir, INDEX_FILE)
	const temp = `${target}.tmp`
	await writeFile(temp, JSON.stringify({ meta, chunks }))
	await rename(temp, target)
}
