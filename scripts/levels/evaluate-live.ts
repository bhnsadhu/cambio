/**
 * npm run ml:evaluate-live: once, on fresh seeds 520001 to 520200 and
 * 530001 to 530200, each level whose tuned mix is above 0 against its
 * frozen self (H10), and the identity matchups easy A* vs frozen medium and
 * medium A* vs frozen hard (H12), with the call and legality checks of H13.
 * Writes results-live/ and refuses to run twice.
 */
import { TUNED_ACTION_MIX } from "../../src/lib/game/bot-policies";
import { fmt, LEVELS, levelSide, tasksFor, type Matchup } from "./play";
import { wallTime } from "./pool";
import { takeLock } from "./lock";
import { writeCsv, writeJson } from "./csv";
import { callColumns, callRow, chooseSeedSets, matchupColumns, matchupRow, play, roundColumns, roundRow, summarize } from "./run";

const started = performance.now();
const OUT = "results-live";
takeLock(OUT, "npm run ml:evaluate-live", "seeds 520001 to 520200 and 530001 to 530200");

const live = LEVELS.filter((level) => TUNED_ACTION_MIX[level] > 0);
const matchups: Matchup[] = [
  ...live.map((level) => ({ id: `${level}_Astar_vs_${level}_C0`, a: levelSide(level, "A*"), b: levelSide(level, "C0") })),
  { id: "easy_Astar_vs_medium_C0", a: levelSide("easy", "A*"), b: levelSide("medium", "C0") },
  { id: "medium_Astar_vs_hard_C0", a: levelSide("medium", "A*"), b: levelSide("hard", "C0") },
];

const { sets, estimateSeconds, fallback } = await chooseSeedSets(matchups);
const tasks = tasksFor(matchups, sets);
const { rounds, calls } = await play(tasks);
const summaries = summarize(matchups, rounds, calls, sets);
const byId = Object.fromEntries(summaries.map((s) => [s.id, s]));

const h10 = {
  rule: "Refuted for a level whose mix is above 0 if the 95% interval of its win share against its frozen self lies entirely below 50%. Holds vacuously at a mix of 0.",
  levels: Object.fromEntries(LEVELS.map((level) => {
    const s = byId[`${level}_Astar_vs_${level}_C0`];
    return [level, s ? { mix: TUNED_ACTION_MIX[level], shareA: s.shareA, holds: s.shareA.high >= 0.5 } : { mix: 0, holds: true, vacuous: true }];
  })),
  holds: live.every((level) => byId[`${level}_Astar_vs_${level}_C0`].shareA.high >= 0.5),
};
const h12 = {
  rule: "Refuted if the 95% interval of easy A* vs frozen medium or medium A* vs frozen hard has an upper bound at or above 50%.",
  easy_vs_medium: byId.easy_Astar_vs_medium_C0.shareA, medium_vs_hard: byId.medium_Astar_vs_hard_C0.shareA,
  holds: byId.easy_Astar_vs_medium_C0.shareA.high < 0.5 && byId.medium_Astar_vs_hard_C0.shareA.high < 0.5,
};
const h13 = {
  roundsExpected: tasks.length, roundsFinished: rounds.length,
  botCalls: calls.length, callsRefusedByGate: calls.filter((c) => !c.passesGate).length,
  holds: rounds.length === tasks.length && calls.every((c) => c.passesGate),
};

writeCsv(`${OUT}/rounds.csv`, roundColumns, rounds.map(roundRow));
writeCsv(`${OUT}/calls.csv`, callColumns, calls.map(callRow));
writeCsv(`${OUT}/matchups.csv`, matchupColumns(sets), summaries.map((s) => matchupRow(s, sets)));
writeJson(`${OUT}/summary.json`, {
  question: "Is each level with learned actions at its tuned mix no worse than its frozen self, and does each level stay below the frozen level above it?",
  seeds: sets, fallback, estimateSeconds, roundsPerMatchup: sets.length * 400, mix: TUNED_ACTION_MIX,
  matchups: summaries, h10, h12, h13,
});
for (const s of summaries) console.log(`${s.id.padEnd(26)} ${fmt(s.shareA)}`);
console.log(JSON.stringify({ h10: h10.holds, h12: h12.holds, h13: h13.holds }));
wallTime("npm run ml:evaluate-live", started);
