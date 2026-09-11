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
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoPayload } from './tools/demo-game.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const DEMO = args.includes('--demo');
const PORT = Number(
  args.find((a) => a.startsWith('--port='))?.slice(7) ?? process.env.PORT ?? 8777,
);
/** Recorded games live here, next to the code, and go nowhere else. */
const GAMES = resolve(ROOT, 'games');

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

/** A game id that cannot climb out of the games directory. */
const safeId = (id) => String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120);

/** Read a JSON request body, with a ceiling so a bad client cannot fill memory. */
function readBody(req, limit = 2_000_000) {
  return new Promise((done, fail) => {
    let size = 0;
    let text = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error('Body too large'));
        req.destroy();
        return;
      }
      text += chunk;
    });
    req.on('end', () => {
      try {
        done(JSON.parse(text || '{}'));
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
}

/**
 * Append moments to a recorded game.
 *
 * Read, concatenate, write. There is exactly one writer - the page you have
 * open - so nothing more careful than that is needed, and a game file that
 * loses its last five seconds to a crash has lost nothing that matters.
 */
async function appendGame(body) {
  const id = safeId(body.id);
  if (!id) throw new Error('A game needs an id');
  await mkdir(GAMES, { recursive: true });
  const file = join(GAMES, `${id}.json`);
  let game = { id, moments: [] };
  try {
    game = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* First write of this game. */
  }
  const { moments = [], ...meta } = body;
  const merged = {
    ...game, ...meta, id,
    moments: [...(game.moments ?? []), ...moments],
  };
  await writeFile(file, JSON.stringify(merged, null, 1));
  return { ok: true, id, moments: merged.moments.length };
}

/** Every recorded game, newest first, without their moment lists. */
async function listGames() {
  let names = [];
  try {
    names = (await readdir(GAMES)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const games = [];
  for (const name of names) {
    try {
      const game = JSON.parse(await readFile(join(GAMES, name), 'utf8'));
      const { moments = [], ...meta } = game;
      games.push({ ...meta, moments: moments.length });
    } catch {
      /* A half-written file is not worth failing the whole list over. */
    }
  }
  return games.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (body, code = 200) => res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }).end(JSON.stringify(body));

  if (url.pathname === '/api/log' && req.method === 'POST') {
    try {
      json(await appendGame(await readBody(req)));
    } catch (err) {
      json({ ok: false, reason: err.message }, 400);
    }
    return;
  }

  if (url.pathname === '/api/games') {
    json({ games: await listGames() });
    return;
  }

  if (url.pathname.startsWith('/api/games/')) {
    const id = safeId(url.pathname.slice('/api/games/'.length));
    try {
      json(JSON.parse(await readFile(join(GAMES, `${id}.json`), 'utf8')));
    } catch {
      json({ reason: 'No such game' }, 404);
    }
    return;
  }

  if (url.pathname === '/api/live') {
    json(DEMO || url.searchParams.get('demo') === '1' ? demoState(url) : await askLeague());
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
