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
            '/api': 'http://localhost:4000',
        },
    },
});
