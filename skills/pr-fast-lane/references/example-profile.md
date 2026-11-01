# Example profile: a CLI monorepo with a merge queue

One real queue, used as the worked example for this skill (the Flisk CLI
repository). The defaults below suit any repo with the same shape: a merge
queue, a single maintainer, and compiled output committed next to the source.

## Gates before

| Gate | Value | Effect |
|------|-------|--------|
| Approving reviews | 2, code owner, last-push approval | Nothing could merge without `--admin` |
| Strict up-to-date | on, alongside a merge queue | Every merge made all other PRs `BEHIND`, then a full CI rerun |
| Required checks | summary checks | Kept |
| Merge queue | squash, batches of up to 5 | Kept, but bypassed by manual merges |

## Gates after (user approved)

| Gate | Value |
|------|-------|
| Approving reviews | 0 (thread resolution still required) |
| Strict up-to-date | off (the queue tests on top of main) |
| Required checks, code scanning, coverage, merge queue | unchanged |

Every open PR was then put on `gh pr merge <n> --auto`.

## Repo-specific defaults

- Compiled CLI output is committed: on a conflict, rebuild it, never hand-edit
  it. This was the main conflict source; the "later" fix is to stop committing it.
- The one-command demo suite is the P1 verification: any PR near it posts that
  suite's result as its evidence.
- Database migrations, release and publish workflows keep a human review.

## Result

Measured on the day of the change, before it: 7 PRs merged by one coordinator
in a manual loop, each merge followed by branch updates and a CI rerun. After
it: owners stop at "push + `--auto`" and the queue merges without the
coordinator. Record the next day's count here before claiming a speed-up.
