// The page you read afterwards.
//
// Deliberately unflattering. The leak list is sorted by what it cost you rather
// than by what is comfortable to read, and the top of it is almost always the
// same line - the deaths you were warned about - because that is what separates
// players at every rank. One game of this is noise; the strip along the top is
// the same reading across every game recorded, which is where a habit shows up.

import { review, trend } from './coach/review.js';

const el = (id) => document.getElementById(id);
const pct = (n) => `${Math.round(n * 100)}%`;

const state = { reviews: [], selected: null };

async function load() {
  const list = await fetch('/api/games').then((r) => r.json()).catch(() => ({ games: [] }));
  const games = list.games ?? [];
  const full = await Promise.all(games.slice(0, 40).map((g) =>
    fetch(`/api/games/${encodeURIComponent(g.id)}`).then((r) => r.json()).catch(() => null)));

  state.reviews = full.filter(Boolean).map(review);
  renderTrend();
  renderList();
  if (state.reviews.length) select(state.reviews[0].id);
}

function renderTrend() {
  const t = trend(state.reviews);
  if (!t) return;
  const moving = t.moving > 2 ? `+${t.moving} better` : t.moving < -2 ? `${t.moving} worse` : 'flat';
  el('trend').innerHTML = [
    `${t.games} game${t.games > 1 ? 's' : ''}`,
    `${t.wins}W ${t.games - t.wins}L`,
    `grade ${t.grade}`,
    `trend ${moving}`,
    `${t.deathsPerTen.toFixed(1)} deaths / 10 min`,
    `${t.ignoredPerGame.toFixed(1)} ignored warnings / game`,
  ].map((s) => `<span class="chip">${s}</span>`).join('');
}

function renderList() {
  el('game-list').innerHTML = state.reviews.map((r) => `
    <li>
      <button type="button" data-id="${escape(r.id)}" class="${r.id === state.selected ? 'on' : ''}">
        <span class="g-champ">${escape(r.champion)}</span>
        <span class="g-meta">${escape(r.clock)} · ${escape(r.kda ?? '—')} · ${escape(r.result ?? 'unfinished')}</span>
        <span class="g-grade" data-label="${r.grade.label}">${r.grade.score}</span>
      </button>
    </li>`).join('');
  for (const b of el('game-list').querySelectorAll('button')) {
    b.addEventListener('click', () => select(b.dataset.id));
  }
}

function select(id) {
  state.selected = id;
  const r = state.reviews.find((x) => x.id === id);
  renderList();
  if (!r) return;
  el('report-empty').hidden = true;
  el('report-body').hidden = false;
  el('report-body').innerHTML = renderReport(r);
}

function renderReport(r) {
  const b = r.farm.bench;
  return `
    <div class="r-head">
      <div class="r-grade" data-label="${r.grade.label}">
        <div class="v">${r.grade.score}</div><div class="k">${r.grade.label}</div>
      </div>
      <div>
        <h2>${escape(r.champion)} &middot; ${escape(r.role.toLowerCase())} &middot; ${escape(r.clock)}</h2>
        <p class="r-sub">${escape(r.kda ?? '')} &middot; ${escape(r.result ?? 'unfinished')} &middot;
          ${r.counts.warnings} warnings, ${r.counts.ignoredWarnings} died to</p>
      </div>
    </div>

    <section class="block">
      <h3>What it cost you, worst first</h3>
      ${r.leaks.length === 0
        ? '<p class="empty">Nothing above the threshold. That is a clean game.</p>'
        : r.leaks.map((l, i) => `
          <div class="leak">
            <div class="leak-rank">${i + 1}</div>
            <div>
              <div class="leak-title">${escape(l.title)}</div>
              <div class="leak-detail">${escape(l.detail)}</div>
              <div class="leak-fix"><b>Next game:</b> ${escape(l.fix)}</div>
            </div>
          </div>`).join('')}
    </section>

    <section class="block">
      <h3>Every death</h3>
      ${r.deaths.length === 0 ? '<p class="empty">None. Nothing to read here.</p>' : `
        <table class="deaths">
          <tbody>${r.deaths.map((d) => `
            <tr data-warned="${d.warned ? 1 : 0}">
              <td class="d-clock">${escape(d.clock)}</td>
              <td>${escape(d.why)}</td>
              <td class="d-tag">${d.unaccounted} unseen${d.deep ? ' · their half' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
    </section>

    <section class="block">
      <h3>The numbers</h3>
      <div class="grid">
        ${cell('CS at 10', r.farm.cs10 ?? '—', r.farm.cs10 != null && r.farm.cs10 < b.cs10 - 8)}
        ${cell('CS at 20', r.farm.cs20 ?? '—', r.farm.cs20 != null && r.farm.cs20 < b.cs20 - 15)}
        ${cell('CS / min', r.farm.csPerMin ? r.farm.csPerMin.toFixed(1) : '—', false)}
        ${cell('Vision / min', r.vision.wardsPerMin.toFixed(1), r.vision.wardsPerMin < r.vision.bench * 0.6)}
        ${cell('In danger', pct(r.timeInDanger), r.timeInDanger > 0.22)}
        ${cell('Objectives missed', `${r.counts.objectivesAbsent}/${r.counts.objectivesLost}`, r.counts.objectivesAbsent > 1)}
      </div>
    </section>`;
}

function cell(label, value, bad) {
  return `<div class="cell" data-soon="${bad ? 1 : 0}">
    <div class="k">${label}</div><div class="v">${value}</div></div>`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

load();
