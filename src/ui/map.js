// Drawing the Rift, and one place to stand on it.
//
// This is not a copy of the game's minimap and should not look like one. It is
// the same shape - the two diagonals, the river across them, six camps a side -
// drawn flat and dark so that the three things that change can be the only
// bright things on it: where they are, where the danger is, and where you
// should be. Everything else is furniture and is drawn to be ignored.
//
// Blue's base is in the bottom-left corner whichever team you are on, because
// that is where the game puts it and a coach that mirrors the map is a coach
// that gets somebody killed the first time they glance at it under pressure.

import {
  LANE_IDS, LANES, P, CAMPS, mirror, forTeam, turret, dist,
} from '../model/rift.js';

const COLOURS = {
  ground: '#0c1116',
  terrain: '#141c22',
  jungle: '#121b17',
  river: '#16303c',
  lane: '#2a333c',
  laneLine: '#39434e',
  blue: '#4a90d9',
  red: '#d9534a',
  camp: '#3d4a3f',
  ward: '#6ee7c8',
  marker: '#ffd166',
  self: '#ffffff',
  text: '#8a98a6',
};

/** Roughly how many seconds of walking one unit of map space is. */
const WALK_SECONDS = 14870 / 350;

export class RiftMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.pad = 0;
    this.resize();
  }

  /**
   * The Rift is square and the panel beside it is not, so the canvas is sized
   * in pixels here rather than left to CSS: `width: 100%` on a square canvas in
   * a rectangular box stretches the drawing, and a stretched map is a map that
   * points at the wrong bush.
   */
  resize() {
    const host = this.canvas.parentElement;
    const box = host.getBoundingClientRect();
    const style = window.getComputedStyle(host);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const side = Math.max(220, Math.min(box.width - padX, box.height - padY));
    this.canvas.style.width = `${side}px`;
    this.canvas.style.height = `${side}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(side * dpr);
    this.canvas.height = Math.round(side * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = side;
    this.pad = Math.round(side * 0.03);
  }

  /** Map space to canvas pixels. Map y runs up; canvas y runs down. */
  at(p) {
    const inner = this.size - this.pad * 2;
    return { x: this.pad + p.x * inner, y: this.pad + (1 - p.y) * inner };
  }

  /** A length in map space as a length in pixels. */
  len(d) { return d * (this.size - this.pad * 2); }

  render(view, now = 0) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    this.terrain();
    this.lanes(view);
    this.camps();
    this.pits();
    if (view) {
      this.threat(view);
      this.wards(view);
      this.jungler(view, now);
      this.contacts(view, now);
      this.self(view, now);
      this.marker(view, now);
    }
  }

  /* ------------------------------------------------------------- furniture */

  terrain() {
    const ctx = this.ctx;
    const s = this.size;
    ctx.fillStyle = COLOURS.ground;
    ctx.fillRect(0, 0, s, s);

    const a = this.at({ x: 0, y: 0 });
    const b = this.at({ x: 1, y: 1 });
    ctx.fillStyle = COLOURS.terrain;
    ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);

    /* The two jungle quadrants, a shade off the rest. */
    ctx.fillStyle = COLOURS.jungle;
    for (const corner of [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]]) {
      ctx.beginPath();
      corner.forEach((p, i) => {
        const q = this.at(p);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    /* The river, across the other diagonal. */
    ctx.strokeStyle = COLOURS.river;
    ctx.lineWidth = this.len(0.075);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const r1 = this.at({ x: 0.06, y: 0.94 });
    const r2 = this.at({ x: 0.94, y: 0.06 });
    ctx.moveTo(r1.x, r1.y);
    ctx.lineTo(r2.x, r2.y);
    ctx.stroke();
  }

  lanes(view) {
    const ctx = this.ctx;
    for (const lane of LANE_IDS) {
      const pts = LANES[lane].map((p) => this.at(p));
      ctx.strokeStyle = COLOURS.lane;
      ctx.lineWidth = this.len(0.042);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.strokeStyle = COLOURS.laneLine;
      ctx.lineWidth = Math.max(1, this.len(0.004));
      ctx.stroke();
    }

    const down = view?.timeline?.turrets;
    for (const team of ['ORDER', 'CHAOS']) {
      const lost = down?.[team] ?? { top: 0, mid: 0, bot: 0 };
      const colour = team === 'ORDER' ? COLOURS.blue : COLOURS.red;
      for (const lane of LANE_IDS) {
        [1, 2, 3].forEach((tier, i) => {
          const p = this.at(turret(lane, tier, team));
          const alive = i >= lost[lane];
          const r = this.len(0.011);
          ctx.fillStyle = alive ? colour : '#000';
          ctx.globalAlpha = alive ? 0.95 : 0.35;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          if (!alive) {
            ctx.strokeStyle = colour;
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x - r, p.y - r); ctx.lineTo(p.x + r, p.y + r);
            ctx.moveTo(p.x + r, p.y - r); ctx.lineTo(p.x - r, p.y + r);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        });
      }
      /* The nexus. */
      const n = this.at(forTeam(P.nexus, team));
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(n.x, n.y, this.len(0.022), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  camps() {
    const ctx = this.ctx;
    ctx.fillStyle = COLOURS.camp;
    for (const c of CAMPS) {
      for (const p of [c.pos, mirror(c.pos)]) {
        const q = this.at(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, this.len(0.008), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  pits() {
    const ctx = this.ctx;
    for (const [pos, label, colour] of [
      [P.baron, 'BARON', '#7a5cc4'],
      [P.drake, 'DRAKE', '#c47a5c'],
    ]) {
      const p = this.at(pos);
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, this.len(0.004));
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, this.len(0.042), this.len(0.030), Math.PI / 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = colour;
      ctx.font = `${Math.max(7, Math.round(this.size * 0.019))}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x, p.y - this.len(0.045));
      ctx.globalAlpha = 1;
    }
  }

  /* ----------------------------------------------------------- what moves */

  threat(view) {
    const ctx = this.ctx;
    for (const s of view.threat?.sources ?? []) {
      const p = this.at(s.pos);
      const r = this.len(s.radius + 0.13);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      const strength = 0.30 * s.weight;
      glow.addColorStop(0, `rgba(226, 74, 60, ${strength})`);
      glow.addColorStop(1, 'rgba(226, 74, 60, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  wards(view) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLOURS.ward;
    ctx.lineWidth = Math.max(1, this.len(0.003));
    for (const w of view.wards ?? []) {
      if (!w.target) continue;
      const p = this.at(w.target);
      const r = this.len(0.011);
      ctx.globalAlpha = w.depth === 'deep' ? 0.4 : 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  jungler(view, now) {
    const j = view.jungler;
    if (!j || j.confidence < 0.12) return;
    const ctx = this.ctx;
    const p = this.at(j.pos);
    ctx.save();
    ctx.setLineDash([this.len(0.012), this.len(0.010)]);
    ctx.lineDashOffset = -now / 60;
    ctx.strokeStyle = COLOURS.red;
    ctx.globalAlpha = 0.25 + j.confidence * 0.45;
    ctx.lineWidth = Math.max(1, this.len(0.004));
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.len(Math.max(0.04, j.radius)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COLOURS.red;
    ctx.globalAlpha = 0.7;
    ctx.font = `${Math.max(7, Math.round(this.size * 0.018))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('JG?', p.x, p.y + this.len(0.004));
    ctx.globalAlpha = 1;
  }

  contacts(view, now) {
    const ctx = this.ctx;
    const gameTime = view.gameTime ?? 0;
    for (const c of view.allyContacts ?? []) {
      const p = this.at(c.pos);
      ctx.fillStyle = COLOURS.blue;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.len(0.012), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const c of view.contacts ?? []) {
      const p = this.at(c.pos);
      const age = Math.max(0, gameTime - (c.lastSeen ?? gameTime));
      const r = this.len(0.014);
      if (c.visible) {
        ctx.fillStyle = COLOURS.red;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        /* Seen a while ago: hollow, fading, with the seconds written on it. */
        ctx.strokeStyle = COLOURS.red;
        ctx.globalAlpha = Math.max(0.15, 1 - age / 70);
        ctx.lineWidth = Math.max(1, this.len(0.004));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        if (age > 3) {
          ctx.fillStyle = COLOURS.red;
          ctx.font = `${Math.max(7, Math.round(this.size * 0.017))}px ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(age)}s`, p.x, p.y - r - this.len(0.008));
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  self(view, now) {
    const pos = view.self?.pos;
    if (!pos) return;
    const ctx = this.ctx;
    const p = this.at(pos);
    ctx.strokeStyle = COLOURS.self;
    ctx.lineWidth = Math.max(2, this.len(0.006));
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.len(0.017), 0, Math.PI * 2);
    ctx.stroke();
  }

  /** The one bright thing: go here. */
  marker(view, now) {
    const target = view.marker;
    if (!target) return;
    const ctx = this.ctx;
    const p = this.at(target);
    const pulse = (Math.sin(now / 380) + 1) / 2;

    const here = view.self?.pos ?? null;
    if (here) {
      const from = this.at(here);
      ctx.save();
      ctx.setLineDash([this.len(0.016), this.len(0.012)]);
      ctx.lineDashOffset = -now / 40;
      ctx.strokeStyle = COLOURS.marker;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(1.5, this.len(0.005));
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = COLOURS.marker;
    ctx.globalAlpha = 0.35 + pulse * 0.45;
    ctx.lineWidth = Math.max(2, this.len(0.006));
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.len(0.020 + pulse * 0.014), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOURS.marker;
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.len(0.009), 0, Math.PI * 2);
    ctx.fill();

    if (view.primary?.title) {
      const label = view.primary.title;
      ctx.font = `600 ${Math.max(9, Math.round(this.size * 0.023))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const width = ctx.measureText(label).width;
      const above = p.y > this.size * 0.16;
      const ly = above ? p.y - this.len(0.048) : p.y + this.len(0.062);
      ctx.fillStyle = 'rgba(10, 14, 18, 0.85)';
      ctx.fillRect(p.x - width / 2 - 6, ly - this.size * 0.022, width + 12, this.size * 0.030);
      ctx.fillStyle = COLOURS.marker;
      ctx.fillText(label, p.x, ly);
    }
  }
}

/** How far away the marker is, in words a player can act on. */
export function walkTime(from, to) {
  if (!from || !to) return null;
  const seconds = dist(from, to) * WALK_SECONDS;
  if (seconds < 2) return 'you are there';
  return `${Math.round(seconds)}s walk`;
}
