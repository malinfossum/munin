// Hybrid ranking: cosine similarity + IDF-weighted keyword overlap,
// plus a recency boost from the chunk date and a per-source weight.
// Pure module — the caller supplies today's date.
//
// Confidence and precedence are separate questions. minScore gates on the
// unweighted score — does this chunk actually answer the query — while the
// source weight only orders what survives. Multiplying before the gate
// muted low-weight sources outright: an imported chunk (weight 0.25) could
// not reach minScore 0.3 even on a perfect match. Rank-down, not mute.
//
// Imported transcript prose is chattier than curated memory and matches
// loosely, so it clears a higher bar (importedMinScore) — measured on the
// golden set, where the honesty probe pulled an unrelated transcript up
// to 0.42. Never below minScore: a stricter caller must not accidentally
// loosen the imported gate.
export function rankChunks(query, chunks, options) {
	const {
		topK,
		minScore,
		semanticWeight,
		keywordWeight,
		recencyWeight,
		recencyHalfLifeDays,
		importedMinScore,
		today,
	} = options
	const importedGate = Math.max(minScore, importedMinScore ?? minScore)
	const terms = [...new Set(tokenize(query.text).map(stem))]
	const chunkTerms = chunks.map(
		(chunk) => new Set(tokenize(`${chunk.heading} ${chunk.text}`).map(stem))
	)
	const idf = inverseDocumentFrequency(terms, chunkTerms)

	return chunks
		.map((chunk, i) => {
			const semantic = dot(query.vector, chunk.vector)
			const keyword = keywordScore(terms, idf, chunkTerms[i])
			const recency = recencyBoost(chunk.date, today, recencyHalfLifeDays)
			const relevance =
				semanticWeight * semantic + keywordWeight * keyword + recencyWeight * recency
			const score = relevance * (chunk.weight ?? 1)
			return { ...chunk, score, relevance, semantic, keyword }
		})
		.filter((chunk) => chunk.relevance >= (chunk.imported === true ? importedGate : minScore))
		.sort((a, b) => b.score - a.score)
		.slice(0, topK)
}

// Lowercase unicode word tokens, deduplicated. Keeps letters, digits and
// inner hyphens so Norwegian words and slugs like "fable-mode" survive.
export function tokenize(text) {
	return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [])]
}

const STEM_SUFFIXES = [
	["ations", ""],
	["ation", ""],
	["ings", ""],
	["ing", ""],
	["ions", ""],
	["ion", ""],
	["ies", "y"],
	["ied", "y"],
	["ed", ""],
	["ly", ""],
	["es", ""],
	["s", ""],
]

// Light suffix stemmer for the keyword leg: "injecting", "injected" and
// "injection" all reduce to "inject", so a query phrased differently from
// the memory still earns keyword credit. Query and chunk terms go through
// the same rules, so only collisions matter, not linguistic correctness.
// At most one rule fires; stems shorter than three characters fall back
// to the original term.
export function stem(term) {
	for (const [suffix, replacement] of STEM_SUFFIXES) {
		if (!term.endsWith(suffix)) continue
		if (suffix === "s" && term.endsWith("ss")) return term
		const base = term.slice(0, term.length - suffix.length) + replacement
		return base.length >= 3 ? base : term
	}
	return term
}

function inverseDocumentFrequency(terms, chunkTerms) {
	const idf = new Map()
	for (const term of terms) {
		let df = 0
		for (const termSet of chunkTerms) {
			if (termSet.has(term)) df++
		}
		idf.set(term, Math.log(1 + (chunkTerms.length - df + 0.5) / (df + 0.5)))
	}
	return idf
}

// Fraction of the query's IDF mass present in the chunk: 1 when every
// query term appears, weighted so rare terms ("Kenaz") dominate and
// stopwords barely count.
export function keywordScore(terms, idf, chunkTermSet) {
	let total = 0
	let matched = 0
	for (const term of terms) {
		const weight = idf.get(term)
		total += weight
		if (chunkTermSet.has(term)) matched += weight
	}
	return total === 0 ? 0 : matched / total
}

// Halves every halfLifeDays. A chunk dated today (or oddly, in the
// future) scores 1; an undated chunk scores 0.
export function recencyBoost(date, today, halfLifeDays) {
	if (!date || !today) return 0
	const ageDays = (Date.parse(today) - Date.parse(date)) / 86_400_000
	if (!Number.isFinite(ageDays)) return 0
	if (ageDays <= 0) return 1
	return 0.5 ** (ageDays / halfLifeDays)
}

export function dot(a, b) {
	let sum = 0
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
	return sum
}
