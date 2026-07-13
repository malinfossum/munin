// Hybrid ranking: cosine similarity + IDF-weighted keyword overlap,
// plus a recency boost from the chunk date and a per-source weight.
// Pure module — the caller supplies today's date.
export function rankChunks(query, chunks, options) {
	const {
		topK,
		minScore,
		semanticWeight,
		keywordWeight,
		recencyWeight,
		recencyHalfLifeDays,
		today,
	} = options
	const terms = tokenize(query.text)
	const chunkTerms = chunks.map((chunk) => new Set(tokenize(`${chunk.heading} ${chunk.text}`)))
	const idf = inverseDocumentFrequency(terms, chunkTerms)

	return chunks
		.map((chunk, i) => {
			const semantic = dot(query.vector, chunk.vector)
			const keyword = keywordScore(terms, idf, chunkTerms[i])
			const recency = recencyBoost(chunk.date, today, recencyHalfLifeDays)
			const score =
				(semanticWeight * semantic + keywordWeight * keyword + recencyWeight * recency) *
				(chunk.weight ?? 1)
			return { ...chunk, score, semantic, keyword }
		})
		.filter((chunk) => chunk.score >= minScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK)
}

// Lowercase unicode word tokens, deduplicated. Keeps letters, digits and
// inner hyphens so Norwegian words and slugs like "fable-mode" survive.
export function tokenize(text) {
	return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [])]
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
