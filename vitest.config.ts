import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'packages/*/src/**/*.{test,spec}.ts',
            'apps/desktop/src/{main,preload}/**/*.{test,spec}.ts',
          ],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['apps/desktop/src/renderer/**/*.{test,spec}.{ts,tsx}'],
        },
      },
    ],
  },
});
