import type { Orientation, Point2 } from '../clouds/shape';

/**
 * The versioned scene document — everything needed to rebuild a sky exactly.
 * Cloud shapes are *not* stored: they are regenerated deterministically from
 * the stroke + seed, so a reload never changes a cloud.
 */

export const SCENE_VERSION = 1;
export const MAX_CLOUDS = 16;

export interface CloudDoc {
  readonly id: string;
  readonly seed: number;
  /** Stroke in shape space (km, centred on the cloud). */
  readonly stroke: readonly Point2[];
  readonly closed: boolean;
  /** Plane the stroke was drawn on (absent in older saves = vertical). */
  readonly orientation?: Orientation;
  /** World-space centre (km). */
  readonly position: readonly [number, number, number];
  readonly scale: number;
  readonly yaw: number;
  /** Monotonic creation order. */
  readonly order: number;
}

export interface SceneDoc {
  readonly version: typeof SCENE_VERSION;
  readonly hour: number;
  readonly clouds: readonly CloudDoc[];
}

export const emptyScene = (hour = 12.5): SceneDoc => ({ version: SCENE_VERSION, hour, clouds: [] });

export const SCALE_MIN = 0.35;
export const SCALE_MAX = 2.6;
export const DISTANCE_MIN = 3;
export const DISTANCE_MAX = 42;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseCloud(raw: unknown): CloudDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id.length === 0 || c.id.length > 64) return null;
  if (!isNum(c.seed) || !isNum(c.scale) || !isNum(c.yaw) || !isNum(c.order)) return null;
  if (typeof c.closed !== 'boolean') return null;
  if (c.orientation !== undefined && c.orientation !== 'vertical' && c.orientation !== 'horizontal') return null;
  if (!Array.isArray(c.position) || c.position.length !== 3 || !c.position.every(isNum)) return null;
  if (!Array.isArray(c.stroke) || c.stroke.length < 2 || c.stroke.length > 2000) return null;
  const stroke: Point2[] = [];
  for (const p of c.stroke) {
    if (!p || typeof p !== 'object' || !isNum((p as Point2).x) || !isNum((p as Point2).y)) return null;
    stroke.push({ x: (p as Point2).x, y: (p as Point2).y });
  }
  return {
    id: c.id,
    seed: c.seed >>> 0,
    stroke,
    closed: c.closed,
    ...(c.orientation === 'horizontal' ? { orientation: 'horizontal' as const } : {}),
    position: [c.position[0], c.position[1], c.position[2]] as const,
    scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, c.scale)),
    yaw: c.yaw,
    order: c.order,
  };
}

export type ParseResult = { ok: true; scene: SceneDoc; dropped: number } | { ok: false; error: string };

/** Validate untrusted JSON (localStorage, imported files). Invalid clouds are dropped, not fatal. */
export function parseScene(json: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'The file is not a Sky Study scene.' };
  const d = data as Record<string, unknown>;
  if (d.version !== SCENE_VERSION) return { ok: false, error: `Unsupported scene version (${String(d.version)}).` };
  if (!isNum(d.hour)) return { ok: false, error: 'The scene has no valid time of day.' };
  if (!Array.isArray(d.clouds)) return { ok: false, error: 'The scene has no cloud list.' };
  const clouds: CloudDoc[] = [];
  let dropped = 0;
  for (const raw of d.clouds) {
    const c = parseCloud(raw);
    if (c && clouds.length < MAX_CLOUDS && !clouds.some((o) => o.id === c.id)) clouds.push(c);
    else dropped++;
  }
  return { ok: true, scene: { version: SCENE_VERSION, hour: d.hour, clouds }, dropped };
}

export const serializeScene = (s: SceneDoc): string => JSON.stringify(s);
