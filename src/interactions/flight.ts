import type { View } from '../renderer/camera';

/**
 * Free flight. Keys (or the touch pad) hold movement intents; the engine
 * integrates them every frame. Moves are relative to where the camera faces
 * horizontally, so flying forward skims over the sea rather than diving.
 */

export type Intent = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

/** Horizontal speed near the ground (km/s); grows with altitude. */
const BASE_SPEED = 0.9;
const VERTICAL_SPEED = 0.6;
const BOOST = 3;

const held = new Set<Intent>();
let boost = false;

export function press(i: Intent) {
  held.add(i);
}

export function release(i: Intent) {
  held.delete(i);
}

export function setBoost(on: boolean) {
  boost = on;
}

export function releaseAll() {
  held.clear();
  boost = false;
}

export const isFlying = () => held.size > 0;

/** Speed factor: slow and precise near the clouds, quick high up. */
export function speedFactor(altitude: number): number {
  return Math.min(4, 0.6 + altitude / 3);
}

/** Advance a view by the held intents over `dtMs`. Returns null when nothing is held. */
export function stepFlight(view: View, dtMs: number, intents: ReadonlySet<Intent> = held, fast = boost): View | null {
  if (intents.size === 0) return null;
  const dt = Math.min(dtMs, 100) / 1000;
  const k = speedFactor(view.altitude) * (fast ? BOOST : 1);
  const f = (intents.has('forward') ? 1 : 0) - (intents.has('back') ? 1 : 0);
  const r = (intents.has('right') ? 1 : 0) - (intents.has('left') ? 1 : 0);
  const u = (intents.has('up') ? 1 : 0) - (intents.has('down') ? 1 : 0);
  const sy = Math.sin(view.yaw);
  const cy = Math.cos(view.yaw);
  // forward = (sin yaw, -cos yaw), right = (cos yaw, sin yaw) on the ground plane
  const step = BASE_SPEED * k * dt;
  return {
    ...view,
    x: view.x + (f * sy + r * cy) * step,
    z: view.z + (-f * cy + r * sy) * step,
    altitude: view.altitude + u * VERTICAL_SPEED * k * dt,
  };
}

/** Glide along the full view direction (scroll on empty sky). `amount` in km. */
export function glide(view: View, amount: number): View {
  const cp = Math.cos(view.pitch);
  return {
    ...view,
    x: view.x + Math.sin(view.yaw) * cp * amount,
    z: view.z - Math.cos(view.yaw) * cp * amount,
    altitude: view.altitude + Math.sin(view.pitch) * amount,
  };
}

export const KEY_INTENTS: Readonly<Record<string, Intent>> = {
  w: 'forward',
  arrowup: 'forward',
  s: 'back',
  arrowdown: 'back',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
  e: 'up',
  q: 'down',
};
