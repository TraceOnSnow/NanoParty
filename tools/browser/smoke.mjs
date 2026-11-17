/**
 * Browser smoke run for one game: isolated players open it through the real UI, then the test
 * players make plain legal moves through the normal command path while every page keeps rendering.
 *   node tools/browser/smoke.mjs <game name> <selector that must appear> [players] [moves]
 *   (server: pnpm dev:test)
 */
import { has, openRoom, sleep, startGame } from "./lib.mjs";

const [name, selector, players = "4", moves = "14"] = process.argv.slice(2);
const names = ["阿明", "小白", "老陈", "琪琪", "大刘", "阿紫"].slice(0, Number(players));
const slug = encodeURIComponent(name).replaceAll("%", "").slice(0, 24);
const room = await openRoom({ players: names.length, names, outDir: `reports/artifacts/browser/smoke-${slug}` });
const { pages, check, api, state } = room;
const [host] = pages;

await startGame(host, name);
// Games that open with a topic choice: the picker takes the first candidate.
await sleep(400);
for (const page of pages) {
  if (await has(page, ".topic-picker .pick-grid .pick:enabled")) {
    await page.locator(".pick-grid .pick").first().click();
    await page.locator('button:has-text("确认使用")').click();
    break;
  }
}
await host.waitForSelector(selector, { timeout: 8000 });
const everyone = await Promise.all(pages.map((p) => has(p, selector)));
await check("SM-01", `${name}：${names.length} 个玩家都看到了游戏面板`, everyone.every(Boolean));

let made = 0;
let rejected = 0;
for (let i = 0; i < Number(moves); i++) {
  const { moves: done } = await api("/autoplay", {});
  made += done.filter((m) => m.ok).length;
  rejected += done.filter((m) => !m.ok).length;
  await sleep(150);
}
const s = (await state()).segment;
await check(
  "SM-02",
  `${name}：测试玩家走了 ${made} 步（被拒 ${rejected} 步），面板仍在，阶段「${s?.state?.phase ?? "已结束"}」`,
  made > 0 && rejected === 0 && (await has(host, ".game")),
);
await check("SM-03", `${name}：最后一位玩家的画面`, await has(pages.at(-1), ".game"), pages.length - 1);
await check("SM-04", `${name}：没有页面报错`, room.problems.length === 0);
await room.finish("smoke");
