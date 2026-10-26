import { useEffect, useRef, useState } from 'react';
import { Recorder, capturePng, downloadBlob, extensionFor, pickRecordingMime, timestamp } from '../capture/capture';
import { runShowcase } from '../engine/showcase';
import { useSky } from '../state/store';
import { useEngine } from './engineContext';
import { IconCamera, IconPlay, IconRecord, IconStop } from './icons';

declare global {
  interface Window {
    __skyCapture?: { lastPng?: { width: number; height: number; size: number }; lastVideo?: { mime: string; size: number; blob: Blob } };
  }
}

export function CaptureMenu() {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const recording = useSky((s) => s.recording);
  const recorder = useRef<Recorder | null>(null);
  const showcase = useRef<AbortController | null>(null);
  const [mime] = useState<string | null>(() => pickRecordingMime());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  async function savePng(mult: number) {
    if (!engine) return;
    setOpen(false);
    setBusy(true);
    const st = useSky.getState();
    try {
      await new Promise((r) => requestAnimationFrame(r));
      const { blob, width, height } = await capturePng(engine, mult);
      window.__skyCapture = { ...window.__skyCapture, lastPng: { width, height, size: blob.size } };
      downloadBlob(blob, `sky-study-${timestamp()}.png`);
      st.notify(`Saved ${width} × ${height} PNG.`);
    } catch (err) {
      st.notify(`Couldn’t capture the image: ${(err as Error).message}`, 'warn');
    } finally {
      setBusy(false);
    }
  }

  function startRecording(hideUi: boolean) {
    if (!engine) return;
    const st = useSky.getState();
    if (!mime) {
      st.notify('This browser can’t record the canvas (no MediaRecorder support).', 'warn');
      return;
    }
    try {
      recorder.current = new Recorder(engine, mime);
      recorder.current.start();
      st.setRecording(true);
      if (hideUi) st.setUiHidden(true);
    } catch (err) {
      st.notify(`Couldn’t start recording: ${(err as Error).message}`, 'warn');
    }
  }

  async function stopRecording() {
    const st = useSky.getState();
    const rec = recorder.current;
    recorder.current = null;
    st.setRecording(false);
    if (!rec) return;
    try {
      const blob = await rec.stop();
      window.__skyCapture = { ...window.__skyCapture, lastVideo: { mime: rec.mime, size: blob.size, blob } };
      downloadBlob(blob, `sky-study-${timestamp()}.${extensionFor(rec.mime)}`);
      st.notify(`Saved ${extensionFor(rec.mime).toUpperCase()} clip (${(blob.size / 1e6).toFixed(1)} MB).`);
    } catch (err) {
      st.notify(`Recording failed: ${(err as Error).message}`, 'warn');
    }
  }

  async function playShowcase(record: boolean) {
    if (!engine) return;
    setOpen(false);
    showcase.current?.abort();
    const ctrl = new AbortController();
    showcase.current = ctrl;
    if (record) startRecording(false);
    try {
      await runShowcase(engine, ctrl.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') useSky.getState().notify(`Showcase stopped: ${(err as Error).message}`, 'warn');
    } finally {
      if (record) await stopRecording();
      showcase.current = null;
    }
  }

  // Escape stops a showcase; expose controls for automation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showcase.current) showcase.current.abort();
    };
    window.addEventListener('keydown', onKey);
    (window as unknown as { __skyShowcase: unknown }).__skyShowcase = { play: playShowcase, savePng, startRecording, stopRecording };
    return () => window.removeEventListener('keydown', onKey);
  });

  if (recording) {
    return (
      <button type="button" className="glass pill record-stop" onClick={stopRecording} data-testid="stop-recording">
        <IconStop /> <span>Stop recording</span>
      </button>
    );
  }

  return (
    <div className="capture" ref={menuRef}>
      <button
        type="button"
        className="glass icon-button large"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Capture"
        aria-label="Capture"
        data-testid="capture-button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        <IconCamera />
      </button>
      {open && (
        <div className="menu glass" role="menu">
          <button role="menuitem" type="button" onClick={() => savePng(1)} data-testid="capture-png">
            Save image <small>PNG · screen size</small>
          </button>
          <button role="menuitem" type="button" onClick={() => savePng(2)} data-testid="capture-png-2x">
            Save large image <small>PNG · 2×</small>
          </button>
          <button role="menuitem" type="button" disabled={!mime} onClick={() => { setOpen(false); startRecording(true); }}>
            <IconRecord /> Record clip <small>{mime ? extensionFor(mime).toUpperCase() + ' · UI hidden' : 'not supported'}</small>
          </button>
          <hr />
          <button role="menuitem" type="button" onClick={() => playShowcase(false)} data-testid="showcase">
            <IconPlay /> Play showcase <small>24 s demo · Esc stops</small>
          </button>
          <button role="menuitem" type="button" disabled={!mime} onClick={() => playShowcase(true)}>
            <IconRecord /> Record showcase
          </button>
        </div>
      )}
    </div>
  );
}
