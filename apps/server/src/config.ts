import { z } from "zod";
import { DEFAULT_DATA_DIR, DEFAULT_WEB_DIST } from "./paths.ts";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const int = (def: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).default(def));

const envSchema = z.object({
  PORT: int(3000),
  /** Required to create rooms. The instance admin's credential; never an invite code. */
  ADMIN_PASSWORD: z.string({ error: "必须设置（至少 8 个字符）" }).min(8, "至少 8 个字符"),
  DATABASE_URL: optionalString,
  PGLITE_DIR: optionalString,
  WEB_DIST: optionalString,
  /** Set to "1" when running behind a reverse proxy so client IPs are read from X-Forwarded-For. */
  TRUST_PROXY: optionalString,

  // --- AI host (all optional; leave ANTHROPIC_API_KEY empty to run without AI) ---
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_BASE_URL: optionalString,
  /** Google AI Studio key (GEMINI_API_KEY is accepted as an alias). */
  GOOGLE_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  GOOGLE_BASE_URL: optionalString,
  /** Which provider to use; by default whichever key is set (Anthropic first). */
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["anthropic", "google"]).optional()),
  AI_ENABLED: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("true")),
  /** Development only: use a canned fake model instead of calling an API. */
  AI_MOCK: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("false")),
  AI_MODEL: optionalString,
  AI_EFFORT: z.preprocess(emptyToUndefined, z.enum(["low", "medium", "high"]).default("low")),
  AI_REFUSAL_FALLBACK: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("true")),
  AI_TIMEOUT_MS: int(45_000),
  AI_MAX_CONCURRENCY: int(2),
  AI_ROOM_CALLS_PER_MINUTE: int(6),
  AI_DAILY_CALL_LIMIT: int(300),
});

export interface Config {
  port: number;
  adminPassword: string;
  databaseUrl?: string;
  pgliteDir?: string;
  webDist: string;
  trustProxy: boolean;
  ai: {
    provider: "anthropic" | "google";
    apiKey?: string;
    baseUrl?: string;
    mock: boolean;
    model: string;
    effort: "low" | "medium" | "high";
    refusalFallback: boolean;
    timeoutMs: number;
    maxConcurrency: number;
    roomCallsPerMinute: number;
    dailyCallLimit: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`配置无效（参考 .env.example）：\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const googleKey = e.GOOGLE_API_KEY ?? e.GEMINI_API_KEY;
  const provider = e.AI_PROVIDER ?? (!e.ANTHROPIC_API_KEY && googleKey ? "google" : "anthropic");
  const apiKey = provider === "google" ? googleKey : e.ANTHROPIC_API_KEY;
  return {
    port: e.PORT,
    adminPassword: e.ADMIN_PASSWORD,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.DATABASE_URL ? undefined : (e.PGLITE_DIR ?? `${DEFAULT_DATA_DIR}/pglite`),
    webDist: e.WEB_DIST ?? DEFAULT_WEB_DIST,
    trustProxy: e.TRUST_PROXY === "1" || e.TRUST_PROXY === "true",
    ai: {
      provider,
      apiKey: e.AI_ENABLED === "true" ? apiKey : undefined,
      baseUrl: provider === "google" ? e.GOOGLE_BASE_URL : e.ANTHROPIC_BASE_URL,
      mock: e.AI_ENABLED === "true" && e.AI_MOCK === "true",
      model: e.AI_MODEL ?? (provider === "google" ? "gemini-2.5-flash" : "claude-opus-5-5"),
      effort: e.AI_EFFORT,
      refusalFallback: e.AI_REFUSAL_FALLBACK === "true",
      timeoutMs: e.AI_TIMEOUT_MS,
      maxConcurrency: e.AI_MAX_CONCURRENCY,
      roomCallsPerMinute: e.AI_ROOM_CALLS_PER_MINUTE,
      dailyCallLimit: e.AI_DAILY_CALL_LIMIT,
    },
  };
}
