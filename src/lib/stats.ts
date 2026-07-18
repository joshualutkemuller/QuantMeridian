/**
 * Pure numerical statistics — shared by the /api/econ/stats route (server) and
 * the Statistical Analysis page (client). No framework imports.
 *
 * Implements: alignment/resampling, Pearson correlation, simple & multiple OLS,
 * Granger causality (F-test), Augmented Dickey-Fuller stationarity, ACF, rolling
 * correlation, and distribution moments.
 */

export interface Obs {
  date: string;
  value: number;
}

/* ───────────────────────── alignment ───────────────────────── */

/** Resample a daily/weekly/monthly series to one value per calendar month (last). */
function toMonthly(obs: Obs[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of obs) if (o.value != null && isFinite(o.value)) m.set(o.date.slice(0, 7), o.value);
  return m;
}

/**
 * Align a set of named series to a common monthly grid. Returns the overlapping
 * window (most recent `maxLen` months present in every series).
 */
export function alignMonthly(series: { label: string; obs: Obs[] }[], maxLen = 60): { labels: string[]; dates: string[]; matrix: number[][] } {
  const monthly = series.map((s) => toMonthly(s.obs));
  // months present in ALL series
  let common: string[] | null = null;
  for (const mm of monthly) {
    const keys = new Set(mm.keys());
    common = common ? common.filter((k) => keys.has(k)) : [...keys];
  }
  const dates = (common ?? []).sort().slice(-maxLen);
  const matrix = monthly.map((mm) => dates.map((d) => mm.get(d)!));
  return { labels: series.map((s) => s.label), dates, matrix };
}

/* ───────────────────────── descriptive ───────────────────────── */

export function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / (a.length || 1);
}
export function std(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length || 1));
}
export function moments(a: number[]): { mean: number; sd: number; skew: number; kurtosis: number; min: number; max: number } {
  const m = mean(a);
  const sd = std(a) || 1;
  const n = a.length || 1;
  const skew = a.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n;
  const kurt = a.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n - 3;
  return { mean: m, sd: std(a), skew, kurtosis: kurt, min: Math.min(...a), max: Math.max(...a) };
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / (Math.sqrt(da * db) || 1);
}

export function diff(a: number[]): number[] {
  return a.slice(1).map((x, i) => x - a[i]);
}

/* ───────────────────────── regression ───────────────────────── */

export interface OlsResult {
  slope: number;
  intercept: number;
  r2: number;
  tStat: number;
  stdErr: number;
  n: number;
}

export function ols(x: number[], y: number[]): OlsResult {
  const n = Math.min(x.length, y.length);
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxy / (sxx || 1);
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / ((sxx * syy) || 1);
  const se = Math.sqrt(((1 - r2) * syy) / Math.max(1, n - 2)) / Math.sqrt(sxx || 1);
  return { slope, intercept, r2, tStat: slope / (se || 1e-9), stdErr: se, n };
}

/** Solve A x = b via Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-12));
}

/** Multiple OLS (X already includes any lag columns; intercept added). Returns RSS. */
function mlrRss(X: number[][], y: number[]): number {
  const n = y.length;
  const k = X[0].length;
  // design with intercept
  const D = X.map((row) => [1, ...row]);
  const p = k + 1;
  // normal equations D'D beta = D'y
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => {
    let s = 0; for (let r = 0; r < n; r++) s += D[r][i] * D[r][j]; return s;
  }));
  const Xty = Array.from({ length: p }, (_, i) => { let s = 0; for (let r = 0; r < n; r++) s += D[r][i] * y[r]; return s; });
  const beta = solve(XtX, Xty);
  let rss = 0;
  for (let r = 0; r < n; r++) {
    let pred = 0;
    for (let i = 0; i < p; i++) pred += D[r][i] * beta[i];
    rss += (y[r] - pred) ** 2;
  }
  return rss;
}

/* ───────────────────────── Granger causality ───────────────────────── */

export interface GrangerResult {
  fStat: number;
  causes: boolean; // significant at ~5%
  lag: number;
}

/**
 * Does `x` Granger-cause `y`? Compares an AR(L) model of y (restricted) with one
 * that also includes L lags of x (unrestricted) via an F-test. Series are first-
 * differenced for stationarity.
 */
export function granger(x: number[], y: number[], lag = 2): GrangerResult {
  const dx = diff(x), dy = diff(y);
  const n = Math.min(dx.length, dy.length);
  const start = lag;
  const Yr: number[] = [];
  const Xr: number[][] = []; // restricted predictors (y lags)
  const Xu: number[][] = []; // unrestricted (y lags + x lags)
  for (let t = start; t < n; t++) {
    Yr.push(dy[t]);
    const yl: number[] = [], xl: number[] = [];
    for (let l = 1; l <= lag; l++) { yl.push(dy[t - l]); xl.push(dx[t - l]); }
    Xr.push(yl);
    Xu.push([...yl, ...xl]);
  }
  const obs = Yr.length;
  if (obs < lag * 2 + 4) return { fStat: 0, causes: false, lag };
  const rssR = mlrRss(Xr, Yr);
  const rssU = mlrRss(Xu, Yr);
  const dfU = obs - (2 * lag + 1);
  const F = ((rssR - rssU) / lag) / (rssU / Math.max(1, dfU));
  // approximate 5% F critical for (lag, dfU) — conservative constants
  const crit = lag === 1 ? 3.9 : lag === 2 ? 3.07 : 2.68;
  return { fStat: Math.max(0, F), causes: F > crit, lag };
}

/* ───────────────────────── stationarity (ADF) ───────────────────────── */

export interface AdfResult {
  stat: number;
  stationary: boolean;
}

/** Augmented Dickey-Fuller (1 lag): regress Δy_t on y_{t-1} (+ intercept). */
export function adf(y: number[]): AdfResult {
  const dy = diff(y);
  const x: number[] = [], yy: number[] = [];
  for (let t = 1; t < dy.length; t++) { yy.push(dy[t]); x.push(y[t]); }
  if (yy.length < 6) return { stat: 0, stationary: false };
  const r = ols(x, yy);
  // 5% ADF critical value (with constant) ≈ -2.89
  return { stat: r.tStat, stationary: r.tStat < -2.89 };
}

/* ───────────────────────── ACF & rolling corr ───────────────────────── */

export function acf(y: number[], maxLag = 12): number[] {
  const m = mean(y);
  const denom = y.reduce((s, v) => s + (v - m) ** 2, 0) || 1;
  const out: number[] = [];
  for (let k = 1; k <= maxLag; k++) {
    let num = 0;
    for (let t = k; t < y.length; t++) num += (y[t] - m) * (y[t - k] - m);
    out.push(num / denom);
  }
  return out;
}

export function rollingCorr(a: number[], b: number[], window = 12): number[] {
  const out: number[] = [];
  for (let i = window; i <= a.length; i++) out.push(pearson(a.slice(i - window, i), b.slice(i - window, i)));
  return out;
}

export function histogram(values: number[], nbins = 13): { center: number; count: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const w = (max - min) / nbins || 1;
  const bins = Array.from({ length: nbins }, (_, i) => ({ center: min + w * (i + 0.5), count: 0 }));
  for (const v of values) bins[Math.min(nbins - 1, Math.max(0, Math.floor((v - min) / w)))].count++;
  return bins;
}

/** Intersect two dated series by date, returning aligned value arrays. */
export function alignPair(a: Obs[], b: Obs[]): { x: number[]; y: number[]; n: number } {
  const mb = new Map(b.map((o) => [o.date, o.value]));
  const x: number[] = [], y: number[] = [];
  for (const o of a) {
    const v = mb.get(o.date);
    if (v != null && o.value != null && isFinite(o.value) && isFinite(v)) { x.push(o.value); y.push(v); }
  }
  return { x, y, n: x.length };
}

/* ───────────────────────── full payload builder ───────────────────────── */

export interface StatsPayload {
  source: "DB" | "FRED" | "SNAPSHOT" | "SIM";
  labels: string[];
  corr: number[][];
  grangerF: number[][];
  grangerSig: boolean[][];
  links: { from: string; to: string; fStat: number }[];
  stationarity: { label: string; stat: number; stationary: boolean; n: number }[];
  descstats: { label: string; mean: number; sd: number; skew: number; kurtosis: number; acf1: number; n: number }[];
  lag: number;
  minN: number;
  maxN: number;
}

/**
 * Compute correlation, pairwise Granger causality, ADF stationarity and
 * descriptive moments. Each pair uses its own overlapping window (pairwise-
 * complete) so the analysis exploits each series' full available history.
 */
export function buildStatsPayload(series: { label: string; obs: Obs[] }[], source: "DB" | "FRED" | "SNAPSHOT" | "SIM", lag = 2): StatsPayload {
  const labels = series.map((s) => s.label);
  const k = labels.length;
  const corr: number[][] = [];
  const grangerF: number[][] = [];
  const grangerSig: boolean[][] = [];
  const links: { from: string; to: string; fStat: number }[] = [];
  for (let i = 0; i < k; i++) {
    corr[i] = []; grangerF[i] = []; grangerSig[i] = [];
    for (let j = 0; j < k; j++) {
      if (i === j) { corr[i][j] = 1; grangerF[i][j] = 0; grangerSig[i][j] = false; continue; }
      const al = alignPair(series[i].obs, series[j].obs);
      corr[i][j] = Number(pearson(al.x, al.y).toFixed(2));
      const g = granger(al.x, al.y, lag);
      grangerF[i][j] = Number(g.fStat.toFixed(2));
      grangerSig[i][j] = g.causes;
      if (g.causes) links.push({ from: labels[i], to: labels[j], fStat: Number(g.fStat.toFixed(2)) });
    }
  }
  links.sort((a, b) => b.fStat - a.fStat);
  const stationarity = series.map((s) => {
    const v = s.obs.map((o) => o.value);
    const t = adf(v);
    return { label: s.label, stat: Number(t.stat.toFixed(2)), stationary: t.stationary, n: v.length };
  });
  const descstats = series.map((s) => {
    const v = s.obs.map((o) => o.value);
    const m = moments(v);
    return { label: s.label, mean: Number(m.mean.toFixed(2)), sd: Number(m.sd.toFixed(2)), skew: Number(m.skew.toFixed(2)), kurtosis: Number(m.kurtosis.toFixed(2)), acf1: Number((acf(v, 1)[0] ?? 0).toFixed(2)), n: v.length };
  });
  const lens = series.map((s) => s.obs.length);
  return { source, labels, corr, grangerF, grangerSig, links, stationarity, descstats, lag, minN: Math.min(...lens), maxN: Math.max(...lens) };
}
