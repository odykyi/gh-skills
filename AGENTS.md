# AGENTS.md

Rules for agents working **in this repository** (contributing to `gh-skills`).

The rules for agents working **on a GitHub repo using these skills** live in
[`rules/AGENTS.github.md`](./rules/AGENTS.github.md) — copy that into your repo.

## What this repository is

A collection of Agent Skills. `skills/` is the single source of truth; every
other surface (plugin marketplace, `npx skills`, `.agents/skills` symlinks,
`llms.txt`) points at it. Nothing is duplicated.

## Ground rules

1. **Never edit a skill to make a check pass.** If `scripts/validate-skills.mjs`
   fails, fix the skill — or fix the check and explain why in the PR. The
   check encodes a real defect that was found once already.
2. **Every `gh` and `git` command in a skill must have been executed** against
   the real CLI. A flag that does not exist is a bug, not a typo — the previous
   review found `gh pr reviews`, `gh pr comments`, `gh pr diff --path` and the
   REST `/replies` endpoint, none of which exist.
3. **No destructive shortcut without a guard.** Force push, `--admin`,
   `branch -D`, `--force` on a dirty worktree — each needs an explicit check
   that proves nothing is lost.
4. **A skill must stand alone.** It may not depend on a file that is not in
   its own folder, and it may not depend on a skill that is not in this
   collection unless the dependency is marked external.
5. **Keep it repository-agnostic.** No organisation names, no product
   vocabulary, no domain nouns that would only make sense in one repo. Label
   sets and path mappings are documented defaults.
6. **Long reference material goes in `references/`.** Keep `SKILL.md` under
   ~500 lines and put the long tables behind a link.

## Adding a skill

1. Copy `template/skill-template.md` to `skills/<name>/SKILL.md`.
2. `name` must equal the folder name, lowercase and hyphenated.
3. The description is the trigger — say what it does **and when** to use it.
4. Add the skill to `README.md`, `llms.txt` and `.claude-plugin/marketplace.json`.
5. Run `node scripts/validate-skills.mjs` until it passes.
6. Open a PR. The `Validate skills` workflow runs on every push.

See [`docs/creating-skills.md`](./docs/creating-skills.md) for the full checklist.

## Repository map

| Path | What it is |
|------|-----------|
| `skills/` | The skills. Source of truth. |
| `assets/pr-lifecycle.dot` | Graphviz source for the flow diagram |
| `assets/build-diagram.sh` | Renders the diagram and injects the animation |
| `scripts/validate-skills.mjs` | The linter CI runs |
| `evals/` | Fixtures, reference implementations and LLM evals for pr-labeler and gh-prioritizer — see [`evals/README.md`](./evals/README.md) |
| `test/` | Unit tests for the evals (`node --test`) |
| `rules/AGENTS.github.md` | Rules template for repos that use these skills |
| `template/skill-template.md` | Template for a new skill |
| `install.sh` | Symlink installer for any agent |
| `.claude-plugin/` | Claude Code plugin + marketplace manifests |
| `docs/` | Creating skills, agent support, troubleshooting |

## Commands

```bash
node scripts/validate-skills.mjs   # validate the collection
npm test                           # validator + eval unit tests + reference eval + README sync
npm run eval:llm -- --model haiku  # re-measure model agreement after changing a decision skill
./assets/build-diagram.sh           # rebuild assets/pr-lifecycle.svg (needs graphviz)
gh pr review <n> --request-changes  # review a PR in this repo like the skills say to
```
