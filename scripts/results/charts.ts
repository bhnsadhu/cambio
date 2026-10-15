/**
 * Static SVG charts for the README and the experiment write up. Hand built,
 * so they need no dependency. GitHub shows an SVG as an image without its
 * page theme, so each chart carries its own light surface.
 */
import { writeFileSync } from "node:fs";
import type { CalibrationBin, MatchupSummary } from "./evaluate";

const C = {
  surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", ink3: "#8a8984", grid: "#e6e5e0",
  series1: "#2a78d6", series2: "#eb6834",
};
const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Row { label: string; sub: string; mean: number; low: number; high: number }

/** A dot and interval chart on a 0 to 100% axis with an even split reference. */
function intervalChart(title: string, subtitle: string, groups: { heading: string; rows: Row[] }[]): string {
  const width = 820, left = 250, right = 620, rowHeight = 46, top = 96;
  const x = (value: number) => left + (right - left) * value;
  let y = top;
  const body: string[] = [];
  for (const group of groups) {
    body.push(`<text x="24" y="${y + 4}" font-size="13" font-weight="600" fill="${C.ink2}">${esc(group.heading)}</text>`);
    y += 22;
    for (const row of group.rows) {
      const cy = y + rowHeight / 2 - 6;
      body.push(`<text x="24" y="${cy - 2}" font-size="14" fill="${C.ink}">${esc(row.label)}</text>`);
      body.push(`<text x="24" y="${cy + 15}" font-size="12" fill="${C.ink2}">${esc(row.sub)}</text>`);
      body.push(`<line x1="${x(row.low).toFixed(1)}" x2="${x(row.high).toFixed(1)}" y1="${cy}" y2="${cy}" stroke="${C.series1}" stroke-width="2" stroke-linecap="round"/>`);
      for (const end of [row.low, row.high]) body.push(`<line x1="${x(end).toFixed(1)}" x2="${x(end).toFixed(1)}" y1="${cy - 6}" y2="${cy + 6}" stroke="${C.series1}" stroke-width="2" stroke-linecap="round"/>`);
      body.push(`<circle cx="${x(row.mean).toFixed(1)}" cy="${cy}" r="5.5" fill="${C.series1}" stroke="${C.surface}" stroke-width="2"/>`);
      body.push(`<text x="${right + 18}" y="${cy + 5}" font-size="13" fill="${C.ink}">${pct(row.mean)} <tspan fill="${C.ink2}">(${pct(row.low)} to ${pct(row.high)})</tspan></text>`);
      y += rowHeight;
    }
    y += 10;
  }
  const height = y + 40;
  const axis: string[] = [];
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    axis.push(`<line x1="${x(tick)}" x2="${x(tick)}" y1="${top - 6}" y2="${y - 6}" stroke="${tick === 0.5 ? C.ink3 : C.grid}" stroke-width="1"${tick === 0.5 ? ' stroke-dasharray="4 4"' : ""}/>`);
    axis.push(`<text x="${x(tick)}" y="${y + 12}" font-size="12" fill="${C.ink2}" text-anchor="middle">${pct(tick, 0)}</text>`);
  }
  axis.push(`<text x="${x(0.5)}" y="${top - 12}" font-size="12" fill="${C.ink2}" text-anchor="middle">even split</text>`);
  return svg(width, height, title, subtitle, [...axis, ...body]);
}

function svg(width: number, height: number, title: string, subtitle: string, body: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d" ${FONT}>
<title id="t">${esc(title)}</title>
<desc id="d">${esc(subtitle)}</desc>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${C.surface}" stroke="${C.grid}"/>
<text x="24" y="34" font-size="18" font-weight="600" fill="${C.ink}">${esc(title)}</text>
<text x="24" y="56" font-size="13" fill="${C.ink2}">${esc(subtitle)}</text>
${body.join("\n")}
</svg>
`;
}

function winShareChart(matchups: MatchupSummary[]): string {
  const rows = (group: MatchupSummary["group"], sub: (m: MatchupSummary) => string) => matchups.filter((m) => m.group === group).map((m) => ({
    label: m.title, sub: sub(m), mean: m.shareA.mean, low: m.shareA.low, high: m.shareA.high,
  }));
  return intervalChart("Win share by matchup, with 95% intervals",
    `Two seats each, reversed seatings, ${matchups[0].rounds} rounds per matchup over two seed sets. Ties split the win.`, [
      { heading: "Levels", rows: rows("levels", (m) => m.note) },
      { heading: `Controls: four copies of one level, ${matchups.find((m) => m.group === "controls")?.rounds ?? 0} rounds each`, rows: rows("controls", (m) => m.note) },
    ]);
}

function ablationChart(matchups: MatchupSummary[]): string {
  const rows = matchups.filter((m) => m.group === "ablations").map((m) => ({
    label: m.title, sub: m.note, mean: m.shareA.mean, low: m.shareA.low, high: m.shareA.high,
  }));
  return intervalChart("Hard with one ability removed, against full hard",
    `Win share of the reduced bot, ${rows.length ? matchups.find((m) => m.group === "ablations")!.rounds : 0} rounds each. Below 50% means the ability adds strength.`, [
      { heading: "Ability removed", rows },
    ]);
}

function calibrationChart(bins: CalibrationBin[]): string {
  const width = 820, height = 560, left = 80, right = 560, top = 90, bottom = 480;
  const x = (value: number) => left + (right - left) * value;
  const y = (value: number) => bottom - (bottom - top) * value;
  const body: string[] = [];
  for (const tick of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    body.push(`<line x1="${x(0)}" x2="${x(1)}" y1="${y(tick)}" y2="${y(tick)}" stroke="${C.grid}"/>`);
    body.push(`<text x="${left - 10}" y="${y(tick) + 4}" font-size="12" fill="${C.ink2}" text-anchor="end">${pct(tick, 0)}</text>`);
    body.push(`<text x="${x(tick)}" y="${bottom + 20}" font-size="12" fill="${C.ink2}" text-anchor="middle">${pct(tick, 0)}</text>`);
  }
  body.push(`<text x="${(left + right) / 2}" y="${bottom + 44}" font-size="13" fill="${C.ink2}" text-anchor="middle">Win belief at the moment of calling</text>`);
  body.push(`<text x="22" y="${(top + bottom) / 2}" font-size="13" fill="${C.ink2}" text-anchor="middle" transform="rotate(-90 22 ${(top + bottom) / 2})">Calls that won</text>`);
  body.push(`<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="${C.ink3}" stroke-dasharray="4 4"/>`);
  const slope = Math.atan2(bottom - top, right - left) * 180 / Math.PI;
  body.push(`<text x="${x(0.3)}" y="${y(0.3) - 8}" font-size="12" fill="${C.ink2}" transform="rotate(${(-slope).toFixed(1)} ${x(0.3)} ${y(0.3) - 8})">belief matches outcome</text>`);
  body.push(`<line x1="${x(0.64)}" y1="${y(0)}" x2="${x(0.64)}" y2="${y(1)}" stroke="${C.ink3}" stroke-dasharray="2 4"/>`);
  body.push(`<text x="${x(0.64) - 6}" y="${y(1) + 14}" font-size="12" fill="${C.ink2}" text-anchor="end">gate threshold 64%</text>`);
  for (const [group, color, nudge] of [["no_gate", C.series2, 6], ["shipped", C.series1, -6]] as const) {
    for (const bin of bins.filter((b) => b.group === group && b.calls > 0)) {
      const cx = x(bin.meanBelief!) + nudge;
      body.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(bin.low!).toFixed(1)}" y2="${y(bin.high!).toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
      body.push(bin.tooSmall
        ? `<circle cx="${cx.toFixed(1)}" cy="${y(bin.rate!).toFixed(1)}" r="5" fill="${C.surface}" stroke="${color}" stroke-width="2"/>`
        : `<circle cx="${cx.toFixed(1)}" cy="${y(bin.rate!).toFixed(1)}" r="5.5" fill="${color}" stroke="${C.surface}" stroke-width="2"/>`);
    }
  }
  // Legend and the per bin counts, so identity is never color alone.
  const legendX = 590;
  body.push(`<circle cx="${legendX}" cy="104" r="5.5" fill="${C.series1}"/><text x="${legendX + 14}" y="108" font-size="13" fill="${C.ink}">Shipped bots, all levels</text>`);
  body.push(`<circle cx="${legendX}" cy="128" r="5.5" fill="${C.series2}"/><text x="${legendX + 14}" y="132" font-size="13" fill="${C.ink}">Hard with the gate removed</text>`);
  body.push(`<circle cx="${legendX}" cy="152" r="5" fill="${C.surface}" stroke="${C.ink2}" stroke-width="2"/><text x="${legendX + 14}" y="156" font-size="13" fill="${C.ink}">Fewer than 30 calls</text>`);
  body.push(`<text x="${legendX - 6}" y="192" font-size="12" font-weight="600" fill="${C.ink2}">Calls per belief bin</text>`);
  let row = 212;
  for (const group of ["shipped", "no_gate"] as const) {
    body.push(`<text x="${legendX - 6}" y="${row}" font-size="12" fill="${group === "shipped" ? C.series1 : C.series2}" font-weight="600">${group === "shipped" ? "Shipped bots" : "Gate removed"}</text>`);
    row += 18;
    for (const bin of bins.filter((b) => b.group === group && b.calls > 0)) {
      body.push(`<text x="${legendX - 6}" y="${row}" font-size="12" fill="${C.ink2}">${pct(bin.from, 0)} to ${pct(bin.to, 0)}: ${bin.wins} of ${bin.calls} won</text>`);
      row += 16;
    }
    row += 8;
  }
  return svg(width, height, "Do Cambio calls win as often as the bots believe?",
    "Calls by shipped bots and by hard with only the gate removed, grouped by the caller's win belief. 95% Wilson intervals.", body);
}

export function renderCharts(dir: string, matchups: MatchupSummary[], bins: CalibrationBin[]) {
  writeFileSync(`${dir}/win-share.svg`, winShareChart(matchups));
  writeFileSync(`${dir}/ablations.svg`, ablationChart(matchups));
  writeFileSync(`${dir}/calibration.svg`, calibrationChart(bins));
}
