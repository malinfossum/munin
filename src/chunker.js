const HEADING = /^#{1,4}\s+(.*)/
const MAX_WORDS = 200
const OVERLAP_WORDS = 40

// Splits a markdown file into one chunk per heading section; long
// sections are further split into overlapping word windows.
// Text before the first heading becomes an "(intro)" chunk.
export function chunkMarkdown(text, { file, date }, options = {}) {
	const maxWords = options.maxWords ?? MAX_WORDS
	const overlapWords = options.overlapWords ?? OVERLAP_WORDS
	const chunks = []
	let heading = "(intro)"
	let buffer = []

	const flush = () => {
		const body = buffer.join("\n").trim()
		buffer = []
		if (!body) return
		for (const part of splitLongText(body, maxWords, overlapWords)) {
			chunks.push({ file, heading, date, text: part })
		}
	}

	for (const line of text.split("\n")) {
		const match = HEADING.exec(line)
		if (match) {
			flush()
			heading = match[1].trim()
		} else {
			buffer.push(line)
		}
	}
	flush()
	return chunks
}

// The embedding model truncates around 256 tokens, so a fact at the
// bottom of a long section would be invisible without this: every word
// must land inside at least one window.
export function splitLongText(text, maxWords = MAX_WORDS, overlapWords = OVERLAP_WORDS) {
	if (overlapWords >= maxWords) throw new Error("overlapWords must be smaller than maxWords")
	const tokens = text.split(/\s+/)
	if (tokens.length <= maxWords) return [text]
	const step = maxWords - overlapWords
	const parts = []
	for (let start = 0; ; start += step) {
		parts.push(tokens.slice(start, start + maxWords).join(" "))
		if (start + maxWords >= tokens.length) break
	}
	return parts
}
