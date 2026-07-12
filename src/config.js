import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))

export async function loadConfig() {
	let raw
	try {
		raw = await readFile(path.join(projectRoot, "munin.config.json"), "utf8")
	} catch {
		throw new Error("munin.config.json not found in the project root")
	}

	const config = JSON.parse(raw)
	if (!Array.isArray(config.sources) || config.sources.length === 0) {
		throw new Error('config needs at least one entry in "sources"')
	}
	if (typeof config.model !== "string" || config.model.length === 0) {
		throw new Error('config needs a "model" name')
	}

	config.sources = config.sources.map(expandHome)
	config.topK = config.topK ?? 5
	config.minScore = config.minScore ?? 0.35
	config.dataDir = path.join(projectRoot, "data")
	return config
}

function expandHome(sourcePath) {
	if (sourcePath.startsWith("~")) {
		return path.join(homedir(), sourcePath.slice(1))
	}
	return sourcePath
}
