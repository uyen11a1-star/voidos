import { defineConfig } from 'vite';

// base './' so the build works under any GitHub Pages sub-path. Two pages: the OS and the Assembly lab.
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { main: 'index.html', lab: 'lab.html' } } },
});
