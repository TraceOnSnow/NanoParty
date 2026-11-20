/**
 * Browser run for 「数牌拆拼」: three isolated players lay sets through the real panel — an invalid
 * draft is refused, the hint builds sets from the rack, one tile is hung on a set by hand — and
 * nobody is ever sent another player's rack.
 *   node tools/browser/meld.mjs      (server: pnpm dev:test)
 */
import { click, has, openRoom, sleep, startGame } from "./lib.mjs";

const names = ["阿明", "小白", "老陈"];
const room = await openRoom({ players: 3, names, outDir: "reports/artifacts/browser/meld" });
const { pages, check, state, indexOf } = room;
const game = async () => (await state()).segment?.state;
const label = (t) => (t.n === 0 ? "百搭" : `${t.color}${t.n}`);

await startGame(pages[0], "数牌拆拼");
await pages[0].waitForSelector(".meld");
await sleep(500);
const racks = await Promise.all(pages.map((p) => p.locator(".meld-hand .meld-tile").count()));
await check(
  "ME-01",
  `三个玩家都看到面板，各自 14 张牌（${racks.join("、")}）`,
  racks.every((n) => n === 14),
);

// An unfinished set is marked and cannot be sent.
{
  const s = await game();
  const page = pages[indexOf(s.current)];
  await page.locator(".meld-hand .meld-tile").first().click();
  await click(page, ".meld-drop.new");
  const bad = (await has(page, ".meld-set.bad")) && (await page.locator(".host-row button.primary").isDisabled());
  await check("ME-02", "只摆一张牌：这一组标红，出牌按钮不可用", bad, indexOf(s.current));
  await click(page, 'button:has-text("重来")');
  await check("ME-03", "点「重来」后牌回到手里", (await page.locator(".meld-hand .meld-tile").count()) === 14);
}

/** A rack tile that extends a set on the table, found from the server's state. */
function extension(s) {
  for (const tile of s.hands[s.current]) {
    if (tile.n === 0) continue;
    for (const [k, set] of s.table.entries()) {
      if (set.some((t) => t.n === 0)) continue;
      const numbers = set.map((t) => t.n);
      const run = set.every((t) => t.color === set[0].color) && numbers[0] !== numbers[1];
      if (
        run &&
        tile.color === set[0].color &&
        (tile.n === Math.min(...numbers) - 1 || tile.n === Math.max(...numbers) + 1)
      )
        return { tile, k };
      if (!run && set.length === 3 && tile.n === numbers[0] && !set.some((t) => t.color === tile.color))
        return { tile, k };
    }
  }
  return null;
}

let hinted = 0;
let hung = false;
let turns = 0;
for (; turns < 150; turns++) {
  const s = await game();
  if (!s || s.phase !== "play") break;
  const who = indexOf(s.current);
  const page = pages[who];
  await page.waitForSelector('.host-row button:has-text("帮我找现成的组")');
  const send = page.locator(".host-row button.primary");
  const ext = s.opened[s.current] && !hung ? extension(s) : null;
  if (ext) {
    await page
      .locator(`.meld-hand .meld-tile[aria-label="${label(ext.tile)}"]`)
      .first()
      .click();
    await page.locator(".meld-table .meld-set").nth(ext.k).locator(".meld-drop").click();
    await sleep(200);
    const ready = (await send.innerText()).includes("1 张");
    await check("ME-05", `${names[who]} 把 ${label(ext.tile)} 接到桌上第 ${ext.k + 1} 组，可以出牌`, ready, who);
    await send.click();
    await sleep(400);
    const after = await game();
    const grown = after.table.some(
      (set) => set.length === s.table[ext.k].length + 1 && set.some((t) => t.id === ext.tile.id),
    );
    await check("ME-06", "服务端接受了这次拆拼，那一组多了一张", grown, (who + 1) % 3);
    hung = true;
    continue;
  }
  await page.locator('button:has-text("帮我找现成的组")').click();
  await sleep(150);
  if (await send.isEnabled()) {
    if (hinted === 0) await check("ME-04", `${names[who]} 用「帮我找现成的组」摆出了第一次出牌`, true, who);
    await send.click();
    hinted += 1;
  } else {
    await click(page, 'button:has-text("重来")', 300);
    await page.locator('.host-row button:has-text("摸一张"), .host-row button:has-text("过")').first().click();
  }
  await sleep(250);
  if (hung && hinted >= 3) break;
}
const end = await game();
await check(
  "ME-07",
  `走了 ${turns} 个回合：出牌 ${hinted} 次，桌上 ${end.table.length} 组`,
  hinted > 0 && end.table.length > 0,
  1,
);
if (!hung) await check("ME-05", "这一局没有出现能直接接上的牌（未验证手动拆拼）", false);

// Nobody has been sent a tile that is still in someone else's rack.
const leaks = [];
for (const [i, seat] of room.seats.entries()) {
  const received = room.network
    .filter((f) => f.player === i)
    .map((f) => f.data)
    .join("\n");
  for (const [owner, hand] of Object.entries(end.hands)) {
    if (owner === seat.playerId) continue;
    for (const t of hand) if (received.includes(`"${t.id}"`)) leaks.push(`${seat.nickname} 收到了 ${t.id}`);
  }
}
await check("ME-08", `没有人收到过别人手里的牌（${leaks.length} 处泄露）`, leaks.length === 0, 2);
await room.finish("meld");
