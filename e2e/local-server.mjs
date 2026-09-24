import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const restOrigin = process.env.E2E_REST_ORIGIN ?? 'http://127.0.0.1:55434';
const proxyPort = Number(process.env.E2E_PROXY_PORT ?? 55433);
const appPort = Number(process.env.E2E_APP_PORT ?? 3100);
const proxy = createServer(async (req, res) => {
  try {
    // Supabase's client prefixes /rest/v1. The test service is vanilla
    // PostgREST. Anonymous test requests need no production API key.
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = { 'content-type': req.headers['content-type'] ?? 'application/json' };
    const response = await fetch(`${restOrigin}${req.url.replace(/^\/rest\/v1/, '')}`, {
      method: req.method, headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'access-control-allow-origin': '*' });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(502); res.end('{}'); }
});
proxy.on('upgrade', (_req, socket) => socket.destroy());
await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', ...(process.env.E2E_WEBPACK ? ['--webpack'] : []), '--port', String(appPort)], {
  stdio: 'inherit', env: { ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${proxyPort}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-anon-key',
    CAMBIO_SERVER_SECRET: 'account-test-secret',
  },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { next.kill(signal); proxy.close(); });
next.on('exit', (code) => { proxy.close(); process.exitCode = code ?? 0; });
