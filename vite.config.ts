import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.glsl'],
  server: {
    port: Number(process.env.PORT) || 5362,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
} as Parameters<typeof defineConfig>[0]);
