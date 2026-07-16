// Pure logic for Huginn mode (spec M5): decide when to inject and build
// the labeled background block. The CLI wiring stays in cli.js.

const MIN_PROMPT_WORDS = 15

// The hook pipes the UserPromptSubmit JSON straight to `munin context`,
// so raw prompt text never touches a shell string (M3 rule, machine path
// included). Plain text on stdin is accepted too — the command stays
// hand-testable with a pipe.
export function parseHookPrompt(stdinText) {
	const raw = (stdinText ?? "").trim()
	if (!raw) return null
	try {
		const parsed = JSON.parse(raw)
		const prompt = typeof parsed?.prompt === "string" ? parsed.prompt.trim() : ""
		return prompt || null
	} catch {
		return raw
	}
}

// Short prompts and slash commands carry no recall signal (spec M5).
export function shouldSkipPrompt(prompt) {
	const trimmed = prompt.trim()
	if (trimmed.startsWith("/")) return true
	return trimmed.split(/\s+/).length < MIN_PROMPT_WORDS
}
