import { useEffect, useRef } from 'react';
import { shapeOf } from '../clouds/cloudModel';
import { MIN_BASE_KM, strokeToCloud } from '../interactions/geometry';
import { cloudDistance, cloudExtent, moveToDistance, pickCloud } from '../interactions/picking';
import { type LiveStroke, addPoint, beginStroke, liveStrokes, releaseStroke, strokeOpacity, strokePath } from '../interactions/strokes';
import { type Vec3, add, clamp, sub } from '../math/vec';
import { intersectPlane } from '../renderer/camera';
import { randomSeed } from '../math/rng';
import { type CloudDoc, DISTANCE_MAX, DISTANCE_MIN, SCALE_MAX, SCALE_MIN } from '../state/scene';
import { useSky } from '../state/store';
import { useEngine } from './engineContext';
import { newId } from './ids';

const TAP_PX = 7;

type Gesture =
  | { kind: 'stroke'; stroke: LiveStroke; startedOn: string | null; pointerId: number }
  | { kind: 'drag'; id: string; offset: Vec3; normal: Vec3; pointerId: number }
  | { kind: 'depth'; id: string; startY: number; startDistance: number; pointerId: number }
  | { kind: 'scale'; id: string; cx: number; cy: number; startDist: number; startScale: number; pointerId: number }
  | { kind: 'look'; lastX: number; lastY: number; pointerId: number };

const findCloud = (id: string | null): CloudDoc | undefined =>
  id ? useSky.getState().scene.clouds.find((c) => c.id === id) : undefined;

export function InteractionLayer() {
  const engine = useEngine();
  const layerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const wheelTimer = useRef<number>(0);
  const tool = useSky((s) => s.tool);

  // Per-frame overlay updates (strokes, selection box) without React renders.
  useEffect(() => {
    if (!engine) return;
    return engine.onFrame(({ now }) => {
      const svg = svgRef.current;
      if (svg) {
        const strokes = liveStrokes(now);
        const paths = svg.querySelectorAll('path');
        strokes.forEach((s, i) => {
          let p = paths[i] as SVGPathElement | undefined;
          if (!p) {
            p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            svg.appendChild(p);
          }
          p.setAttribute('d', strokePath(s.points));
          p.style.opacity = String(strokeOpacity(s, now));
        });
        for (let i = strokes.length; i < paths.length; i++) paths[i].remove();
      }
      const sel = selRef.current;
      if (!sel) return;
      const { selectedId, uiHidden, recording } = useSky.getState();
      const c = findCloud(selectedId);
      const rect = c && !uiHidden && !recording ? engine.screenRect(c, now) : null;
      if (!rect || !c) {
        sel.style.display = 'none';
        return;
      }
      sel.style.display = 'block';
      sel.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      sel.style.width = `${rect.w}px`;
      sel.style.height = `${rect.h}px`;
      if (labelRef.current) {
        const ext = cloudExtent(c, shapeOf(c));
        const w = Math.round(ext.w * 1000);
        const h = Math.round(ext.h * 1000);
        const d = cloudDistance(engine.camera.position, c);
        labelRef.current.textContent = `${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} m · ${d.toFixed(1)} km away`;
      }
    });
  }, [engine]);

  // Wheel = push away / pull closer. Grouped into one undo step per gesture.
  useEffect(() => {
    const el = layerRef.current;
    if (!el || !engine) return;
    const onWheel = (e: WheelEvent) => {
      const st = useSky.getState();
      const local = localPoint(e);
      let id = st.selectedId;
      if (!id) {
        const { origin, dir } = engine.rayAt(local.x, local.y);
        id = pickCloud(origin, dir, st.scene.clouds, shapeOf, (c) => engine.renderPosition(c))?.id ?? null;
        if (id) st.select(id);
      }
      const c = findCloud(id);
      if (!c) return;
      e.preventDefault();
      st.begin();
      const cam = engine.camera.position;
      const dist = clamp(cloudDistance(cam, c) * Math.exp(e.deltaY * 0.0016), DISTANCE_MIN, DISTANCE_MAX);
      st.updateCloud(c.id, { position: liftAboveGround(moveToDistance(cam, c.position, dist), c) });
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => useSky.getState().end(), 350);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [engine]);

  function localPoint(e: { clientX: number; clientY: number }) {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function liftAboveGround(p: Vec3, c: CloudDoc): Vec3 {
    const minY = MIN_BASE_KM - shapeOf(c).baseY * c.scale;
    return [p[0], Math.max(p[1], minY), p[2]];
  }

  function startDrag(id: string, x: number, y: number, pointerId: number) {
    if (!engine) return;
    const c = findCloud(id);
    if (!c) return;
    const cam = engine.camera;
    const { origin, dir } = engine.rayAt(x, y);
    const center = c.position;
    const hit = intersectPlane(origin, dir, center, cam.forward) ?? center;
    useSky.getState().begin();
    gesture.current = { kind: 'drag', id, offset: sub(center, hit), normal: cam.forward, pointerId };
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!engine || gesture.current) return;
    const st = useSky.getState();
    const lookButton = e.button === 2 || (e.button === 0 && st.tool === 'look');
    if (e.button !== 0 && !lookButton) return;
    const { x, y } = localPoint(e);
    try {
      layerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointers can't be captured; the gesture still works
    }
    if (lookButton) {
      gesture.current = { kind: 'look', lastX: x, lastY: y, pointerId: e.pointerId };
      return;
    }
    const handle = (e.target as HTMLElement).dataset?.handle;
    if (handle && st.selectedId) {
      const rect = selRef.current!.getBoundingClientRect();
      const lr = layerRef.current!.getBoundingClientRect();
      const cx = rect.left - lr.left + rect.width / 2;
      const cy = rect.top - lr.top + rect.height / 2;
      const c = findCloud(st.selectedId)!;
      st.begin();
      gesture.current = { kind: 'scale', id: c.id, cx, cy, startDist: Math.max(8, Math.hypot(x - cx, y - cy)), startScale: c.scale, pointerId: e.pointerId };
      return;
    }
    const { origin, dir } = engine.rayAt(x, y);
    const pick = pickCloud(origin, dir, st.scene.clouds, shapeOf, (c) => engine.renderPosition(c));
    if (pick && e.shiftKey) {
      const c = findCloud(pick.id)!;
      st.select(pick.id);
      st.begin();
      gesture.current = { kind: 'depth', id: pick.id, startY: y, startDistance: cloudDistance(engine.camera.position, c), pointerId: e.pointerId };
      return;
    }
    if (st.tool === 'move') {
      if (pick) {
        st.select(pick.id);
        startDrag(pick.id, x, y, e.pointerId);
      } else st.select(null);
      return;
    }
    if (pick && pick.id === st.selectedId) {
      startDrag(pick.id, x, y, e.pointerId);
      return;
    }
    gesture.current = { kind: 'stroke', stroke: beginStroke({ x, y }), startedOn: pick?.id ?? null, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!engine) return;
    const { x, y } = localPoint(e);
    if (!g) {
      updateHoverCursor(x, y);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    const st = useSky.getState();
    if (g.kind === 'look') {
      // grab the sky: dragging right turns the view left, dragging down looks up
      const k = engine.camera.fovY / Math.max(1, engine.size.height);
      const v = st.view;
      st.setView({ yaw: v.yaw - (x - g.lastX) * k, pitch: v.pitch + (y - g.lastY) * k });
      gesture.current = { ...g, lastX: x, lastY: y };
      return;
    }
    if (g.kind === 'stroke') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) addPoint(g.stroke, localPoint(ev));
      return;
    }
    const c = findCloud(g.id);
    if (!c) return;
    if (g.kind === 'drag') {
      const { origin, dir } = engine.rayAt(x, y);
      const hit = intersectPlane(origin, dir, c.position, g.normal);
      if (!hit) return;
      st.updateCloud(c.id, { position: liftAboveGround(add(hit, g.offset), c) });
    } else if (g.kind === 'depth') {
      const dist = clamp(g.startDistance * Math.exp((g.startY - y) * -0.006), DISTANCE_MIN, DISTANCE_MAX);
      st.updateCloud(c.id, { position: liftAboveGround(moveToDistance(engine.camera.position, c.position, dist), c) });
    } else if (g.kind === 'scale') {
      const d = Math.hypot(x - g.cx, y - g.cy);
      const scale = clamp((g.startScale * d) / g.startDist, SCALE_MIN, SCALE_MAX);
      st.updateCloud(c.id, { scale, position: liftAboveGround(c.position, { ...c, scale }) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || !engine) return;
    gesture.current = null;
    const st = useSky.getState();
    if (g.kind === 'look') return;
    if (g.kind !== 'stroke') {
      st.end();
      return;
    }
    const pts = g.stroke.points;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const now = performance.now();
    if (len < TAP_PX) {
      releaseStroke(g.stroke, false, now);
      st.select(g.startedOn);
      return;
    }
    if (e.type === 'pointercancel') {
      releaseStroke(g.stroke, false, now);
      return;
    }
    const { width, height } = engine.size;
    const ndc = pts.map((p) => ({ x: (p.x / width) * 2 - 1, y: 1 - (p.y / height) * 2 }));
    const result = strokeToCloud(engine.camera, ndc, randomSeed());
    if (!result.ok) {
      releaseStroke(g.stroke, false, now);
      st.notify(result.reason === 'too-short' ? 'Draw a little longer — that line is too short for a cloud.' : 'Draw above the horizon to make a cloud.', 'warn');
      return;
    }
    const order = Math.max(0, ...st.scene.clouds.map((c) => c.order)) + 1;
    const id = newId();
    const added = st.addCloud({ ...result.cloud, id, order }, now);
    releaseStroke(g.stroke, added, now);
    if (added) st.select(null);
  };

  function updateHoverCursor(x: number, y: number) {
    const el = layerRef.current;
    if (!el || !engine) return;
    const st = useSky.getState();
    const { origin, dir } = engine.rayAt(x, y);
    const pick = pickCloud(origin, dir, st.scene.clouds, shapeOf, (c) => engine.renderPosition(c));
    const overSelected = pick && pick.id === st.selectedId;
    el.dataset.cursor = st.tool === 'look' ? 'grab' : st.tool === 'move' ? (pick ? 'grab' : 'default') : overSelected ? 'grab' : 'draw';
  }

  return (
    <div
      ref={layerRef}
      className="interaction-layer"
      data-tool={tool}
      data-cursor={tool === 'look' ? 'grab' : tool === 'move' ? 'default' : 'draw'}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="sky-surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg ref={svgRef} className="stroke-layer" aria-hidden="true" />
      <div ref={selRef} className="selection" style={{ display: 'none' }} data-testid="selection">
        <i data-handle="nw" className="handle nw" />
        <i data-handle="ne" className="handle ne" />
        <i data-handle="sw" className="handle sw" />
        <i data-handle="se" className="handle se" />
        <span ref={labelRef} className="selection-label" />
      </div>
    </div>
  );
}
