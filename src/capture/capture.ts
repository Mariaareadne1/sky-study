import type { Engine } from '../engine/Engine';
import { drawStrokes } from '../interactions/strokes';

export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Largest capture size this GPU supports for a given multiplier of the canvas. */
export function captureSize(engine: Engine, multiplier: number): { width: number; height: number } {
  const gl = engine.renderer.gl;
  const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, 8192);
  const { width, height, dpr } = engine.size;
  let w = Math.round(width * dpr * multiplier);
  let h = Math.round(height * dpr * multiplier);
  const k = Math.min(1, limit / Math.max(w, h));
  w = Math.floor(w * k);
  h = Math.floor(h * k);
  return { width: w, height: h };
}

/** Render a clean, accumulated still of the real scene and encode it as PNG. */
export async function capturePng(engine: Engine, multiplier: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = captureSize(engine, multiplier);
  const pixels = engine.capture(width, height, multiplier > 1 ? 24 : 32);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas for encoding.');
  ctx.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  return { blob, width, height };
}

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4d002a',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export const extensionFor = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

/**
 * Records the live canvas plus the drawing strokes, composited each frame
 * into a 2D canvas (the stroke overlay is DOM, not part of the WebGL image).
 */
export class Recorder {
  private readonly engine: Engine;
  private readonly composite: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private unsub: (() => void) | null = null;
  readonly mime: string;
  startedAt = 0;

  constructor(engine: Engine, mime: string) {
    this.engine = engine;
    this.mime = mime;
    this.composite = document.createElement('canvas');
    const ctx = this.composite.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create the recording canvas.');
    this.ctx = ctx;
  }

  start() {
    const { width, height, dpr } = this.engine.size;
    // H.264 encoders want even dimensions; cap at 1920 on the long side for smooth encoding.
    const k = Math.min(dpr, 1920 / Math.max(width, height));
    this.composite.width = Math.round((width * k) / 2) * 2;
    this.composite.height = Math.round((height * k) / 2) * 2;
    this.unsub = this.engine.onAfterRender((canvas) => {
      this.ctx.drawImage(canvas, 0, 0, this.composite.width, this.composite.height);
      drawStrokes(this.ctx, performance.now(), this.composite.width / width);
    });
    const stream = this.composite.captureStream(60);
    this.recorder = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 16_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
    this.startedAt = performance.now();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) return reject(new Error('Recording was not started.'));
      rec.onstop = () => {
        this.unsub?.();
        this.unsub = null;
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        if (blob.size === 0) reject(new Error('The browser produced an empty recording.'));
        else resolve(blob);
      };
      rec.onerror = () => reject(new Error('The recording failed.'));
      rec.stop();
    });
  }
}
