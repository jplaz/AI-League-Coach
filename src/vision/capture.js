// Watching the minimap.
//
// The game will not tell anybody where the champions are - not yours, not
// theirs - and that is the correct decision on Riot's part. What it will do is
// draw them, in the bottom corner of your own screen, for you to look at. So
// that is what this reads: the pixels you are already looking at, through the
// browser's own screen-sharing prompt, which you have to click yourself and can
// revoke at any time. Nothing touches the game client or its memory.
//
// The player marks the minimap once with a drag; the rectangle is remembered.
// Everything after that is a crop, a downscale, and some arithmetic.

const STORE = 'riftcoach.capture';

/** A guess at where the minimap is: a square in the bottom-right corner. */
export function guessRegion(width, height) {
  const size = Math.round(height * 0.235);
  return {
    x: width - size - Math.round(height * 0.012),
    y: height - size - Math.round(height * 0.012),
    w: size,
    h: size,
  };
}

export class MinimapCapture {
  constructor() {
    this.stream = null;
    this.video = null;
    this.region = null;
    this.flipped = false;
    this.error = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.load();
  }

  get active() {
    return !!(this.stream && this.video && this.video.videoWidth > 0);
  }

  get frameSize() {
    return this.video ? { w: this.video.videoWidth, h: this.video.videoHeight } : null;
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      if (saved && saved.region) {
        this.region = saved.region;
        this.flipped = !!saved.flipped;
      }
    } catch {
      /* A corrupt setting is not worth a crash; the player can drag again. */
    }
  }

  save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ region: this.region, flipped: this.flipped }));
    } catch {
      /* Private browsing. The calibration lasts as long as the tab does. */
    }
  }

  /**
   * Ask for the screen. The browser shows its own picker; share the display
   * League is on rather than the browser window, or there will be nothing on it
   * but this page looking at itself.
   */
  async start() {
    this.error = null;
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 12, max: 15 } },
        audio: false,
      });
    } catch (err) {
      this.error = err.name === 'NotAllowedError'
        ? 'Screen sharing was declined'
        : `Screen capture failed: ${err.message}`;
      return false;
    }

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((done) => {
      if (this.video.videoWidth) { done(); return; }
      this.video.onloadedmetadata = () => done();
    });

    /* The player can stop the share from the browser's own bar; notice it. */
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.stop());
    }

    if (!this.region) {
      const { w, h } = this.frameSize;
      this.region = guessRegion(w, h);
      this.save();
    }
    return true;
  }

  stop() {
    for (const track of this.stream?.getVideoTracks() ?? []) track.stop();
    this.stream = null;
    this.video = null;
  }

  setRegion(region) {
    /* The minimap is square. Keeping the crop square keeps map space square. */
    const size = Math.max(40, Math.round((region.w + region.h) / 2));
    this.region = { x: Math.round(region.x), y: Math.round(region.y), w: size, h: size };
    this.save();
  }

  setFlipped(flipped) {
    this.flipped = !!flipped;
    this.save();
  }

  /** The whole screen, for the calibration picker to draw and be dragged on. */
  drawFrame(canvas) {
    if (!this.active) return false;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    return true;
  }

  /**
   * The minimap alone, square, at `size` pixels a side. Small on purpose: the
   * icons are still several pixels across at 160, and everything downstream
   * runs over every pixel of this several times a second.
   */
  grab(size = 160) {
    if (!this.active || !this.region) return null;
    const { x, y, w, h } = this.region;
    if (this.canvas.width !== size) { this.canvas.width = size; this.canvas.height = size; }
    this.ctx.drawImage(this.video, x, y, w, h, 0, 0, size, size);
    return this.ctx.getImageData(0, 0, size, size);
  }

  /**
   * Image space to map space. Image y runs down and map y runs up, and a player
   * with the minimap flipped is looking at the whole thing rotated.
   */
  toMap(px, py, size) {
    const p = { x: px / size, y: 1 - py / size };
    return this.flipped ? { x: 1 - p.x, y: 1 - p.y } : p;
  }
}
