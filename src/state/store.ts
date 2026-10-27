import { create } from 'zustand';
import { type View, DEFAULT_VIEW, clampView } from '../renderer/camera';
import type { Style } from '../renderer/Renderer';

/** Size of one pixel-art pixel, in CSS pixels. */
export const PIXEL_SIZES = [3, 4, 6, 8] as const;
export const DEFAULT_PIXEL_SIZE = 4;
import { type CloudDoc, type SceneDoc, MAX_CLOUDS, emptyScene } from './scene';

export type Tool = 'draw' | 'move' | 'look';
export type QualityMode = 'auto' | 'high' | 'balanced' | 'reduced';

const HISTORY_LIMIT = 100;

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'warn';
}

export interface SkyState {
  readonly scene: SceneDoc;
  readonly past: readonly SceneDoc[];
  readonly future: readonly SceneDoc[];
  /** Snapshot taken at the start of a grouped edit (drag, slider). */
  readonly txn: SceneDoc | null;
  readonly selectedId: string | null;
  readonly tool: Tool;
  readonly uiHidden: boolean;
  readonly quality: QualityMode;
  readonly toast: Toast | null;
  readonly recording: boolean;
  /** Gentle wander of finished clouds. */
  readonly drift: boolean;
  /** Where the camera looks from. Not part of undo history; persisted separately. */
  readonly view: View;
  readonly style: Style;
  readonly pixelSize: number;
  /** Wall-clock (performance.now) at which each cloud started forming. Runtime only. */
  readonly formedAt: Readonly<Record<string, number>>;

  /** Apply an undoable change. Inside a transaction it only updates the scene. */
  readonly apply: (fn: (s: SceneDoc) => SceneDoc) => void;
  readonly begin: () => void;
  readonly end: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly replaceScene: (s: SceneDoc) => void;

  readonly addCloud: (c: CloudDoc, now: number) => boolean;
  readonly updateCloud: (id: string, patch: Partial<Pick<CloudDoc, 'position' | 'scale' | 'yaw'>>) => void;
  readonly deleteCloud: (id: string) => void;
  readonly duplicateCloud: (id: string, newId: string, now: number) => void;
  readonly clearAll: () => void;
  readonly setHour: (hour: number) => void;

  readonly select: (id: string | null) => void;
  readonly setTool: (t: Tool) => void;
  readonly setUiHidden: (v: boolean) => void;
  readonly setQuality: (q: QualityMode) => void;
  readonly setRecording: (v: boolean) => void;
  readonly setDrift: (v: boolean) => void;
  readonly setView: (v: Partial<View>) => void;
  readonly setStyle: (s: Style) => void;
  readonly setPixelSize: (n: number) => void;
  readonly notify: (text: string, tone?: Toast['tone']) => void;
  readonly dismissToast: () => void;
}

const sameScene = (a: SceneDoc, b: SceneDoc) => a === b || JSON.stringify(a) === JSON.stringify(b);

let toastId = 0;

export const useSky = create<SkyState>((set, get) => ({
  scene: emptyScene(),
  past: [],
  future: [],
  txn: null,
  selectedId: null,
  tool: 'draw',
  uiHidden: false,
  quality: 'auto',
  toast: null,
  recording: false,
  drift: true,
  view: DEFAULT_VIEW,
  style: 'realistic',
  pixelSize: DEFAULT_PIXEL_SIZE,
  formedAt: {},

  apply: (fn) => {
    const { scene, txn, past } = get();
    const next = fn(scene);
    if (next === scene) return;
    if (txn) set({ scene: next });
    else set({ scene: next, past: [...past, scene].slice(-HISTORY_LIMIT), future: [] });
  },
  begin: () => {
    if (!get().txn) set({ txn: get().scene });
  },
  end: () => {
    const { txn, scene, past } = get();
    if (!txn) return;
    if (sameScene(txn, scene)) set({ txn: null });
    else set({ txn: null, past: [...past, txn].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, scene, future, selectedId } = get();
    if (get().txn) get().end();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      scene: prev,
      past: past.slice(0, -1),
      future: [scene, ...future].slice(0, HISTORY_LIMIT),
      selectedId: prev.clouds.some((c) => c.id === selectedId) ? selectedId : null,
    });
  },
  redo: () => {
    const { past, scene, future, selectedId } = get();
    const next = future[0];
    if (!next) return;
    set({
      scene: next,
      past: [...past, scene].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      selectedId: next.clouds.some((c) => c.id === selectedId) ? selectedId : null,
    });
  },
  replaceScene: (s) => set({ scene: s, past: [], future: [], txn: null, selectedId: null, formedAt: {} }),

  addCloud: (c, now) => {
    if (get().scene.clouds.length >= MAX_CLOUDS) {
      get().notify(`The sky holds ${MAX_CLOUDS} clouds — delete one to draw another.`, 'warn');
      return false;
    }
    get().apply((s) => ({ ...s, clouds: [...s.clouds, c] }));
    set({ formedAt: { ...get().formedAt, [c.id]: now } });
    return true;
  },
  updateCloud: (id, patch) =>
    get().apply((s) => ({ ...s, clouds: s.clouds.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  deleteCloud: (id) => {
    get().apply((s) => ({ ...s, clouds: s.clouds.filter((c) => c.id !== id) }));
    if (get().selectedId === id) set({ selectedId: null });
  },
  duplicateCloud: (id, newId, now) => {
    const src = get().scene.clouds.find((c) => c.id === id);
    if (!src) return;
    const order = Math.max(0, ...get().scene.clouds.map((c) => c.order)) + 1;
    const copy: CloudDoc = {
      ...src,
      id: newId,
      order,
      position: [src.position[0] + 1.1 * src.scale, src.position[1] + 0.15, src.position[2] + 0.6],
    };
    if (get().addCloud(copy, now - 10_000)) set({ selectedId: newId });
  },
  clearAll: () => {
    if (get().scene.clouds.length === 0) return;
    get().apply((s) => ({ ...s, clouds: [] }));
    set({ selectedId: null });
  },
  setHour: (hour) => get().apply((s) => (s.hour === hour ? s : { ...s, hour })),

  select: (id) => set({ selectedId: id }),
  setTool: (tool) => set({ tool }),
  setUiHidden: (uiHidden) => set({ uiHidden }),
  setQuality: (quality) => set({ quality }),
  setRecording: (recording) => set({ recording }),
  setDrift: (drift) => set({ drift }),
  setView: (v) => set({ view: clampView({ ...get().view, ...v }) }),
  setStyle: (style) => set({ style }),
  setPixelSize: (n) => set({ pixelSize: Math.min(12, Math.max(2, Math.round(n))) }),
  notify: (text, tone = 'info') => set({ toast: { id: ++toastId, text, tone } }),
  dismissToast: () => set({ toast: null }),
}));
