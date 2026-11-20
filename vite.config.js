import { defineConfig, loadEnv } from 'vite';
import { javaDebuggerAssetsPlugin } from './scripts/javaDebuggerAssets.mjs';

export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const experimentalJava = command === 'serve' && mode !== 'production' && env.VITE_EXPERIMENTAL_JAVA === 'true';
    return {
        define: { __TANKSCRIPT_EXPERIMENTAL_JAVA__: experimentalJava },
        plugins: experimentalJava ? [javaDebuggerAssetsPlugin()] : [],
        publicDir: 'frontend/public',
        // Prepare the lazy compiler before its first use can reload an unsaved editor.
        optimizeDeps: {
            include: ['typescript'],
        },
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
    };
});
