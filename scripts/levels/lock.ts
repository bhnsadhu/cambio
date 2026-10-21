import { execSync } from "node:child_process";
import { mkdirSync, openSync, writeSync, closeSync, existsSync } from "node:fs";

/**
 * Takes the run lock for a script before it plays anything. The lock is
 * created exclusively, so a second run of the same script refuses to start;
 * it is committed with the results, so the refusal survives a fresh clone.
 */
export function takeLock(dir: string, script: string, seeds: string) {
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/run.lock`;
  if (existsSync(path)) {
    console.error(`${path} exists: ${script} has already run on ${seeds}. Each seed range is used once per script.`);
    process.exit(1);
  }
  const fd = openSync(path, "wx");
  const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  writeSync(fd, `${JSON.stringify({ script, seeds, commit, startedAt: new Date().toISOString() }, null, 2)}\n`);
  closeSync(fd);
}
