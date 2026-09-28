import { defineConfig } from 'vite';
import { resolve } from 'path';

// Port 3100 rather than 3000 so this can run at the same time as the lab game next door.
export default defineConfig({
    root: '.',
    // A GitHub project page is served from /<repo>/, so every asset path has to start there.
    base: process.env.GITHUB_PAGES ? '/smash_arena/' : '/',
    resolve: { alias: { '@client': resolve('./src/client') } },
    build: { outDir: 'dist', rollupOptions: { input: { main: resolve('./index.html') } } },
    server: { port: 3100 }
});
