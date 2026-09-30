import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json' with { type: 'json' };

const externalPackages = [
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.peerDependencies)
];

export default defineConfig({
  plugins: [react(), vue(), svelte()],
  build: {
    lib: {
      entry: {
        index: 'lib/index.js',
        react: 'lib/react/index.js',
        vue: 'lib/vue/index.js',
        svelte: 'lib/svelte/index.js'
      },
      formats: ['es'],
      fileName: (_format, entry) => `${entry}.js`
    },
    sourcemap: true,
    rolldownOptions: {
      external: id => externalPackages.some(name => id === name || id.startsWith(`${name}/`))
    }
  }
});
