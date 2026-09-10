// Telling the coach where to look.
//
// Once, with a drag. The awkward part is that the browser hands over a picture
// of a whole screen and has no idea which corner of it is a minimap, and the
// answer differs with resolution, with the in-game minimap size slider, and
// with whether the player has moved their HUD around. Rather than guess and be
// quietly wrong all game, this shows exactly what the coach can see, with a
// circle drawn on every champion it thinks it has found. If the circles land on
// the champions, the calibration is right, and the player can see that it is
// right without taking anybody's word for it.

import { findChampions } from '../vision/detect.js';
import { guessRegion } from '../vision/capture.js';

export class Calibrator {
  constructor(capture, onSaved) {
    this.capture = capture;
    this.onSaved = onSaved;
    this.open = false;
    this.region = null;
    this.drag = null;
    this.sensitivity = 0.5;

    this.root = document.getElementById('calibrator');
    this.screen = document.getElementById('cal-screen');
    this.preview = document.getElementById('cal-preview');

    this.screen.addEventListener('pointerdown', (e) => this.startDrag(e));
    this.screen.addEventListener('pointermove', (e) => this.moveDrag(e));
    window.addEventListener('pointerup', () => this.endDrag());

    document.getElementById('cal-guess').addEventListener('click', () => {
      const size = this.capture.frameSize;
      if (size) this.region = guessRegion(size.w, size.h);
    });
    document.getElementById('cal-save').addEventListener('click', () => {
      if (this.region) this.capture.setRegion(this.region);
      this.close();
      this.onSaved?.();
    });
    document.getElementById('cal-cancel').addEventListener('click', () => this.close());
  }

  show(sensitivity) {
    if (!this.capture.active) return;
    this.sensitivity = sensitivity;
    this.region = this.capture.region
      ? { ...this.capture.region }
      : guessRegion(this.capture.frameSize.w, this.capture.frameSize.h);
    this.open = true;
    this.root.hidden = false;
    this.fit();
  }

  close() {
    this.open = false;
    this.root.hidden = true;
  }

  /** Size the working canvas to the shared screen's aspect. */
  fit() {
    const size = this.capture.frameSize;
    if (!size) return;
    const width = Math.min(this.screen.clientWidth || 800, 1000);
    this.screen.width = Math.round(width);
    this.screen.height = Math.round(width * size.h / size.w);
    this.scale = size.w / this.screen.width;
  }

  /** Canvas pixels to shared-screen pixels. */
  toFrame(e) {
    const rect = this.screen.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.screen.width / rect.width) * this.scale;
    const y = (e.clientY - rect.top) * (this.screen.height / rect.height) * this.scale;
    return { x, y };
  }

  startDrag(e) {
    if (!this.open) return;
    this.drag = this.toFrame(e);
    this.screen.setPointerCapture?.(e.pointerId);
  }

  moveDrag(e) {
    if (!this.drag) return;
    const now = this.toFrame(e);
    const w = Math.abs(now.x - this.drag.x);
    const h = Math.abs(now.y - this.drag.y);
    const side = Math.max(w, h);
    this.region = {
      x: Math.round(Math.min(this.drag.x, now.x)),
      y: Math.round(Math.min(this.drag.y, now.y)),
      w: Math.round(side),
      h: Math.round(side),
    };
  }

  endDrag() { this.drag = null; }

  /** Called every frame while open: the screen, the box, and what is detected. */
  draw() {
    if (!this.open || !this.capture.active) return;
    if (!this.screen.width) this.fit();
    this.capture.drawFrame(this.screen);

    const ctx = this.screen.getContext('2d');
    if (this.region) {
      const x = this.region.x / this.scale;
      const y = this.region.y / this.scale;
      const w = this.region.w / this.scale;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, w);
      ctx.fillStyle = 'rgba(255, 209, 102, 0.08)';
      ctx.fillRect(x, y, w, w);
    }

    /* The crop as the detector sees it, with its findings circled. */
    const saved = this.capture.region;
    this.capture.region = this.region;
    const image = this.capture.grab(160);
    this.capture.region = saved;
    if (!image) return;

    const pctx = this.preview.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, 240, 240);
    const tmp = document.createElement('canvas');
    tmp.width = 160; tmp.height = 160;
    tmp.getContext('2d').putImageData(image, 0, 0);
    pctx.drawImage(tmp, 0, 0, 240, 240);

    const seen = findChampions(image, (px, py, size) => ({ x: px / size, y: py / size }),
      { sensitivity: this.sensitivity });
    const ring = (list, colour) => {
      pctx.strokeStyle = colour;
      pctx.lineWidth = 2;
      for (const c of list) {
        pctx.beginPath();
        pctx.arc(c.x * 240, c.y * 240, 9, 0, Math.PI * 2);
        pctx.stroke();
      }
    };
    ring(seen.enemies, '#e2604a');
    ring(seen.allies, '#4a90d9');
    ring(seen.self, '#ffffff');
  }
}
