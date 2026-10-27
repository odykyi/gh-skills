import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationReport, multiLabelReport } from "../evals/lib/metrics.mjs";

test("classificationReport: accuracy, per-class scores and confusion matrix", () => {
  const gold = ["a", "a", "b", "b", null];
  const pred = ["a", "b", "b", "b", undefined];
  const r = classificationReport(gold, pred, ["a", "b", null]);
  assert.equal(r.accuracy, 0.6);
  assert.deepEqual(r.perClass.a, { support: 2, precision: 1, recall: 0.5, f1: 0.667 });
  assert.deepEqual(r.perClass.b, { support: 2, precision: 0.667, recall: 1, f1: 0.8 });
  assert.deepEqual(r.perClass.skip, { support: 1, precision: null, recall: 0, f1: 0 });
  assert.equal(r.confusion.a.b, 1);
  assert.equal(r.confusion.skip.invalid, 1); // undefined is an invalid answer
  assert.equal(r.macroF1, 0.489);
});

test("classificationReport: Cohen's kappa matches a hand-computed value", () => {
  // po = 0.7; pe = 0.5*0.6 + 0.5*0.4 = 0.5; kappa = (0.7 - 0.5) / 0.5 = 0.4
  const gold = ["y", "y", "y", "y", "y", "n", "n", "n", "n", "n"];
  const pred = ["y", "y", "y", "y", "n", "y", "y", "n", "n", "n"];
  assert.equal(classificationReport(gold, pred, ["y", "n"]).kappa, 0.4);
});

test("classificationReport: a perfect answer has accuracy and kappa 1", () => {
  const gold = ["a", "b", "c", "a"];
  const r = classificationReport(gold, [...gold], ["a", "b", "c"]);
  assert.equal(r.accuracy, 1);
  assert.equal(r.kappa, 1);
  assert.equal(r.macroF1, 1);
});

test("classificationReport: a class the answers never use is invalid", () => {
  const r = classificationReport(["a"], ["zzz"], ["a"]);
  assert.equal(r.confusion.a.invalid, 1);
  assert.equal(r.accuracy, 0);
});

test("multiLabelReport: exact match and micro / per-label scores", () => {
  const gold = [["x", "y"], ["x"], ["z"]];
  const pred = [["x", "y"], ["x", "z"], undefined];
  const r = multiLabelReport(gold, pred);
  assert.equal(r.exact, 1);
  assert.equal(r.exactMatch, 0.333);
  // tp: x,y,x = 3; fp: z (item 2) = 1; fn: z (item 3) = 1
  assert.deepEqual(r.micro, { precision: 0.75, recall: 0.75, f1: 0.75 });
  assert.deepEqual(r.perLabel.z, { support: 1, tp: 0, fp: 1, fn: 1, precision: 0, recall: 0, f1: 0 });
  assert.deepEqual(r.perLabel.x, { support: 2, tp: 2, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 });
});

test("multiLabelReport: order and duplicates do not matter for exact match", () => {
  assert.equal(multiLabelReport([["a", "b"]], [["b", "a"]]).exact, 1);
  assert.equal(multiLabelReport([[]], [[]]).exact, 1);
  assert.equal(multiLabelReport([[]], [undefined]).exact, 0);
});

test("reports reject mismatched lengths", () => {
  assert.throws(() => classificationReport(["a"], [], ["a"]));
  assert.throws(() => multiLabelReport([["a"]], []));
});
