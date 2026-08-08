import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  /**
   * GitHub Pages serves a project site from /<repo>/, not from the domain root,
   * so every asset URL needs that prefix baked in at build time. Set by the
   * Pages workflow; empty everywhere else, including the single-origin Docker
   * deployment, which is served from /.
   */
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
  },
});
