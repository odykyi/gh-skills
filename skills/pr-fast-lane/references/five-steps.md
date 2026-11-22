# Gates and the five steps

Read this when the queue itself is slow (approvals nobody gives, strict up-to-date with a merge queue, a scan that never reports on PRs), not for per-PR work.

## Decide the design first (Zachman questions)

Do not ask these. Use the recommended defaults below (or the user's earlier
answers, memory, or CLAUDE.md where they differ), record them in the cycle
report, and start working. A fix/merge/release request is not a design
interview.

| Zachman column | Question | Recommended default |
|----------------|----------|---------------------|
| **Who** | Who merges a ready PR? | The owner agent enables auto-merge; the merge queue lands it |
| **Why** | What makes a PR trusted? | Required checks pass **and** the owner posts verification evidence |
| **When** | When does a human look? | Daily, after the merge: revert, fix, or add a rule |
| **Where** | Which repos and paths? | All PRs; sensitive paths keep a code-owner review |
| **What** | What counts as done? | PR `MERGED`, checks green on the merge commit, linked issues closed |
| **How** | How do PRs enter the queue? | `gh pr merge <n> --auto`, never a manual merge loop |

## The five steps, in this order

Do not skip ahead. Automating a step that should have been deleted only makes
waste faster.

## Step 1: Question every requirement

List each gate the queue has and who asked for it.

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/<owner>/<repo>/rulesets/<id> --jq '.rules[] | {type, parameters}'
gh pr list --state open --json number,mergeStateStatus,reviewDecision \
  --jq '.[] | "\(.number) \(.mergeStateStatus) \(.reviewDecision)"'
```

For each gate, mark it: *verified needed*, *assumed*, or *needs the user*, and
note what breaks if it is removed. Report the *needs the user* gates at the end;
they never pause the loop. Typical findings:

- `required_approving_review_count: 2` with one maintainer: nothing can ever
  merge without a bypass. The gate only adds delay.
- `strict_required_status_checks_policy: true` **and** a merge queue: the queue
  already tests every PR on top of the latest base, so "branch must be up to
  date" just forces a rebase and a full CI rerun after every merge.
- `require_last_push_approval`: every fix push by an agent invalidates the
  approval it just earned.
- A `code_scanning` rule that names a tool, or a CodeQL category, that never
  uploads a result on pull requests: every PR waits forever, so only `--admin`
  merges ever land. Compare what the base branch has with what a PR has:

```bash
gh api "repos/<owner>/<repo>/code-scanning/analyses?ref=refs/heads/main&per_page=50" \
  --jq '[.[] | "\(.tool.name) \(.category)"] | unique'
gh api "repos/<owner>/<repo>/code-scanning/analyses?ref=refs/pull/<n>/merge&per_page=50" \
  --jq '[.[] | "\(.tool.name) \(.category)"] | unique'
```

A gate that verifies nothing on a PR only blocks. Either make the scan run on
every PR (path-filtered scans are the usual cause) or, with the user's yes,
drop that tool from the rule.

## Step 2: Delete

Propose the smallest gate set that keeps safety. Changing branch protection is
the user's decision: show the before and after, and change it only after an
explicit yes.

Keep: required status checks, the merge queue, code scanning, coverage,
review-thread resolution. Drop or lower: approval count, last-push approval,
strict up-to-date (when a merge queue exists).

```bash
gh api repos/<owner>/<repo>/rulesets/<id> > ruleset.json
# edit only the fields the user approved, drop null parameters, then:
gh api -X PUT repos/<owner>/<repo>/rulesets/<id> --input ruleset.json
```

Also delete process steps: a coordinator that merges by hand, manual
`update-branch` calls, polling loops, owner sessions for trivial PRs.

## Step 3: Simplify

- One gate per PR: required checks + one verification artifact.
- One owner per PR. Small one-file PRs share one owner instead of getting one
  each.
- Generated files committed to the repo are the commonest conflict source.
  Rebuild them in one place, or stop committing them.

## Step 4: Accelerate

Measure first: count how long PRs wait in each state.

```bash
gh pr list --state open --json number,createdAt,mergeStateStatus,reviewDecision
gh pr list --state merged --search "merged:>=<YYYY-MM-DD>" --json number,createdAt,mergedAt
```

Then shorten the slowest wait. Usual wins, in order of size: auto-merge instead
of a merge loop, a batching merge queue, path-filtered CI, cancel-in-progress on
new pushes. Label estimates as estimates; report only measured gains.

### Do not test the same change twice in the queue

A merge queue that reruns every suite the PR just passed doubles the wait
for nothing. Check what a queue entry actually runs:

```bash
# workflows with a merge_group trigger
grep -l '^  merge_group' .github/workflows/*.yml
# what ran for one queue entry, and for how long
gh run list --event merge_group --limit 60 \
  --json name,headBranch,createdAt,updatedAt,conclusion \
  --jq '.[] | select(.headBranch | test("pr-<n>-")) | "\(.name) \(.conclusion)"'
```

Typical waste: a matrix job that picks legs by changed files on PRs but "keeps
the full set" in the queue, or a queue diff against `merge_group.base_sha`
that relists the PR's own files. The fix: when the workflow already passed on
the queued PR's current head, select legs from `git diff <pr head> HEAD` on
the queue commit. That diff holds only what the base branch changed since the
PR branched, so legs nobody touched skip. Fall back to the full selection when
there is no passing run on that exact head. Keep queue-only suites (ones too
slow to run per PR) as they are, and keep every required check reporting.

Open that change as its own PR in the same run; do not stop to ask.

## Step 5: Automate

Only now, once the flow above is stable:

```bash
# every owner, after its verification passes:
gh pr merge <n> --auto
# the queue picks the merge method; check it is queued:
gh pr view <n> --json autoMergeRequest,mergeStateStatus
```

The owner's verification evidence goes on the PR as a comment: the command it
ran (the affected e2e suite, the app smoke test) and the result, PASS or FAIL.

## Plan the fixes by horizon

Report every finding in one of three columns, fastest win first.

| Now (minutes, no code) | Later (one PR each) | Post-later (a project) |
|------------------------|---------------------|------------------------|
| Lower the approval gate (with a yes) | Stop committing generated files | Verifier agents that run the app per PR |
| Drop strict up-to-date under a queue | Path-filtered CI, cancel-in-progress | An intake agent that turns issues into PRs |
| `--auto` on every open PR | Code owners only on sensitive paths | Daily review session on a schedule |
| One owner per blocked PR | Owner brief that ends with `--auto` | Lint rules from repeated review findings |

