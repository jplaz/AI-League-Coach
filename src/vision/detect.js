// Finding champions in a hundred and sixty pixels square.
//
// A minimap icon is a small round portrait inside a coloured ring, and the ring
// is the only part worth looking at: the portrait is a different colour for
// every champion and every skin, but the ring is red if they are the enemy,
// blue if they are yours, and white if it is you. So this classifies every
// pixel into one of those three, joins the ones that touch, and calls each
// blob of a plausible size a champion.
//
// It is deliberately simple. There is no model to load, no champion is
// identified by name, and the whole pass is a few hundred microseconds, which
// matters more than cleverness would: advice about where somebody was a second
// ago is not advice.

/** RGB 0-255 to hue 0-360, saturation 0-1, value 0-1. */
function hsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
}

/**
 * Which team a pixel's colour belongs to, if any.
 *
 * `sensitivity` widens every threshold at once, which is the only knob worth
 * giving a player: monitors, colourblind mode and the game's own HDR settings
 * all shift these colours a little, and one slider they can watch the overlay
 * respond to beats six they would have to understand.
 */
export function classify(r, g, b, sensitivity = 0.5) {
  const { h, s, v } = hsv(r, g, b);
  const give = (sensitivity - 0.5) * 0.35;

  if (v > 0.30 && s > 0.42 - give && (h >= 340 || h <= 16)) return 1;        // enemy red
  if (v > 0.32 && s > 0.30 - give && h >= 175 && h <= 235) return 2;         // ally blue
  if (v > 0.82 + give * 0.3 && s < 0.16 + give) return 3;                    // you, in white
  return 0;
}

/**
 * Every champion icon in the frame, as map-space points.
 *
 * `toMap` converts a pixel to map space, which the capture owns because only it
 * knows whether the player has the minimap flipped.
 */
export function findChampions(image, toMap, options = {}) {
  const { sensitivity = 0.5, minArea = 6, maxArea = 260 } = options;
  const { width: w, height: h, data } = image;
  const mask = new Uint8Array(w * h);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    mask[p] = classify(data[i], data[i + 1], data[i + 2], sensitivity);
  }

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found = { enemies: [], allies: [], self: [] };
  const bucket = [null, found.enemies, found.allies, found.self];

  for (let start = 0; start < mask.length; start++) {
    const kind = mask[start];
    if (!kind || seen[start]) continue;

    /* Flood fill, iteratively - a recursive one blows the stack on a bad
       frame where half the screen is red because somebody used a smite. */
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;

    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p - x) / w;
      n++; sx += x; sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && !seen[p - 1] && mask[p - 1] === kind) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && mask[p + 1] === kind) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && !seen[p - w] && mask[p - w] === kind) { seen[p - w] = 1; stack[top++] = p - w; }
      if (y < h - 1 && !seen[p + w] && mask[p + w] === kind) { seen[p + w] = 1; stack[top++] = p + w; }
    }

    if (n < minArea || n > maxArea) continue;
    /* An icon is round. A long thin run of red is a health bar, a ping ring, or
       the edge of the fog, and none of those are a champion. */
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw > bh * 2.6 || bh > bw * 2.6) continue;

    bucket[kind].push({ ...toMap(sx / n, sy / n, w), area: n, size: Math.max(bw, bh) });
  }

  /* An icon's ring can break into two arcs where a health bar crosses it.
     Anything this close together is one champion seen twice. */
  return {
    enemies: merge(found.enemies),
    allies: merge(found.allies),
    self: merge(found.self),
  };
}

function merge(points, within = 0.028) {
  const out = [];
  for (const p of points) {
    const near = out.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < within);
    if (near) {
      const total = near.area + p.area;
      near.x = (near.x * near.area + p.x * p.area) / total;
      near.y = (near.y * near.area + p.y * p.area) / total;
      near.area = total;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}
