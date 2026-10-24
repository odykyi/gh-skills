# Spec: gh-skills

Status: implemented · Package: `odykyi/gh-skills` · Version: 1.0.0

## Goal

Make an AI coding agent a competent GitHub maintainer: it can take a task from
a queue, open a properly linked PR, survive a review, and land it — without
guessing, without force-pushing, and without leaving a PR behind.

The collection encodes the *workflow*, not the *tooling*. Every step is a real
`gh` or `git` invocation that a reviewer can read and a CI job can check.

## Who it is for

| | |
|---|---|
| Primary | Maintainers with **dozens** of open PRs, or any repo where every PR needs an issue, a label, a review and a clean merge |
| Secondary | Contributors who enjoy running loops and many subagents and want their agent to hold the same bar a human maintainer would |
| Not for | Someone with one or two PRs — the queue discipline is overhead there |

## Layout

```text
skills/
  pr-workflow-orchestrator/SKILL.md   # entry point, one PR end to end
  pr-manager/SKILL.md                 # the same loop at 20+ PRs
  pr-worktree/SKILL.md                # isolation
  pr-opener/… pr-reviewer/… pr-feedback-handler/… pr-commenter/… pr-labeler/… pr-merger/… pr-queue-digest/… pr-initiative-driver/
  gh-project-orchestrator/… gh-prioritizer/… gh-pr-review-buttons/
rules/AGENTS.github.md                # drop-in rules for a repo that uses these skills
template/skill-template.md          # starting point for a new skill
docs/                                 # creating skills, agent support, troubleshooting
assets/                               # the animated diagrams (Graphviz source + SVG)
scripts/validate-skills.mjs           # the linter CI runs
.claude-plugin/marketplace.json       # Claude Code plugin marketplace
install.sh                            # symlink installer for any agent
llms.txt                              # machine-readable index
SPEC.md                               # this file
```

`skills/` is the single source of truth. The plugin, the `npx skills` package
and the `.agents/skills/` symlinks all point at it. Nothing is duplicated.

## Skill format

Each `SKILL.md` follows the [Agent Skills spec](https://agentskills.io/specification):
YAML frontmatter, then markdown.

- `name` — required. Must equal the folder name, lowercase and hyphenated.
- `description` — required. What the skill does **and when to use it**. It is
  the trigger, and the only thing the agent sees before it decides to load
  the skill. Under 1024 characters.
- Body — under ~500 lines. Long command tables go in `references/`.

```yaml
---
name: pr-example
description: Does one specific thing. Use when the user asks for X.
---
```

## Invariants

These are the guarantees the collection makes. `scripts/validate-skills.mjs`
enforces the mechanical ones in CI.

1. **Issue-linked.** No PR is opened without a linked issue. The link goes
   both ways.
2. **Definition of Done.** A task is done when the issue is linked **and** the
   PR is merged. Opening a PR is not completion.
3. **No unattended PRs.** Every open PR is monitored, and every review comment
   is either fixed or answered.
4. **Never guess at intent.** An unclear review comment produces a reply
   asking for clarification, never a speculative code change.
5. **Isolation.** Work happens in a git worktree. The main checkout is never
   switched to a feature branch.
6. **No destructive shortcuts.** No force push, no `gh pr merge --admin`, no
   `git branch -D`, no force-removing a dirty worktree, no resolving a thread
   without acting on it.
7. **Repository-agnostic.** No private organisation, product, or domain
   vocabulary. Label sets, path mappings and category taxonomies are shipped as
   documented defaults that a repo can override.
8. **Every command is real.** `gh` and `git` invocations are checked against the
   actual CLI. Flags that do not exist are a CI failure.

## Definition of done for a skill

A new skill is ready when:

- [ ] `name` matches the folder name and the description states what **and when**
- [ ] every `gh` / `git` command was executed at least once against the real CLI
- [ ] every `references/*.md` link resolves
- [ ] the skill is listed in `README.md`, `llms.txt` and `.claude-plugin/marketplace.json`
- [ ] `node scripts/validate-skills.mjs` passes
- [ ] the skill states its safety rules and has no unguarded destructive step
