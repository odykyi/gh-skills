#!/usr/bin/env bash
# Classify every open PR of a repository by what it changes, in one API call.
# Usage: classify-prs.sh <owner/repo>
# Prints "<number> <author> <LANE>", one per line. Lanes:
#   SEC    touches CI, scripts, manifests, lockfiles, Dockerfiles, CODEOWNERS,
#          vendored dependencies or build bundles, or changes 100+ files
#   DOCS   only markdown, text or docs/
#   TESTS  only docs, tests and compiled output next to them
#   CODE   everything else
set -euo pipefail
repo="${1:?usage: classify-prs.sh <owner/repo>}"
gh pr list -R "$repo" --state open --limit 1000 --json number,author,files --jq '
  def sec: test("^\\.github/|(^|/)scripts/|(^|/)node_modules/|dist-bundle/|(^|/)(package\\.json|package-lock\\.json|bun\\.lockb?|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|go\\.sum|uv\\.lock|poetry\\.lock|Gemfile\\.lock|CODEOWNERS|Dockerfile[^/]*)$");
  def docs: test("\\.(md|txt)$|^docs/");
  def tests: test("(^|/)__tests__/|^tests?/|\\.(test|spec)\\.|^[^/]+/dist/");
  .[] | . as $pr | ([.files[].path]) as $p |
  "\($pr.number) \($pr.author.login) " + (
    if ($p|length) >= 100 or ($p|any(sec)) then "SEC"
    elif ($p|length) > 0 and ($p|all(docs)) then "DOCS"
    elif ($p|length) > 0 and ($p|all(docs or tests)) then "TESTS"
    else "CODE" end)'
