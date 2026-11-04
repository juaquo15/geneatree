import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // GitHub Pages sirve el sitio en /geneatree/; localmente en /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
