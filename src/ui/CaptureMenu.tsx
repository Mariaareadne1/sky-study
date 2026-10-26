import { useEffect, useRef, useState } from 'react';
import { extensionFor } from '../capture/capture';
import { playShowcase, recordingMime, savePng, startRecording } from '../capture/session';
import { useEngine } from './engineContext';
import { IconCamera, IconPlay, IconRecord } from './icons';

export function CaptureMenu() {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (!engine) return null;
  const run = (fn: () => unknown) => () => {
    setOpen(false);
    fn();
  };

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
          {([1, 2] as const).map((m) => (
            <button
              key={m}
              role="menuitem"
              type="button"
              data-testid={m === 1 ? 'capture-png' : 'capture-png-2x'}
              onClick={run(async () => {
                setBusy(true);
                await savePng(engine, m);
                setBusy(false);
              })}
            >
              {m === 1 ? 'Save image' : 'Save large image'} <small>PNG · {m === 1 ? 'screen size' : '2×'}</small>
            </button>
          ))}
          <button role="menuitem" type="button" disabled={!recordingMime} onClick={run(() => startRecording(engine, true))}>
            <IconRecord /> Record clip <small>{recordingMime ? `${extensionFor(recordingMime).toUpperCase()} · UI hidden` : 'not supported'}</small>
          </button>
          <hr />
          <button role="menuitem" type="button" data-testid="showcase" onClick={run(() => playShowcase(engine, false))}>
            <IconPlay /> Play showcase <small>24 s demo · Esc stops</small>
          </button>
          <button role="menuitem" type="button" disabled={!recordingMime} onClick={run(() => playShowcase(engine, true))}>
            <IconRecord /> Record showcase
          </button>
        </div>
      )}
    </div>
  );
}
