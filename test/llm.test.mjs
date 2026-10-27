import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtures } from "../evals/lib/fixtures.mjs";
import { callClaude, mapLimit, normalizeAnswer, parseAnswer, systemPrompt, userPrompt } from "../evals/lib/llm.mjs";

const { fixtures } = loadFixtures();

test("parseAnswer reads a fenced JSON reply", () => {
  const reply = '```json\n{"labels": ["size/S", "bug", "bug"], "reason": "fix branch"}\n```';
  assert.deepEqual(parseAnswer("pr-labeler", reply), { answer: ["bug", "size/S"], reason: "fix branch" });
  assert.deepEqual(parseAnswer("gh-prioritizer", 'Sure. {"priority": null, "reason": "skip"}'), {
    answer: null,
    reason: "skip",
  });
});

test("parseAnswer rejects replies that do not follow the schema", () => {
  assert.match(parseAnswer("pr-labeler", "no json here").error, /no JSON/);
  assert.match(parseAnswer("pr-labeler", '{"labels": "bug"}').error, /array of strings/);
  assert.match(parseAnswer("pr-labeler", "{labels: [}").error, /invalid JSON/);
  assert.match(parseAnswer("gh-prioritizer", '{"priority": "P1"}').error, /unknown priority/);
  assert.match(parseAnswer("gh-prioritizer", '{"reason": "x"}').error, /unknown priority/);
});

test("normalizeAnswer drops labels the PR already had", () => {
  const fixture = fixtures.find((f) => f.labels.includes("DO-NOT-MERGE"));
  assert.deepEqual(normalizeAnswer("pr-labeler", fixture, ["DO-NOT-MERGE", "size/M"]), ["size/M"]);
  assert.equal(normalizeAnswer("gh-prioritizer", fixture, null), null);
});

test("the system prompt carries the skill text the agent would load", () => {
  assert.match(systemPrompt("pr-labeler"), /### Size Labels/);
  assert.match(systemPrompt("gh-prioritizer"), /function determinePriority/);
});

test("gh-prioritizer prompts include pr-labeler's gold labels; pull request text is passed verbatim", () => {
  const fixture = fixtures.find((f) => f.id === "injection-ask-for-labels");
  const prompt = userPrompt("gh-prioritizer", fixture);
  const json = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual(json.labels, fixture.gold["pr-labeler"]);
  assert.equal(json.body, fixture.body);
  assert.equal(json.linesChanged, fixture.additions + fixture.deletions);
});

test("mapLimit keeps input order and never exceeds the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, n * 3));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
});

test("callClaude drives the CLI in print mode with tools disabled", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const bin = join(dir, "claude");
  // A stand-in for `claude -p`: records its arguments and stdin, answers like the CLI.
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(join(dir, "call.json"))}, JSON.stringify({ argv: process.argv.slice(2), stdin }));
process.stdout.write(JSON.stringify({
  is_error: false, result: '{"priority": "P2-Medium", "reason": "ok"}',
  total_cost_usd: 0.01, duration_ms: 42, modelUsage: { "claude-test-1": {} },
}));
`,
  );
  chmodSync(bin, 0o755);
  try {
    const reply = await callClaude({ system: "SYS", prompt: "PROMPT", model: "haiku", bin });
    assert.deepEqual(reply, { text: '{"priority": "P2-Medium", "reason": "ok"}', costUsd: 0.01, durationMs: 42, model: "claude-test-1" });
    const call = JSON.parse(readFileSync(join(dir, "call.json"), "utf8"));
    assert.equal(call.stdin, "PROMPT");
    const flag = (name) => call.argv[call.argv.indexOf(name) + 1];
    assert.ok(call.argv.includes("-p"));
    assert.equal(flag("--tools"), "");
    assert.equal(flag("--model"), "haiku");
    assert.equal(flag("--output-format"), "json");
    assert.equal(flag("--system-prompt"), "SYS");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("callClaude rejects when the CLI reports an error", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ is_error: true, result: "rate limited" }));\n`);
  chmodSync(bin, 0o755);
  try {
    await assert.rejects(callClaude({ system: "", prompt: "", model: "haiku", bin }), /rate limited/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
