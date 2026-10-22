import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/app.js',
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css')
            ? 'amll.css'
            : 'assets/[name]-[hash][extname]'
      }
    }
  }
});
