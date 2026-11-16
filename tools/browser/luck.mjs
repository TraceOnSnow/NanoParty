/**
 * Browser check for the two push-your-luck games (贪心登顶, 别翻重): three isolated players
 * act through the real UI.
 *   node tools/browser/luck.mjs climb       (server: pnpm dev:test)
 *   node tools/browser/luck.mjs flipout
 */
import { click, has, openRoom, sleep, startGame } from "./lib.mjs";

const which = process.argv[2] === "flipout" ? "flipout" : "climb";
const room = await openRoom({ players: 3, names: ["阿明", "小白", "老陈"], outDir: "reports/artifacts/browser/luck" });
const { pages, check, state, indexOf } = room;
const [host] = pages;
const game = async () => (await state()).segment?.state;
const btn = (t) => `button:has-text("${t}")`;

let s;
let page;
if (which === "climb") {
  // ---- 贪心登顶
  await startGame(host, "贪心登顶");
  await host.waitForSelector(".climb-board");
  await check("LK-01", "贪心登顶：十一列棋盘，中间最长", (await host.locator(".climb-col").count()) === 11);
  s = await game();
  page = pages[indexOf(s.current)];
  const other = pages.find((p) => p !== page);
  await check(
    "LK-02",
    "没轮到的人没有掷骰子的按钮",
    !(await has(other, btn("掷骰子"))) && (await has(page, btn("掷骰子"))),
    pages.indexOf(other),
  );

  // Roll until a turn banks something (a first roll can only fail to fit in rare positions).
  let banked = false;
  for (let i = 0; i < 12 && !banked; i++) {
    s = await game();
    page = pages[indexOf(s.current)];
    const who = s.current;
    await click(page, `${btn("掷骰子")}, ${btn("再掷一次")}`);
    await sleep(300);
    s = await game();
    if (s.phase !== "move" || s.current !== who) continue;
    await page.locator(".climb-turn button.primary").first().click();
    await sleep(300);
    const climbing = await page.locator(".climb-dot.now").count();
    await click(page, btn("见好就收"));
    await sleep(300);
    s = await game();
    banked = climbing > 0 && Object.keys(s.saved[who]).length > 0 && s.current !== who;
    if (banked) await check("LK-03", "掷骰、分骰子、前进、见好就收：进度存下并轮到下一个人", true, pages.indexOf(page));
  }
  if (!banked) await check("LK-03", "掷骰、分骰子、前进、见好就收：进度存下并轮到下一个人", false);
  await check("LK-04", "棋盘上出现存下的进度圆点", (await host.locator(".climb-cell .climb-dot").count()) > 0);
} else {
  // ---- 别翻重
  await startGame(host, "别翻重");
  await host.waitForSelector(".flipout");
  s = await game();
  await check(
    "LK-05",
    "别翻重：发牌后每人面前的牌公开，牌堆不发给客户端",
    (await host.locator(".flip-card").count()) >= 1 && !room.network.some((f) => f.data.includes('"deck":[')),
  );
  // Play until someone has stayed or bust, handling whatever special cards come up.
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) {
    s = await game();
    if (s.phase === "roundOver" || s.phase === "gameOver") break;
    if (s.phase === "turn") {
      page = pages[indexOf(s.current)];
      const mine = s.cards[s.current].filter((c) => c.kind === "num").length;
      await click(page, mine >= 2 && !(await page.locator(btn("有 0 不能停")).count()) ? btn("停（") : btn("再翻一张"));
    } else if (s.phase === "assign") {
      page = pages[indexOf(s.pending.by)];
      await page.locator(".flip-pending .host-row button").first().click();
    } else if (s.phase === "use") {
      page = pages[indexOf(s.pending.by)];
      const need = s.pending.card.act === "swap" ? 2 : 1;
      const seatsWithCards = page.locator(".pseat:has(button.flip-card)");
      for (let k = 0; k < need; k++) await seatsWithCards.nth(k).locator("button.flip-card").first().click();
      await click(page, `.flip-pending ${btn("确定")}`);
    }
    await sleep(300);
    s = await game();
    moved = Object.values(s.status).some((x) => x !== "active");
  }
  await check("LK-06", "轮流翻牌或停：有人停下或爆掉，座位上显示状态", moved && (await has(host, ".pseat .tag")));
}
await check("LK-07", "没有页面报错", room.problems.length === 0);
await room.finish(`luck-${which}`);
