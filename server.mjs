#!/usr/bin/env node
// The little server that stands between the browser and League.
//
// It exists for one reason: the Live Client Data API is served over https with
// a certificate signed by Riot's own root, which no browser trusts and no page
// may therefore fetch. A page can, however, fetch this, and this can fetch
// that. Everything else here is a static file server, because the coach itself
// is plain ES modules with no build step.
//
//   node server.mjs            with League running
//   node server.mjs --demo     without it, replaying a scripted game
//
// Nothing is sent anywhere. The only outbound request this process makes is to
// 127.0.0.1, and there is no second one.

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoPayload } from './tools/demo-game.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const PORT = Number(
  args.find((a) => a.startsWith('--port='))?.slice(7) ?? process.env.PORT ?? 8777,
);
/** Where the scripted game starts, so demo mode opens on something happening. */
const DEMO_START = Number(args.find((a) => a.startsWith('--from='))?.slice(7) ?? 150);
const startedAt = Date.now();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Ask League what is happening.
 *
 * `rejectUnauthorized` is off deliberately and narrowly: the endpoint is on the
 * loopback interface of this machine, and its certificate is Riot's own
 * self-signed one which is not in any trust store. There is no network in
 * between to be a man in the middle of.
 */
function askLeague() {
  return new Promise((done) => {
    const req = httpsRequest({
      host: '127.0.0.1',
      port: 2999,
      path: '/liveclientdata/allgamedata',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 1500,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          done({ connected: false, reason: `League replied ${res.statusCode}` });
          return;
        }
        try {
          done({ connected: true, data: JSON.parse(body) });
        } catch {
          done({ connected: false, reason: 'League replied with something that is not a game' });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); });
    req.on('error', (err) => done({
      connected: false,
      reason: err.code === 'ECONNREFUSED'
        ? 'No game in progress'
        : `Cannot reach the game (${err.code ?? err.message})`,
    }));
    req.end();
  });
}

/** The scripted game, at whatever second of it we have reached. */
function demoState(url) {
  const forced = url.searchParams.get('t');
  const t = forced != null
    ? Number(forced)
    : DEMO_START + (Date.now() - startedAt) / 1000;
  const { payload, vision } = demoPayload(t);
  return { connected: true, demo: true, data: payload, vision };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/live') {
    const body = DEMO || url.searchParams.get('demo') === '1'
      ? demoState(url)
      : await askLeague();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(JSON.stringify(body));
    return;
  }

  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const target = join(ROOT, normalize(path));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Coach -> http://localhost:${PORT}/`);
  console.log(DEMO
    ? `Demo mode: replaying a scripted game from ${Math.floor(DEMO_START / 60)}:${String(DEMO_START % 60).padStart(2, '0')}.`
    : 'Watching for a live game on 127.0.0.1:2999. Start a game and it will connect itself.');
});
