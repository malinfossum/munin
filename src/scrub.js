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

// Digit groups joined by single separators: "4111 1111 1111 1111",
// "1234.56.78903", "010190 12345". Each run is split into groups and
// windows of groups are checked against known shapes plus a checksum, so
// a trailing "12 kr" can't hide a card and dates or lists survive.
const DIGIT_RUN = /\b\d+(?:[ .-]\d+)*\b/g
// Fødselsnummer / D-nummer (6 5) and kontonummer (4.2.5), or unseparated.
const ID11_SHAPES = new Set(["11", "6,5", "4,2,5"])
// Unseparated 13–19 digits, groups of four, or Amex/Diners 4-6-5 / 4-6-4.
const CARD_SHAPE = /^(1[3-9]|4,4,4,[1-4]|4,4,4,4,[1-3]|4,6,[45])$/
const MAX_WINDOW = 5

// Kontonummer's check digit uses the same weights as a fødselsnummer's
// second control digit, so one mod 11 test covers both: a valid
// fødselsnummer always passes it.
const MOD11_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

function mod11Valid(digits) {
	const sum = MOD11_WEIGHTS.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0)
	const check = (11 - (sum % 11)) % 11
	return check !== 10 && check === Number(digits[10])
}

function luhnValid(digits) {
	let sum = 0
	for (let i = 0; i < digits.length; i++) {
		let n = Number(digits[digits.length - 1 - i])
		if (i % 2 === 1) {
			n *= 2
			if (n > 9) n -= 9
		}
		sum += n
	}
	return sum % 10 === 0
}

function isSensitive(groups) {
	const digits = groups.join("")
	const shape = groups.map((group) => group.length).join(",")
	if (ID11_SHAPES.has(shape)) return mod11Valid(digits)
	if (CARD_SHAPE.test(shape)) return luhnValid(digits)
	return false
}

function scrubNumbers(text) {
	return text.replaceAll(DIGIT_RUN, (run) => {
		const groups = [...run.matchAll(/\d+/g)].map((m) => ({ digits: m[0], start: m.index }))
		let out = ""
		let kept = 0
		let i = 0
		while (i < groups.length) {
			let end = -1
			for (let j = Math.min(groups.length, i + MAX_WINDOW) - 1; j >= i; j--) {
				if (isSensitive(groups.slice(i, j + 1).map((g) => g.digits))) {
					end = j
					break
				}
			}
			if (end === -1) {
				i++
				continue
			}
			out += run.slice(kept, groups[i].start) + REPLACEMENT
			kept = groups[end].start + groups[end].digits.length
			i = end + 1
		}
		return out + run.slice(kept)
	})
}

// <private>…</private> is never stored: not by import, not by the
// indexer. Case-insensitive because people type it. An unclosed block
// strips to the end: safer to drop too much than to index a secret.
export function stripPrivate(text) {
	return text.replaceAll(/<private>[\s\S]*?(?:<\/private>|$)/gi, "")
}

export function scrubSecrets(text) {
	let out = text
	for (const pattern of PATTERNS) {
		out = out.replaceAll(pattern, REPLACEMENT)
	}
	out = scrubNumbers(out)
	out = out.replaceAll(URL_CREDENTIALS, `$1${REPLACEMENT}@`)
	out = out.replaceAll(ASSIGNMENT, `$1${REPLACEMENT}`)
	return out.replaceAll(BARE_BEARER, `$1${REPLACEMENT}`)
}
