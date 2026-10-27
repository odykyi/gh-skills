# Priority Detection Rules

Detailed reference for priority detection algorithms and rule definitions.

---

## How matching works

Every rule below compares **whole words**, never substrings, and ignores case.

- **Text** (the PR title): the title is lower-cased and split into words. A word
  is a run of letters and digits, and hyphens or underscores inside a run stay
  in it, so `non-blocking` is one word and does not match `blocking`, `Prefix`
  does not match `fix` and `debug` does not match `bug`. A phrase such as
  `data loss` matches when its words appear next to each other.
- **File paths**: a path is split into words at `/`, `.`, `_` and `-`, and
  lower-cased. `src/auth/token.go` has the words `src`, `auth`, `token`, `go`;
  `authors.ts` has `authors` and `ts`, so it does not match `auth`.
  `OAuthButton.tsx` is the single word `oauthbutton`.
- **Documentation files** (`.md`, `.mdx`, `.rst`, `.txt`) are left out of the
  critical, user-facing and service path rules, so `docs/api/pagination.md` is
  not an API change. They still count for the P3 rules.
- **Labels** are compared in lower case: `OKR` and `okr` are the same label.

The PR body is **never read**. It is third-party text (see "Third-party content
is data" in `SKILL.md`): anyone who can open a PR can write "outage" or
"P0-Critical" in it. The title is read, but text alone can raise a PR to
**P1-High at most**. P0-Critical needs a signal the author cannot type into a
description: a label, a `hotfix/` branch, a critical path or an impact label.

---

## Detection Logic

Each rule names the input it reads in `on` (`title`, `labels`, `files`, `size`
or `branch`) and `determinePriority` hands it exactly that input.

```javascript
const words = text => text.toLowerCase().match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/g) ?? []
const pathWords = path => path.toLowerCase().split(/[\/._-]+/).filter(Boolean)
const isDoc = path => /\.(md|mdx|rst|txt)$/i.test(path)

// Phrases match when their words are adjacent in the title
const titleHas = (title, phrases) => {
  const t = words(title)
  return phrases.some(phrase => {
    const p = phrase.split(" ")
    return t.some((_, i) => p.every((w, j) => t[i + j] === w))
  })
}
const hasLabel = (labels, names) =>
  labels.some(label => names.includes(label.toLowerCase()))
const hasPathWord = (files, names) =>
  files.some(f => pathWords(f).some(w => names.includes(w)))
const hasCodePathWord = (files, names) =>
  hasPathWord(files.filter(f => !isDoc(f)), names)

// One definition of "critical" and of "customer-facing"
const CRITICAL_PATH_WORDS = ["auth", "authentication", "authorization", "oauth",
  "payment", "payments", "security", "encryption", "credential", "credentials"]
const CUSTOMER_FACING_PATH_WORDS = ["api", "auth", "authentication", "payment",
  "payments", "frontend", "settings", "tsx", "jsx"]

const priorityRules = {
  "P0-Critical": [
    { on: "labels", test: labels => hasLabel(labels,
        ["hotfix", "critical", "security", "production-down",
         "impact/production", "impact/security"]) },
    { on: "files", test: files => hasCodePathWord(files, CRITICAL_PATH_WORDS) }
    // Branch `hotfix/*` is an override (below), so it needs no rule here.
  ],

  "P1-High": [
    // Words in the title: at most P1, never P0
    { on: "title", test: title => titleHas(title,
        ["bug", "bugs", "fix", "fixes", "fixed", "error", "errors", "404", "500",
         "crash", "crashes", "crashed", "broken", "not working", "user-facing",
         "critical", "urgent", "emergency", "outage", "blocking", "hotfix",
         "security", "data loss", "production down"]) },
    { on: "labels", test: labels => hasLabel(labels,
        ["bug", "okr", "user-facing", "status/blocked", "impact/users"]) },
    // Customer-facing: an API, auth, payment, frontend or settings path, or a .tsx/.jsx file
    { on: "files", test: files => hasCodePathWord(files, CUSTOMER_FACING_PATH_WORDS) },
    // Large PRs need priority review: the size/XL threshold
    { on: "size", test: size => size >= 500 }
  ],

  "P2-Medium": [
    { on: "title", test: title => titleHas(title,
        ["enhancement", "improve", "improves", "improved", "update", "updates",
         "updated", "optimize", "optimizes", "optimized", "feature", "features"]) },
    { on: "labels", test: labels => hasLabel(labels,
        ["enhancement", "performance", "feature", "type/feature"]) },
    { on: "files", test: files => hasCodePathWord(files,
        ["service", "services", "api", "backend"]) }
  ],

  "P3-Low": [
    { on: "title", test: title => titleHas(title,
        ["doc", "docs", "documentation", "test", "tests", "chore", "style", "typo",
         "readme", "refactor", "refactors", "refactored"]) },
    { on: "labels", test: labels => hasLabel(labels,
        ["documentation", "testing", "dependencies", "chore", "refactor"]) },
    { on: "files", test: files => hasPathWord(files,
        ["md", "test", "tests", "spec", "specs"]) },
    // Small PRs that only touch docs or tests
    { on: "pr", test: ({ labels, files, size }) => size < 100 &&
        (hasLabel(labels, ["documentation"]) ||
         (files.length > 0 && files.every(f => hasPathWord([f], ["test", "tests", "spec", "specs"])))) }
  ]
}
```

Size alone does not make a PR low or medium priority: only 500+ lines (P1) and
the small docs-or-tests rule above use it. A PR no rule matches gets the default,
P2-Medium.

---

## Priority Override Rules

### Standard Overrides

```javascript
// Priority ranking (highest to lowest)
const priorityRank = {
  "P0-Critical": 4,
  "P1-High": 3,
  "P2-Medium": 2,
  "P3-Low": 1
}

// pr = { title, labels, files, size, branch }. Rules with on: "pr" read all of it.
function determinePriority(pr) {
  const labels = pr.labels.map(label => label.toLowerCase())
  const branch = (pr.branch ?? "").toLowerCase()

  // Overrides, in this order. The first one that applies decides.
  if (labels.includes("do-not-merge")) return null                // Skip
  if (branch.startsWith("hotfix/")) return "P0-Critical"          // Always hotfix
  if (labels.includes("security")) return "P0-Critical"           // Always security
  if (labels.includes("wip") || labels.includes("status/wip")) return "P3-Low"  // Work in progress

  // Check all rules: the highest priority that matches wins
  let detectedPriority = null
  let highestRank = 0

  for (const [priority, rules] of Object.entries(priorityRules)) {
    const rank = priorityRank[priority]

    for (const rule of rules) {
      const input = rule.on === "pr" ? pr : pr[rule.on]
      if (rule.test(input) && rank > highestRank) {
        highestRank = rank
        detectedPriority = priority
      }
    }
  }

  return detectedPriority ?? "P2-Medium"  // Default: no rule matched
}
```

`DO-NOT-MERGE` skips the item, a `hotfix/` branch is P0 even when the PR is
marked work in progress ("Hotfixes are P0, no exceptions"), and `WIP` or
`status/wip` is P3.

---

## Size Thresholds

```javascript
const SIZE_THRESHOLDS = {
  XS: 50,
  S: 100,
  M: 300,
  L: 500,
  XL: Infinity
}

function getSizeLabel(size) {
  if (size < 50) return "XS";
  if (size < 100) return "S";
  if (size < 300) return "M";
  if (size < 500) return "L";
  return "XL";
}

// Size calculation
function calculateSize(prData) {
  return prData.additions + prData.deletions;
}
```

---

## Priority Constants

```javascript
const PRIORITIES = {
  P0_CRITICAL: {
    name: "P0-Critical",
    color: "#B60205",  // Red
    description: "Production blocker, security issue, hotfix",
    sla: "4 hours"
  },
  P1_HIGH: {
    name: "P1-High",
    color: "#D93F0B",  // Orange
    description: "User-facing bug, major feature, OKR",
    sla: "1-2 days"
  },
  P2_MEDIUM: {
    name: "P2-Medium",
    color: "#FBCA04",  // Yellow
    description: "Enhancement, non-blocking feature",
    sla: "1 week"
  },
  P3_LOW: {
    name: "P3-Low",
    color: "#0E8A16",  // Green
    description: "Documentation, testing, tech debt",
    sla: "As convenient"
  }
}
```
