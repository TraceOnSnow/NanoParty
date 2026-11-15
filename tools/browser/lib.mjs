/**
 * Helpers for browser acceptance runs: several ISOLATED browser contexts, one per player,
 * each holding its own session token — the same as four people on four computers.
 * Rooms are created through /api/test (TEST_MODE instances only).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

export const BASE = process.env.BASE ?? "http://localhost:3100";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openRoom({ players = 4, names, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const res = await fetch(`${BASE}/api/test/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ players, names }),
  });
  if (!res.ok) throw new Error(`cannot create a test room (is the server running with TEST_MODE=true?) ${res.status}`);
  const { roomId, seats } = await res.json();
  const browser = await chromium.launch();
  const problems = [];
  const network = [];
  const pages = [];
  for (const [i, seat] of seats.entries()) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [`apr:session:${roomId}`, seat.sessionToken]);
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`[${seat.nickname}] page error: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && problems.push(`[${seat.nickname}] console: ${m.text()}`));
    page.on("dialog", (d) => d.accept());
    // Everything the server pushes to this player, for leak checks.
    page.on("websocket", (ws) => ws.on("framereceived", (f) => network.push({ player: i, data: String(f.payload) })));
    await page.goto(`${BASE}/room/${roomId}`);
    await page.waitForSelector(".lobby");
    pages.push(page);
  }
  const api = async (path, body) => {
    const r = await fetch(`${BASE}/api/test/rooms/${roomId}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return r.json();
  };
  const results = [];
  /** Records one acceptance check; `evidence` is a screenshot name taken from player `who`. */
  async function check(id, text, ok, who = 0) {
    const file = `${id}-${results.filter((r) => r.id === id).length + 1}.png`;
    await pages[who].screenshot({ path: `${outDir}/${file}`, fullPage: true });
    results.push({ id, text, ok: Boolean(ok), evidence: file });
    console.log(`${ok ? "✓" : "✗"} ${id} ${text}`);
  }
  return {
    roomId,
    seats,
    pages,
    problems,
    network,
    api,
    check,
    results,
    state: () => api("/state"),
    /** Index of the player who holds `playerId`. */
    indexOf: (playerId) => seats.findIndex((s) => s.playerId === playerId),
    async finish(name) {
      const failed = results.filter((r) => !r.ok);
      writeFileSync(
        `${outDir}/${name}.json`,
        JSON.stringify({ name, base: BASE, roomId, at: new Date().toISOString(), results, problems }, null, 2),
      );
      console.log(
        `\n${name}: ${results.length - failed.length}/${results.length} checks ok, ${problems.length} page problems`,
      );
      for (const p of problems) console.log(`  ! ${p}`);
      await browser.close();
      process.exit(failed.length > 0 || problems.length > 0 ? 1 : 0);
    },
  };
}

/** Clicks the first visible, enabled match. Returns false if there is none within the timeout. */
export async function click(page, selector, timeout = 4000) {
  const loc = page.locator(selector).locator("visible=true").first();
  try {
    await loc.waitFor({ timeout });
    await loc.click({ timeout });
    await sleep(250);
    return true;
  } catch {
    return false;
  }
}

export const has = async (page, selector) => (await page.locator(selector).locator("visible=true").count()) > 0;
export const text = async (page, selector) => (await page.locator(selector).allInnerTexts()).join("\n");
