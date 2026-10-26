import { computeAtmosphere, type Atmosphere } from '../atmosphere/timeOfDay';
import { envelopeOf, pruneCaches, shapeKey, shapeOf } from '../clouds/cloudModel';
import { type Vec3, add, clamp } from '../math/vec';
import { type Camera, createCamera, project, rayDirection } from '../renderer/camera';
import { type Quality, type RenderCloud, Renderer } from '../renderer/Renderer';
import type { CloudDoc } from '../state/scene';
import { type QualityMode, useSky } from '../state/store';

export const FORM_DURATION_MS = 3400;
const HOUR_TWEEN_MS = 1700;
const DRIFT_AMPLITUDE_KM = 0.05;
/** Render scales the auto mode steps through (fraction of device pixels). */
const AUTO_SCALES = [0.72, 0.62, 0.54, 0.46, 0.4, 0.34, 0.28] as const;
const FIXED: Record<Exclude<QualityMode, 'auto'>, { quality: Quality; scale: number }> = {
  high: { quality: 'high', scale: 0.72 },
  balanced: { quality: 'balanced', scale: 0.5 },
  reduced: { quality: 'reduced', scale: 0.36 },
};

export const easeOutQuad = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface FrameInfo {
  readonly now: number;
  readonly frameMs: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly accumulated: number;
  readonly displayHour: number;
}

type FrameListener = (info: FrameInfo) => void;

/** Smooth, bounded wander so finished clouds feel alive without going anywhere. */
export function driftOffset(c: Pick<CloudDoc, 'seed'>, tSeconds: number): Vec3 {
  const ph = (c.seed % 1000) / 159.155;
  const w = (Math.PI * 2) / 95;
  return [
    Math.sin(tSeconds * w + ph) * DRIFT_AMPLITUDE_KM,
    Math.sin(tSeconds * w * 0.63 + ph * 1.7) * DRIFT_AMPLITUDE_KM * 0.25,
    0,
  ];
}

export class Engine {
  readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private raf = 0;
  private running = false;
  private listeners = new Set<FrameListener>();
  private afterRender = new Set<(canvas: HTMLCanvasElement) => void>();
  private resizeObserver: ResizeObserver;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private lastFrame = 0;
  private frameEma = 16.7;
  private slowSince = 0;
  private fastSince = 0;
  private autoIndex = 2;
  private signature = '';
  private hourFrom = 12.5;
  private hourTo = 12.5;
  private hourStart = 0;
  private displayHour = 12.5;
  private atmosphere: Atmosphere;
  private atmosphereHour = NaN;
  private readonly startTime = performance.now();
  /** When set, `render` uses this hour instead of the tween (capture/showcase). */
  freezeTime: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, 'balanced');
    const hour = useSky.getState().scene.hour;
    this.hourFrom = this.hourTo = this.displayHour = hour;
    this.atmosphere = computeAtmosphere(hour);
    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(canvas);
    this.syncSize();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) useSky.getState().setDrift(false);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.tick(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.listeners.clear();
    this.afterRender.clear();
    this.renderer.dispose();
  }

  onFrame(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onAfterRender(fn: (canvas: HTMLCanvasElement) => void): () => void {
    this.afterRender.add(fn);
    return () => this.afterRender.delete(fn);
  }

  private syncSize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(1, this.canvas.clientWidth);
    this.cssH = Math.max(1, this.canvas.clientHeight);
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  get size() {
    return { width: this.cssW, height: this.cssH, dpr: this.dpr };
  }

  get camera(): Camera {
    return createCamera(this.cssW / this.cssH);
  }

  get drift(): boolean {
    return useSky.getState().drift;
  }

  get hour(): number {
    return this.displayHour;
  }

  get currentAtmosphere(): Atmosphere {
    return this.atmosphere;
  }

  /** Ray direction for a CSS-pixel position relative to the canvas. */
  rayAt(x: number, y: number): { origin: Vec3; dir: Vec3 } {
    const cam = this.camera;
    return { origin: cam.position, dir: rayDirection(cam, (x / this.cssW) * 2 - 1, 1 - (y / this.cssH) * 2) };
  }

  /** World → CSS pixels. */
  toScreen(p: Vec3): { x: number; y: number; depth: number } | null {
    const pr = project(this.camera, p);
    if (!pr) return null;
    return { x: (pr.x * 0.5 + 0.5) * this.cssW, y: (0.5 - pr.y * 0.5) * this.cssH, depth: pr.depth };
  }

  /** Render-time centre of a cloud, including drift. */
  renderPosition(c: CloudDoc, now = performance.now()): Vec3 {
    if (!this.drift) return c.position;
    return add(c.position, driftOffset(c, (now - this.startTime) / 1000));
  }

  /** Screen-space bounds of the visible cloud (CSS px), from its lobes. */
  screenRect(c: CloudDoc, now = performance.now()): ScreenRect | null {
    const shape = shapeOf(c);
    const p = this.renderPosition(c, now);
    const cam = this.camera;
    const th = Math.tan(cam.fovY / 2);
    const yawC = Math.cos(c.yaw), yawS = Math.sin(c.yaw);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of shape.lobes) {
      const lx = l.x * c.scale, lz = l.z * c.scale;
      const center: Vec3 = [p[0] + yawC * lx + yawS * lz, p[1] + l.y * c.scale, p[2] - yawS * lx + yawC * lz];
      const s = this.toScreen(center);
      if (!s) return null;
      const r = l.r * c.scale * 0.8;
      const rpx = (r / (s.depth * th)) * (this.cssH / 2);
      const bottom = p[1] + shape.baseY * c.scale;
      const below = center[1] - r < bottom ? this.toScreen([center[0], bottom, center[2]]) : null;
      minX = Math.min(minX, s.x - rpx); maxX = Math.max(maxX, s.x + rpx);
      minY = Math.min(minY, s.y - rpx); maxY = Math.max(maxY, below ? Math.min(s.y + rpx, below.y) : s.y + rpx);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  growthOf(id: string, now: number): number {
    const t0 = useSky.getState().formedAt[id];
    if (t0 === undefined) return 1;
    return easeOutQuad((now - t0) / FORM_DURATION_MS);
  }

  private updateHour(now: number) {
    const target = this.freezeTime ?? useSky.getState().scene.hour;
    if (this.freezeTime !== null) {
      this.displayHour = this.hourFrom = this.hourTo = target;
    } else if (target !== this.hourTo) {
      this.hourFrom = this.displayHour;
      this.hourTo = target;
      this.hourStart = now;
    }
    if (this.displayHour !== this.hourTo) {
      const span = Math.abs(this.hourTo - this.hourFrom);
      const dur = HOUR_TWEEN_MS * clamp(0.55 + span / 10, 0.6, 1.25);
      const t = clamp((now - this.hourStart) / dur, 0, 1);
      this.displayHour = this.hourFrom + (this.hourTo - this.hourFrom) * easeInOutCubic(t);
      if (t >= 1) this.displayHour = this.hourTo;
    }
    if (this.displayHour !== this.atmosphereHour) {
      this.atmosphere = computeAtmosphere(this.displayHour);
      this.atmosphereHour = this.displayHour;
    }
  }

  private applyQuality(frameMs: number, now: number) {
    const mode = useSky.getState().quality;
    if (mode !== 'auto') {
      const f = FIXED[mode];
      this.renderer.quality = f.quality;
      this.renderer.renderScale = f.scale;
      return;
    }
    // Adapt only on sustained trends; ignore single hitches.
    this.frameEma = this.frameEma * 0.92 + Math.min(frameMs, 100) * 0.08;
    if (this.frameEma > 26) {
      this.fastSince = 0;
      if (!this.slowSince) this.slowSince = now;
      if (now - this.slowSince > 1200 && this.autoIndex < AUTO_SCALES.length - 1) {
        this.autoIndex++;
        this.slowSince = now;
      }
    } else if (this.frameEma < 18.5) {
      this.slowSince = 0;
      if (!this.fastSince) this.fastSince = now;
      if (now - this.fastSince > 4000 && this.autoIndex > 0) {
        this.autoIndex--;
        this.fastSince = now;
      }
    } else {
      this.slowSince = this.fastSince = 0;
    }
    const scale = AUTO_SCALES[this.autoIndex];
    this.renderer.renderScale = scale;
    this.renderer.quality = scale >= 0.6 ? 'high' : scale >= 0.4 ? 'balanced' : 'reduced';
  }

  buildRenderClouds(now: number, withDrift = this.drift): RenderCloud[] {
    const { scene } = useSky.getState();
    return [...scene.clouds]
      .sort((a, b) => a.order - b.order)
      .map((c) => {
        const shape = shapeOf(c);
        return {
          id: c.id,
          shapeKey: shapeKey(c),
          envelope: () => envelopeOf(c),
          position: withDrift ? this.renderPosition(c, now) : c.position,
          scale: c.scale,
          yaw: c.yaw,
          half: shape.half,
          growth: this.growthOf(c.id, now),
          seed: c.seed,
          density: 1,
        };
      });
  }

  private tick(now: number) {
    const frameMs = this.lastFrame ? now - this.lastFrame : 16.7;
    this.lastFrame = now;
    this.syncSize();
    this.updateHour(now);
    this.applyQuality(frameMs, now);
    const clouds = this.buildRenderClouds(now);
    // Anything except the slow drift invalidates the accumulated image.
    const sig = [
      this.canvas.width, this.canvas.height, this.renderer.renderScale, this.renderer.quality, this.displayHour.toFixed(5),
      ...clouds.map((c) => `${c.id}:${c.shapeKey}:${useSky.getState().scene.clouds.find((d) => d.id === c.id)?.position.join(',')}:${c.scale}:${c.yaw}:${c.growth.toFixed(4)}`),
    ].join('|');
    const changed = sig !== this.signature;
    this.signature = sig;
    const stats = this.renderer.render({ clouds, atmosphere: this.atmosphere, changed, time: now / 1000 }, 0.06);
    this.frames++;
    for (const fn of this.afterRender) fn(this.canvas);
    const info: FrameInfo = {
      now,
      frameMs,
      renderWidth: stats.renderWidth,
      renderHeight: stats.renderHeight,
      accumulated: stats.accumulated,
      displayHour: this.displayHour,
    };
    for (const fn of this.listeners) fn(info);
    if (Math.random() < 0.01) pruneCaches(useSky.getState().scene.clouds);
  }

  /** Frames rendered since start (for tests and diagnostics). */
  frames = 0;

  /**
   * Small rendered sample of the live scene for automated checks: returns mean
   * linear-ish sRGB per channel over a normalised region, plus the max value.
   */
  sample(region: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: 1, y1: 1 }, w = 192, h = 120) {
    const px = this.capture(w, h, 6);
    let r = 0, g = 0, b = 0, n = 0, max = 0, nonFinite = 0;
    const lum: [number, number][] = [];
    for (let y = Math.floor(region.y0 * h); y < Math.ceil(region.y1 * h); y++) {
      for (let x = Math.floor(region.x0 * w); x < Math.ceil(region.x1 * w); x++) {
        const i = (y * w + x) * 4;
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        max = Math.max(max, px[i], px[i + 1], px[i + 2]);
        if (!Number.isFinite(px[i])) nonFinite++;
        lum.push([0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2], i]);
      }
    }
    // warmth (r/b) of the brightest 10% — the lit highlights
    lum.sort((a, c) => c[0] - a[0]);
    const top = lum.slice(0, Math.max(1, Math.floor(lum.length / 10)));
    let hr = 0, hb = 0;
    for (const [, i] of top) { hr += px[i]; hb += px[i + 2]; }
    return { r: r / n, g: g / n, b: b / n, max, nonFinite, highlightWarmth: hr / Math.max(1, hb), glError: this.renderer.gl.getError() };
  }

  /** High-quality still of the current scene (no drift, settled formation). */
  capture(width: number, height: number, samples = 32): Uint8ClampedArray {
    const now = performance.now();
    const clouds = this.buildRenderClouds(now).map((c) => ({ ...c, growth: 1 }));
    return this.renderer.capture({ clouds, atmosphere: this.atmosphere, changed: true, time: now / 1000 }, width, height, samples, 0.85);
  }
}
