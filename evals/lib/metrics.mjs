/**
 * Agreement metrics for single-label (priority) and multi-label (label set)
 * predictions. Pure functions over arrays of gold/predicted answers.
 */

const round = (x) => Math.round(x * 1000) / 1000;
const ratio = (num, den) => (den === 0 ? null : round(num / den));

function prf(tp, fp, fn) {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0
    ? (tp + fp + fn === 0 ? null : 0)
    : round((2 * precision * recall) / (precision + recall));
  return { precision, recall, f1 };
}

/** Name used for a null class (an item the skill skips). */
export const SKIP = "skip";
const className = (value) => (value === null ? SKIP : value);

/**
 * Single-label agreement: accuracy, per-class precision/recall/F1, macro F1,
 * Cohen's kappa and the confusion matrix (rows = gold, columns = predicted).
 * A prediction of `undefined` (the model gave no usable answer) counts as wrong.
 */
export function classificationReport(gold, predicted, classes) {
  if (gold.length !== predicted.length) throw new Error("gold and predicted differ in length");
  const n = gold.length;
  const names = [...classes.map(className)];
  const INVALID = "invalid";

  const confusion = {};
  for (const g of names) {
    confusion[g] = Object.fromEntries([...names, INVALID].map((p) => [p, 0]));
  }

  let correct = 0;
  for (let i = 0; i < n; i++) {
    const g = className(gold[i]);
    const p = predicted[i] === undefined || !names.includes(className(predicted[i])) ? INVALID : className(predicted[i]);
    confusion[g][p] += 1;
    if (g === p) correct += 1;
  }

  const perClass = {};
  for (const c of names) {
    const tp = confusion[c][c];
    const fn = Object.values(confusion[c]).reduce((a, b) => a + b, 0) - tp;
    const fp = names.reduce((sum, g) => sum + (g === c ? 0 : confusion[g][c]), 0);
    perClass[c] = { support: tp + fn, ...prf(tp, fp, fn) };
  }

  const scored = Object.values(perClass).filter((c) => c.support > 0 && c.f1 !== null);
  const macroF1 = scored.length ? round(scored.reduce((sum, c) => sum + c.f1, 0) / scored.length) : null;

  // Cohen's kappa: agreement corrected for the agreement expected by chance.
  const po = correct / n;
  let pe = 0;
  for (const c of names) {
    const goldCount = Object.values(confusion[c]).reduce((a, b) => a + b, 0);
    const predCount = names.reduce((sum, g) => sum + confusion[g][c], 0);
    pe += (goldCount / n) * (predCount / n);
  }
  const kappa = pe === 1 ? null : round((po - pe) / (1 - pe));

  return { n, correct, accuracy: ratio(correct, n), macroF1, kappa, perClass, confusion };
}

/**
 * Multi-label agreement: exact-set accuracy, micro precision/recall/F1 over
 * every (item, label) pair, and the same per label.
 */
export function multiLabelReport(gold, predicted) {
  if (gold.length !== predicted.length) throw new Error("gold and predicted differ in length");
  const counts = new Map();
  const bump = (label, key) => {
    if (!counts.has(label)) counts.set(label, { tp: 0, fp: 0, fn: 0 });
    counts.get(label)[key] += 1;
  };

  let exact = 0;
  for (let i = 0; i < gold.length; i++) {
    const g = new Set(gold[i]);
    const p = new Set(predicted[i] ?? []);
    let same = predicted[i] !== undefined && g.size === p.size;
    for (const label of g) {
      if (p.has(label)) bump(label, "tp");
      else {
        bump(label, "fn");
        same = false;
      }
    }
    for (const label of p) if (!g.has(label)) bump(label, "fp");
    if (same) exact += 1;
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  const perLabel = {};
  for (const label of [...counts.keys()].sort()) {
    const c = counts.get(label);
    tp += c.tp;
    fp += c.fp;
    fn += c.fn;
    perLabel[label] = { support: c.tp + c.fn, tp: c.tp, fp: c.fp, fn: c.fn, ...prf(c.tp, c.fp, c.fn) };
  }

  return { n: gold.length, exact, exactMatch: ratio(exact, gold.length), micro: prf(tp, fp, fn), perLabel };
}
