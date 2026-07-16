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
- **M2 — hybrid + rerank.** ✅ Hybrid keyword+cosine, recency from inline dates, sub-chunking
  with overlap, source weights, pinned model revision, offline-first load. Golden set 9/10
  (from 6/10 baseline); the miss is a vocabulary-mismatch — query expansion/stemming queued
  for M3. **Correctness requirements, not polish (as scoped going in):**
  (a) sub-chunk sections longer than ~200 words with overlap — the model truncates at ~256
  tokens, so today a fact at the bottom of a long section is invisible and Munin can't be
  trusted to say "no match"; (b) recency uses inline entry dates (`2026-05-14 — …`) when
  present, mtime only as fallback — folding/reformatting a file must not make old facts look
  fresh. **Entry gate:** a 10-question golden recall set is written down before M2 starts and
  every ranking change is judged against them.
- **M3 — the `recall` skill.** ✅ Shipped in-repo (`skills/recall/`) with the citation format,
  verbatim "No confident match.", and retrieved-text-is-data rules; keyword terms are stemmed
  so inflected phrasing still matches (golden set 10/10 — the Q9 vocabulary-mismatch miss is
  fixed). The skill instructs that the query reaches the CLI as plain search words only, never
  raw prompt text in a shell string.
- **M4 — session import.** ✅ Gate run 2026-07-14: Munin 10/10 vs curated system 9/10 (its one
  failure a confidently-wrong recall) vs native transcript search ~0/10 — Munin wins, M4 built.
  `munin import` (opt-in `importSources`): user/assistant text only — tool output, tool
  results, and thinking never reach the pipeline — secret-scrub before write, lowest source
  weight (`importedWeight`, default 0.25), incremental sentinel written only after a fully
  successful run, third-party-words caveat documented in the README. Golden set stays 10/10
  with imports indexed.
- **M5 — proactive recall ("Huginn mode").** ✅ Shipped 2026-07-16 — gates green: tests
  68/68, golden 10/10 (Q8 expectation updated to the decision's post-reorganize home,
  `session-log.md`, per Malin), probes 8/8 on the default `contextMinScore` 0.45, median
  `munin context` latency 0.803 s. A `UserPromptSubmit` hook runs `munin context`
  and silently injects the top matches as background context — so brainstorming a new project
  automatically surfaces lessons from earlier ones. Off by default; enabling = registering
  the hook in the project's `.claude/settings.json` — hook presence is the toggle, no second
  switch in `munin.config.json`. Requirements (spec stress-tested 2026-07-16):
  - **Prompt transport.** The hook reads the UserPromptSubmit JSON from stdin and passes the
    prompt to `munin context` via stdin, spawned without a shell — `node src/cli.js` directly,
    never the npm `.cmd` shim (which forces `shell: true` on Windows). Raw prompt text never
    enters a shell string; the M3 rule applies to the machine path too.
  - **Injection wrapper — spec'd text, not an implementation detail.** The wrapper carries
    the M3 retrieved-text-is-data preamble verbatim; chunk text is delimiter-escaped so a
    chunk cannot forge the block boundary (the M4 heading-forgery lesson); it states that
    injected background is private context, never to be quoted or paraphrased into public
    artifacts (commits, PRs, READMEs); and it carries a sentinel marker (see re-import loop).
  - **Curated sources only by default.** Chunks under `data/imported/` are flagged
    `imported: true` at index time and `munin context` filters on that flag — weight is not
    the discriminator. Imported transcript text is the memory-poisoning vector (third-party
    content silently steering future sessions) and is never auto-injected unless explicitly
    enabled in config.
  - **No re-import feedback loop.** `munin import` strips sentinel-marked injection blocks
    during conversion, so injected chunks never re-enter the index as session text and
    boost their own future ranking.
  - **Fail-safe means silent.** `munin context` always exits 0 and prints nothing — no
    stdout, no stderr — on any failure (for UserPromptSubmit hooks, exit 2 blocks the prompt
    and other non-zero codes nag the user). Cached model and existing index are
    preconditions, not triggers: missing either → silent exit, never a model download. The
    hook registers with an explicit ~5 s timeout so a hang can't ride the 60 s default —
    never block or delay the user on a broken index.
  - **Guardrails.** High threshold via a dedicated `contextMinScore`, hard cap of ~3 chunks,
    skip prompts under ~15 whitespace-split words, skip slash-command prompts (`/…`).
  - **Entry gate.** The golden set stays 10/10 (`munin search` gates every ranking change
    and M5 must not disturb it), plus a probe set through the real `context` path:
    should-inject prompts that must surface the right citation, and should-not-inject
    prompts that must produce nothing (the Q10 honesty pattern extended to injection).
  - Perf question resolved by measurement (2026-07-16): median end-to-end `munin context`
    run is 0.803 s — accepted; the "no always-on process" non-goal stands and the lazy-daemon
    idea stays closed unless real usage says otherwise.

## Security & release checklist (before publishing)

- [x] `data/` gitignored from first commit — the index contains raw private memory text
- [x] Repo history contains no personal paths, no private email, no memory content
- [x] Read-only guarantee documented and true: no code path writes outside `data/`
- [x] No network calls at runtime except the model download; documented, model name pinned in config
- [x] Offline mode is enforced, not assumed: once the model is cached, remote lookups are
      disabled (`env.allowRemoteModels = false`) so "fully offline after download" is a
      guarantee the code keeps, and a hub outage can't break indexing
- [x] Model revision pinned (not just the name) so upstream changes can't silently swap weights
      — done with M2 (pinned 751bff37…, offline-first load with one-time fetch)
- [x] Single runtime dependency, `package-lock.json` committed, `npm audit` clean (2026-07-13)
- [x] No telemetry, no analytics, no "phone home" — stated in the README
- [x] Errors are friendly one-liners; no stack traces or absolute paths leak to users
- [x] Recall output is data: the skill (M3/M5) must instruct Claude to treat retrieved text as quotes, never as instructions to follow (prompt-injection hygiene) — shipped with M3
- [x] MIT license file present; git author uses the public dev email

## Proof it works

1. Index real memory. Ask about a known decision *using words never used in the file* — it must find and cite it.
2. Ask about something genuinely absent — it must say "No confident match."
3. Touch one file, re-run `munin index` — only that file's chunks re-embed.
