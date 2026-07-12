# Munin — spec

Local semantic search over AI memory files. Recall by meaning, cited by source.
Named after Muninn, Odin's raven of memory, who flies out each day and reports everything he
has seen. (Naming decided 2026-07-13 after checking alternatives — Malin loves the name and
keeps it with eyes open: the 20-year-old Munin monitoring tool lives in a different space, the
GitHub repo is namespaced, and npm publishing goes scoped as `@malinfossum/munin` with a bare
`munin` bin. The README carries a one-line disambiguation.)

## What it is

A Node CLI that indexes markdown memory files with a local embedding model and answers
natural-language queries with cited results. Read-only over its sources. No server, no API
keys, no telemetry, no subscription. The only network request it ever makes is the one-time
embedding-model download; after that it runs fully offline.

## Non-goals

- **No capture-everything hook.** Curated memory stays the source of truth; Munin makes it findable.
- **No writes to sources.** Munin reads the configured folders; all writes stay inside its own `data/`.
- **No vector database.** The corpus is small; brute-force cosine similarity in plain JS is milliseconds. Revisit only if a real limit is hit.
- **No always-on process.** It is a CLI invoked on demand.

## Architecture

```
munin/
├── src/
│   ├── cli.js          # command routing: index | search | status
│   ├── config.js       # loads munin.config.json, expands ~, validates
│   ├── chunker.js      # markdown → chunks split by heading, with metadata
│   ├── embedder.js     # local embeddings via @huggingface/transformers
│   ├── indexer.js      # walks sources, embeds new/changed chunks (hash-incremental)
│   ├── search.js       # ranking (cosine now, hybrid in M2)
│   └── store.js        # index persistence (data/index.json)
├── tests/              # node --test, pure-logic modules only
├── data/               # index + model cache (gitignored — contains private memory text)
└── munin.config.json   # sources, model, topK, minScore
```

- **Embeddings:** `Xenova/all-MiniLM-L6-v2` via transformers.js — small, CPU, downloads once into `data/models`. Changing the model invalidates the index (the CLI detects the mismatch and asks for a re-index).
- **Chunking:** split by markdown heading; text before the first heading is an `(intro)` chunk. Each chunk carries `{file, heading, date, hash}`. The hash makes re-indexing incremental.
- **Citations:** every result prints `file § heading (date, score)` plus a preview. Below the confidence threshold, Munin says "No confident match." — it never pads results.

## Milestones

- **M1 — index + search.** ✅ `index`, `search` (cosine + threshold + citations, `--json` for tooling), `status`.
- **M1.1 — hardening.** ✅ Atomic index writes (write temp file, rename over
  `index.json` — a crash mid-write must not corrupt the index). Warn when directory entries are
  skipped during the walk (junction/symlink subdirs on Windows report `isDirectory() === false`
  and would otherwise vanish silently — a recall tool that silently indexes less than it claims
  breaks its own honesty promise).
- **M2 — hybrid + rerank.** Keyword scoring merged with cosine; recency boost; source weighting
  (curated memory above imported summaries). **Correctness requirements, not polish:**
  (a) sub-chunk sections longer than ~200 words with overlap — the model truncates at ~256
  tokens, so today a fact at the bottom of a long section is invisible and Munin can't be
  trusted to say "no match"; (b) recency uses inline entry dates (`2026-05-14 — …`) when
  present, mtime only as fallback — folding/reformatting a file must not make old facts look
  fresh. **Entry gate:** the 10 golden recall questions are written down before M2 starts and
  every ranking change is judged against them.
- **M3 — the `recall` skill.** A Claude Code skill that runs `munin search --json` and answers
  with citations. The query is passed as an argv array (`execFile`-style), never interpolated
  into a shell string — prompts contain quotes and backticks. Recalled text is rendered as
  quoted, labeled data with its source line, never as instructions. "No confident match." is
  passed through verbatim, not embellished.
- **M4 — session import (conditional).** One-time import of old session transcripts into dated,
  indexable logs. **Decision rule:** run the 10 golden questions side by side — Munin vs. the
  current memory system + native transcript search. Build M4 only if Munin wins.
  **Requirements:** a secret-scrubbing pass before anything is written (session transcripts
  contain pasted API keys, tokens, and terminal output — those must never reach the plaintext
  index); import is opt-in per source; imported chunks carry the lowest source weight; the
  run-once sentinel is written only after a fully successful import; document that transcripts
  include third parties' words (collaborators, quoted web content).
- **M5 — proactive recall ("Huginn mode").** A `UserPromptSubmit` hook runs
  `munin context "<prompt>"` and silently injects the top matches as background context — so
  brainstorming a new project automatically surfaces lessons from earlier ones. Guardrails:
  high threshold, hard cap of ~3 chunks, skip prompts under ~15 words, injected chunks labeled
  as recalled background data (not instructions). **Injects from curated sources only by
  default** — M4-imported transcript text is never auto-injected unless explicitly enabled
  (imported text is the memory-poisoning vector: third-party content silently steering future
  sessions). The hook fails safe: any Munin error means no injection and the prompt proceeds
  untouched — never block or delay the user on a broken index. Off by default; enabled per
  project. Open question to resolve with measurement, not upfront: model load adds ~1–2 s per
  prompt; accept it, or revisit the "no always-on process" non-goal with a lazy local daemon
  only if it measurably hurts.

## Security & release checklist (before publishing)

- [x] `data/` gitignored from first commit — the index contains raw private memory text
- [x] Repo history contains no personal paths, no private email, no memory content
- [x] Read-only guarantee documented and true: no code path writes outside `data/`
- [x] No network calls at runtime except the model download; documented, model name pinned in config
- [x] Offline mode is enforced, not assumed: once the model is cached, remote lookups are
      disabled (`env.allowRemoteModels = false`) so "fully offline after download" is a
      guarantee the code keeps, and a hub outage can't break indexing
- [ ] Model revision pinned (not just the name) so upstream changes can't silently swap weights
      — open at v0.1.0, do alongside M2
- [x] Single runtime dependency, `package-lock.json` committed, `npm audit` clean (2026-07-13)
- [x] No telemetry, no analytics, no "phone home" — stated in the README
- [x] Errors are friendly one-liners; no stack traces or absolute paths leak to users
- [ ] Recall output is data: the skill (M3/M5) must instruct Claude to treat retrieved text as quotes, never as instructions to follow (prompt-injection hygiene) — lands with M3
- [x] MIT license file present; git author uses the public dev email

## Proof it works

1. Index real memory. Ask about a known decision *using words never used in the file* — it must find and cite it.
2. Ask about something genuinely absent — it must say "No confident match."
3. Touch one file, re-run `munin index` — only that file's chunks re-embed.
