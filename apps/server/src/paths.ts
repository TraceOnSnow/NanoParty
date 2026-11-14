import { fileURLToPath } from "node:url";

// This file and the bundled dist/index.js both sit one level below apps/server.
const serverRoot = fileURLToPath(new URL("..", import.meta.url));

export const MIGRATIONS_DIR = `${serverRoot}drizzle`;
export const DEFAULT_WEB_DIST = `${serverRoot}../web/dist`;
export const DEFAULT_DATA_DIR = `${serverRoot}../../data`;
