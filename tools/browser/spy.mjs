/**
 * Browser check for 地点疑云: four isolated players; only the outsider is not shown the place.
 *   node tools/browser/spy.mjs            (server: pnpm dev:test)
 */
import { click, has, openRoom, sleep, startGame, text } from "./lib.mjs";

const room = await openRoom({
  players: 4,
  names: ["阿明", "小白", "老陈", "琪琪"],
  outDir: "reports/artifacts/browser/spy",
});
const { pages, check, state, indexOf, network, seats } = room;
const [host] = pages;
const game = async () => (await state()).segment?.state;
const btn = (t) => `button:has-text("${t}")`;

await startGame(host, "地点疑云");
await host.waitForSelector(".spy-card");
let s = await game();
const spy = indexOf(s.spy);
const insiders = pages.filter((_, i) => i !== spy);
const shown = await Promise.all(insiders.map((p) => text(p, ".spy-card strong")));
await check(
  "SY-01",
  "知情的三个人看到同一个地点，外人看到「你是外人」",
  shown.every((t) => t === s.place) && (await text(pages[spy], ".spy-card strong")) === "你是外人",
  spy,
);
// The place name is in everyone's list of candidates, so check the field that carries the answer.
const leaked = network.some((f) => f.player === spy && f.data.includes(`"place":"${s.place}"`));
const named = network.some((f) => f.player !== spy && f.data.includes(`"spy":"${seats[spy].playerId}"`));
await check("SY-02", "地点没有发给外人，谁是外人没有发给其他人", !leaked && !named);

// An insider accuses another insider; the vote fails and the talk goes on.
const [a, b, c] = insiders;
const nameOf = (page) => seats[pages.indexOf(page)].nickname;
await click(a, btn("我要指认一个人"));
await a.locator(".pseat.pick", { hasText: nameOf(b) }).click();
await sleep(300);
await check(
  "SY-03",
  "发起指认：被指认的人不能投票，其他人看到同意 / 不同意",
  (await has(c, btn("同意，翻开"))) && !(await has(b, btn("同意，翻开"))),
  pages.indexOf(c),
);
await click(c, btn("不同意"));
await click(pages[spy], btn("不同意"));
await sleep(300);
s = await game();
await check(
  "SY-04",
  "没过半：回到提问，发起人这一轮不能再指认",
  s.phase === "talk" && (await has(a, 'button:disabled:has-text("已经指认过")')),
);

// The outsider guesses the place from the list (a wrong place, read from the server).
const wrong = s.place === "学校" ? "医院" : "学校";
await click(pages[spy], btn("我猜到地点了"));
await pages[spy].locator(".spy-places button", { hasText: new RegExp(`^${wrong}$`) }).click();
await sleep(400);
s = await game();
await check(
  "SY-05",
  `外人猜「${wrong}」猜错：这一轮结束，公布地点和外人，其他人得分`,
  s.phase === "roundOver" && s.result.winner === "team" && (await text(host, ".game")).includes(s.place),
);
await check("SY-06", "没有页面报错", room.problems.length === 0);
await room.finish("spy");
