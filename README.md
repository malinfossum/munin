# Munin

Local semantic search over your AI memory files — recall by meaning, cited by source.

Ask "how do we keep users logged in" and Munin finds the note that says "session cookies over
JWT", even though no words overlap. Every result cites its file, heading, and date.

Named after Muninn, Odin's raven of memory, who flies out over the world each day and returns
to report everything he has seen.

> Not related to the [Munin monitoring tool](https://github.com/munin-monitoring/munin) —
> this raven only watches your memory files.

## Stack

Node (ESM), one dependency: `@huggingface/transformers` for local embeddings. No server, no API
keys, no telemetry. The only network request Munin ever makes is the one-time model download
(~30 MB); once the model is cached, remote lookups are disabled in code and it runs fully
offline.

## Setup

```
npm install
node src/cli.js index
```

Point `munin.config.json` at your memory folders (defaults to `~/.claude/memory`). For
machine-specific folders, create `munin.config.local.json` next to it (gitignored) — any field
set there overrides the committed config, so your personal paths never enter the repo.

### Config options

- `sources` — array of folders to index. Each entry is either `"~/path"` or
  `{ "path": "~/path", "weight": 0.5 }`; lower-weight sources rank below curated memory. Changes to a source's weight take effect after the next `munin index` run.
- `topK` — max results returned (default 5).
- `minScore` — confidence threshold below which Munin says "No confident match." (default 0.3).
- `semanticWeight` — weight of cosine similarity in the final ranking (default 0.7).
- `keywordWeight` — weight of keyword/IDF matching in the final ranking (default 0.3).
- `recencyWeight` — weight of the recency boost in the final ranking (default 0.05).
- `recencyHalfLifeDays` — how fast the recency boost decays with age, in days (default 90).
- `modelRevision` — pinned commit hash of the embedding model, so upstream changes can't
  silently swap weights (default `"main"` when omitted).

## Usage

```
node src/cli.js search "how do we keep users logged in"
node src/cli.js status
```

Results are ranked by a hybrid of meaning, keywords, and recency. `search --json` emits raw
results for tooling. When nothing clears the confidence threshold, Munin says "No confident
match." instead of guessing.

## Privacy

Munin is read-only over your memory folders. Its index (`data/`) contains the raw text of those
files — it is gitignored and never leaves your machine.
