// Separate config for live-server browser probes so they never run in the unit suite.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			'#lib': fileURLToPath(new URL('../src/lib', import.meta.url))
		}
	},
	oxc: {
		tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url))
	},
	test: {
		include: ['probes/**/*.probe.ts'],
		environment: 'node',
		testTimeout: 90_000,
		hookTimeout: 90_000
	}
});
