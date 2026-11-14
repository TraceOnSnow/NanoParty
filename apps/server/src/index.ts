import { startApp } from "./app.ts";
import { loadConfig } from "./config.ts";

try {
  const config = loadConfig();
  const app = await startApp(config);
  console.log(
    `[server] listening on :${app.port} | db=${app.dbKind} | ai=${app.aiEnabled ? (config.ai.mock ? "MOCK" : `on (${config.ai.model})`) : "off"}`,
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      app.close().finally(() => process.exit(0));
    });
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
