import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = process.env.APR_SERVER_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the REST API is proxied; the realtime client talks to the server port directly (see src/api.ts).
    proxy: { "/api": SERVER },
  },
});
