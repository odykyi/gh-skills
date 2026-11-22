# Fix a red check

A red check gets a pushed fix, not a rerun and not a paragraph about it.
Explaining that a failure is "unrelated" or "a flake" and moving on is not a
fix; the same check stays red on the next PR.

1. Find the job that actually failed. An aggregate check (a `Summary` or
   `gate` job) fails because a job it needs failed; follow it down:

   ```bash
   gh pr checks <n> | grep -P '\tfail\t'
   gh run view <run> --json jobs \
     --jq '.jobs[] | select(.conclusion!="success" and .conclusion!="skipped") | "\(.databaseId) \(.name) \(.conclusion)"'
   ```

2. Read that job's log, then the step that failed. `--log-failed` is often
   empty; the raw log never is:

   ```bash
   gh api repos/<o>/<r>/actions/jobs/<job>/logs | grep -B30 '##\[error\]'
   gh run view <run> --json jobs --jq '.jobs[] | select(.databaseId==<job>) | .steps[] | "\(.name) \(.conclusion)"'
   ```

   Filter out lines that only look like failures (expected-failure test
   output, `fail-on-cache-miss`, echoed `::error::` inside script text).

3. Classify it, then act:

   | Failure | Fix |
   |---------|-----|
   | A step `cancelled`, job ended at exactly its `timeout-minutes` | The limit is too tight for a step that now runs longer (an online scan, a cold cache). Raise that one job's limit, say why in a comment, push. Change only that job: a `sed` on a line several jobs share edits all of them |
   | A score, gate or ratchet (`make scores`, a baseline file) | A new feature legitimately moved the number: bump the baseline in the same PR, with the reason in the commit |
   | A map or inventory test ("every X is in the map") | Add the new file to the map |
   | Lint, format, spell check | Run the repo's own fixer (`biome check --write`); for a spell check, change the word, not the dictionary, unless it is a real term |
   | A real test failure | Fix the code or the test with the reason in the commit |
   | Passed on the PR, the queue and later PRs, failed once on `main` | Rerun once (`gh run rerun <run> --failed`). If it fails again, it is real: fix it first; the one-command demo outranks everything (P1) |
   | DCO sign-off on an old unsigned commit | History cannot be rewritten without a force push. Squash the tree into one `git commit -s` commit on a new branch, open a replacement PR that links the old one, close the old PR with a pointer |
   | Fails locally on `main` too | Not this PR's cause: open one fix PR for `main`, or report it if the cause is the local machine |

4. Run the same gate locally (lint, typecheck, the touched tests, `make
   scores` or the repo's equivalent), commit, push normally, then let the hook
   or the loop report the new run. A rerun alone is allowed only for the flake
   row above, and only once.

