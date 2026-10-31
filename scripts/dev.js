// Local dev server for testing on a phone: rebuilds the single HTML on every
// request and serves it on all interfaces. PORT or DEV3_PORT picks the port.

import { networkInterfaces } from 'node:os';
import { buildHtml } from './build.js';

const port = Number(process.env.PORT || process.env.DEV3_PORT || 5173);

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== '/' && pathname !== '/index.html') return new Response('Not found', { status: 404 });
    try {
      return new Response(await buildHtml(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    } catch (e) {
      return new Response(`Build failed:\n${e?.stack ?? e}`, { status: 500 });
    }
  },
});

const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log(`http://localhost:${port}/`);
for (const ip of lan) console.log(`http://${ip}:${port}/  (phone on the same Wi-Fi)`);
