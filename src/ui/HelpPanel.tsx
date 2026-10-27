import { useRef } from 'react';
import { downloadBlob, timestamp } from '../capture/capture';
import { parseScene, serializeScene } from '../state/scene';
import { PIXEL_SIZES, type QualityMode, useSky } from '../state/store';
import { useEngine } from './engineContext';
import { IconClose } from './icons';

const SHORTCUTS: [string, string][] = [
  ['B', 'Draw'],
  ['V', 'Select & move'],
  ['W A S D / arrows', 'Fly (hold ⇧ to go faster)'],
  ['Q / E', 'Sink / rise'],
  ['Scroll on the sky', 'Glide forward or back along your view'],
  ['L / right-drag / ⇧ arrows', 'Look around'],
  ['R', 'Reset the view'],
  ['Scroll / ⇧-drag on a cloud', 'Push it away or bring it closer'],
  ['⌫', 'Delete selected cloud'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['1 – 5', 'Dawn · Noon · Golden · Blue hour · Moonlight'],
  ['P', 'Pixel-art / realistic style'],
  ['H', 'Hide interface'],
  ['Esc', 'Deselect / stop showcase'],
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const quality = useSky((s) => s.quality);
  const drift = useSky((s) => s.drift);
  const style = useSky((s) => s.style);
  const pixelSize = useSky((s) => s.pixelSize);
  const fileRef = useRef<HTMLInputElement>(null);
  const st = useSky.getState;

  async function importFile(f: File) {
    if (f.size > 2_000_000) {
      st().notify('That file is too large to be a Sky Study scene.', 'warn');
      return;
    }
    const parsed = parseScene(await f.text());
    if (!parsed.ok) {
      st().notify(parsed.error, 'warn');
      return;
    }
    st().apply(() => parsed.scene);
    st().notify(parsed.dropped ? `Imported; ${parsed.dropped} invalid cloud(s) skipped.` : 'Scene imported.');
  }

  return (
    <div className="help glass" role="dialog" aria-label="About Sky Study">
      <button type="button" className="icon-button close" aria-label="Close" onClick={onClose}>
        <IconClose />
      </button>
      <h2>Sky Study</h2>
      <p>
        Draw a line and it gathers into a cloud — a real volume, raymarched and lit by the same atmosphere that paints the
        sky. Move clouds through space, push them into the distance, and change the hour.
      </p>
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="settings">
        <label>
          <span>Render quality</span>
          <select value={quality} onChange={(e) => st().setQuality(e.target.value as QualityMode)} data-testid="quality-select">
            <option value="auto">Auto (adapts to frame rate)</option>
            <option value="high">High</option>
            <option value="balanced">Balanced</option>
            <option value="reduced">Reduced</option>
          </select>
        </label>
        <label>
          <span>Style</span>
          <select value={style} onChange={(e) => st().setStyle(e.target.value as 'realistic' | 'pixel')} data-testid="style-select">
            <option value="realistic">Realistic</option>
            <option value="pixel">Pixel art</option>
          </select>
        </label>
        {style === 'pixel' && (
          <label>
            <span>Pixel size</span>
            <select value={pixelSize} onChange={(e) => st().setPixelSize(Number(e.target.value))} data-testid="pixel-size">
              {PIXEL_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={drift}
            onChange={(e) => st().setDrift(e.target.checked)}
          />
          <span>Gentle drift</span>
        </label>
        <div className="row">
          <button type="button" className="chip" onClick={() => downloadBlob(new Blob([serializeScene(st().scene)], { type: 'application/json' }), `sky-study-${timestamp()}.json`)}>
            Export scene
          </button>
          <button type="button" className="chip" onClick={() => fileRef.current?.click()}>
            Import scene
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      </div>
      <p className="credit">
        Inspired by a cloud-drawing clip by @azlenelza. Rendering and code are original; see ATTRIBUTION.md.
        {engine && !engine.renderer.hdrSupported && ' · This GPU lacks float render targets, so gradients may band slightly.'}
      </p>
    </div>
  );
}
