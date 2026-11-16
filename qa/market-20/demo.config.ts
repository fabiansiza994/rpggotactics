import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  base: "/",
  publicDir: false,
  build: {
    outDir: "/private/tmp/market-auth-qa/demo-build",
    emptyOutDir: true,
    rollupOptions: { input: resolve("qa/market-20/demo.html") },
  },
});
