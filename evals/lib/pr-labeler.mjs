/**
 * Reference implementation of the `auto-label` command in
 * skills/pr-labeler/SKILL.md. Every table in the skill is encoded below, in
 * the order the skill lists it; where the skill leaves a choice open, the
 * comment names the ambiguity id documented in evals/README.md.
 *
 * Priority labels are not decided here: the skill defers to gh-prioritizer's
 * rules (ambiguity X1), so labelPullRequest runs prioritize() on the title,
 * the branch, the PR's labels plus the type labels assigned in this pass, the
 * files and the size.
 *
 * Input:  { title, branch, labels: string[], files: string[], additions, deletions }
 * Output: { type, priority, size, team, domain, labels, evidence }
 */

import { firstMatch } from "./glob.mjs";
import { pathWords, prioritize } from "./gh-prioritizer.mjs";

// Type Labels (from branch name). A branch pattern `feature/*` is read as
// "starts with feature/" — a git ref is not a file path, so `*` also spans
// later slashes (feature/auth/login is still a feature branch). Prefixes are
// matched in lower case. `feat/`, `test/`, `chore/` and `dependabot/` map to a
// type label too (ambiguity L4).
export const TYPE_RULES = [
  { prefix: "feature/", labels: ["feature"] },
  { prefix: "feat/", labels: ["feature"] },
  { prefix: "fix/", labels: ["bug"] },
  { prefix: "bugfix/", labels: ["bug"] },
  { prefix: "hotfix/", labels: ["hotfix"] }, // + P0-Critical, applied as the priority
  { prefix: "refactor/", labels: ["refactor"] },
  { prefix: "docs/", labels: ["documentation"] },
  { prefix: "security/", labels: ["security", "security-review"] },
  { prefix: "performance/", labels: ["performance"] },
  { prefix: "deps/", labels: ["dependencies"] },
  { prefix: "dependabot/", labels: ["dependencies"] },
  { prefix: "test/", labels: ["testing"] },
  { prefix: "chore/", labels: ["chore"] },
];

// Size Labels (auto-calculated from diff): lines changed = additions + deletions.
// The table says 500 lines is size/XL; Best Practices says "XL PRs (>500
// lines)". The table wins (ambiguity L6).
export const SIZE_BUCKETS = [
  { max: 49, label: "size/XS" },
  { max: 99, label: "size/S" },
  { max: 299, label: "size/M" },
  { max: 499, label: "size/L" },
  { max: Infinity, label: "size/XL" },
];

// Team Labels (from file paths), gitignore semantics (ambiguity L2, L5).
export const TEAM_RULES = [
  { label: "team/frontend", patterns: ["frontend/**", "*.tsx"] },
  { label: "team/backend", patterns: ["backend/**", "api/**", "server/**"] },
  { label: "team/devops", patterns: ["infra/**", "docker/**", "*.yml"] },
  { label: "team/qa", patterns: ["tests/**", "**/*.test.*", "**/*.spec.*"] },
  { label: "team/security", patterns: ["security/**", "**/auth/**"] },
];

// Domain Labels (from branch/files). A label applies when the branch or a
// changed path contains one of its words, as a whole word in any case; paths
// are split at / . _ and - (ambiguity L3).
export const DOMAIN_RULES = [
  { label: "domain/api", words: ["api"] },
  { label: "domain/auth", words: ["auth", "authentication", "authorization", "oauth"] },
  { label: "domain/payment", words: ["payment", "payments"] },
  { label: "domain/ui", words: ["ui"] },
  { label: "domain/docs", words: ["docs"] },
];

export function linesChanged(pr) {
  return (pr.additions ?? 0) + (pr.deletions ?? 0);
}

export function sizeLabel(lines) {
  return SIZE_BUCKETS.find((bucket) => lines <= bucket.max).label;
}

export function labelPullRequest(pr) {
  const branch = pr.branch ?? "";
  const files = pr.files ?? [];
  const evidence = {};

  const type = [];
  for (const rule of TYPE_RULES) {
    if (branch.toLowerCase().startsWith(rule.prefix)) {
      for (const label of rule.labels) {
        type.push(label);
        evidence[label] = `branch ${rule.prefix}*`;
      }
    }
  }

  const lines = linesChanged(pr);
  const size = sizeLabel(lines);
  evidence[size] = `${lines} lines changed`;

  const team = [];
  for (const rule of TEAM_RULES) {
    const hit = firstMatch(files, rule.patterns);
    if (hit) {
      team.push(rule.label);
      evidence[rule.label] = `${hit.path} matches ${hit.pattern}`;
    }
  }

  const domain = [];
  for (const rule of DOMAIN_RULES) {
    for (const path of [branch, ...files]) {
      const word = pathWords(path).find((w) => rule.words.includes(w));
      if (word) {
        domain.push(rule.label);
        evidence[rule.label] = `${path} has the word "${word}"`;
        break;
      }
    }
  }

  // Priority comes last: gh-prioritizer sees the labels assigned above (X1).
  const decision = prioritize({
    title: pr.title,
    branch,
    labels: [...(pr.labels ?? []), ...type],
    files,
    additions: pr.additions,
    deletions: pr.deletions,
  });
  const priority = decision.priority; // null: DO-NOT-MERGE, no priority label
  if (priority) evidence["priority"] = `gh-prioritizer ${decision.decidedBy}`;

  const labels = [...type, ...(priority ? [priority] : []), size, ...team, ...domain].sort();
  return { type, priority, size, team, domain, labels, evidence };
}

/** Sort a flat label list into the skill's categories (used to score LLM output). */
export function categorize(labels) {
  const out = { type: [], priority: [], size: [], team: [], domain: [] };
  for (const label of labels) {
    if (/^P\d-/.test(label)) out.priority.push(label);
    else if (label.startsWith("size/")) out.size.push(label);
    else if (label.startsWith("team/")) out.team.push(label);
    else if (label.startsWith("domain/")) out.domain.push(label);
    else out.type.push(label);
  }
  for (const key of Object.keys(out)) out[key].sort();
  return out;
}
