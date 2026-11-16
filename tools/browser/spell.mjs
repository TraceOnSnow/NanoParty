/**
 * Browser check for 盲念咒语: four isolated players; nobody is sent their own stones.
 *   node tools/browser/spell.mjs            (server: pnpm dev:test)
 */
import { has, openRoom, sleep, startGame } from "./lib.mjs";

const room = await openRoom({
  players: 4,
  names: ["阿明", "小白", "老陈", "琪琪"],
  outDir: "reports/artifacts/browser/spell",
});
const { pages, check, state, indexOf, seats, network } = room;
const [host] = pages;
const game = async () => (await state()).segment?.state;

await startGame(host, "盲念咒语");
await host.waitForSelector(".spell-book");
let s = await game();
await check(
  "SP-01",
  "开局：八条咒语，自己面前是五块盖着的石头，别人的石头看得到",
  (await host.locator(".spell-row").count()) === 8 &&
    (await host.locator(".pseat.mine .stone.hidden").count()) === 5 &&
    (await host.locator(".pseat:not(.mine) .stone:not(.hidden)").count()) === 15,
);

// Everything the server pushed to a player: it must never contain that player's own hand.
const own = seats.map((seat, i) => {
  const mine = JSON.stringify(s.hands[seat.playerId]);
  return network.filter((f) => f.player === i && f.data.includes(`"${seat.playerId}":${mine}`)).length;
});
const leakedPiles = network.some((f) => f.data.includes('"supply":[') || f.data.includes('"secret":['));
await check("SP-02", "自己的石头、牌堆和秘密石没有发给本人", own.every((n) => n === 0) && !leakedPiles);

const page = pages[indexOf(s.current)];
const waiting = pages.find((p) => p !== page);
await check(
  "SP-03",
  "没轮到的人不能念咒",
  (await waiting.locator(".spell-row:enabled").count()) === 0 &&
    (await page.locator(".spell-row:enabled").count()) === 8,
  pages.indexOf(waiting),
);

// Call a number the player really holds (read from the server), then a wrong one.
const who = s.current;
const held = [...s.hands[who]].sort((a, b) => a - b);
const right = held[0];
await page
  .locator(".spell-row")
  .nth(right - 1)
  .click();
await sleep(400);
s = await game();
const moved = s.hands[who]?.length === 4 || s.phase !== "play";
await check(
  "SP-04",
  `喊中（${right}）：石头移到桌面，可以收手或继续喊更大的`,
  moved && (s.phase !== "play" || ((await has(page, 'button:has-text("收手")')) && s.board[right] >= 1)),
  pages.indexOf(page),
);
if (s.phase === "play" && s.current === who) {
  const lowAllowed = await page.locator(".spell-row:enabled").count();
  await check("SP-05", "喊中之后比它小的咒语不能再喊", lowAllowed === 9 - right, pages.indexOf(page));
  await page.locator('button:has-text("收手")').click();
  await sleep(400);
  s = await game();
  await check("SP-06", "收手后补满五块，轮到下一个人", s.hands[who].length === 5 && s.current !== who);
}
await check("SP-07", "没有页面报错", room.problems.length === 0);
await room.finish("spell");
