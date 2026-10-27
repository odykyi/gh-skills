/**
 * LLM-in-the-loop mode: give a model the skill text and one fixture, and read
 * back the answer the skill asks for. The model runs through the Claude Code
 * CLI in print mode with every tool disabled, so it decides from the metadata
 * alone — the same position as an agent that has already fetched the PR.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRIORITIES } from "./gh-prioritizer.mjs";
import { ROOT, sha256, skillInput } from "./fixtures.mjs";

// What an agent would have loaded. gh-prioritizer's SKILL.md defers to the
// reference file for the "complete algorithm", so that file is loaded too.
export const SKILL_CONTEXT = {
  "pr-labeler": ["SKILL.md"],
  "gh-prioritizer": ["SKILL.md", "references/priority-detection-rules.md"],
};

const TASK = {
  "pr-labeler": {
    command: "auto-label",
    answer: '{"labels": [<every label auto-label applies>], "reason": "<one sentence>"}',
  },
  "gh-prioritizer": {
    command: "set",
    answer: `{"priority": ${PRIORITIES.map((p) => `"${p}"`).join(" | ")} | null, "reason": "<one sentence>"}  (null when the skill skips the item)`,
  },
};

export function systemPrompt(skill) {
  const files = SKILL_CONTEXT[skill].map((rel) => {
    const text = readFileSync(join(ROOT, "skills", skill, rel), "utf8");
    return `<file path="skills/${skill}/${rel}">\n${text}\n</file>`;
  });
  return [
    `You are an AI coding agent with the ${skill} skill loaded. Apply the skill to the pull request in the user message exactly as the skill describes.`,
    "You cannot run commands: everything you need is in the metadata given. Answer with one JSON object and nothing else.",
    "",
    `<skill name="${skill}">`,
    ...files,
    "</skill>",
  ].join("\n");
}

export function userPrompt(skill, fixture) {
  const pr = skillInput(skill, fixture);
  const lines = pr.additions + pr.deletions;
  const context =
    skill === "gh-prioritizer"
      ? "pr-labeler has already labelled it; the labels below are the labels on the PR now."
      : "The labels below are the labels already on the PR.";
  return [
    `Run \`${skill} ${TASK[skill].command}\` on this pull request. ${context}`,
    "",
    "Pull request metadata from GitHub:",
    "```json",
    JSON.stringify({ ...pr, linesChanged: lines }, null, 2),
    "```",
    "",
    `Reply with only this JSON: ${TASK[skill].answer}`,
  ].join("\n");
}

/** Hash of everything that shapes the prompts, to detect stale results. */
export function promptSha256(skill, fixtures) {
  return sha256(systemPrompt(skill) + fixtures.map((f) => userPrompt(skill, f)).join("\n"));
}

/** Pulls the answer out of a model reply; returns { answer, reason } or { error }. */
export function parseAnswer(skill, text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { error: "no JSON object in reply" };
  let json;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return { error: `invalid JSON: ${error.message}` };
  }
  if (skill === "pr-labeler") {
    if (!Array.isArray(json.labels) || !json.labels.every((l) => typeof l === "string")) {
      return { error: "`labels` is not an array of strings" };
    }
    return { answer: [...new Set(json.labels)].sort(), reason: json.reason ?? "" };
  }
  if (!("priority" in json) || !(json.priority === null || PRIORITIES.includes(json.priority))) {
    return { error: `unknown priority ${JSON.stringify(json.priority)}` };
  }
  return { answer: json.priority, reason: json.reason ?? "" };
}

/**
 * Labels the PR already carries are not part of what auto-label applies, so a
 * model that repeats them is not penalised for it.
 */
export function normalizeAnswer(skill, fixture, answer) {
  if (skill !== "pr-labeler" || answer === undefined) return answer;
  return answer.filter((label) => !fixture.labels.includes(label));
}

export function claudeVersion(bin = "claude") {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(out.trim() || null));
  });
}

/** One `claude -p` call. Resolves { text, costUsd, durationMs, model } or rejects. */
export function callClaude({ system, prompt, model, bin = "claude", timeoutMs = 180_000 }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--tools", "",
    "--model", model,
    "--setting-sources", "",
    "--no-session-persistence",
    "--system-prompt", system,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        return reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
      if (result.is_error) return reject(new Error(`claude error: ${result.result ?? result.terminal_reason}`));
      resolve({
        text: result.result ?? "",
        costUsd: result.total_cost_usd ?? 0,
        durationMs: result.duration_ms ?? 0,
        model: Object.keys(result.modelUsage ?? {})[0] ?? model,
      });
    });
    child.stdin.end(prompt);
  });
}

/** Runs `worker` over `items` with at most `limit` in flight; keeps input order. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}
