# llmlint Development Repository

`llmlint` is a Chinese text linter for LLM output. This repository root is the development workspace; the installable Agent Skill / CLI package lives in [`skill/`](./skill/).

## Install The Skill

Recommended install through the `skills` CLI:

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

For manual installation, copy [`skill/`](./skill/) into your agent skills directory as `llmlint/`, then install dependencies inside that skill directory:

```bash
cd skill
bun install
bun bin/llmlint.ts check <file>
```

## Development

```bash
bun install
bun test
bun run typecheck
bun run eval:fixture
```

`evals/` is the tracked evaluation harness and baseline corpus. Put temporary evaluation output under `.agent/evals/` or `evals/tmp/`.

The NeuroBook bundled copy is not the source of truth. After editing `skill/`, run this from the repository root:

```bash
bun run sync:neuro-book
```

It mirrors `skill/` into the sibling NeuroBook repository at `assets/workspace/.nbook/agent/skills/llmlint/`.

## License

This development repository and the installable `skill/` package are licensed under the [GNU Affero General Public License v3.0 only](./LICENSE), identified by the SPDX expression `AGPL-3.0-only`. Copyright © 2026 notnotype.
