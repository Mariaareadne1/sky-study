import type { Point2 } from './shape';

/** Reference gestures (km, drawing-plane space) used by the spike page and tests. */
export type TestStrokeId = 'wave' | 'vertical' | 'circle' | 'arc' | 'heart' | 'squiggle' | 'short' | 'scribble' | 'hook';

const range = (n: number) => Array.from({ length: n }, (_, i) => i / (n - 1));

export function testStroke(id: TestStrokeId, size = 3): Point2[] {
  switch (id) {
    case 'wave':
      return range(80).map((u) => ({ x: (u - 0.5) * size * 1.6, y: Math.sin(u * Math.PI * 2.2) * size * 0.12 + u * size * 0.1 }));
    case 'vertical':
      return range(60).map((u) => ({ x: Math.sin(u * 5) * size * 0.04, y: (u - 0.5) * size * 1.1 }));
    case 'circle':
      return range(90).map((u) => ({ x: Math.cos(u * Math.PI * 2) * size * 0.45, y: Math.sin(u * Math.PI * 2) * size * 0.38 }));
    case 'arc':
      return range(60).map((u) => ({ x: Math.cos(Math.PI * (1 - u)) * size * 0.6, y: Math.sin(Math.PI * u) * size * 0.35 }));
    case 'heart':
      return range(120).map((u) => {
        const t = u * Math.PI * 2;
        return {
          x: (16 * Math.pow(Math.sin(t), 3) * size) / 34,
          y: ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * size) / 34,
        };
      });
    case 'squiggle':
      return range(140).map((u) => ({
        x: (u - 0.5) * size * 1.8 + Math.sin(u * 31) * size * 0.05,
        y: Math.sin(u * 9) * size * 0.18 + Math.cos(u * 4) * size * 0.1,
      }));
    case 'short':
      return range(12).map((u) => ({ x: (u - 0.5) * size * 0.25, y: u * size * 0.04 }));
    case 'scribble':
      return range(160).map((u) => ({
        x: Math.sin(u * 37) * size * 0.25 + (u - 0.5) * size * 0.2,
        y: Math.cos(u * 23) * size * 0.2,
      }));
    case 'hook':
      // the reference video's question-mark gesture
      return range(100).map((u) => {
        if (u < 0.45) {
          const a = Math.PI * (0.05 + (u / 0.45) * 1.25);
          return { x: Math.cos(a) * size * 0.25 + size * 0.05, y: Math.sin(a) * size * 0.22 + size * 0.45 };
        }
        const v = (u - 0.45) / 0.55;
        return { x: -size * 0.2 + Math.sin(v * Math.PI) * size * 0.05 + v * size * 0.45 * v, y: size * 0.4 - v * size * 0.95 };
      });
  }
}
