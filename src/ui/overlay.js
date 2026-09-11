// Getting the coach on top of the game.
//
// A second monitor works and is what most people will use. For everybody else
// the problem is that a browser tab is behind League, and a page cannot ask an
// operating system to put it in front - which is the wall every web-based
// overlay hits.
//
// Except there is now one door in that wall, and it is a legitimate one:
// document picture-in-picture. It is the same mechanism a video call uses to
// float a caller over your other windows, it holds a real document rather than
// a video, and the browser itself keeps it above everything else. So the coach
// pops the map and the current instruction into that window, floats it in the
// corner of the game, and keeps updating it, because the elements moved there
// are the *same* elements - the same canvas, still being drawn to by the same
// loop. Nothing is duplicated and nothing needs syncing.
//
// League has to be in Borderless or Windowed for any overlay to be visible over
// it, this one included. Exclusive fullscreen is the game owning the screen, and
// nothing gets in front of that.

const WANTED = ['stage', 'call'];

export class Overlay {
  constructor(onChange) {
    this.onChange = onChange;
    this.window = null;
    this.home = new Map();
  }

  /** Whether this browser has the door. Chrome and Edge do; others do not yet. */
  get available() {
    return !!window.documentPictureInPicture;
  }

  get open() {
    return !!this.window && !this.window.closed;
  }

  async popOut(width = 420, height = 640) {
    if (!this.available) {
      return { ok: false, reason: 'This browser has no floating-window support. Open ?compact=1 in a small window instead.' };
    }
    if (this.open) {
      this.window.focus();
      return { ok: true };
    }

    try {
      this.window = await window.documentPictureInPicture.requestWindow({ width, height });
    } catch (err) {
      return { ok: false, reason: `Could not open the overlay: ${err.message}` };
    }

    copyStyles(this.window.document);
    this.window.document.body.classList.add('compact', 'overlay');

    /* Move, do not clone. The canvas that lands in the floating window is the
       one the render loop already holds a reference to. */
    for (const id of WANTED) {
      const node = document.getElementById(id);
      if (!node) continue;
      this.home.set(id, node.parentElement);
      this.window.document.body.append(node);
    }

    this.window.addEventListener('pagehide', () => this.reclaim());
    this.onChange?.(true);
    return { ok: true };
  }

  close() {
    if (this.open) this.window.close();
    this.reclaim();
  }

  /** Put the page back together when the floating window goes away. */
  reclaim() {
    for (const [id, parent] of this.home) {
      const node = this.window?.document.getElementById(id);
      if (node && parent) parent.append(node);
    }
    this.home.clear();
    this.window = null;
    this.onChange?.(false);
  }
}

/**
 * A picture-in-picture document starts blank - no stylesheets, not even the
 * ones the opener is using. Copy them across, both the linked ones and any
 * inline rules.
 */
function copyStyles(target) {
  for (const sheet of document.styleSheets) {
    try {
      const text = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      const style = target.createElement('style');
      style.textContent = text;
      target.head.append(style);
    } catch {
      /* A cross-origin sheet will not enumerate; link it instead. */
      if (sheet.href) {
        const link = target.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.head.append(link);
      }
    }
  }
  const own = target.createElement('style');
  own.textContent = `
    body { margin: 0; padding: 6px; background: #0a0e12; }
    body.overlay #stage { border: none; padding: 0; }
    body.overlay #call { margin-top: 6px; }
  `;
  target.head.append(own);
}
