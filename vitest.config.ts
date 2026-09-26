import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		// The state modules guard on `window`, so tests need a browser-ish env.
		conditions: ['browser'],
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
