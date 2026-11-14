import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  sourcemap: true,
  // Workspace packages are plain TS sources: bundle them. Everything else stays in node_modules.
  noExternal: [/^@apr\//],
});
