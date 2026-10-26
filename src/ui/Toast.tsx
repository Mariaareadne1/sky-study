import { useEffect } from 'react';
import { useSky } from '../state/store';

export function Toast() {
  const toast = useSky((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => useSky.getState().dismissToast(), toast.tone === 'warn' ? 4200 : 2600);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast glass ${toast.tone}`} role="status" data-testid="toast">
      {toast.text}
    </div>
  );
}
