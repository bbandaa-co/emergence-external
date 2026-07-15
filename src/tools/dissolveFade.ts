// Density "trail-off" for the abstract line tools (Fingerprint, Jagged,
// Contour, Map). Not a fade and not an erase — the linework stays fully solid
// but thins in COUNT toward the bottom: individual lines end at staggered
// depths so the field goes from dense/complex to sparse/minimal, the way roots
// are packed at the trunk and peter out toward the tips.
//
// Usage: build keep(lineId, x, y) with makeDissolve(); in a tool's draw loop
// pass a stable per-line id and only connect points where keep() is true,
// breaking the stroke where it's false. Whole lines drop out coherently (by a
// per-line "persistence" rank) rather than fragmenting into speckle.

function hash2(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 2654435761);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

export interface DissolveOptions {
  /** Fraction down the canvas where lines start dropping out (0 top … 1 bottom). */
  start?: number;
  /** Pressure at the very bottom (≥1 = fully bare; <1 leaves a few survivors). */
  end?: number;
  /** How much the per-line cutoff wobbles with position, so lines don't all end
   *  along a flat line. Fraction of the persistence range. */
  wobble?: number;
  /** Seed so the trail-off is stable for a given design. */
  seed?: number;
}

/**
 * Returns keep(lineId, x, y): whether a point of line `lineId` should still be
 * drawn. Each line gets a fixed "persistence" rank; as you descend, the
 * pressure rises, and once it passes a line's rank that line stops — so line
 * count thins with depth (dense → sparse) while surviving lines stay solid.
 * A little positional noise wobbles each cutoff so the ends stagger organically.
 * Resolution-independent, so preview and export match.
 */
export function makeDissolve(
  w: number,
  h: number,
  opts: DissolveOptions = {},
): (lineId: number, x: number, y: number) => boolean {
  const start = opts.start ?? 0.35;
  const end = opts.end ?? 1.1;
  const wobble = opts.wobble ?? 0.16;
  const seed = (opts.seed ?? 1) >>> 0;
  const scale = 4 / Math.max(w, h); // low-freq wobble, image-relative

  return (lineId: number, x: number, y: number) => {
    // Linear pressure across (almost) the whole height, so lines shed at an
    // even, gradual rate rather than dumping out through a steep middle band.
    const pressure = Math.min(1, Math.max(0, (y / h - start) / (end - start)));
    if (pressure <= 0) return true;
    const rank = hash2(lineId | 0, 0x51ed, seed); // per-line persistence 0..1
    const n = valueNoise(x * scale, y * scale, seed + 53); // 0..1 gentle wobble
    return rank + (n - 0.5) * wobble > pressure;
  };
}

/**
 * Stroke a flat [x, y, x, y, …] polyline, breaking it into separate strokes
 * wherever `keep(x, y)` is false. With keep = null it strokes the whole line.
 * Used to render the surviving runs of a thinned line.
 */
export function strokeRuns(
  ctx: CanvasRenderingContext2D,
  pts: number[] | Float64Array,
  keep: ((x: number, y: number) => boolean) | null,
) {
  if (pts.length < 4) return;
  if (!keep) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    return;
  }
  let started = false;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (keep(x, y)) {
      if (!started) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    } else if (started) {
      ctx.stroke();
      started = false;
    }
  }
  if (started) ctx.stroke();
}

/**
 * SVG counterpart of {@link strokeRuns}: returns a path `d` string with a fresh
 * `M` for each surviving run (a break wherever `keep` is false).
 */
export function svgRuns(
  pts: number[] | Float64Array,
  keep: ((x: number, y: number) => boolean) | null,
  f: (n: number) => number,
): string {
  if (!keep) {
    let d = "";
    for (let i = 0; i < pts.length; i += 2)
      d += `${i === 0 ? "M" : "L"}${f(pts[i])} ${f(pts[i + 1])}`;
    return d;
  }
  let d = "";
  let pen = false;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (keep(x, y)) {
      d += `${pen ? "L" : "M"}${f(x)} ${f(y)}`;
      pen = true;
    } else {
      pen = false;
    }
  }
  return d;
}
