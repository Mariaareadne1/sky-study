import type { Engine } from '../engine/Engine';
import { runShowcase } from '../engine/showcase';
import { useSky } from '../state/store';
import { Recorder, capturePng, downloadBlob, extensionFor, pickRecordingMime, timestamp } from './capture';

/**
 * Capture actions that must outlive any particular piece of UI (recording
 * hides the interface, which unmounts the menu that started it).
 */

declare global {
  interface Window {
    __skyCapture?: { lastPng?: { width: number; height: number; size: number }; lastVideo?: { mime: string; size: number } };
  }
}

let recorder: Recorder | null = null;
let showcase: AbortController | null = null;
export const recordingMime = pickRecordingMime();

export async function savePng(engine: Engine, multiplier: number) {
  const st = useSky.getState();
  try {
    await new Promise((r) => requestAnimationFrame(r));
    const { blob, width, height } = await capturePng(engine, multiplier);
    window.__skyCapture = { ...window.__skyCapture, lastPng: { width, height, size: blob.size } };
    downloadBlob(blob, `sky-study-${timestamp()}.png`);
    st.notify(`Saved ${width} × ${height} PNG.`);
  } catch (err) {
    st.notify(`Couldn’t capture the image: ${(err as Error).message}`, 'warn');
  }
}

export function startRecording(engine: Engine, hideUi: boolean) {
  const st = useSky.getState();
  if (recorder) return;
  if (!recordingMime) {
    st.notify('This browser can’t record the canvas (no MediaRecorder support).', 'warn');
    return;
  }
  try {
    recorder = new Recorder(engine, recordingMime);
    recorder.start();
    st.setRecording(true);
    st.select(null);
    if (hideUi) st.setUiHidden(true);
  } catch (err) {
    recorder = null;
    st.notify(`Couldn’t start recording: ${(err as Error).message}`, 'warn');
  }
}

export async function stopRecording() {
  const st = useSky.getState();
  const rec = recorder;
  recorder = null;
  showcase?.abort();
  st.setRecording(false);
  st.setUiHidden(false);
  if (!rec) return;
  try {
    const blob = await rec.stop();
    window.__skyCapture = { ...window.__skyCapture, lastVideo: { mime: rec.mime, size: blob.size } };
    downloadBlob(blob, `sky-study-${timestamp()}.${extensionFor(rec.mime)}`);
    st.notify(`Saved ${extensionFor(rec.mime).toUpperCase()} clip (${(blob.size / 1e6).toFixed(1)} MB).`);
  } catch (err) {
    st.notify(`Recording failed: ${(err as Error).message}`, 'warn');
  }
}

export async function playShowcase(engine: Engine, record: boolean) {
  showcase?.abort();
  const ctrl = new AbortController();
  showcase = ctrl;
  if (record) startRecording(engine, false);
  try {
    await runShowcase(engine, ctrl.signal);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') useSky.getState().notify(`Showcase stopped: ${(err as Error).message}`, 'warn');
  } finally {
    if (record && recorder) await stopRecording();
    if (showcase === ctrl) showcase = null;
  }
}

export function stopShowcase(): boolean {
  if (!showcase) return false;
  showcase.abort();
  return true;
}
