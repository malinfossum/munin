import path from "node:path"

// Loads the embedding model once and returns an embed function.
// Offline-first: loading from the local cache is always tried with remote
// lookups disabled, so a hub outage can never break indexing. Only when
// whenever the offline load fails (first run, a changed pin, or a damaged cache)
// is the one-time download allowed — after that, runs are fully offline
// again. This keeps the spec's guarantee: the only network request Munin
// ever makes is the model download.
export async function createEmbedder(
	{ model, modelRevision, dataDir },
	{ offlineOnly = false } = {}
) {
	const { env, pipeline } = await import("@huggingface/transformers")
	env.cacheDir = path.join(dataDir, "models")
	env.allowRemoteModels = false

	let extractor
	try {
		extractor = await pipeline("feature-extraction", model, { revision: modelRevision })
	} catch (error) {
		// The hook path (spec M5) must never trigger the one-time download:
		// a cold cache means silent no-injection upstream, not a 30 MB fetch
		// riding a prompt.
		if (offlineOnly) throw error
		console.warn(
			"munin: model not in local cache — fetching the pinned revision (one-time download)"
		)
		env.allowRemoteModels = true
		extractor = await pipeline("feature-extraction", model, { revision: modelRevision })
	}

	return async function embed(texts) {
		const output = await extractor(texts, { pooling: "mean", normalize: true })
		return output.tolist()
	}
}
