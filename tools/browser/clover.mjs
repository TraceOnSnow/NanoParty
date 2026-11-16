/**
 * Browser check for 四叶联想: cards are dragged onto the board, tapped to turn, and dragged back.
 *   node tools/browser/clover.mjs            (server: pnpm dev:test)
 */
import { openRoom, sleep, startGame } from "./lib.mjs";

const room = await openRoom({
  players: 3,
  names: ["阿明", "小白", "老陈"],
  outDir: "reports/artifacts/browser/clover",
});
const { pages, check, state, api, seats, indexOf } = room;
const [host] = pages;
const game = async () => (await state()).segment?.state;
const act = (playerId, action) =>
  state().then((s) => api("/act", { playerId, command: { type: "gameAction", segmentId: s.segment.id, action } }));

await startGame(host, "四叶联想");
await host.waitForSelector(".clover-board");
await check(
  "CL-01",
  "写提示：四张卡摆成一圈，四条边各有一个输入框",
  (await host.locator(".clover-board .clover-card").count()) === 4 &&
    (await host.locator(".clover-clue input").count()) === 4,
);

for (const seat of seats) {
  const s = await game();
  await act(seat.playerId, {
    type: "clues",
    step: s.step,
    clues: ["甲", "乙", "丙", "丁"].map((c) => `${c}${seat.nickname}`),
  });
}
await sleep(400);
let s = await game();
const page = pages.find((_, i) => seats[i].playerId !== s.solve.author);
await page.waitForSelector(".clover-tray .clover-card");
await check(
  "CL-02",
  "还原：桌面上四个空位、四条提示，下面五张卡",
  (await page.locator(".clover-tray .clover-card").count()) === 5,
  pages.indexOf(page),
);

const centre = async (locator) => {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const drag = async (from, to) => {
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await sleep(250);
};

await drag(page.locator(".clover-tray .clover-card").first(), page.locator(".clover-slot").nth(1));
s = await game();
await check(
  "CL-03",
  "把一张卡从下面拖到第二个位置",
  s.solve.slots[1] !== null && s.solve.slots[1].flipped === false,
  pages.indexOf(page),
);

await page.locator(".clover-slot").nth(1).click();
await sleep(250);
s = await game();
await check("CL-04", "点一下摆好的卡：调转方向", s.solve.slots[1]?.flipped === true, pages.indexOf(page));

await drag(page.locator(".clover-slot").nth(1), page.locator(".clover-slot").nth(3));
s = await game();
await check(
  "CL-05",
  "在位置之间拖动：卡换到第四个位置，方向保留",
  s.solve.slots[1] === null && s.solve.slots[3]?.flipped === true,
  pages.indexOf(page),
);

await drag(page.locator(".clover-slot").nth(3), page.locator(".clover-tray"));
s = await game();
await check(
  "CL-06",
  "拖回下面：位置空出来",
  s.solve.slots.every((x) => x === null),
  pages.indexOf(page),
);

// The author sees the board but cannot move anything.
const author = pages[indexOf(s.solve.author)];
await check(
  "CL-07",
  "出题的人不能动卡",
  (await author.locator(".clover-tray .clover-card:enabled").count()) === 0,
  pages.indexOf(author),
);
await room.finish("clover");
