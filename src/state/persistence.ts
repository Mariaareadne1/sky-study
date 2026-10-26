import { emptyScene, parseScene, serializeScene, type SceneDoc } from './scene';
import { useSky } from './store';

const KEY = 'sky-study/scene/v1';
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

/** Save the scene whenever it changes (debounced). Returns an unsubscribe function. */
export function startAutosave(): () => void {
  let timer = 0;
  let warned = false;
  const unsub = useSky.subscribe((state, prev) => {
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
    unsub();
  };
}
