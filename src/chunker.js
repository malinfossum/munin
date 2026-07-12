const HEADING = /^#{1,4}\s+(.*)/

// Splits a markdown file into one chunk per heading section.
// Text before the first heading becomes an "(intro)" chunk.
export function chunkMarkdown(text, { file, date }) {
	const chunks = []
	let heading = "(intro)"
	let buffer = []

	const flush = () => {
		const body = buffer.join("\n").trim()
		if (body) chunks.push({ file, heading, date, text: body })
		buffer = []
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
