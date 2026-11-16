/**
 * Browser check for 凑一桌: three isolated players take rules and ingredients through the real UI.
 *   node tools/browser/platter.mjs            (server: pnpm dev:test)
 */
import { click, has, openRoom, sleep, startGame, text } from "./lib.mjs";

const room = await openRoom({
  players: 3,
  names: ["阿明", "小白", "老陈"],
  outDir: "reports/artifacts/browser/platter",
});
const { pages, check, state, indexOf } = room;
const [host] = pages;

await startGame(host, "凑一桌");
await host.waitForSelector(".platter-market");
await check(
  "PL-01",
  "开局：三张规则牌、六张材料牌、每人一栏",
  (await host.locator(".platter-rule").count()) === 3 &&
    (await host.locator(".platter-item").count()) === 6 &&
    (await host.locator(".platter-player").count()) === 3,
);

const turnPage = async () => pages[indexOf((await state()).segment.state.current)];
const others = async () => {
  const turn = indexOf((await state()).segment.state.current);
  return pages.filter((_, i) => i !== turn);
};

// Someone not on turn cannot click anything on the table.
const waiting = (await others())[0];
await check(
  "PL-02",
  "没轮到的人，桌上的牌都点不了",
  (await waiting.locator(".platter-market button:enabled").count()) === 0,
  pages.indexOf(waiting),
);

// Turn 1: take a rule.
let page = await turnPage();
await page.locator(".platter-rule").first().click();
await sleep(150);
const notYet = Object.values((await state()).segment.state.rules).every((r) => r.length === 0);
await click(page, 'button:has-text("拿这张规则牌")');
await sleep(300);
await check(
  "PL-03",
  "拿一张规则牌：点一下只是选中，确认后才出现在自己的盘子里并显示当前分值",
  notYet && (await page.locator(".platter-player .platter-rules li").count()) === 1,
  pages.indexOf(page),
);

// Turn 2: take two ingredients; one alone is not enough.
page = await turnPage();
await page.locator(".platter-item").nth(0).click();
const oneOnly = await page.locator('button:has-text("拿走选中的")').isDisabled();
await page.locator(".platter-item").nth(3).click();
await click(page, 'button:has-text("拿走选中的")');
await sleep(300);
const taken = (await state()).segment.state.items;
await check(
  "PL-04",
  "拿两张材料：只选一张不能拿，拿完桌面补满",
  oneOnly &&
    Object.values(taken).some((row) => row.reduce((a, b) => a + b, 0) === 2) &&
    (await page.locator(".platter-item:has-text('—')").count()) === 0,
  pages.indexOf(page),
);

// Turn 3 passes with a rule; turn 4 is the first player again, who turns their rule over.
page = await turnPage();
await page.locator(".platter-rule").nth(1).click();
await click(page, 'button:has-text("拿这张规则牌")');
await sleep(300);
page = await turnPage();
await click(page, '.platter-rules button:has-text("翻成")');
await sleep(300);
await check(
  "PL-05",
  "翻牌：规则牌变成材料，本回合不能再翻，仍要拿牌",
  (await state()).segment.state.flipped === true &&
    !(await has(page, '.platter-rules button:has-text("翻成")')) &&
    (await text(page, ".game > .muted")).includes("轮到你"),
  pages.indexOf(page),
);

/** A real press-move-release with the mouse. */
const dragTo = async (p, from, to) => {
  const mid = async (l) => {
    const b = await l.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  await from.scrollIntoViewIfNeeded();
  const a = await mid(from);
  const b = await mid(to);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await p.mouse.move(b.x, b.y, { steps: 6 });
  await p.mouse.up();
  await sleep(300);
};

// Still the same player's turn: drag a rule card onto their own plate.
const mine = (await state()).segment.state.current;
const had = (await state()).segment.state.rules[mine].length;
await dragTo(page, page.locator(".platter-rule:enabled").first(), page.locator(".platter-player.mine header"));
const s7 = (await state()).segment.state;
await check(
  "PL-07",
  "拖动：把规则牌拖到自己的盘子里就拿走，轮到下一个人",
  s7.rules[mine].length === had + 1 && s7.current !== mine,
  pages.indexOf(page),
);

// Play on to the end through the UI.
for (let i = 0; i < 120; i++) {
  const s = await state();
  if (!s.segment || s.segment.state?.phase !== "play") break;
  page = pages[indexOf(s.segment.state.current)];
  const items = page.locator(".platter-item:enabled");
  const n = Math.min(2, await items.count());
  const rulesLeft = await page.locator(".platter-rule:enabled").count();
  if (n > 0 && (i % 3 !== 0 || rulesLeft === 0)) {
    for (let k = 0; k < n; k++) await items.nth(k).click();
    await click(page, 'button:has-text("拿走选中的")');
  } else {
    await page.locator(".platter-rule:enabled").first().click();
    await click(page, 'button:has-text("拿这张规则牌")');
  }
  await sleep(120);
}
await sleep(500);
await check("PL-06", "所有牌拿完后进入结算", (await text(host, "main, body")).includes("这一场的结果"));
await room.finish("platter");
