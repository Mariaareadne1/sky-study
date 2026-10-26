import { VIEW_PRESETS } from '../renderer/camera';
import { useSky } from '../state/store';

const near = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;

/** Camera presets. Look-around (right-drag, Look tool, arrow keys) refines from there. */
export function ViewControl() {
  const view = useSky((s) => s.view);
  const active = VIEW_PRESETS.find(
    (p) => near(p.view.altitude, view.altitude, p.view.altitude * 0.05) && near(p.view.pitch, view.pitch, 0.02) && near(p.view.yaw, view.yaw, 0.02),
  )?.id;
  return (
    <div className="view-control glass" role="group" aria-label="Viewpoint">
      {VIEW_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`chip ${active === p.id ? 'is-active' : ''}`}
          aria-pressed={active === p.id}
          title={`${p.label} (${p.id === 'ground' ? 'G' : p.id === 'eye' ? 'E' : 'T'})`}
          data-testid={`view-${p.id}`}
          onClick={() => useSky.getState().setView(p.view)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
