import { shapeOf } from '../clouds/cloudModel';
import { MIN_BASE_KM } from '../interactions/geometry';
import { cloudDistance, moveToDistance } from '../interactions/picking';
import { DISTANCE_MAX, DISTANCE_MIN, SCALE_MAX, SCALE_MIN } from '../state/scene';
import { useSky } from '../state/store';
import { useEngine } from './engineContext';
import { IconClear, IconDuplicate } from './icons';
import { newId } from './ids';

export function SelectionBar() {
  const engine = useEngine();
  const cloud = useSky((s) => s.scene.clouds.find((c) => c.id === s.selectedId));
  if (!cloud || !engine) return null;
  const cam = engine.camera.position;
  const distance = cloudDistance(cam, cloud);
  const st = useSky.getState;
  const lift = (p: readonly [number, number, number], scale: number): [number, number, number] => [
    p[0],
    Math.max(p[1], MIN_BASE_KM - shapeOf(cloud).baseY * scale),
    p[2],
  ];
  return (
    <div className="selection-bar glass" role="group" aria-label="Selected cloud" data-testid="selection-bar">
      <label className="field">
        <span>Distance</span>
        <input
          type="range"
          min={Math.log(DISTANCE_MIN)}
          max={Math.log(DISTANCE_MAX)}
          step={0.005}
          value={Math.log(distance)}
          aria-label="Distance from viewer"
          data-testid="depth-slider"
          onPointerDown={() => st().begin()}
          onPointerUp={() => st().end()}
          onKeyDown={() => st().begin()}
          onKeyUp={() => st().end()}
          onChange={(e) => st().updateCloud(cloud.id, { position: lift(moveToDistance(cam, cloud.position, Math.exp(Number(e.target.value))), cloud.scale) })}
        />
        <output>{distance.toFixed(1)} km</output>
      </label>
      <label className="field">
        <span>Size</span>
        <input
          type="range"
          min={Math.log(SCALE_MIN)}
          max={Math.log(SCALE_MAX)}
          step={0.005}
          value={Math.log(cloud.scale)}
          aria-label="Cloud size"
          data-testid="scale-slider"
          onPointerDown={() => st().begin()}
          onPointerUp={() => st().end()}
          onKeyDown={() => st().begin()}
          onKeyUp={() => st().end()}
          onChange={(e) => {
            const scale = Math.exp(Number(e.target.value));
            st().updateCloud(cloud.id, { scale, position: lift(cloud.position, scale) });
          }}
        />
        <output>{Math.round(cloud.scale * 100)}%</output>
      </label>
      <button type="button" className="icon-button" title="Duplicate" aria-label="Duplicate cloud" onClick={() => st().duplicateCloud(cloud.id, newId(), performance.now())}>
        <IconDuplicate />
      </button>
      <button type="button" className="icon-button" title="Delete (⌫)" aria-label="Delete cloud" data-testid="delete-cloud" onClick={() => st().deleteCloud(cloud.id)}>
        <IconClear />
      </button>
    </div>
  );
}
