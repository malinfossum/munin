// Secret scrubbing for imported transcript text. Aggressive by design:
// imported logs are search fodder, so losing a git SHA to the catch-all
// is an accepted cost — a leaked key in the plaintext index is not.
const REPLACEMENT = "[scrubbed]"

const PATTERNS = [
	// PEM blocks first — they span lines and contain the other shapes.
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	// Provider-prefixed keys (sk- and sk_live_-style underscore variants).
	/\bsk[-_][A-Za-z0-9_-]{16,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{16,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{16,}/g,
	/\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
	/\bAKIA[A-Z0-9]{16}\b/g,
	/\bAIza[A-Za-z0-9_-]{30,}/g,
	// JWTs.
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
	// npm tokens.
	/\bnpm_[A-Za-z0-9]{10,}/g,
	// Catch-all: long opaque base64/hex-ish tokens (also eats git SHAs).
	/\b[A-Za-z0-9+/_-]{40,}\b/g,
]

// scheme://user:pass@host (or scheme://token@host) — scrub the
// credentials, keep the host so the log stays readable.
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

// key: value / key=value assignments — keep the key, scrub the value.
// The key may carry env-style prefixes (GITHUB_TOKEN, DB_PASSWORD,
// MY_API_SECRET) and the value an optional "Bearer " prefix, so header
// tokens don't survive.
const ASSIGNMENT =
	/(\b_?(?:[a-z0-9]+[_-])*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth[_-]?token|authorization|bearer|credential)s?\b\s*[:=]\s*)(?:bearer\s+)?\S+/gi

// A bare "Bearer <token>" with no key: separator — scrub anything
// token-shaped after it, leave short prose ("bearer of bad news") alone.
const BARE_BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi

export function scrubSecrets(text) {
	let out = text
	for (const pattern of PATTERNS) {
		out = out.replaceAll(pattern, REPLACEMENT)
	}
	out = out.replaceAll(URL_CREDENTIALS, `$1${REPLACEMENT}@`)
	out = out.replaceAll(ASSIGNMENT, `$1${REPLACEMENT}`)
	return out.replaceAll(BARE_BEARER, `$1${REPLACEMENT}`)
}
