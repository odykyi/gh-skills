# Contributing

Thanks for improving the collection. The bar is high on purpose: these
instructions are executed by an agent against a real repository, so a wrong
command is a wrong action.

## Before you start

Read [`AGENTS.md`](./AGENTS.md) — it is the short version of the rules — and
[`docs/creating-skills.md`](./docs/creating-skills.md) for the long version.

## Adding a skill

1. `cp template/skill-template.md skills/<name>/SKILL.md`
2. Write the frontmatter: `name` equals the folder name, `description` says
   what the skill does **and when** to use it.
3. Write the workflow. Run every command you write. A flag that does not
   exist is a defect, not a typo.
4. Guard every destructive step.
5. Add the skill to `README.md`, `llms.txt` and `.claude-plugin/marketplace.json`.
6. `node scripts/validate-skills.mjs`
7. Open a PR. CI runs the validator on every push.

## Changing an existing skill

Same rules, plus:

- Keep the frontmatter `description` a valid trigger. Changing it changes when
  the skill fires, which is a behavioural change.
- If you change a command, say in the PR description which command you ran and
  what it printed.
- If you fix a contradiction between two skills, fix both and say so.
- If you change a rule in `pr-labeler` or `gh-prioritizer`, change the
  reference implementation in `evals/lib/` and the gold answers it affects in
  `evals/fixtures/pull-requests.json`. `npm test` fails until they agree.
  Re-run `npm run eval:llm` if you can, so the recorded model agreement
  reflects the new text. See [`evals/README.md`](./evals/README.md).

## Style

- Markdown, one sentence per idea, no marketing tone.
- Commands in fenced blocks with the exact flags.
- Long tables and decision trees in `references/`, linked from `SKILL.md`.
- Keep `SKILL.md` under ~500 lines.
- No organisation names, product nouns or domain vocabulary — the collection
  is repository-agnostic.

## Commit messages

Use the same style as the repository: a short imperative summary, then a body
that says what changed and why.

```
Add pr-changelog skill

Generates a changelog entry from merged PRs since a tag. Uses
`gh pr list --search "merged:>=<date>"` and groups by label.

Linked to issue #123.
```

## Reporting a bug in a skill

Open an issue with:

- the skill name
- the command that failed, and the exact error
- what you expected instead
- the output of `gh --version` and `git --version`

A bug report with the exact error text is worth ten without it.

## License

By contributing you agree that your work is licensed under the
[MIT License](./LICENSE). If you derive a skill from someone else's work, add
the attribution to [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and
keep the original license.
