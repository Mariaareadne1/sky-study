// Paste-able helper for the browser pane / Playwright: draws a path of [x,y] CSS px on the sky surface.
window.__drawPath = async (pts, { shift = false, stepMs = 8 } = {}) => {
  const el = document.querySelector('[data-testid="sky-surface"]');
  const r = el.getBoundingClientRect();
  const fire = (type, [x, y], buttons) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: r.left + x, clientY: r.top + y, shiftKey: shift }));
  fire('pointerdown', pts[0], 1);
  for (const p of pts.slice(1)) {
    fire('pointermove', p, 1);
    await new Promise((res) => setTimeout(res, stepMs));
  }
  fire('pointerup', pts[pts.length - 1], 0);
};
