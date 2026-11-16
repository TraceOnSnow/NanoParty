/**
 * Screenshots of the main screens at desktop and phone width, for visual review.
 *   OUT=reports/artifacts/browser/ui-before node tools/browser/shots.mjs      (server: pnpm dev:test)
 */
import { openRoom, sleep } from "./lib.mjs";

const out = process.env.OUT ?? "reports/artifacts/browser/ui";
const room = await openRoom({ players: 4, names: ["阿明", "小白", "老陈", "琪琪"], outDir: out });
const { pages, api, seats } = room;
const [host, b] = pages;
const shot = async (page, name) => {
  await page.setViewportSize({ width: 1366, height: 860 });
  await page.screenshot({ path: `${out}/${name}-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 780 });
  await sleep(150);
  await page.screenshot({ path: `${out}/${name}-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 860 });
};
const act = (playerId, command) => api("/act", { playerId, command });
const start = (gameId, config = {}) => act(seats[0].playerId, { type: "startGame", gameId, config });
const end = async () => {
  const s = await room.state();
  if (s.segment) await act(seats[0].playerId, { type: "endSegment", segmentId: s.segment.id, mode: "abandon" });
  await sleep(200);
};

await b.locator("textarea").first().fill("来点抽象题目");
await b.locator('button:has-text("发送")').first().click();
await sleep(300);
await shot(host, "01-lobby");

await start("spectrum");
await sleep(400);
await shot(host, "02-pick");
await api("/autoplay", {});
await sleep(400);
await shot(b, "03-spectrum");
await end();

await start("wager");
await sleep(400);
await api("/autoplay", {});
await sleep(300);
await shot(b, "04-wager");
await end();

await start("seven");
await sleep(400);
await shot(host, "05-seven");
await end();

await start("platter");
await sleep(400);
await shot(host, "06-platter");
const s = await room.state();
await act(seats[0].playerId, { type: "endSegment", segmentId: s.segment.id, mode: "settle" });
await sleep(400);
await shot(host, "07-settlement");
await shot(b, "08-settlement-player");
console.log("done", out);
process.exit(0);
