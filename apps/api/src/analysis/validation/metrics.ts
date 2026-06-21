// Error-metric math for the validation harness (PROMPT B.2).
// RMSE / MAE / bias / ICC(2,1) absolute agreement. No deps; unit-tested.

export function mae(pred: number[], truth: number[]): number {
  assertPaired(pred, truth);
  return mean(pred.map((p, i) => Math.abs(p - truth[i])));
}

export function rmse(pred: number[], truth: number[]): number {
  assertPaired(pred, truth);
  return Math.sqrt(mean(pred.map((p, i) => (p - truth[i]) ** 2)));
}

/** Mean signed error (predicted - truth). Positive = systematic over-read. */
export function bias(pred: number[], truth: number[]): number {
  assertPaired(pred, truth);
  return mean(pred.map((p, i) => p - truth[i]));
}

/**
 * ICC(2,1), two-way random, absolute agreement, for k=2 raters (truth & pred).
 * 1 = perfect agreement; ~0 = no better than chance; penalizes systematic bias.
 */
export function icc(pred: number[], truth: number[]): number {
  assertPaired(pred, truth);
  const n = pred.length;
  if (n < 2) return NaN;
  const k = 2;
  const rows = pred.map((p, i) => [truth[i], p]);
  const grand = mean(rows.flat());
  const rowMeans = rows.map((r) => mean(r));
  const colMeans = [mean(truth), mean(pred)];

  const SSR = k * sum(rowMeans.map((rm) => (rm - grand) ** 2));
  const SSC = n * sum(colMeans.map((cm) => (cm - grand) ** 2));
  let SST = 0;
  for (const r of rows) for (const x of r) SST += (x - grand) ** 2;
  const SSE = SST - SSR - SSC;

  const MSR = SSR / (n - 1);
  const MSC = SSC / (k - 1);
  const MSE = SSE / ((n - 1) * (k - 1));

  const denom = MSR + (k - 1) * MSE + (k / n) * (MSC - MSE);
  if (denom === 0) return 1;
  return (MSR - MSE) / denom;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
function assertPaired(a: number[], b: number[]): void {
  if (a.length !== b.length) throw new Error(`paired arrays must match length (${a.length} vs ${b.length})`);
}
