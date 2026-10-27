#!/usr/bin/env node
/**
 * LLM-in-the-loop eval: asks a model to apply each skill to every fixture and
 * scores its answers against the gold answers. Uses the Claude Code CLI
 * (`claude -p`, tools disabled), which authenticates with your Claude login
 * or ANTHROPIC_API_KEY.
 *
 *   node evals/run-llm.mjs --model haiku
 *   node evals/run-llm.mjs --model sonnet --skill gh-prioritizer --concurrency 6
 *   node evals/run-llm.mjs --model haiku --limit 3      smoke test, writes nothing
 *   node evals/run-llm.mjs --print-prompt <fixture-id>  show the prompts, call nothing
 *
 * A full run writes evals/results/<skill>.<model>.json with every answer, the
 * model's one-line reason, cost and timing; `node evals/report.mjs --write`
 * turns those files into the tables in the READMEs.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EVALS_DIR, ROOT, SKILLS, loadFixtures, sha256 } from "./lib/fixtures.mjs";
import {
  SKILL_CONTEXT,
  callClaude,
  claudeVersion,
  mapLimit,
  normalizeAnswer,
  parseAnswer,
  promptSha256,
  systemPrompt,
  userPrompt,
} from "./lib/llm.mjs";
import { scoreSkill } from "./lib/score.mjs";

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "haiku" },
    skill: { type: "string" },
    concurrency: { type: "string", default: "4" },
    limit: { type: "string" },
    out: { type: "string", default: join(EVALS_DIR, "results") },
    "print-prompt": { type: "string" },
    claude: { type: "string", default: process.env.CLAUDE_BIN ?? "claude" },
  },
});

const skills = args.skill ? [args.skill] : SKILLS;
for (const skill of skills) {
  if (!SKILLS.includes(skill)) {
    console.error(`unknown skill "${skill}" — expected one of ${SKILLS.join(", ")}`);
    process.exit(2);
  }
}

const { fixtures: allFixtures, sha256: fixturesSha256 } = loadFixtures();

if (args["print-prompt"]) {
  const fixture = allFixtures.find((f) => f.id === args["print-prompt"]);
  if (!fixture) {
    console.error(`no fixture "${args["print-prompt"]}"`);
    process.exit(2);
  }
  for (const skill of skills) {
    console.log(`===== ${skill}: system =====\n${systemPrompt(skill)}\n===== ${skill}: user =====\n${userPrompt(skill, fixture)}\n`);
  }
  process.exit(0);
}

const limit = args.limit ? Number(args.limit) : allFixtures.length;
const fixtures = allFixtures.slice(0, limit);
const partial = fixtures.length < allFixtures.length;
const version = await claudeVersion(args.claude);
if (!version) {
  console.error(`could not run \`${args.claude} --version\` — install Claude Code or pass --claude <path>`);
  process.exit(2);
}

async function ask(skill, system, fixture) {
  const prompt = userPrompt(skill, fixture);
  let last = { error: "not called" };
  let costUsd = 0;
  let durationMs = 0;
  let model = args.model;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = await callClaude({ system, prompt, model: args.model, bin: args.claude });
      costUsd += reply.costUsd;
      durationMs += reply.durationMs;
      model = reply.model;
      const parsed = parseAnswer(skill, reply.text);
      if (!parsed.error) {
        return {
          id: fixture.id,
          answer: normalizeAnswer(skill, fixture, parsed.answer),
          reason: parsed.reason,
          attempts: attempt,
          costUsd,
          durationMs,
          model,
        };
      }
      last = { error: parsed.error, raw: reply.text };
    } catch (error) {
      last = { error: error.message };
    }
  }
  return { id: fixture.id, answer: undefined, ...last, attempts: 2, costUsd, durationMs, model };
}

for (const skill of skills) {
  const system = systemPrompt(skill);
  let done = 0;
  const started = Date.now();
  const predictions = await mapLimit(fixtures, Number(args.concurrency), async (fixture) => {
    const prediction = await ask(skill, system, fixture);
    done += 1;
    const mark = prediction.answer === undefined ? `invalid (${prediction.error})` : JSON.stringify(prediction.answer);
    process.stderr.write(`[${skill} ${done}/${fixtures.length}] ${fixture.id}: ${mark}\n`);
    return prediction;
  });

  const answers = new Map(predictions.filter((p) => p.answer !== undefined).map((p) => [p.id, p.answer]));
  const summary = scoreSkill(skill, fixtures, answers);
  const resolvedModel = predictions.find((p) => p.answer !== undefined)?.model ?? args.model;
  const costUsd = predictions.reduce((sum, p) => sum + p.costUsd, 0);

  console.log(
    `${skill} × ${resolvedModel}: ${summary.agree}/${summary.n} agree with gold ` +
      `(clean ${summary.clean.agree}/${summary.clean.n}, traps ${summary.traps.agree}/${summary.traps.n}, ` +
      `invalid ${summary.invalid}) — $${costUsd.toFixed(4)}, ${Math.round((Date.now() - started) / 1000)} s`,
  );

  if (partial) {
    console.log("  partial run (--limit): nothing written");
    continue;
  }

  const skillFiles = SKILL_CONTEXT[skill].map((rel) => readFileSync(join(ROOT, "skills", skill, rel), "utf8"));
  const record = {
    skill,
    model: args.model,
    resolvedModel,
    runner: `${version} — claude -p, tools disabled`,
    date: new Date().toISOString().slice(0, 10),
    fixturesSha256,
    skillSha256: sha256(skillFiles.join("\n")),
    promptSha256: promptSha256(skill, fixtures),
    totals: {
      costUsd: Math.round(costUsd * 10000) / 10000,
      wallClockSeconds: Math.round((Date.now() - started) / 1000),
      invalid: summary.invalid,
    },
    predictions: predictions.map(({ model, ...p }) => p),
    summary,
  };
  mkdirSync(args.out, { recursive: true });
  const file = join(args.out, `${skill}.${args.model}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`  wrote ${file}`);
}
