/**
 * Browser check for 攒七张: three isolated players draw and discard through the real UI.
 *   node tools/browser/seven.mjs            (server: pnpm dev:test)
 */
import { click, has, openRoom, sleep, startGame, text } from "./lib.mjs";

const room = await openRoom({ players: 3, names: ["阿明", "小白", "老陈"], outDir: "reports/artifacts/browser/seven" });
const { pages, check, state, indexOf, network, seats } = room;
const [host] = pages;
const game = async () => (await state()).segment?.state;
const turnPage = async () => pages[indexOf((await game()).current)];
const handCards = (p) => p.locator(".seven-row").nth(1).locator(".seven-card");
/** Lift a card, then confirm: nothing leaves the hand on the first press. */
const discard = async (p, which) => {
  await handCards(p)[which]().click();
  await click(p, '.game > button.primary.wide:has-text("弃掉")');
};

await startGame(host, "攒七张");
await host.waitForSelector(".seven-deck");
const hand = host.locator(".seven-row").nth(1).locator(".seven-card");
await check(
  "SV-01",
  "开局：七张手牌，每张显示类别、当前分值和效果",
  (await hand.count()) === 7 && (await has(host, ".seven-text")),
);

// Nobody is sent another player's cards or the deck (checked on everything the server pushed).
const s0 = await game();
const leaks = seats.flatMap((seat, i) =>
  seats
    .filter((other) => other.playerId !== seat.playerId)
    .flatMap((other) => s0.hands[other.playerId])
    .concat(s0.deck)
    .filter((id) => network.some((f) => f.player === i && f.data.includes(`"id":"${id}"`))),
);
await check("SV-02", "别人的手牌和牌堆没有发给任何客户端", leaks.length === 0);

let page = await turnPage();
const waiting = pages.find((p) => p !== page);
await check(
  "SV-03",
  "没轮到的人不能摸牌",
  (await waiting.locator(".seven-deck:enabled").count()) === 0,
  pages.indexOf(waiting),
);

await page.locator(".seven-deck").click();
await sleep(300);
const eight = (await handCards(page).count()) === 8;
const hints = await page.locator(".seven-hand .seven-hint").count();
await handCards(page).first().click();
await sleep(150);
const stillEight = (await game()).discards.length === 0 && (await has(page, ".seven-card.lifted"));
await click(page, '.game > button.primary.wide:has-text("弃掉")');
await sleep(300);
await check(
  "SV-04",
  "摸牌堆后手里八张，每张标出弃掉后的分数；点一下只是抬起，确认后才弃掉，弃牌区公开一张",
  eight &&
    hints === 8 &&
    stillEight &&
    (await game()).discards.length === 1 &&
    (await page.locator(".seven-row").nth(1).locator(".seven-card").count()) === 7,
  pages.indexOf(page),
);

page = await turnPage();
const open = (await game()).discards[0];
await page.locator(".seven-row").first().locator(".seven-card").nth(1).click();
await click(page, '.game > button.primary.wide:has-text("拿走")');
await sleep(300);
const after = await game();
await check(
  "SV-05",
  "下一个人可以从弃牌区把那张牌拿走",
  after.hands[after.current].includes(open) && after.discards.length === 0,
  pages.indexOf(page),
);
await discard(page, "first");
await sleep(200);

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

page = await turnPage();
await dragTo(page, page.locator(".seven-deck"), page.locator(".seven-hand"));
const drawn = (await game()).phase === "discard" && (await handCards(page).count()) === 8;
const before = (await game()).discards.length;
const thrown = (await game()).hands[(await game()).current][0];
await dragTo(page, handCards(page).first(), page.locator(".felt .felt-note").first());
const g7 = await game();
await check(
  "SV-07",
  "拖动：把牌堆拖进手牌是摸牌，把手牌拖到桌上是弃牌",
  drawn && g7.discards.length === before + 1 && g7.discards.at(-1) === thrown,
  pages.indexOf(page),
);

for (let i = 0; i < 80; i++) {
  const s = await game();
  if (!s || s.phase === "finished") break;
  page = pages[indexOf(s.current)];
  if (s.phase === "draw") await page.locator(".seven-deck").click();
  else await discard(page, "last");
  await sleep(120);
}
await sleep(500);
await check("SV-06", "弃牌区摆满后进入结算", (await text(host, "main, body")).includes("这一场的结果"));
await room.finish("seven");
