import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))

// Where a user's own config and index live once Munin is installed as a
// package. They must not sit inside the package directory: npm update
// replaces its contents, which would wipe an index that takes minutes to
// build. Platform arguments are injected so the rules stay testable.
export function userConfigDir(env = process.env, platform = process.platform, home = homedir()) {
	if (platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "munin")
	if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "munin")
	return path.join(home, ".config", "munin")
}

export function userDataDir(env = process.env, platform = process.platform, home = homedir()) {
	if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "munin")
	if (env.XDG_DATA_HOME) return path.join(env.XDG_DATA_HOME, "munin")
	return path.join(home, ".local", "share", "munin")
}

// munin.config.json is the committed default. The override is
// munin.config.local.json next to it in a git checkout, or
// munin.config.json in the user config dir for an installed copy — and
// the presence of the checkout file is what picks between them, so
// working on Munin never reads or writes the installed copy's index.
export async function loadConfig() {
	const base = await readConfigFile(path.join(projectRoot, "munin.config.json"))
	if (!base) throw new Error("munin.config.json not found in the project root")
	const checkoutLocal = path.join(projectRoot, "munin.config.local.json")
	const isCheckout = existsSync(checkoutLocal)
	const local = isCheckout
		? await readConfigFile(checkoutLocal)
		: await readConfigFile(path.join(userConfigDir(), "munin.config.json"))
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
	config.modelRevision = config.modelRevision ?? "main"
	config.importSources = (config.importSources ?? []).map(normalizeImportSource)
	config.importedWeight = config.importedWeight ?? 0.25
	config.contextMinScore = config.contextMinScore ?? 0.45
	config.contextMaxChunks = config.contextMaxChunks ?? 3
	config.importedMinScore = config.importedMinScore ?? 0.5
	config.importedTopK = config.importedTopK ?? 2
	config.contextIncludeImported = config.contextIncludeImported === true
	config.dataDir = isCheckout ? path.join(projectRoot, "data") : userDataDir()
	config.importedDir = path.join(config.dataDir, "imported")
	if (existsSync(config.importedDir)) {
		config.sources.push({ path: config.importedDir, weight: config.importedWeight, imported: true })
	}
	return config
}

async function readConfigFile(filePath) {
	let raw
	try {
		raw = await readFile(filePath, "utf8")
	} catch {
		return null
	}
	try {
		return JSON.parse(raw)
	} catch {
		throw new Error(`${path.basename(filePath)} is not valid JSON`)
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
	return {
		path: expandHome(source.path),
		weight: source.weight ?? 1,
		imported: source.imported === true,
	}
}

// Import sources are opt-in and weightless — imported chunks always rank
// at config.importedWeight, the lowest weight in the index (spec M4).
export function normalizeImportSource(entry) {
	const source = typeof entry === "string" ? { path: entry } : { ...entry }
	if (typeof source.path !== "string" || source.path.length === 0) {
		throw new Error('each import source needs a "path"')
	}
	return { path: expandHome(source.path) }
}
