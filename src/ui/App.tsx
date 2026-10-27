import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../atmosphere/timeOfDay';
import { Engine } from '../engine/Engine';
import { loadSavedPrefs, loadSavedScene, loadSavedView, startAutosave } from '../state/persistence';
import { useSky } from '../state/store';
import { stopRecording, stopShowcase } from '../capture/session';
import { CaptureMenu } from './CaptureMenu';
import { EngineContext } from './engineContext';
import { HelpPanel } from './HelpPanel';
import { IconClear, IconEye, IconHelp, IconLook, IconMove, IconPixel, IconPen, IconRedo, IconStop, IconUndo } from './icons';
import { ViewControl } from './ViewControl';
import { VIEW_PRESETS } from '../renderer/camera';
import { DEG } from '../math/vec';
import { InteractionLayer } from './InteractionLayer';
import { SelectionBar } from './SelectionBar';
import { TimeControl } from './TimeControl';
import { Toast } from './Toast';

declare global {
  interface Window {
    __sky?: { engine: Engine; store: typeof useSky };
  }
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input[type="text"], textarea, select, [contenteditable="true"]')) return;
      const st = useSky.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod || e.altKey) return;
      const isRange = target instanceof HTMLInputElement && target.type === 'range';
      switch (e.key) {
        case 'd': case 'D': st.setTool('draw'); break;
        case 'v': case 'V': st.setTool('move'); break;
        case 'l': case 'L': st.setTool('look'); break;
        case 'p': case 'P': st.setStyle(st.style === 'pixel' ? 'realistic' : 'pixel'); break;
        case 'g': case 'G': st.setView(VIEW_PRESETS[0].view); break;
        case 'e': case 'E': st.setView(VIEW_PRESETS[1].view); break;
        case 't': case 'T': st.setView(VIEW_PRESETS[2].view); break;
        case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
          if (isRange || target.closest('button')) break;
          e.preventDefault();
          const step = (e.shiftKey ? 12 : 4) * DEG;
          const v = st.view;
          if (e.key === 'ArrowLeft') st.setView({ yaw: v.yaw - step });
          if (e.key === 'ArrowRight') st.setView({ yaw: v.yaw + step });
          if (e.key === 'ArrowUp') st.setView({ pitch: v.pitch + step });
          if (e.key === 'ArrowDown') st.setView({ pitch: v.pitch - step });
          break;
        }
        case 'h': case 'H': st.setUiHidden(!st.uiHidden); break;
        case 'Escape':
          if (stopShowcase()) break;
          st.select(null);
          if (st.uiHidden && !st.recording) st.setUiHidden(false);
          break;
        case 'Delete': case 'Backspace':
          if (st.selectedId && !isRange) { e.preventDefault(); st.deleteCloud(st.selectedId); }
          break;
        default:
          if (/^[1-5]$/.test(e.key) && !isRange) st.setHour(PRESETS[Number(e.key) - 1].hour);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Hint() {
  const count = useSky((s) => s.scene.clouds.length);
  const [moved, setMoved] = useState(false);
  const [showMoveHint, setShowMoveHint] = useState(false);
  const prev = useRef(count);
  useEffect(() => {
    if (prev.current === 0 && count === 1 && !moved) {
      setShowMoveHint(true);
      const t = window.setTimeout(() => setShowMoveHint(false), 6500);
      return () => window.clearTimeout(t);
    }
    prev.current = count;
  }, [count, moved]);
  useEffect(() => useSky.subscribe((s) => { if (s.selectedId) setMoved(true); }), []);
  if (count === 0) return <p className="hint" data-testid="hint">Draw something in the sky.</p>;
  if (showMoveHint && !moved) return <p className="hint small">Click a cloud to select it — drag to move, scroll to send it farther away.</p>;
  return null;
}

function Chrome({ onHelp }: { onHelp: () => void }) {
  const tool = useSky((s) => s.tool);
  const canUndo = useSky((s) => s.past.length > 0);
  const canRedo = useSky((s) => s.future.length > 0);
  const hasClouds = useSky((s) => s.scene.clouds.length > 0);
  const style = useSky((s) => s.style);
  const st = useSky.getState;
  return (
    <>
      <header className="wordmark">
        <h1>Sky Study</h1>
        <p>Draw with atmosphere.</p>
      </header>
      <div className="top-right">
        <button
          type="button"
          className={`glass icon-button ${style === 'pixel' ? 'is-on' : ''}`}
          title={style === 'pixel' ? 'Realistic style (P)' : 'Pixel-art style (P)'}
          aria-label="Pixel-art style"
          aria-pressed={style === 'pixel'}
          data-testid="style-toggle"
          onClick={() => st().setStyle(style === 'pixel' ? 'realistic' : 'pixel')}
        >
          <IconPixel />
        </button>
        <button type="button" className="glass icon-button" title="Hide interface (H)" aria-label="Hide interface" onClick={() => st().setUiHidden(true)}>
          <IconEye />
        </button>
        <button type="button" className="glass icon-button" title="Clear sky" aria-label="Clear all clouds" disabled={!hasClouds} data-testid="clear-all" onClick={() => st().clearAll()}>
          <IconClear />
        </button>
        <button type="button" className="glass icon-button" title="About & settings" aria-label="About and settings" onClick={onHelp}>
          <IconHelp />
        </button>
      </div>
      <nav className="toolbar glass" aria-label="Tools">
        <button type="button" className={`tool ${tool === 'draw' ? 'is-active' : ''}`} aria-pressed={tool === 'draw'} title="Draw (D)" data-testid="tool-draw" onClick={() => st().setTool('draw')}>
          <IconPen /> <span>Draw</span>
        </button>
        <button type="button" className={`tool ${tool === 'move' ? 'is-active' : ''}`} aria-pressed={tool === 'move'} title="Move (V)" data-testid="tool-move" onClick={() => st().setTool('move')}>
          <IconMove /> <span>Move</span>
        </button>
        <button type="button" className={`tool ${tool === 'look' ? 'is-active' : ''}`} aria-pressed={tool === 'look'} title="Look around (L) — or right-drag anywhere" data-testid="tool-look" onClick={() => st().setTool('look')}>
          <IconLook /> <span>Look</span>
        </button>
        <span className="divider" />
        <button type="button" className="icon-button" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} data-testid="undo" onClick={() => st().undo()}>
          <IconUndo />
        </button>
        <button type="button" className="icon-button" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} data-testid="redo" onClick={() => st().redo()}>
          <IconRedo />
        </button>
      </nav>
      <ViewControl />
      <div className="bottom-right">
        <TimeControl />
        <CaptureMenu />
      </div>
      <SelectionBar />
    </>
  );
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const uiHidden = useSky((s) => s.uiHidden);
  const recording = useSky((s) => s.recording);
  const style = useSky((s) => s.style);
  useKeyboard();

  useEffect(() => {
    const { scene, message } = loadSavedScene();
    useSky.getState().replaceScene(scene);
    const view = loadSavedView();
    if (view) useSky.getState().setView(view);
    const prefs = loadSavedPrefs();
    if (prefs) {
      useSky.getState().setStyle(prefs.style);
      useSky.getState().setPixelSize(prefs.pixelSize);
    }
    if (message) useSky.getState().notify(message, 'warn');
    const stopSave = startAutosave();
    let eng: Engine | null = null;
    try {
      eng = new Engine(canvasRef.current!);
      eng.start();
      setEngine(eng);
      window.__sky = { engine: eng, store: useSky };
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
    const canvas = canvasRef.current!;
    const onLost = (e: Event) => {
      e.preventDefault();
      setError('The graphics context was lost (the GPU was reset or ran out of memory). Reload to continue — your sky is saved.');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      stopSave();
      eng?.dispose();
    };
  }, []);

  return (
    <EngineContext.Provider value={engine}>
      <main className={`app ${uiHidden ? 'ui-hidden' : ''} ${recording ? 'is-recording' : ''}`} data-style={style}>
        <canvas ref={canvasRef} className="sky-canvas" data-testid="sky-canvas" />
        {engine && <InteractionLayer />}
        {engine && !uiHidden && <Chrome onHelp={() => setHelp(true)} />}
        {engine && !uiHidden && <Hint />}
        {help && !uiHidden && <HelpPanel onClose={() => setHelp(false)} />}
        {recording && (
          <button type="button" className="glass pill record-stop" onClick={() => stopRecording()} data-testid="stop-recording">
            <IconStop /> <span>Stop recording</span>
          </button>
        )}
        {uiHidden && !recording && <button type="button" className="unhide" onClick={() => useSky.getState().setUiHidden(false)}>Show interface (H)</button>}
        <Toast />
        {error && (
          <div className="fatal" role="alert">
            <h1>Sky Study</h1>
            <p>{error}</p>
            <p className="small">Sky Study raymarches volumetric clouds with WebGL2. A recent desktop browser (Chrome, Edge, Safari 15+, Firefox) on a machine with hardware graphics is required.</p>
          </div>
        )}
      </main>
    </EngineContext.Provider>
  );
}
