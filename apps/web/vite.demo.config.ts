import { renameSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The static build: a demo and a pass-the-device mode that run without the server.
 * Output is plain files with relative paths, so it can sit at any URL of any static host.
 */
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "static-index",
      closeBundle: () => renameSync("dist-demo/demo.html", "dist-demo/index.html"),
    },
  ],
  server: { port: 5174 },
  preview: { port: 4173 },
  build: { outDir: "dist-demo", emptyOutDir: true, rollupOptions: { input: "demo.html" } },
});
