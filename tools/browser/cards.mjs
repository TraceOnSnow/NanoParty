/**
 * Card table check with a real mouse: drag a card onto the felt, drag a chip onto the offer,
 * and play a card at a seat. Needs the test instance (pnpm dev:test).
 *   node tools/browser/cards.mjs
 */
import { has, openRoom, sleep, text } from "./lib.mjs";

const room = await openRoom({
  players: 4,
  names: ["阿明", "小白", "老陈", "琪琪"],
  outDir: "reports/artifacts/browser/cards",
});
const { pages, api, seats, check } = room;
const host = seats[0].playerId;
const start = async (gameId) => {
  const s = await room.state();
  if (s.segment)
    await api("/act", { playerId: host, command: { type: "endSegment", segmentId: s.segment.id, mode: "abandon" } });
  await api("/act", { playerId: host, command: { type: "startGame", gameId, config: {} } });
  await sleep(600);
};
const centre = async (locator) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
async function drag(page, from, to) {
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await sleep(400);
}
/** The page of whoever the game is waiting for. */
const turnPage = async () => {
  for (const p of pages) if (await has(p, ".play-hand .hand-slot:not([disabled]), .chip-tray .host-row")) return p;
  return pages[0];
};

await start("rowcards");
let p = pages[1];
await p.locator(".play-hand .hand-slot").first().click();
await check("CT-01", "点一张牌：桌上标出它会落在哪一行", await has(p, ".felt .card-row.aim"), 1);
await drag(p, p.locator(".play-hand .hand-slot").nth(2), p.locator(".felt"));
await check(
  "CT-02",
  "把牌拖到桌上就是暗出，手里少一张",
  (await has(p, ".card-face.back")) && (await p.locator(".play-hand .hand-slot").count()) === 9,
  1,
);

await start("nothanks");
p = await turnPage();
const before = await text(p, ".pot .felt-note");
await drag(p, p.locator(".chip-tray .hand-slot"), p.locator(".felt"));
const q = pages.find((x) => x !== p);
await check(
  "CT-03",
  "把筹码拖到桌上等于说不要，牌上多一个筹码",
  before.includes("0") && (await q.locator(".pot .token").count()) === 1,
  pages.indexOf(q),
);
p = await turnPage();
await drag(p, p.locator(".felt .hand-slot"), p.locator(".pseat.mine"));
await check(
  "CT-04",
  "把牌拖到自己面前等于收下",
  (await p.locator(".pseat.mine .mini-card").count()) === 1,
  pages.indexOf(p),
);

await start("flush");
p = await turnPage();
await p.locator(".play-hand .hand-slot:not([disabled])").first().click();
await check(
  "CT-05",
  "压牌出清：点牌后说明它的强度和会压掉谁",
  /强度 \d+/.test(await text(p, ".game > p.muted")),
  pages.indexOf(p),
);
await p.locator(".play-hand > button.primary").click();
await sleep(400);
await check("CT-06", "确认后牌出现在自己座位前", await has(p, ".pseat.mine .card-face:not(.empty)"), pages.indexOf(p));

await start("duel");
p = await turnPage();
const hand = p.locator(".play-hand .hand-slot:not([disabled])");
await hand.first().click();
await sleep(200);
if (await has(p, "button.pseat.pick")) await p.locator("button.pseat.pick").first().click();
else await p.locator(".play-hand > button.primary").click();
await sleep(400);
await check(
  "CT-07",
  "暗牌对决：选牌再点人（或确认）后出牌进入记录",
  (await p.locator(".describe-list li").count()) === 1,
  pages.indexOf(p),
);

await start("skull");
for (const page of pages) await drag(page, page.locator(".play-hand .hand-slot").first(), page.locator(".felt"));
await check(
  "CT-08",
  "翻牌诈唬：每人拖一张到桌上，四堆各一张",
  (await pages[0].locator(".disc-stack .disc.back").count()) === 4,
);

await start("crew");
p = await turnPage();
for (
  let i = 0;
  i < 6 &&
  !(await has(pages[0], ".play-hand .hand-slot:not([disabled])")) &&
  !(await has(pages[1], ".play-hand .hand-slot:not([disabled])")) &&
  !(await has(pages[2], ".play-hand .hand-slot:not([disabled])")) &&
  !(await has(pages[3], ".play-hand .hand-slot:not([disabled])"));
  i++
) {
  for (const page of pages)
    if (await has(page, "button.task.open")) await page.locator("button.task.open").first().click();
  await sleep(300);
}
p = await turnPage();
await drag(p, p.locator(".play-hand .hand-slot:not([disabled])").first(), p.locator(".felt"));
await check(
  "CT-09",
  "合作吃墩：认领完任务后把牌拖到桌上，牌出现在座位前",
  await has(p, ".pseat.mine .card-face:not(.empty)"),
  pages.indexOf(p),
);

await room.finish("cards");
