// Wiring.
//
// Four clocks, deliberately different speeds. The game is asked what is
// happening twice a second, because the scoreboard does not change faster than
// that and the endpoint is not free. The minimap is read about nine times a
// second, because a champion crossing a river takes about a second and missing
// it is the whole cost. The advice is recomputed a little slower than that, and
// the canvas redraws every frame so that the marker can pulse without any of
// the above happening sixty times a second.
//
// Everything below is glue. The decisions are in coach/, the seeing is in
// vision/, and the facts come from live/.

import { MinimapCapture } from './vision/capture.js';
import { findChampions } from './vision/detect.js';
import { ContactTracker } from './vision/tracker.js';
import { pollLive } from './live/feed.js';
import { coach } from './coach/engine.js';
import { resolveRole, ROLE_LANE } from './model/roles.js';
import { Recorder } from './live/recorder.js';
import { RiftMap } from './ui/map.js';
import { Hud } from './ui/hud.js';
import { Calibrator } from './ui/calibrate.js';
import { Overlay } from './ui/overlay.js';

const SETTINGS = 'riftcoach.settings';
const params = new URL(window.location.href).searchParams;
const DEMO = params.get('demo') === '1';
/* ?compact=1 strips everything but the map and the instruction, for a small
   window kept on top of the game rather than a second screen. */
if (params.get('compact') === '1') document.body.classList.add('compact');

const settings = load();
const capture = new MinimapCapture();
const tracker = new ContactTracker();
const map = new RiftMap(document.getElementById('map'));
const recorder = new Recorder((body) => fetch('/api/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then((res) => (res.ok ? res : Promise.reject(new Error(String(res.status))))));

let live = { connected: false, reason: 'Starting up' };
let polledAt = 0;
let view = null;

const hud = new Hud({
  onRole: (v) => save({ role: v }),
  onLine: (v) => save({ line: v }),
  onSensitivity: (v) => save({ sensitivity: v }),
  onFlip: (v) => { capture.setFlipped(v); save({ flipped: v }); },
  onVoice: (v) => save({ voice: v }),
  onCapture: () => startWatching(),
  onStopCapture: () => { capture.stop(); reportCapture(); },
  onCalibrate: () => calibrator.show(settings.sensitivity),
  onOverlay: async () => {
    const result = overlay.open ? (overlay.close(), { ok: true }) : await overlay.popOut();
    hud.overlayState(overlay.open, result.ok ? null : result.reason);
  },
});
const overlay = new Overlay((open) => {
  hud.overlayState(open, null);
  map.resize();
});
const calibrator = new Calibrator(capture, () => reportCapture());

hud.restore({ ...settings, flipped: capture.flipped });
reportCapture();

function load() {
  const base = { role: '', line: '', sensitivity: 0.5, voice: false };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') };
  } catch {
    return base;
  }
}

function save(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  } catch {
    /* Nothing to do about it, and nothing worth stopping for. */
  }
}

async function startWatching() {
  const started = await capture.start();
  reportCapture();
  /* First run: there is no saved rectangle worth trusting, so ask. */
  if (started) calibrator.show(settings.sensitivity);
}

function reportCapture() {
  hud.captureState({ active: capture.active, error: capture.error });
}

/** The game clock, ticking on between polls rather than jumping every half second. */
function gameTime() {
  if (!live.connected) return 0;
  return live.gameTime + (performance.now() - polledAt) / 1000;
}

/* ------------------------------------------------------------------ loops */

async function poll() {
  const next = await pollLive(DEMO ? '/api/live?demo=1' : '/api/live');
  if (next.connected && (!live.connected || next.gameTime < live.gameTime - 5)) {
    /* A new game, or the same one restarted: nothing remembered still applies. */
    tracker.forget();
  }
  live = next;
  polledAt = performance.now();
  if (live.connected) tracker.setTeam(live.team);
}

/** Read the minimap, or in demo mode, pretend to have read it. */
function look() {
  const now = gameTime();
  if (!live.connected) return;

  if (capture.active && !calibrator.open) {
    const image = capture.grab(160);
    if (!image) return;
    const seen = findChampions(image, (px, py, size) => capture.toMap(px, py, size), {
      sensitivity: settings.sensitivity,
    });
    tracker.update(now, seen);
    return;
  }

  if (live.demoVision) {
    const v = live.demoVision;
    tracker.update(now, {
      enemies: v.enemies.filter((e) => e.visible).map((e) => ({ ...e.pos })),
      allies: v.allies.map((a) => ({ ...a.pos })),
      self: v.self ? [{ ...v.self }] : [],
    });
  }
}

function think() {
  if (!live.connected) {
    view = null;
    hud.update(null, status(), recorder.counts);
    return;
  }
  const now = gameTime();
  const role = resolveRole(live.reportedRole, settings.role);
  view = coach({
    gameTime: now,
    team: live.team,
    role: settings.role,
    reportedRole: live.reportedRole,
    lineOverride: settings.line,
    self: { ...live.self, pos: tracker.self },
    allies: live.allies,
    enemies: live.enemies,
    events: live.events,
    contacts: tracker.contacts(now),
    allyContacts: tracker.allyContacts(now),
    junglerSightings: tracker.junglerSightings,
    push: tracker.push(ROLE_LANE[role]),
  });
  recorder.observe(view, live);
  hud.update(view, status(), live.demo ? null : recorder.counts);
}

function status() {
  return {
    link: live.connected
      ? (live.demo ? { state: 'demo', text: 'Demo game' } : { state: 'on', text: 'Live game' })
      : { state: 'off', text: live.reason ?? 'Not connected' },
    vision: capture.active
      ? { state: 'on', text: 'Reading minimap' }
      : live.demoVision
        ? { state: 'demo', text: 'Demo positions' }
        : { state: 'off', text: 'Minimap off' },
  };
}

function frame(now) {
  map.render(view, now);
  calibrator.draw();
  window.requestAnimationFrame(frame);
}

/* The map is square inside a panel that is not; watch the box, not the window. */
new window.ResizeObserver(() => map.resize()).observe(document.getElementById('stage'));

/* The last few seconds of a game are the ones with the death in them. */
window.addEventListener('pagehide', () => recorder.flush(Infinity, true));

hud.overlayState(false, overlay.available
  ? null
  : 'Floating window needs Chrome or Edge. On other browsers, open ?compact=1 in a small window.');

poll();
setInterval(poll, 500);
setInterval(look, 110);
setInterval(think, 150);
window.requestAnimationFrame(frame);
