import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: { main: 'src/app.js', experimental: 'src/testing-app.js' },
      output: {
        entryFileNames: (chunk) => chunk.name === 'experimental' ? 'testingthisisexperimental/app.js' : 'app.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css')
            ? 'amll.css'
            : 'assets/[name]-[hash][extname]'
      }
    }
  }
});
