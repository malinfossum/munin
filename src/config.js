import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))

// munin.config.json is the committed default; munin.config.local.json
// (gitignored) overrides any field for machine-specific folders.
export async function loadConfig() {
	const base = await readConfigFile("munin.config.json")
	if (!base) throw new Error("munin.config.json not found in the project root")
	const local = await readConfigFile("munin.config.local.json")
	const config = { ...base, ...local }

	if (!Array.isArray(config.sources) || config.sources.length === 0) {
		throw new Error('config needs at least one entry in "sources"')
	}
	if (typeof config.model !== "string" || config.model.length === 0) {
		throw new Error('config needs a "model" name')
	}

	config.sources = config.sources.map(normalizeSource)
	config.topK = config.topK ?? 5
	config.minScore = config.minScore ?? 0.3
	config.semanticWeight = config.semanticWeight ?? 0.7
	config.keywordWeight = config.keywordWeight ?? 0.3
	config.recencyWeight = config.recencyWeight ?? 0.05
	config.recencyHalfLifeDays = config.recencyHalfLifeDays ?? 90
	config.dataDir = path.join(projectRoot, "data")
	return config
}

async function readConfigFile(name) {
	let raw
	try {
		raw = await readFile(path.join(projectRoot, name), "utf8")
	} catch {
		return null
	}
	try {
		return JSON.parse(raw)
	} catch {
		throw new Error(`${name} is not valid JSON`)
	}
}

function expandHome(sourcePath) {
	if (sourcePath.startsWith("~")) {
		return path.join(homedir(), sourcePath.slice(1))
	}
	return sourcePath
}

// A source is "~/path" or { "path": "~/path", "weight": 0.8 } — curated
// memory outranks imported material via the weight multiplier (spec M2/M4).
export function normalizeSource(entry) {
	const source = typeof entry === "string" ? { path: entry } : { ...entry }
	if (typeof source.path !== "string" || source.path.length === 0) {
		throw new Error('each source needs a "path"')
	}
	return { path: expandHome(source.path), weight: source.weight ?? 1 }
}
