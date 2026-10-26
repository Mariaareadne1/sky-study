import { beforeEach, describe, expect, test } from 'vitest';
import { MAX_CLOUDS, type CloudDoc, emptyScene, parseScene, serializeScene } from '../../src/state/scene';
import { useSky } from '../../src/state/store';

const cloud = (id: string, x = 0): CloudDoc => ({
  id,
  seed: 7,
  stroke: [{ x: -1, y: 0 }, { x: 0, y: 0.3 }, { x: 1, y: 0 }],
  closed: false,
  position: [x, 3, -9],
  scale: 1,
  yaw: 0,
  order: 1,
});

beforeEach(() => {
  useSky.getState().replaceScene(emptyScene());
  useSky.setState({ toast: null });
});

describe('scene store', () => {
  test('add, undo and redo reconstruct the scene exactly', () => {
    const st = useSky.getState;
    st().addCloud(cloud('a'), 0);
    st().addCloud(cloud('b', 2), 0);
    const two = st().scene;
    st().undo();
    expect(st().scene.clouds.map((c) => c.id)).toEqual(['a']);
    st().undo();
    expect(st().scene.clouds).toHaveLength(0);
    st().redo();
    st().redo();
    expect(st().scene).toEqual(two);
  });

  test('a drag is a single undo step, however many moves it contains', () => {
    const st = useSky.getState;
    st().addCloud(cloud('a'), 0);
    const before = st().past.length;
    st().begin();
    for (let i = 1; i <= 30; i++) st().updateCloud('a', { position: [i * 0.1, 3, -9] });
    st().end();
    expect(st().past.length).toBe(before + 1);
    st().undo();
    expect(st().scene.clouds[0].position).toEqual([0, 3, -9]);
  });

  test('an empty transaction adds no history', () => {
    const st = useSky.getState;
    st().addCloud(cloud('a'), 0);
    const before = st().past.length;
    st().begin();
    st().end();
    expect(st().past.length).toBe(before);
  });

  test('delete, duplicate, clear and time changes are undoable', () => {
    const st = useSky.getState;
    st().addCloud(cloud('a'), 0);
    st().duplicateCloud('a', 'a2', 0);
    expect(st().scene.clouds).toHaveLength(2);
    expect(st().selectedId).toBe('a2');
    expect(st().scene.clouds[1].stroke).toEqual(st().scene.clouds[0].stroke);
    st().deleteCloud('a2');
    expect(st().selectedId).toBeNull();
    st().setHour(19.45);
    st().clearAll();
    expect(st().scene.clouds).toHaveLength(0);
    st().undo();
    expect(st().scene.clouds).toHaveLength(1);
    st().undo();
    expect(st().scene.hour).toBe(12.5);
  });

  test('refuses more than the cloud limit with a visible message', () => {
    const st = useSky.getState;
    for (let i = 0; i < MAX_CLOUDS; i++) expect(st().addCloud(cloud(`c${i}`), 0)).toBe(true);
    expect(st().addCloud(cloud('overflow'), 0)).toBe(false);
    expect(st().scene.clouds).toHaveLength(MAX_CLOUDS);
    expect(st().toast?.tone).toBe('warn');
  });
});

describe('scene serialization', () => {
  test('round-trips without changing anything', () => {
    const scene = { ...emptyScene(18.2), clouds: [cloud('a'), cloud('b', 3)] };
    const parsed = parseScene(serializeScene(scene));
    expect(parsed).toEqual({ ok: true, scene, dropped: 0 });
  });

  test('rejects malformed input with a clear message', () => {
    expect(parseScene('{nope').ok).toBe(false);
    expect(parseScene('[]').ok).toBe(false);
    const wrongVersion = parseScene(JSON.stringify({ version: 99, hour: 12, clouds: [] }));
    expect(wrongVersion.ok || wrongVersion.error).toMatch(/version/);
  });

  test('drops damaged clouds but keeps the rest', () => {
    const json = JSON.stringify({
      version: 1,
      hour: 12,
      clouds: [cloud('ok'), { ...cloud('bad'), position: [0, 'x', 0] }, { ...cloud('nan'), stroke: [{ x: null, y: 1 }] }, cloud('ok')],
    });
    const r = parseScene(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scene.clouds.map((c) => c.id)).toEqual(['ok']);
      expect(r.dropped).toBe(3);
    }
  });
});
