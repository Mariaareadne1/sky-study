import { useEffect, useState } from 'react';
import { type Intent, press, release } from '../interactions/flight';
import { DEFAULT_VIEW } from '../renderer/camera';
import { useSky } from '../state/store';

const moved = (v: typeof DEFAULT_VIEW) =>
  Math.hypot(v.x, v.z) > 0.05 ||
  Math.abs(v.altitude - DEFAULT_VIEW.altitude) > 0.05 ||
  Math.abs(v.yaw - DEFAULT_VIEW.yaw) > 0.02 ||
  Math.abs(v.pitch - DEFAULT_VIEW.pitch) > 0.02;

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    if (!mq) return;
    const on = () => setCoarse(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return coarse;
}

function PadButton({ intent, label, glyph }: { intent: Intent; label: string; glyph: string }) {
  const stop = () => release(intent);
  return (
    <button
      type="button"
      className="pad-button"
      aria-label={label}
      data-testid={`pad-${intent}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press(intent);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      {glyph}
    </button>
  );
}

/** Free-flight helpers: reset to the starting view, and a move pad on touch screens. */
export function ViewControl() {
  const view = useSky((s) => s.view);
  const coarse = useCoarsePointer();
  return (
    <div className="view-control">
      {coarse && (
        <div className="move-pad glass" role="group" aria-label="Fly">
          <PadButton intent="forward" label="Fly forward" glyph="↑" />
          <PadButton intent="left" label="Fly left" glyph="←" />
          <PadButton intent="back" label="Fly back" glyph="↓" />
          <PadButton intent="right" label="Fly right" glyph="→" />
          <PadButton intent="up" label="Rise" glyph="⤒" />
          <PadButton intent="down" label="Sink" glyph="⤓" />
        </div>
      )}
      {moved(view) && (
        <button type="button" className="glass chip reset-view" title="Back to the starting view (R)" data-testid="reset-view" onClick={() => useSky.getState().setView(DEFAULT_VIEW)}>
          Reset view
        </button>
      )}
    </div>
  );
}
