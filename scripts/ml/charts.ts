/** The learned policy charts, in the same hand built style as scripts/results/charts.ts. */
import { writeFileSync } from "node:fs";
import { C, intervalChart, pct, svg } from "../results/charts";
import type { Interval } from "../results/stats";

interface Summary { id: string; group: string; config: string; sideA: string; sideB: string; rounds: number; shareA: Interval }
interface Bin { group: "model" | "gate"; from: number; to: number; calls: number; wins: number; meanStated: number | null; rate: number | null; low: number | null; high: number | null; tooSmall: boolean }

const CONFIG_NAMES: Record<string, string> = { C: "learned calls", A: "learned actions", CA: "learned calls and actions" };

function winShareChart(summaries: Summary[]): string {
  const row = (s: Summary) => ({ label: `${s.sideA} vs ${s.sideB}`, sub: `share won by ${s.sideA}, ${s.rounds} rounds`, mean: s.shareA.mean, low: s.shareA.low, high: s.shareA.high });
  return intervalChart("Learned policies on the test seeds, with 95% intervals",
    "C is learned calls, A learned actions, CA both. Seatings reversed, two test seed sets, ties split the win.", [
      ...["C", "A", "CA"].map((config) => ({ heading: `Configuration ${config}: ${CONFIG_NAMES[config]}`, rows: summaries.filter((s) => s.config === config).map(row) })),
      { heading: "Frozen reference", rows: summaries.filter((s) => s.config === "frozen").map(row) },
    ]);
}

function calibrationChart(bins: Bin[]): string {
  const width = 820, height = 560, left = 80, right = 560, top = 90, bottom = 480;
  const x = (value: number) => left + (right - left) * value;
  const y = (value: number) => bottom - (bottom - top) * value;
  const body: string[] = [];
  for (const tick of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    body.push(`<line x1="${x(0)}" x2="${x(1)}" y1="${y(tick)}" y2="${y(tick)}" stroke="${C.grid}"/>`);
    body.push(`<text x="${left - 10}" y="${y(tick) + 4}" font-size="12" fill="${C.ink2}" text-anchor="end">${pct(tick, 0)}</text>`);
    body.push(`<text x="${x(tick)}" y="${bottom + 20}" font-size="12" fill="${C.ink2}" text-anchor="middle">${pct(tick, 0)}</text>`);
  }
  body.push(`<text x="${(left + right) / 2}" y="${bottom + 44}" font-size="13" fill="${C.ink2}" text-anchor="middle">Stated chance of winning at the moment of calling</text>`);
  body.push(`<text x="22" y="${(top + bottom) / 2}" font-size="13" fill="${C.ink2}" text-anchor="middle" transform="rotate(-90 22 ${(top + bottom) / 2})">Calls that won</text>`);
  body.push(`<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="${C.ink3}" stroke-dasharray="4 4"/>`);
  const slope = Math.atan2(bottom - top, right - left) * 180 / Math.PI;
  body.push(`<text x="${x(0.3)}" y="${y(0.3) - 8}" font-size="12" fill="${C.ink2}" transform="rotate(${(-slope).toFixed(1)} ${x(0.3)} ${y(0.3) - 8})">stated chance matches outcome</text>`);
  for (const [group, color, nudge] of [["gate", C.series2, 6], ["model", C.series1, -6]] as const) {
    for (const bin of bins.filter((b) => b.group === group && b.calls > 0)) {
      const cx = x(bin.meanStated!) + nudge;
      body.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(bin.low!).toFixed(1)}" y2="${y(bin.high!).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
      body.push(bin.tooSmall
        ? `<circle cx="${cx.toFixed(1)}" cy="${y(bin.rate!).toFixed(1)}" r="5" fill="${C.surface}" stroke="${color}" stroke-width="2"/>`
        : `<circle cx="${cx.toFixed(1)}" cy="${y(bin.rate!).toFixed(1)}" r="5.5" fill="${color}" stroke="${C.surface}" stroke-width="2"/>`);
    }
  }
  const legendX = 590;
  body.push(`<circle cx="${legendX}" cy="104" r="5.5" fill="${C.series1}"/><text x="${legendX + 14}" y="108" font-size="13" fill="${C.ink}">Call model, learned seats</text>`);
  body.push(`<circle cx="${legendX}" cy="128" r="5.5" fill="${C.series2}"/><text x="${legendX + 14}" y="132" font-size="13" fill="${C.ink}">Gate belief, frozen seats</text>`);
  body.push(`<circle cx="${legendX}" cy="152" r="5" fill="${C.surface}" stroke="${C.ink2}" stroke-width="2"/><text x="${legendX + 14}" y="156" font-size="13" fill="${C.ink}">Fewer than 30 calls</text>`);
  body.push(`<text x="${legendX - 6}" y="192" font-size="12" font-weight="600" fill="${C.ink2}">Calls per probability bin</text>`);
  let row = 212;
  for (const group of ["model", "gate"] as const) {
    body.push(`<text x="${legendX - 6}" y="${row}" font-size="12" fill="${group === "model" ? C.series1 : C.series2}" font-weight="600">${group === "model" ? "Call model" : "Gate belief"}</text>`);
    row += 18;
    for (const bin of bins.filter((b) => b.group === group && b.calls > 0)) {
      body.push(`<text x="${legendX - 6}" y="${row}" font-size="12" fill="${C.ink2}">${pct(bin.from, 0)} to ${pct(bin.to, 0)}: ${bin.wins} of ${bin.calls} won</text>`);
      row += 16;
    }
    row += 8;
  }
  return svg(width, Math.max(height, row + 10), "Call model next to the gate, on the test seeds",
    "Every call in the test run, grouped by the probability the caller stated. 95% Wilson intervals.", body);
}

export function renderLearnedCharts(dir: string, summaries: Summary[], bins: Bin[]) {
  writeFileSync(`${dir}/learned-win-share.svg`, winShareChart(summaries));
  writeFileSync(`${dir}/learned-calibration.svg`, calibrationChart(bins));
}
