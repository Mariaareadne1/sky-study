import type { CloudDoc } from '../state/scene';
import { type CloudShape, bakeEnvelope, buildShape } from './shape';

/**
 * Cache of derived cloud geometry keyed by stroke identity + seed.
 * Shapes are pure functions of the document, so caching is safe.
 */
const shapeCache = new Map<string, CloudShape>();
const envelopeCache = new Map<string, Uint8Array>();

/** FNV-1a over the stroke coordinates + seed: identical strokes share geometry. */
export function shapeKey(c: Pick<CloudDoc, 'seed' | 'stroke' | 'closed'>): string {
  let h = 0x811c9dc5 ^ c.seed;
  const mix = (v: number) => {
    h ^= Math.round(v * 1e4) | 0;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of c.stroke) {
    mix(p.x);
    mix(p.y);
  }
  mix(c.closed ? 1 : 0);
  return `${c.seed.toString(36)}-${(h >>> 0).toString(36)}-${c.stroke.length}`;
}

export function shapeOf(c: CloudDoc): CloudShape {
  const key = shapeKey(c);
  let s = shapeCache.get(key);
  if (!s) {
    s = buildShape(c.stroke, c.closed, c.seed);
    shapeCache.set(key, s);
  }
  return s;
}

export function envelopeOf(c: CloudDoc): Uint8Array {
  const key = shapeKey(c);
  let e = envelopeCache.get(key);
  if (!e) {
    e = bakeEnvelope(shapeOf(c));
    envelopeCache.set(key, e);
    // keep memory bounded across long sessions
    if (envelopeCache.size > 48) envelopeCache.delete(envelopeCache.keys().next().value!);
  }
  return e;
}

export function pruneCaches(live: readonly CloudDoc[]) {
  const keep = new Set(live.map(shapeKey));
  for (const k of shapeCache.keys()) if (!keep.has(k)) shapeCache.delete(k);
  for (const k of envelopeCache.keys()) if (!keep.has(k)) envelopeCache.delete(k);
}
