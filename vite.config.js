import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
    define: {
        __TANKSCRIPT_BACKEND_BATTLES__: JSON.stringify(
            loadEnv(mode, process.cwd(), 'VITE_').VITE_TANKSCRIPT_BACKEND_BATTLES === '1',
        ),
    },
    publicDir: 'frontend/public',
    server: {
        fs: {
            deny: [
                '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}',
                '.npmrc', '.yarnrc.yml', '**/.git/**', '**/backend/**', '**/build/**',
            ],
        },
        proxy: {
            // Preserve the browser's Host for same-origin battle controls.
            '/api': { target: 'http://localhost:4000', changeOrigin: false },
        },
    },
}));
