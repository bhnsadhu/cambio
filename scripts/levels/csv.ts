import { writeFileSync } from "node:fs";

export const round6 = (value: number) => Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;

export function writeCsv(path: string, header: string[], rows: (string | number | boolean | null)[][]) {
  const cell = (v: string | number | boolean | null) => {
    const text = typeof v === "number" ? String(round6(v)) : v === null ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  writeFileSync(path, [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n");
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, (_, v) => typeof v === "number" ? round6(v) : v, 2)}\n`);
}
