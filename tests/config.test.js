import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import {
	normalizeImportSource,
	normalizeSource,
	userConfigDir,
	userDataDir,
} from "../src/config.js"

test("a plain string source gets weight 1", () => {
	const source = normalizeSource("C:/memory")
	assert.equal(source.path, "C:/memory")
	assert.equal(source.weight, 1)
})

test("an object source keeps its weight", () => {
	assert.equal(normalizeSource({ path: "C:/imported", weight: 0.5 }).weight, 0.5)
})

test("a source without a path is rejected", () => {
	assert.throws(() => normalizeSource({ weight: 2 }), /path/)
})

test("importSources entries normalize like sources but carry no weight", () => {
	assert.equal(normalizeImportSource("C:/transcripts").path, "C:/transcripts")
	assert.equal(normalizeImportSource({ path: "C:/transcripts" }).weight, undefined)
	assert.throws(() => normalizeImportSource({}), /path/)
})

test("a source marked imported keeps its flag through normalization", () => {
	assert.equal(normalizeSource({ path: "C:/transcripts", imported: true }).imported, true)
	assert.equal(normalizeSource("C:/memory").imported, false)
})

// Installed as a package, Munin must keep the user's config and index
// outside node_modules — npm update replaces package contents, and that
// would silently destroy an index that took minutes to build.
test("windows puts config in APPDATA and the index in LOCALAPPDATA", () => {
	const env = { APPDATA: "C:/Users/x/AppData/Roaming", LOCALAPPDATA: "C:/Users/x/AppData/Local" }
	assert.equal(userConfigDir(env, "win32", "C:/Users/x"), path.join(env.APPDATA, "munin"))
	assert.equal(userDataDir(env, "win32", "C:/Users/x"), path.join(env.LOCALAPPDATA, "munin"))
})

test("XDG variables win on other platforms", () => {
	const env = { XDG_CONFIG_HOME: "/home/x/cfg", XDG_DATA_HOME: "/home/x/data" }
	assert.equal(userConfigDir(env, "linux", "/home/x"), path.join("/home/x/cfg", "munin"))
	assert.equal(userDataDir(env, "linux", "/home/x"), path.join("/home/x/data", "munin"))
})

test("without XDG variables the spec defaults apply", () => {
	assert.equal(userConfigDir({}, "linux", "/home/x"), path.join("/home/x", ".config", "munin"))
	assert.equal(
		userDataDir({}, "linux", "/home/x"),
		path.join("/home/x", ".local", "share", "munin")
	)
})

test("windows falls back to the home directory when APPDATA is unset", () => {
	assert.equal(
		userConfigDir({}, "win32", "C:/Users/x"),
		path.join("C:/Users/x", ".config", "munin")
	)
	assert.equal(
		userDataDir({}, "win32", "C:/Users/x"),
		path.join("C:/Users/x", ".local", "share", "munin")
	)
})
