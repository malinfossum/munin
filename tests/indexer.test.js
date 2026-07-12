import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { findMarkdownFiles } from "../src/indexer.js"

async function makeTree() {
	const dir = await mkdtemp(path.join(tmpdir(), "munin-walk-"))
	await writeFile(path.join(dir, "top.md"), "# Top")
	await writeFile(path.join(dir, "ignore.txt"), "not markdown")
	await writeFile(path.join(dir, ".hidden.md"), "# Hidden")
	await mkdir(path.join(dir, "sub"))
	await writeFile(path.join(dir, "sub", "nested.md"), "# Nested")
	return dir
}

test("finds markdown recursively, ignores dotfiles and non-markdown", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))

	const { files, skipped } = await findMarkdownFiles(dir)
	assert.deepEqual(files.map((file) => path.relative(dir, file)).sort(), [
		"sub" + path.sep + "nested.md",
		"top.md",
	])
	assert.deepEqual(skipped, [])
})

test("links are reported as skipped, not followed", async (t) => {
	const dir = await makeTree()
	t.after(() => rm(dir, { recursive: true, force: true }))

	try {
		await symlink(path.join(dir, "sub"), path.join(dir, "linked"), "junction")
	} catch {
		t.skip("cannot create links in this environment")
		return
	}

	const { files, skipped } = await findMarkdownFiles(dir)
	assert.equal(
		files.some((file) => file.includes("linked")),
		false
	)
	assert.deepEqual(
		skipped.map((entry) => path.relative(dir, entry)),
		["linked"]
	)
})
