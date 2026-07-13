import { readdir } from "node:fs/promises"
import path from "node:path"

// Loads the embedding model once and returns an embed function.
// The model is downloaded on first use and cached under data/models.
// Once cached, remote lookups are disabled so "fully offline after
// download" is a guarantee the code keeps, not a hope.
export async function createEmbedder({ model, modelRevision, dataDir }) {
	const { env, pipeline } = await import("@huggingface/transformers")
	const cacheDir = path.join(dataDir, "models")
	env.cacheDir = cacheDir
	if (await hasCachedModel(cacheDir, model)) {
		env.allowRemoteModels = false
	}

	const extractor = await pipeline("feature-extraction", model, { revision: modelRevision })

	return async function embed(texts) {
		const output = await extractor(texts, { pooling: "mean", normalize: true })
		return output.tolist()
	}
}

async function hasCachedModel(cacheDir, model) {
	try {
		const entries = await readdir(path.join(cacheDir, ...model.split("/")))
		return entries.length > 0
	} catch {
		return false
	}
}
