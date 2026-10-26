import { HOUR_MAX, HOUR_MIN, PRESETS } from '../atmosphere/timeOfDay';
import { useSky } from '../state/store';

export function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const m = mm === 60 ? 0 : mm;
  const H = mm === 60 ? hh + 1 : hh;
  return `${String(H).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function TimeControl() {
  const hour = useSky((s) => s.scene.hour);
  const active = PRESETS.find((p) => Math.abs(p.hour - hour) < 0.01)?.id;
  const st = useSky.getState;
  return (
    <div className="time-control glass" role="group" aria-label="Time of day">
      <div className="time-presets">
        {PRESETS.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`chip ${active === p.id ? 'is-active' : ''}`}
            aria-pressed={active === p.id}
            title={`${p.label} (${i + 1})`}
            data-testid={`preset-${p.id}`}
            onClick={() => st().setHour(p.hour)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="time-slider">
        <span className="time-readout" aria-live="polite">{formatHour(hour)}</span>
        <input
          type="range"
          min={HOUR_MIN}
          max={HOUR_MAX}
          step={0.05}
          value={hour}
          aria-label="Time of day"
          data-testid="time-slider"
          onPointerDown={() => st().begin()}
          onPointerUp={() => st().end()}
          onKeyUp={() => st().end()}
          onKeyDown={() => st().begin()}
          onChange={(e) => st().setHour(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
