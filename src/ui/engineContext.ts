import { createContext, useContext } from 'react';
import type { Engine } from '../engine/Engine';

export const EngineContext = createContext<Engine | null>(null);

export function useEngine(): Engine | null {
  return useContext(EngineContext);
}
