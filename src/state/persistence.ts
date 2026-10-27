import { emptyScene, parseScene, serializeScene, type SceneDoc } from './scene';
import { type View, clampView } from '../renderer/camera';
import { useSky } from './store';

const KEY = 'sky-study/scene/v1';
const VIEW_KEY = 'sky-study/view/v1';
const PREFS_KEY = 'sky-study/prefs/v1';
const SAVE_DELAY_MS = 400;

/** Restore the saved sky. Corrupt or foreign data is reported, never fatal. */
export function loadSavedScene(): { scene: SceneDoc; message: string | null } {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { scene: emptyScene(), message: 'Storage is unavailable here, so this sky won’t be saved.' };
  }
  if (!raw) return { scene: emptyScene(), message: null };
  const parsed = parseScene(raw);
  if (!parsed.ok) return { scene: emptyScene(), message: `Couldn’t restore the saved sky: ${parsed.error}` };
  return {
    scene: parsed.scene,
    message: parsed.dropped > 0 ? `Restored your sky; ${parsed.dropped} damaged cloud(s) were skipped.` : null,
  };
}

/** Restore the last camera view, if any (ignored when invalid). */
export function loadSavedView(): View | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<View>;
    if (typeof v.yaw !== 'number' || typeof v.pitch !== 'number' || typeof v.altitude !== 'number') return null;
    return clampView(v as View);
  } catch {
    return null;
  }
}

/** Restore the look (realistic / pixel art) and pixel size. */
export function loadSavedPrefs(): { style: 'realistic' | 'pixel'; pixelSize: number } | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { style?: unknown; pixelSize?: unknown };
    if (p.style !== 'realistic' && p.style !== 'pixel') return null;
    return { style: p.style, pixelSize: typeof p.pixelSize === 'number' && Number.isFinite(p.pixelSize) ? p.pixelSize : 4 };
  } catch {
    return null;
  }
}

/** Save the scene whenever it changes (debounced). Returns an unsubscribe function. */
export function startAutosave(): () => void {
  let timer = 0;
  let warned = false;
  let viewTimer = 0;
  const unsub = useSky.subscribe((state, prev) => {
    if (state.view !== prev.view) {
      window.clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        try {
          localStorage.setItem(VIEW_KEY, JSON.stringify(useSky.getState().view));
        } catch {
          // the scene save below reports storage problems
        }
      }, SAVE_DELAY_MS);
    }
    if (state.style !== prev.style || state.pixelSize !== prev.pixelSize) {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ style: state.style, pixelSize: state.pixelSize }));
      } catch {
        // the scene save reports storage problems
      }
    }
    if (state.scene === prev.scene) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, serializeScene(useSky.getState().scene));
      } catch {
        if (!warned) useSky.getState().notify('Couldn’t save this sky to local storage.', 'warn');
        warned = true;
      }
    }, SAVE_DELAY_MS);
  });
  return () => {
    window.clearTimeout(timer);
    window.clearTimeout(viewTimer);
    unsub();
  };
}
