// Vectors are normalized at embed time, so the dot product is cosine similarity.
export function rankChunks(queryVector, chunks, { topK, minScore }) {
	return chunks
		.map((chunk) => ({ ...chunk, score: dot(queryVector, chunk.vector) }))
		.filter((chunk) => chunk.score >= minScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK)
}

export function dot(a, b) {
	let sum = 0
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
	return sum
}
