import path from "node:path"

// Loads the embedding model once and returns an embed function.
// Offline-first: loading from the local cache is always tried with remote
// lookups disabled, so a hub outage can never break indexing. Only when
// the pinned revision is not cached yet (first run, or the pin changed)
// is the one-time download allowed — after that, runs are fully offline
// again. This keeps the spec's guarantee: the only network request Munin
// ever makes is the model download.
export async function createEmbedder({ model, modelRevision, dataDir }) {
	const { env, pipeline } = await import("@huggingface/transformers")
	env.cacheDir = path.join(dataDir, "models")
	env.allowRemoteModels = false

	let extractor
	try {
		extractor = await pipeline("feature-extraction", model, { revision: modelRevision })
	} catch {
		env.allowRemoteModels = true
		extractor = await pipeline("feature-extraction", model, { revision: modelRevision })
	}

	return async function embed(texts) {
		const output = await extractor(texts, { pooling: "mean", normalize: true })
		return output.tolist()
	}
}
