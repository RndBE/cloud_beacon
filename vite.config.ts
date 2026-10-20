import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            ssr: 'resources/js/ssr.tsx',
            refresh: true,
        }),
        react({
            babel: {
                plugins: ['babel-plugin-react-compiler'],
            },
        }),
        tailwindcss(),
        wayfinder({
            formVariants: true,
        }),
    ],
    // server: {
    //     host: '127.0.0.1',
    //     hmr: {
    //         host: '127.0.0.1',
    //     },
    // },
    server: {
        host: '0.0.0.0',
        hmr: {
            host: '192.168.12.76',
        },
    },
    esbuild: {
        jsx: 'automatic',
    },
});
