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

Point `munin.config.json` at your memory folders (defaults to `~/.claude/memory`).

## Usage

```
node src/cli.js search "how do we keep users logged in"
node src/cli.js status
```

`search --json` emits raw results for tooling. When nothing clears the confidence threshold,
Munin says "No confident match." instead of guessing.

## Privacy

Munin is read-only over your memory folders. Its index (`data/`) contains the raw text of those
files — it is gitignored and never leaves your machine.
