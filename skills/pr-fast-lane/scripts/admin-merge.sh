#!/usr/bin/env bash
# Merge one PR past required checks, after the guards that make that safe.
# Use only when the user's standing instruction says to admin-merge and the
# repository's own gates (lint, typecheck, touched tests) already passed locally.
# Usage: admin-merge.sh <owner/repo> <pr> [--expect-sha <head sha>] [--dry-run]
# Exit codes: 0 merged (or would merge), 2 not open, 3 sensitive paths,
#   4 head moved since the gates ran, 5 unresolved review threads,
#   6 merge conflict, 7 merge did not land.
set -euo pipefail
repo="${1:?usage: admin-merge.sh <owner/repo> <pr> [--expect-sha SHA] [--dry-run]}"
pr="${2:?pr number}"; shift 2
expect=""; dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-sha) expect="${2:?sha}"; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 64 ;;
  esac
done
owner="${repo%%/*}"; name="${repo##*/}"
json=$(gh pr view "$pr" -R "$repo" --json id,state,mergeStateStatus,headRefOid,files)
state=$(jq -r .state <<<"$json")
[ "$state" = OPEN ] || { echo "#$pr $state: not open"; exit 2; }
sensitive=$(jq -r '[.files[].path | select(test("^\\.github/|(^|/)scripts/|(^|/)node_modules/|dist-bundle/|(^|/)(package\\.json|package-lock\\.json|bun\\.lockb?|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|go\\.sum|uv\\.lock|poetry\\.lock|Gemfile\\.lock|CODEOWNERS|Dockerfile[^/]*)$"))] | length' <<<"$json")
count=$(jq '.files|length' <<<"$json")
if [ "$sensitive" != 0 ] || [ "$count" -ge 100 ]; then echo "#$pr HOLD-SECURITY: $sensitive sensitive paths, $count files"; exit 3; fi
head=$(jq -r .headRefOid <<<"$json")
if [ -n "$expect" ] && [ "$head" != "$expect" ]; then echo "#$pr head moved: $head != $expect"; exit 4; fi
# Bots re-review every push, so count threads now, not from an earlier note.
open=$(gh api graphql -F n="$pr" -f o="$owner" -f r="$name" -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){totalCount nodes{isResolved}}}}}' \
  --jq '.data.repository.pullRequest.reviewThreads | [.nodes[]|select(.isResolved==false)] | length')
[ "$open" = 0 ] || { echo "#$pr $open unresolved review threads"; exit 5; }
[ "$(jq -r .mergeStateStatus <<<"$json")" != DIRTY ] || { echo "#$pr merge conflict"; exit 6; }
if [ "$dry" = 1 ]; then echo "#$pr would admin-merge at $head"; exit 0; fi
gh api graphql -f query='mutation($i:ID!){dequeuePullRequest(input:{id:$i}){clientMutationId}}' -f i="$(jq -r .id <<<"$json")" >/dev/null 2>&1 || true
gh pr merge "$pr" -R "$repo" --admin --squash >/dev/null
[ "$(gh pr view "$pr" -R "$repo" --json state --jq .state)" = MERGED ] && { echo "#$pr MERGED"; exit 0; }
echo "#$pr merge did not land"; exit 7
