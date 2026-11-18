import { defineConfig } from 'vite';

export default defineConfig({
    publicDir: 'frontend/public',
    server: {
        fs: {
            deny: [
                '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}',
                '.npmrc', '.yarnrc.yml', '**/.git/**', '**/backend/**', '**/build/**',
            ],
        },
        proxy: {
            '/api': { target: 'http://localhost:4000', changeOrigin: false },
            '/ws': { target: 'ws://localhost:4000', ws: true },
        },
    },
});