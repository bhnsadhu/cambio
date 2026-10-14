/**
 * Creates accounts for the group chat and fills their records through the same
 * RPCs real play uses (account_register, profile_record_round, friend_request).
 *
 *   node --env-file=.env.local scripts/seed-friends.mjs --plan   print the plan, touch nothing
 *   node --env-file=.env.local scripts/seed-friends.mjs          create whatever is missing
 *
 * A fixed random seed makes every run produce the same names and numbers. A
 * username that already exists is skipped and never modified, so reruns add
 * nothing twice. An account this script created but did not finish (no rounds
 * yet, same display name, same password) is resumed on the next run.
 */
import { createHash, randomBytes, scrypt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SEED = 228;
const PARENT = 'bhnsadhu';

/** Usernames already in use when the plan was designed. Live checks still run. */
const RESERVED = ['bhnsadhu', 'goku', 'prisha', 'vaanya', 'pavan', 'rhkannan', 'varunrk22', 'swaggysher', 'sahanan', 'samarthishot69'];
const BOT_NAMES = ['cameron', 'camila', 'cami', 'camille'];

/** Ceiling taken from the current top player, so nobody starts above them. */
const MAX_ROUNDS = 34;
const MAX_POINTS = 147;

const PEOPLE = [
  { first: 'Ayushi', last: 'Patel', nicks: ['ayu', 'ayushp'] },
  { first: 'Kaashish', last: 'Venkataramanan', nicks: ['kash', 'kaash'] },
  { first: 'Krishna', last: 'Charidwar', nicks: ['kc', 'krishu'] },
  { first: 'Pranav', last: 'Subramaniyan', nicks: ['pran', 'pv'] },
  { first: 'Ramya Sree', last: 'Paniyappa', short: 'Ramya', nicks: ['ramz', 'rs'] },
  { first: 'Rishi', last: 'Vemuri', nicks: ['rish', 'rv'] },
  { first: 'Ruhi', last: 'Kamdar', nicks: ['ruru', 'rukam'] },
  { first: 'Sanjay', last: 'Lakshmanan', nicks: ['sanj', 'sanju'] },
  { first: 'Serena', last: 'Malhan', nicks: ['rena', 'sm'] },
  { first: 'Yana', last: 'Kapoor', nicks: ['yanu', 'yk'] },
];
const JOKE_SUFFIXES = ['ftw', 'ongod', 'islit', 'theman', 'wins', 'nocap'];

/* ------------------------------ random ------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const make = (rand) => {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const weighted = (entries) => {
    let r = rand() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [value, w] of entries) if ((r -= w) < 0) return value;
    return entries[entries.length - 1][0];
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const poisson = (lambda) => {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do { k++; p *= rand(); } while (p > limit);
    return k - 1;
  };
  // Gamma by Marsaglia and Tsang, enough for a Beta draw.
  const gamma = (shape) => {
    if (shape < 1) return gamma(shape + 1) * Math.pow(rand(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x;
      let v;
      do { x = normal(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
  };
  const beta = (a, b) => { const x = gamma(a); return x / (x + gamma(b)); };
  return { pick, weighted, normal, poisson, beta };
};

/* ------------------------------- names ------------------------------ */

const clean = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const validUsername = (name) => /^[a-z0-9]{3,18}$/.test(name);
const validDisplay = (name) => name.length >= 1 && name.length <= 18 && !BOT_NAMES.includes(name.toLowerCase());

/** Mix measured from the real accounts: mostly plain first names, the rest varied. */
const USERNAME_STYLES = [['first', 30], ['firstInitial', 15], ['initialLast', 15], ['nick', 15], ['firstNumber', 15], ['joke', 10]];
const DISPLAY_STYLES = [['firstCap', 35], ['firstLower', 20], ['full', 15], ['nick', 15], ['firstInitial', 10], ['firstOnlyShort', 5]];

function usernameFor(person, style, r) {
  const first = clean((person.short ?? person.first).split(' ')[0]);
  const last = clean(person.last);
  switch (style) {
    case 'first': return first;
    case 'firstInitial': return first + last[0];
    case 'initialLast': return first[0] + last;
    case 'nick': return r.pick(person.nicks);
    case 'firstNumber': return first + r.pick(['7', '8', '9', '10', '11', '12', '21', '22', '23', '99']);
    case 'joke': return first + r.pick(JOKE_SUFFIXES);
    default: return '';
  }
}

function displayFor(person, style, r) {
  const first = (person.short ?? person.first).split(' ')[0];
  switch (style) {
    case 'firstCap': return first;
    case 'firstLower': return first.toLowerCase();
    case 'full': return `${first} ${person.last}`;
    case 'nick': { const n = r.pick(person.nicks); return r.pick([true, false]) ? cap(n) : n; }
    case 'firstInitial': return `${first} ${person.last[0]}`;
    case 'firstOnlyShort': return first.slice(0, Math.max(3, first.length - 2));
    default: return '';
  }
}

function chooseIdentity(person, r, taken, jokesUsed) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const style = r.weighted(USERNAME_STYLES);
    if (style === 'joke' && jokesUsed.count >= 1) continue;
    const username = usernameFor(person, style, r);
    if (!validUsername(username) || taken.has(username)) continue;
    // Prefer a display name that is not an obvious copy of the username.
    let display = '';
    for (let i = 0; i < 20; i++) {
      display = displayFor(person, r.weighted(DISPLAY_STYLES), r);
      if (validDisplay(display)) break;
      display = '';
    }
    if (!display) continue;
    if (style === 'joke') jokesUsed.count++;
    taken.add(username);
    return { username, display, style };
  }
  return null;
}

/* ------------------------------ records ----------------------------- */

/** Plays out one account's rounds in order, the way profile_record_round replays them. */
function chooseRecord(r) {
  for (let attempt = 0; attempt < 200; attempt++) {
    // Skewed low: a lognormal gives many short histories and a few long ones.
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Math.round(Math.exp(1.85 + 0.95 * r.normal()))));
    // Skill varies by player; the average is a quarter of a four seat table.
    const skill = r.beta(2.4, 7.2);
    const callRate = 0.075 * Math.exp(0.5 * r.normal());
    const stickRate = Math.min(4.2, Math.max(0.8, 1.9 * Math.exp(0.38 * r.normal())));
    const missRate = Math.min(1.2, 0.29 * Math.exp(0.5 * r.normal()));
    const lossAverage = Math.min(30, Math.max(3, 11 * Math.exp(0.6 * r.normal())));
    const tables = Math.max(1, Math.min(rounds, Math.round(rounds * Math.min(1, Math.max(0.1, r.beta(3, 3))))));
    const starts = new Set([0]);
    while (starts.size < tables) starts.add(Math.floor(r.beta(1, 1) * rounds));
    const rows = [];
    for (let i = 0; i < rounds; i++) {
      const called = (r.beta(1, 1) < callRate);
      const won = called ? r.beta(1, 1) < 0.7 : r.beta(1, 1) < skill;
      const score = won
        ? Math.round(Math.max(-1, Math.min(6, 1.5 + 2 * r.normal())))
        : Math.max(4, Math.round(lossAverage * (0.45 + r.beta(1, 1) * 1.1)));
      rows.push({
        won,
        score,
        sticks: Math.min(8, r.poisson(stickRate)),
        misses: Math.min(4, r.poisson(missRate)),
        called,
        first_round: starts.has(i),
        opponents: [],
      });
    }
    const stats = summarize(rows);
    if (stats.points > MAX_POINTS) continue;
    return { rows, stats };
  }
  throw new Error('Could not draw a record inside the real range.');
}

/** What the database columns will hold after the rounds are recorded. */
function summarize(rows) {
  let won = 0, tables = 0, scoreTotal = 0, best = null, calls = 0, callWins = 0, hit = 0, missed = 0, streak = 0, bestStreak = 0;
  for (const row of rows) {
    if (row.won) { won++; streak++; bestStreak = Math.max(bestStreak, streak); } else streak = 0;
    if (row.first_round) tables++;
    scoreTotal += row.score;
    best = best === null ? row.score : Math.min(best, row.score);
    if (row.called) { calls++; if (row.won) callWins++; }
    hit += row.sticks;
    missed += row.misses;
  }
  const played = rows.length;
  return {
    played, won, tables, scoreTotal, best, calls, callWins, hit, missed, streak, bestStreak,
    points: won * 12 + (played - won) * 3 + callWins * 5,
  };
}

function assertConsistent(s) {
  const ok = s.won <= s.played && s.tables >= 1 && s.tables <= s.played && s.callWins <= s.calls
    && s.calls <= s.played && s.bestStreak >= s.streak && s.bestStreak <= s.won
    && s.points <= MAX_POINTS && s.played <= MAX_ROUNDS;
  if (!ok) throw new Error(`Inconsistent record ${JSON.stringify(s)}`);
}

export function buildPlan(seed = SEED) {
  const r = make(mulberry32(seed));
  const taken = new Set(RESERVED);
  const jokesUsed = { count: 0 };
  const accounts = [];
  const unusable = [];
  for (const person of PEOPLE) {
    const identity = chooseIdentity(person, r, taken, jokesUsed);
    if (!identity) { unusable.push(`${person.first} ${person.last}`); continue; }
    const { rows, stats } = chooseRecord(r);
    assertConsistent(stats);
    // Most real accounts picked a head; a couple never did.
    const avatarId = r.beta(1, 1) < 0.8 ? Math.floor(r.beta(1, 1) * 36) : null;
    const password = clean(person.short ?? person.first.split(' ')[0]);
    accounts.push({ person, ...identity, password, avatarId, rows, stats });
  }
  return { accounts, unusable };
}

/* ------------------------------ database ---------------------------- */

const PARAMS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const derive = (password, saltHex) => new Promise((resolve, reject) => {
  scrypt(password, Buffer.from(saltHex, 'hex'), 64, PARAMS, (error, key) => (error ? reject(error) : resolve(key)));
});
/** Same format and parameters as src/lib/server/passwords.ts. */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
async function passwordMatches(password, encoded) {
  const parts = String(encoded).split('$');
  if (parts.length !== 6) return false;
  return (await derive(password, parts[4])).toString('hex') === parts[5];
}

function connect() {
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CAMBIO_SERVER_SECRET']) {
    if (!process.env[name]) throw new Error(`Missing environment variable ${name}`);
  }
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return async (fn, args) => {
    const { data, error } = await client.rpc(fn, { p_secret: process.env.CAMBIO_SERVER_SECRET, ...args });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
}

function print(plan) {
  console.log('username            display             style         rounds won  rate  pts  tables calls/stuck sticks/missed streak/best  avatar');
  for (const a of plan.accounts) {
    const s = a.stats;
    console.log([
      a.username.padEnd(19), a.display.padEnd(19), a.style.padEnd(13), String(s.played).padStart(6), String(s.won).padStart(3),
      `${Math.round((100 * s.won) / s.played)}%`.padStart(5), String(s.points).padStart(4), String(s.tables).padStart(6),
      `${s.calls}/${s.callWins}`.padStart(11), `${s.hit}/${s.missed}`.padStart(12), `${s.streak}/${s.bestStreak}`.padStart(11), String(a.avatarId ?? 'none').padStart(7),
    ].join(' '));
  }
  const played = plan.accounts.reduce((n, a) => n + a.stats.played, 0);
  const won = plan.accounts.reduce((n, a) => n + a.stats.won, 0);
  console.log(`\nTotals: ${plan.accounts.length} accounts, ${played} rounds, ${won} wins, ${Math.round((1000 * won) / played) / 10}% overall.`);
  if (plan.unusable.length) console.log(`No valid username could be made for: ${plan.unusable.join(', ')}`);
}

/** Safe to repeat: an existing friendship is left as it is. */
async function befriend(call, id, parentId) {
  await call('friend_request', { p_from: id, p_to: parentId });
  await call('friend_respond', { p_me: parentId, p_other: id, p_accept: true });
}

async function main() {
  const plan = buildPlan();
  print(plan);
  if (process.argv.includes('--plan')) return;
  const call = connect();
  const parent = await call('account_credentials', { p_username: PARENT });
  if (!parent) throw new Error(`Parent account ${PARENT} was not found.`);

  for (const a of plan.accounts) {
    const existing = await call('account_credentials', { p_username: a.username });
    let id;
    let sessionHash;
    let hash;
    if (existing) {
      // Resume only our own unfinished account; any other holder of the name is left alone.
      const profile = await call('profile_by_handle', { p_handle: a.username });
      const ours = profile && profile.display_name === a.display && (await passwordMatches(a.password, existing.password_hash));
      if (!ours) { console.log(`skip ${a.username}: already exists`); continue; }
      id = existing.profile_id;
      hash = existing.password_hash;
      if (profile.rounds_played > 0) {
        await befriend(call, id, parent.profile_id);
        console.log(`skip ${a.username}: already seeded`);
        continue;
      }
      console.log(`resume ${a.username}`);
    } else {
      const clash = await call('profile_by_handle', { p_handle: a.username });
      if (clash) { console.log(`skip ${a.username}: handle in use`); continue; }
      hash = await hashPassword(a.password);
      sessionHash = createHash('sha256').update(randomBytes(32)).digest('hex');
      const created = await call('account_register', {
        p_username: a.username, p_display_name: a.display, p_handle: a.username,
        p_password_hash: hash, p_session_hash: sessionHash,
      });
      id = created.profile.id;
      console.log(`created ${a.username}`);
      if (a.avatarId !== null) {
        await call('account_update', {
          p_session_hash: sessionHash, p_expected_hash: hash, p_display_name: null, p_username: null, p_avatar_id: a.avatarId,
        });
      }
    }
    // One call is one transaction, so the record lands whole or not at all.
    await call('profile_record_round', { p_rows: a.rows.map((row) => ({ ...row, profile_id: id })) });
    // Friendship with the parent account, requested by the new account and accepted by the parent.
    await befriend(call, id, parent.profile_id);
  }
  if (plan.unusable.length) console.log(`Skipped, no valid username: ${plan.unusable.join(', ')}`);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
