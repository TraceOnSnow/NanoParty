import { defineConfig } from "tsup";

export default defineConfig({
  // index = the server; report = the read-only play report export (node dist/report.js).
  entry: ["src/index.ts", "src/report.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  sourcemap: true,
  // Workspace packages are plain TS sources: bundle them. Everything else stays in node_modules.
  noExternal: [/^@apr\//],
});
