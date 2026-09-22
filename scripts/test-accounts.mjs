/** Fully isolated integration run. Requires Docker and Playwright Chromium. */
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

const db = `cambio-e2e-db-${process.pid}`;
const rest = `cambio-e2e-rest-${process.pid}`;
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const query = (sql) => docker(['exec', '-i', db, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql);
const portFor = (name, port) => Number(docker(['port', name, `${port}/tcp`]).split(':').at(-1));
const freePort = async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
let server;
let testProcess;
let serverLog = '';
let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  testProcess?.kill('SIGTERM');
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), pause(5000)]);
  }
  for (const name of [rest, db]) { try { docker(['rm', '-f', '-v', name]); } catch { /* Already stopped or never started. */ } }
}
process.on('SIGINT', () => { void cleanup().finally(() => process.exit(130)); });
process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(143)); });
try {
  console.log('Starting an isolated Postgres database and PostgREST service.');
  docker(['run', '-d', '--name', db, '-e', 'POSTGRES_PASSWORD=cambio-local-test', '-p', '127.0.0.1::5432', 'postgres:17-alpine']);
  let databaseReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    // The image briefly starts a socket-only server during initialization.
    // TCP readiness waits for the final server, after that restart is over.
    try { docker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); databaseReady = true; break; } catch { await pause(200); }
  }
  if (!databaseReady) throw new Error('The isolated database did not start.');
  query('create role anon; create role authenticated; create publication supabase_realtime;');
  for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    if (file === '0005_usernames.sql') query(readFileSync('supabase/tests/username_migration_before.sql', 'utf8'));
    query(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    if (file === '0005_usernames.sql') query(readFileSync('supabase/tests/username_migration_after.sql', 'utf8'));
  }
  query("insert into private.server_config(key,value) values ('server_secret','account-test-secret'); grant select on public.game_views to anon;");
  query(readFileSync('supabase/tests/accounts.sql', 'utf8'));
  docker(['run', '-d', '--name', rest, '-e', `PGRST_DB_URI=postgres://postgres:cambio-local-test@host.docker.internal:${portFor(db, 5432)}/postgres`, '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-p', '127.0.0.1::3000', 'postgrest/postgrest:v13.0.7']);
  const appPort = await freePort();
  const proxyPort = await freePort();
  const env = { ...process.env, E2E_DB_CONTAINER: db, E2E_APP_PORT: String(appPort), E2E_PROXY_PORT: String(proxyPort), E2E_REST_ORIGIN: `http://127.0.0.1:${portFor(rest, 3000)}`, E2E_APP_ORIGIN: `http://localhost:${appPort}` };
  server = spawn(process.execPath, ['e2e/local-server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (data) => { serverLog += data; });
  server.stderr.on('data', (data) => { serverLog += data; });
  let appReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('The test app exited before becoming ready.');
    try { const response = await fetch(`${env.E2E_APP_ORIGIN}/api/account`); if (response.ok) { appReady = true; break; } } catch { /* Still starting. */ }
    await pause(300);
  }
  if (!appReady) throw new Error('The test app did not start.');
  testProcess = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--reporter=line'], { env, stdio: 'inherit' });
  const result = await new Promise((resolve) => testProcess.once('exit', resolve));
  if (result !== 0) throw new Error('Account browser tests failed.');
  console.log('Database and browser lifecycle checks passed.');
} catch (error) {
  console.error(error.message);
  if (serverLog) console.error(serverLog.slice(-8000));
  process.exitCode = 1;
} finally { await cleanup(); }
