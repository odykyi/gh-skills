import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVALS_DIR, loadFixtures, skillInput } from "../evals/lib/fixtures.mjs";
import { DOMAIN_RULES, SIZE_BUCKETS, TEAM_RULES, TYPE_RULES, labelPullRequest } from "../evals/lib/pr-labeler.mjs";
import { PRIORITIES, RULES, prioritize } from "../evals/lib/gh-prioritizer.mjs";

const { fixtures } = loadFixtures();

const KNOWN_LABELS = new Set([
  ...TYPE_RULES.flatMap((r) => r.labels),
  ...PRIORITIES,
  ...SIZE_BUCKETS.map((b) => b.label),
  ...TEAM_RULES.map((r) => r.label),
  ...DOMAIN_RULES.map((r) => r.label),
]);

test("fixtures are well-formed", () => {
  const ids = new Set();
  for (const f of fixtures) {
    assert.match(f.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${f.id}: id is not kebab-case`);
    assert.ok(!ids.has(f.id), `${f.id}: duplicate id`);
    ids.add(f.id);
    for (const key of ["title", "body", "branch"]) assert.equal(typeof f[key], "string", `${f.id}.${key}`);
    assert.ok(f.title.length > 0 && f.branch.length > 0, `${f.id}: empty title or branch`);
    assert.ok(Array.isArray(f.labels), `${f.id}.labels`);
    assert.ok(Array.isArray(f.files) && f.files.length > 0, `${f.id}.files`);
    for (const key of ["additions", "deletions"]) {
      assert.ok(Number.isInteger(f[key]) && f[key] >= 0, `${f.id}.${key}`);
    }
    assert.ok(Array.isArray(f.traps), `${f.id}.traps`);
  }
});

test("gold answers use only labels and priorities the skills define", () => {
  for (const f of fixtures) {
    const labels = f.gold["pr-labeler"];
    assert.equal(new Set(labels).size, labels.length, `${f.id}: duplicate gold label`);
    for (const label of labels) assert.ok(KNOWN_LABELS.has(label), `${f.id}: unknown label ${label}`);
    assert.equal(labels.filter((l) => PRIORITIES.includes(l)).length, 1, `${f.id}: needs one priority`);
    assert.equal(labels.filter((l) => l.startsWith("size/")).length, 1, `${f.id}: needs one size`);
    const priority = f.gold["gh-prioritizer"];
    assert.ok(priority === null || PRIORITIES.includes(priority), `${f.id}: unknown priority ${priority}`);
  }
});

test("every trap a fixture names is documented in evals/README.md", () => {
  const readme = readFileSync(join(EVALS_DIR, "README.md"), "utf8");
  const documented = new Set([...readme.matchAll(/^\| ([LPIX]\d+) \|/gm)].map((m) => m[1]));
  assert.ok(documented.size > 0, "no ambiguity table found in evals/README.md");
  for (const f of fixtures) {
    for (const id of f.traps) assert.ok(documented.has(id), `${f.id}: trap ${id} is not documented`);
  }
});

test("coverage: every pr-labeler rule produces a gold label somewhere", () => {
  const used = new Set(fixtures.flatMap((f) => f.gold["pr-labeler"]));
  for (const label of KNOWN_LABELS) assert.ok(used.has(label), `no fixture exercises ${label}`);
  for (const { prefix } of TYPE_RULES) {
    assert.ok(fixtures.some((f) => f.branch.startsWith(prefix)), `no fixture uses a ${prefix} branch`);
  }
  for (const priority of PRIORITIES) {
    assert.ok(fixtures.some((f) => labelPullRequest(skillInput("pr-labeler", f)).priority === priority), priority);
  }
});

test("coverage: every reachable gh-prioritizer rule fires on some fixture", () => {
  // p0:branch can never fire: the hotfix override returns first (ambiguity P4).
  const UNREACHABLE = new Set(["p0:branch"]);
  const fired = new Set(fixtures.flatMap((f) => prioritize(skillInput("gh-prioritizer", f)).matches.map((m) => m.rule)));
  for (const { rule } of RULES) {
    if (UNREACHABLE.has(rule)) assert.ok(!fired.has(rule), `${rule} fired; it is listed as unreachable`);
    else assert.ok(fired.has(rule), `no fixture fires ${rule}`);
  }
  for (const priority of [...PRIORITIES, null]) {
    assert.ok(fixtures.some((f) => f.gold["gh-prioritizer"] === priority), `no fixture has gold ${priority}`);
  }
});
