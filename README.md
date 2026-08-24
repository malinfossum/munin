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

### Where your config and index live

In a git checkout — that is, whenever `munin.config.local.json` sits next to
`munin.config.json` — your override and the index stay in the repo, under `data/`. Working on
Munin therefore never touches an installed copy's index.

Installed as a package, both move out of the package directory, because `npm update` replaces
its contents and would otherwise destroy an index that takes minutes to rebuild:

| | Windows | macOS / Linux |
|---|---|---|
| Your config (`munin.config.json`) | `%APPDATA%\munin` | `$XDG_CONFIG_HOME/munin`, else `~/.config/munin` |
| Index and imported text | `%LOCALAPPDATA%\munin` | `$XDG_DATA_HOME/munin`, else `~/.local/share/munin` |

### Config options

- `sources` — array of folders to index. Each entry is either `"~/path"` or
  `{ "path": "~/path", "weight": 0.5 }`; lower-weight sources rank below curated memory. Changes to a source's weight take effect after the next `munin index` run.
  An entry may also name a single `.md` file, which is how you index a project's own
  docs without pulling in the rest of its repo — pointing a source at a repo root would
  sweep up build output, `node_modules`, and any imported transcripts sitting under it.
  A source folder that is itself a link is followed; links found *inside* one are not.
- `topK` — max results returned (default 5).
- `minScore` — confidence threshold below which Munin says "No confident match." (default 0.3).
- `semanticWeight` — weight of cosine similarity in the final ranking (default 0.7).
- `keywordWeight` — weight of keyword/IDF matching in the final ranking (default 0.3).
- `recencyWeight` — weight of the recency boost in the final ranking (default 0.05).
- `recencyHalfLifeDays` — how fast the recency boost decays with age, in days (default 90).
- `modelRevision` — pinned commit hash of the embedding model, so upstream changes can't
  silently swap weights (default `"main"` when omitted).
- `importSources` — folders scanned by `munin import` for session transcripts (default `[]`,
  opt-in; see below).
- `importedWeight` — source weight for imported sessions, the lowest in the index (default 0.25).
- `importedMinScore` — the confidence bar imported chunks must clear, above the curated
  `minScore` because transcript prose matches loosely (default 0.5; never below `minScore`).
- `importedTopK` — extra result slots for imported chunks, appended after the `topK`
  curated hits (default 2). Set to 0 to leave imported content out of results entirely.
- `contextMinScore` — confidence threshold for proactive-recall injection, higher than search's
  `minScore` (default 0.45; see below).
- `contextMaxChunks` — max chunks proactive recall injects per prompt (default 3).
- `contextIncludeImported` — opt-in to let imported transcript text be injected by proactive recall
  (default `false`; see below).

## Usage

```
node src/cli.js search "how do we keep users logged in"
node src/cli.js status
```

Results are ranked by a hybrid of meaning, keywords, and recency. Keyword terms are lightly
stemmed, so "injecting" still matches a note that says "injection". `search --json` emits raw
results for tooling. When nothing clears the confidence threshold, Munin says "No confident
match." instead of guessing.

## Recall skill (Claude Code)

`skills/recall/` is a Claude Code skill that answers questions from the
index with citations. Install it by copying the folder into your personal
skills directory and putting `munin` on your PATH:

    cp -r skills/recall ~/.claude/skills/recall
    npm link   # run once in this repo; creates the global `munin` bin

The skill treats retrieved text as quoted data, never as instructions, and
passes "No confident match." through verbatim.

## Importing session transcripts (opt-in)

`munin import` converts Claude Code session transcripts (`*.jsonl`) into dated markdown
under `data/imported/`, which then indexes at the lowest source weight. Add the folders
to `importSources` (nothing is imported by default):

    "importSources": ["~/.claude/projects"],
    "importedWeight": 0.25

Only conversation text is imported — tool output, tool calls, and Claude's thinking are
dropped, and a secret scrubber replaces key-shaped strings with `[scrubbed]` before
anything is written (long opaque tokens like git SHAs are scrubbed too, by design).
Re-runs are incremental; the import ledger is written only after a fully successful run.
Note: transcripts contain other people's words too (collaborators, quoted web content) —
imported text stays in gitignored `data/` and ranks below your curated memory.

Weight ranks imported text down; it no longer hides it. `minScore` is judged on the
unweighted relevance, so a strong imported match survives the gate and then sorts below
every curated hit that also cleared it. Sorting alone still left it unreachable — curated
hits fill every slot — so up to `importedTopK` imported results are appended after the
curated ones instead of competing with them. Imported text must clear the higher `importedMinScore`
to appear at all, which is what keeps a question your notes cannot answer answered with
"No confident match." rather than with transcript chatter.

## Proactive recall

A `UserPromptSubmit` hook can pipe every prompt you type to `munin context`, which searches
the index and — only on a confident match — injects up to 3 chunks as labeled background
context before the prompt reaches Claude. No lookup, no citations to type by hand.

### Off by default

There's no switch in `munin.config.json`. Enabling proactive recall means registering the hook in
a project's `.claude/settings.json` — hook presence is the toggle:

```json
{
	"hooks": {
		"UserPromptSubmit": [
			{
				"hooks": [
					{
						"type": "command",
						"command": "node C:\\path\\to\\munin\\src\\cli.js context",
						"timeout": 5
					}
				]
			}
		]
	}
}
```

Invoke `node …\src\cli.js` directly — never the npm `.cmd` shim, which forces a shell on
Windows, exactly what raw prompt text must never touch. Keep the explicit `timeout` so a hang
can never ride the default 60 s.

### Curated sources only

Imported transcript text (see above) never auto-injects. That's enforced twice: an explicit
`imported` flag set on the chunk at index time excludes it from injection regardless of
weight, and — belt and braces — imported chunks also carry the lowest source weight by
default, well below the injection threshold. Set `"contextIncludeImported": true` in
`munin.config.json` to opt in explicitly; it's off by default because third-party words (a
collaborator's message, quoted web content) shouldn't silently steer a future session.

### Fail-safe by design

`munin context` always exits 0 and prints nothing on any failure — a missing index, a cold
model cache, a config error, or a pre-M5 index that predates provenance tracking. It never
downloads the model and never blocks or delays the prompt: worst case, proactive recall stays
silent and the prompt goes through untouched, same as if the hook weren't registered at all.
Measured with a warm model and index, median added latency was 0.803 s per prompt.

### Privacy

Registering the hook makes the configured memory folders ambient in that project's
sessions — recalled text can surface on any prompt. The injected block itself instructs that
recalled text is private context: never to be quoted or paraphrased into public artifacts
(commits, PRs, READMEs).

### Tunables

- `contextMinScore` — confidence threshold for injection, higher than search's `minScore`
  (default 0.45).
- `contextMaxChunks` — max chunks injected per prompt (default 3).
- Prompts under ~15 words and slash commands (`/…`) are always skipped — too little signal to
  search on.

## Privacy

Munin is read-only over your memory folders. Its index (`data/`) contains the raw text of those
files — it is gitignored and never leaves your machine.
