/**
 * Reference implementation of the `auto-label` command in
 * skills/pr-labeler/SKILL.md. Every table in the skill is encoded below, in
 * the order the skill lists it; where the skill leaves a choice open, the
 * comment names the ambiguity id documented in evals/README.md.
 *
 * Input:  { branch, files: string[], additions, deletions }
 * Output: { type, priority, size, team, domain, labels, evidence }
 */

import { firstMatch } from "./glob.mjs";

// Type Labels (from branch name). A branch pattern `feature/*` is read as
// "starts with feature/" — a git ref is not a file path, so `*` also spans
// later slashes (feature/auth/login is still a feature branch).
export const TYPE_RULES = [
  { prefix: "feature/", labels: ["feature"] },
  { prefix: "fix/", labels: ["bug"] },
  { prefix: "bugfix/", labels: ["bug"] },
  { prefix: "hotfix/", labels: ["hotfix"] }, // + P0-Critical, applied as the priority
  { prefix: "refactor/", labels: ["refactor"] },
  { prefix: "docs/", labels: ["documentation"] },
  { prefix: "security/", labels: ["security", "security-review"] },
  { prefix: "performance/", labels: ["performance"] },
  { prefix: "deps/", labels: ["dependencies"] },
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

// Domain Labels (from branch/files). The globs are applied as written, so
// `*ui*` matches `build` and `guide` (ambiguity L3).
export const DOMAIN_RULES = [
  { label: "domain/api", pattern: "*api*" },
  { label: "domain/auth", pattern: "*auth*" },
  { label: "domain/payment", pattern: "*payment*" },
  { label: "domain/ui", pattern: "*ui*" },
  { label: "domain/docs", pattern: "*docs*" },
];

// The skill splits feature/* into "customer-facing" (P1-High) and "internal"
// (P2-Medium) without defining either. The only definition in the collection
// is USER_FACING_PATHS in gh-prioritizer/references/priority-detection-rules.md,
// so that list decides (ambiguity L1).
export const CUSTOMER_FACING_PATHS = [
  "**/api/**",
  "**/auth/**",
  "**/payment/**",
  "**/frontend/**",
  "**/*.tsx",
  "**/*.jsx",
];

export function linesChanged(pr) {
  return (pr.additions ?? 0) + (pr.deletions ?? 0);
}

export function sizeLabel(lines) {
  return SIZE_BUCKETS.find((bucket) => lines <= bucket.max).label;
}

function priorityLabel(branch, files, evidence) {
  if (branch.startsWith("hotfix/")) {
    evidence["priority"] = "branch hotfix/*";
    return "P0-Critical";
  }
  if (branch.startsWith("feature/")) {
    const hit = firstMatch(files, CUSTOMER_FACING_PATHS);
    evidence["priority"] = hit
      ? `customer-facing feature: ${hit.path} matches ${hit.pattern}`
      : "internal feature: no customer-facing path";
    return hit ? "P1-High" : "P2-Medium";
  }
  if (branch.startsWith("docs/") || branch.startsWith("refactor/")) {
    evidence["priority"] = "branch docs/* or refactor/*";
    return "P3-Low";
  }
  evidence["priority"] = "no priority rule matched: default";
  return "P2-Medium";
}

export function labelPullRequest(pr) {
  const branch = pr.branch ?? "";
  const files = pr.files ?? [];
  const evidence = {};

  const type = [];
  for (const rule of TYPE_RULES) {
    if (branch.startsWith(rule.prefix)) {
      for (const label of rule.labels) {
        type.push(label);
        evidence[label] = `branch ${rule.prefix}*`;
      }
    }
  }

  const priority = priorityLabel(branch, files, evidence);

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
    const hit = firstMatch([branch, ...files], [rule.pattern]);
    if (hit) {
      domain.push(rule.label);
      evidence[rule.label] = `${hit.path} matches ${hit.pattern}`;
    }
  }

  const labels = [...type, priority, size, ...team, ...domain].sort();
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
