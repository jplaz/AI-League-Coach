// The words next to the map.
//
// The map says where. This says what and why, and it is written on the
// assumption that the player is reading it in the half second between a wave
// dying and the next one arriving. So: one instruction, large, at the top; the
// runners-up beneath it in case the first one is wrong; and then the numbers
// that do not change fast enough to need reading every glance.

import { clock } from '../coach/rules.js';
import { walkTime } from './map.js';
import { ROLE_NAMES } from '../model/roles.js';

const el = (id) => document.getElementById(id);

const TIMERS = [
  { key: 'drake', label: 'Drake' },
  { key: 'baron', label: 'Baron' },
  { key: 'herald', label: 'Herald' },
  { key: 'grubs', label: 'Grubs' },
  { key: 'atakhan', label: 'Atakhan' },
  { key: 'plates', label: 'Plates' },
];

export class Hud {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.spokenAt = 0;
    this.spoken = null;
    this.nodes = {
      link: el('chip-link'), vision: el('chip-vision'),
      clock: el('chip-clock'), phase: el('chip-phase'),
      call: el('call'), kicker: el('call-kicker'), title: el('call-title'),
      detail: el('call-detail'), walk: el('call-walk'),
      queue: el('queue'), timers: el('timers'), enemies: el('enemies'),
      note: el('vision-note'),
    };
    this.bind();
  }

  bind() {
    const h = this.handlers;
    el('role').addEventListener('change', (e) => h.onRole?.(e.target.value));
    el('line').addEventListener('change', (e) => h.onLine?.(e.target.value));
    el('sensitivity').addEventListener('input', (e) => h.onSensitivity?.(Number(e.target.value)));
    el('flip').addEventListener('change', (e) => h.onFlip?.(e.target.checked));
    el('voice').addEventListener('change', (e) => { this.voice = e.target.checked; });
    el('capture-start').addEventListener('click', () => h.onCapture?.());
    el('capture-stop').addEventListener('click', () => h.onStopCapture?.());
    el('capture-calibrate').addEventListener('click', () => h.onCalibrate?.());
  }

  /** Put saved settings back on the controls after a reload. */
  restore(settings) {
    el('role').value = settings.role ?? '';
    el('line').value = settings.line ?? '';
    el('sensitivity').value = settings.sensitivity ?? 0.5;
    el('flip').checked = !!settings.flipped;
    el('voice').checked = !!settings.voice;
    this.voice = !!settings.voice;
  }

  captureState({ active, error }) {
    el('capture-start').disabled = active;
    el('capture-stop').disabled = !active;
    el('capture-calibrate').disabled = !active;
    if (error) this.nodes.note.textContent = error;
  }

  update(view, status) {
    this.chips(view, status);
    if (!view) return;
    this.call(view);
    this.queue(view);
    this.timers(view);
    this.enemies(view);
  }

  chips(view, status) {
    const n = this.nodes;
    n.link.textContent = status.link.text;
    n.link.dataset.state = status.link.state;
    n.vision.textContent = status.vision.text;
    n.vision.dataset.state = status.vision.state;
    n.clock.textContent = view ? clock(view.gameTime) : '--:--';
    n.phase.textContent = view
      ? `${ROLE_NAMES[view.role] ?? view.role} · ${view.phase}`
      : '—';
  }

  call(view) {
    const n = this.nodes;
    const d = view.primary;
    if (!d) return;
    n.call.dataset.kind = d.kind;
    n.kicker.textContent = kickerFor(d, view);
    n.title.textContent = d.title;
    n.detail.textContent = d.detail;
    const walk = walkTime(view.self?.pos, view.marker);
    n.walk.textContent = walk ? `Marker: ${walk}` : '';
    this.say(d);
  }

  /** Speak the ones worth interrupting for, and only once each. */
  say(d) {
    if (!this.voice || !window.speechSynthesis) return;
    if (d.score < 60 || d.id === this.spoken) return;
    const now = Date.now();
    if (now - this.spokenAt < 6000) return;
    this.spoken = d.id;
    this.spokenAt = now;
    const utter = new window.SpeechSynthesisUtterance(d.title);
    utter.rate = 1.15;
    utter.volume = 0.85;
    window.speechSynthesis.speak(utter);
  }

  queue(view) {
    const rest = [...view.directives, ...view.wards]
      .filter((d) => d !== view.primary)
      .slice(0, 4);
    this.nodes.queue.innerHTML = rest.map((d) => `
      <li>
        <span class="score">${d.score}</span>
        <span class="what">${escape(d.title)}<span class="why">${escape(d.detail)}</span></span>
      </li>`).join('');
  }

  timers(view) {
    const t = view.timeline;
    this.nodes.timers.innerHTML = TIMERS.map(({ key, label }) => {
      const o = t[key];
      let value = '—';
      let soon = 0;
      let up = 0;
      if (key === 'plates') {
        value = o.standing ? clock(o.in) : 'gone';
        soon = o.standing && o.in < 120 ? 1 : 0;
      } else if (!o || o.at == null) {
        value = key === 'drake' && t.drake?.soulTeam ? 'soul' : '—';
      } else if (o.in <= 0) {
        value = 'up';
        up = 1;
      } else {
        value = clock(o.in);
        soon = o.in < 45 ? 1 : 0;
      }
      return `<div class="cell" data-soon="${soon}" data-up="${up}">
        <div class="k">${label}</div><div class="v">${value}</div></div>`;
    }).join('') + `
      <div class="cell"><div class="k">Wave</div><div class="v">${clock(Math.max(0, view.wave.arrivesIn))}</div></div>
      <div class="cell"><div class="k">Drakes</div><div class="v">${view.timeline.drake?.stacks?.ORDER ?? 0}-${view.timeline.drake?.stacks?.CHAOS ?? 0}</div></div>
      <div class="cell" data-soon="${view.threat.unaccounted >= 3 ? 1 : 0}">
        <div class="k">Unseen</div><div class="v">${view.threat.unaccounted}/5</div></div>`;
  }

  enemies(view) {
    this.nodes.enemies.innerHTML = view.enemies.map((e) => {
      const dead = e.isDead ? 1 : 0;
      const state = e.isDead ? `back in ${clock(e.respawnIn)}` : `lvl ${e.level}`;
      return `<div class="foe" data-dead="${dead}">
        <span class="name">${escape(e.champion)}</span>
        <span class="state">${state}</span></div>`;
    }).join('');
  }
}

/** The line above the instruction: why this one and not another. */
function kickerFor(d, view) {
  if (d.kind === 'danger') return 'Get out';
  if (d.kind === 'fight') return 'Fight';
  if (d.kind === 'objective') return 'Objective';
  if (d.kind === 'vision') return 'Vision';
  if (d.kind === 'jungle') return 'Jungle route';
  if (d.kind === 'macro') return 'Map';
  return `${ROLE_NAMES[view.role] ?? ''} · lane`.trim();
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
