import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({plugins:[react()],build:{outDir:'/private/tmp/auto-deck-compiled-qa-20261115',rollupOptions:{input:resolve(process.cwd(),'qa/auto-deck-20261115/index.html')},chunkSizeWarningLimit:1500}});
