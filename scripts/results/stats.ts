/** Small, dependency free statistics for the bot evaluation. */

export interface Interval { mean: number; low: number; high: number; n: number; sd: number }

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sd(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

/** 95% interval for a mean: mean ± t(0.975, n − 1) × sd / √n. */
export function tInterval(values: number[]): Interval {
  const n = values.length;
  const m = mean(values);
  const s = sd(values);
  const half = tQuantile(0.975, n - 1) * s / Math.sqrt(n);
  return { mean: m, low: m - half, high: m + half, n, sd: s };
}

/** 95% Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number): { rate: number; low: number; high: number } {
  if (!n) return { rate: NaN, low: NaN, high: NaN };
  const z = 1.959963984540054;
  const p = k / n;
  const denominator = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return { rate: p, low: centre - half, high: centre + half };
}

/** Student t quantile by bisection on the exact CDF. */
export function tQuantile(p: number, df: number): number {
  let low = 0, high = 50;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (tCdf(mid, df) < p) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Regularized incomplete beta function, by continued fraction (Numerical Recipes 6.4). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return front * betaFraction(x, a, b) / a;
  return 1 - front * betaFraction(1 - x, b, a) / b;
}

function betaFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

function logGamma(z: number): number {
  // Lanczos approximation, g = 7.
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
