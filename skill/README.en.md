# llmlint

> Lint and polish LLM-generated Chinese text — locate AI writing tells deterministically, fix them with judgment.

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm--Noncommercial--1.0.0-blue.svg)](./LICENSE)
[![Runtime: Node.js or Bun](https://img.shields.io/badge/Runtime-Node.js%20or%20Bun-green.svg)](#requirements)
[![Version](https://img.shields.io/badge/version-2.0.0-green.svg)](./package.json)

**[中文](./README.md) · English**

---

## What is llmlint

**llmlint** is a text linter for LLM-generated Chinese prose. It catches template-like wording, AI writing tells, hollow summaries, monotonous rhythm, and other rule-driven style problems — then helps you fix them without flattening the author's voice.

It has two faces that work together:

| Layer | Role |
| --- | --- |
| **CLI** (this repo's `bin/llmlint.ts`) | Stable, reproducible **candidate location** via regex detectors. It tells you *where* something might be wrong. |
| **Agent Skill** (`SKILL.md`) | An LLM/agent reads the candidates **in context**, scores the text, drafts a fix plan, and rewrites *only after you approve*. |

The guiding principle: **a hit is a candidate, not a verdict.** The CLI never auto-rewrites your prose. Mechanical, judgment-free cleanups (invisible characters, duplicated punctuation) are the only thing `fix` touches; everything semantic stays with the human/agent.

## Why

LLM output has recognizable "tells" in Chinese: filler openers (其实、值得注意的是), mechanical transitions (首先…其次…最后), binary contrast scaffolding (不是…而是…), business jargon (赋能、抓手、闭环), inflated significance (深刻的影响、前所未有), sycophantic assistant-speak (好问题、希望这对你有帮助), and so on. Most are *stably locatable* by regex, but *deciding whether to cut them* needs context — a line of dialogue, a technical doc, or a deliberate rhetorical device may legitimately keep them.

llmlint splits those two jobs: deterministic location (CLI) and contextual judgment (agent).

## Requirements

- **Bun** (runs TypeScript directly, no build step) or **Node.js + [`tsx`](https://github.com/privatenumber/tsx)** (`npx tsx bin/llmlint.ts …`). The CLI source uses extensionless TS relative imports, which Node's built-in type stripping doesn't resolve — run it through `tsx` (or build first); Bun supports it natively.
- Dependencies: `commander`, `picocolors`, `tinyglobby` (all tiny, pure-JS, no native build)

## Install

**Recommended (as an Agent Skill)** — use the open [`skills`](https://skills.sh) CLI to install it into any supported agent (Claude Code, Codex, Cursor, …) with one command:

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

It copies / links the skill files into the agent's skills directory and drives the CLI per `SKILL.md`.

**Standalone CLI** — clone and install dependencies (Bun or Node both work):

```bash
git clone https://github.com/notnotype/llmlint.git
cd llmlint/skill
bun install        # or npm install / pnpm install
```

Run it directly (Bun runs TS natively; for Node see [Requirements](#requirements)):

```bash
bun bin/llmlint.ts check <file>     # Node: npx tsx bin/llmlint.ts check <file>
```

Or expose the `llmlint` command on your PATH (declared in `package.json` `bin`): run `bun link`, then `llmlint check <file>`.

> The docs in `SKILL.md` / `references/` call the CLI as `bun .nbook/agent/skills/llmlint/bin/llmlint.ts …`. That path is for when llmlint is installed as an embedded agent skill (see [Using as an Agent Skill](#using-as-an-agent-skill)). Standalone, just use `bin/llmlint.ts` and swap `bun` for your Node runner.

## Quick start

```bash
# Locate regex candidates in a file (or directory — recurses .md/.markdown/.txt)
bun bin/llmlint.ts check manuscript/chapter-01.md
bun bin/llmlint.ts check manuscript/

# Long file? Show only medium-and-up first
bun bin/llmlint.ts check chapter.md --min-level medium

# Small file / human reading? Show full lines with <mark> around hits
bun bin/llmlint.ts check chapter.md --show-lines

# List the LLM rules that need an agent's whole-text review
bun bin/llmlint.ts show-llm-rules

# Deterministic mechanical fix (zero-width chars, duplicated symbols) — dry-run by default
bun bin/llmlint.ts fix manuscript/             # preview only (exit code 1 if anything pending)
bun bin/llmlint.ts fix manuscript/ --write     # write back to source files

# JSON output for tooling
bun bin/llmlint.ts check chapter.md --format json
```

For Markdown, `check` and `fix` skip code blocks / frontmatter / inline code / links by default so code and URLs aren't flagged as prose. Use `--scan-all` to scan everything.

## The three independent dimensions

Every rule carries three orthogonal axes — don't conflate them:

- **`level`** — `high` / `medium` / `low`. Severity only. Drives `--min-level` filtering and the exit code.
- **`review`** — `agent` / `human` / `none`. *Audience*: who should look at a hit. `check` defaults to `--review agent`, so author-preference noise (dashes, similes, generic adverbs) is parked in the `human` bucket and mechanical hits in `none`. Use `--review human` / `--review all` to see the rest.
- **`fixability`** — `auto` / `candidate` / `manual`. Mechanical fix capability. `fix` only applies `auto` rules.

`review` (audience) is **not** the same as `detector` (detection method):

- **`detector`** decides *how* a problem is found: `regex` → matched statically by `check`; `llm` → reviewed by the agent via `show-llm-rules`.
- **`review`** decides *who a regex hit is shown to* by default.

A complete review runs both `check` (regex hits for the agent) and `show-llm-rules` (whole-text semantic rules).

## Configuration

Most projects need **no config** — without `llmlint.config.ts`, llmlint loads `builtin/default` and a tuned namespace policy. When you do want to customize, drop a `llmlint.config.ts` anywhere up the directory tree (auto-discovered from the cwd):

```typescript
export default {
    rulesets: ["builtin/default"],
    namespaces: {
        "vocabulary.r18": "off",          // turn off adult-vocabulary rules for general projects
        "商务黑话": "off",                  // Chinese alias → jargon.business
        "jargon.engineer": {review: "agent"}, // move a bucket into the agent view
    },
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
    },
    output: "stylish",
};
```

- **Override priority:** rule id > namespace > ruleset > rule default.
- **String shorthand** is sugar for an object patch: `off` = `{enabled:false}`, `warn` = `{enabled:true, level:"medium"}`, `error` = `{enabled:true, level:"high"}`, and `low`/`medium`/`high` set the level. Object form `{enabled?, level?, review?, fixability?}` only overrides the fields you set — to enable a default-off rule you must write `enabled: true` explicitly.
- **Namespaces** accept stable English keys and built-in Chinese aliases (e.g. `商务黑话` → `jargon.business`).

See [`llmlint.config.example.ts`](./llmlint.config.example.ts) for a fully annotated example.

## Built-in ruleset: `builtin/default`

The official recommended ruleset — ~340 rule records across 40+ namespaces, merged from a hand-maintained anti-AI-slop set and curated Chinese rule samples (`shuorenhua` / `avoid-ai-writing` / `humanizer`).

- **agent bucket (shown by default):** `filler`, `opening.cliche`, `inflation.significance`, `transition.summary`, `attribution.vague`, `cliche.uplift`, `sycophantic`, `jargon.business`, …
- **human bucket (high false-positive / author preference):** `punctuation.dash`, `metaphor`, `modifier`, `jargon.engineer`, `jargon.social`, `translationese`, `structure.fragment`, …
- **none bucket (mechanical):** `punctuation.dedup`, `mechanical.zero-width`.
- **`mechanical.*` (language-agnostic, high precision):** zero-width characters, homoglyphs, leftover `{{placeholders}}`, chatbot copy-paste artifacts (`:contentReference`, `oaicite`, …).

It ships with R18 / adult-vocabulary rules; general projects can disable them with `namespaces: {"vocabulary.r18": "off"}` rather than editing rule files.

## Exit codes

- `0` — no problems, or only `low`/`medium` problems are visible.
- `1` — a visible `high` problem, a CLI failure, or (for `fix` dry-run) pending mechanical fixes.

Exit codes follow the **visible view**: hits hidden by `--review` / `--min-level` don't count. Use `--review all --min-level low` to make every high hit count (e.g. a CI gate like "no zero-width characters in the repo").

## Using as an Agent Skill

This repo is also a self-contained **Agent Skill**. `SKILL.md` defines a 6-step polish workflow: get input → `check` → `show-llm-rules` + 50-point review → fix plan (user-approved) → apply → report.

Recommended install via the [`skills`](https://skills.sh) CLI — `npx skills add notnotype/llmlint --skill llmlint --full-depth` — which searches the repository recursively, installs the `llmlint` skill from `skill/`, and drops it into the agent's skills directory (e.g. `.claude/skills/llmlint/` or NeuroBook's `.nbook/agent/skills/llmlint/`). For manual installation, copy the repository's `skill/` directory and name it `llmlint/` in the target skills directory. After installing, run the dependency install once in the skill directory (`npm install` / `bun install` / `pnpm install`), and the agent can drive the CLI through the documented flow.

## Documentation

- [`SKILL.md`](./SKILL.md) — the Agent Skill manifest and workflow contract
- [`references/cli-usage.md`](./references/cli-usage.md) — full CLI reference (flags, output formats, JSON schema)
- [`references/patterns.md`](./references/patterns.md) — the Chinese-text pattern library (what each rule looks for, and when to keep it)
- [`references/workflow.md`](./references/workflow.md) — the 6-step polish workflow in detail

## License

[PolyForm Noncommercial License 1.0.0](./LICENSE) — free for any noncommercial purpose (personal use, research, education, nonprofits, government). Commercial use requires a separate license. Copyright © 2026 notnotype.
