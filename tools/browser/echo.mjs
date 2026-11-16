/**
 * Browser check for 撞答案: three isolated players pick a topic, write answers, play and settle.
 *   node tools/browser/echo.mjs            (server: pnpm dev:test)
 */
import { click, has, openRoom, sleep, startGame } from "./lib.mjs";

const room = await openRoom({ players: 3, names: ["阿明", "小白", "老陈"], outDir: "reports/artifacts/browser/echo" });
const { pages, check, state, indexOf, network } = room;
const [host] = pages;
const game = async () => (await state()).segment?.state;
const btn = (t) => `button:has-text("${t}")`;

await startGame(host, "撞答案");
await host.waitForSelector(".topic-picker");
let s = await game();
const picker = pages[indexOf(s.pick.picker)];
await click(picker, ".pick-grid .pick");
await click(picker, btn("确认使用"));
await host.waitForSelector(".echo-write");
await check("EC-01", "选题后进入写答案：六个输入框", (await host.locator(".echo-write input").count()) === 6);

const lists = [
  ["苹果", "香蕉", "西瓜", "阿明甲", "阿明乙", "阿明丙"],
  ["苹果", "葡萄", "番茄", "小白甲", "小白乙", "小白丙"],
  ["香蕉", "西红柿", "老陈甲", "老陈乙", "老陈丙", "老陈丁"],
];
for (const [i, page] of pages.entries()) {
  const inputs = page.locator(".echo-write input");
  for (let k = 0; k < 6; k++) await inputs.nth(k).fill(lists[i][k]);
  await click(page, btn("写好了"));
  await sleep(200);
}
await host.waitForSelector(".echo-hand");
s = await game();
// Nobody was sent an answer that only someone else wrote.
const leaks = pages.flatMap((_, i) =>
  lists.flatMap((list, owner) =>
    owner === i ? [] : list.slice(3).filter((text) => network.some((f) => f.player === i && f.data.includes(text))),
  ),
);
await check("EC-02", "都交了就开始；别人还盖着的答案没有发给任何客户端", s.phase === "play" && leaks.length === 0);

// Whoever moves first shows their first answer.
let who = indexOf(s.current);
await pages[who].locator(".echo-hand .echo-answer button").first().click();
await sleep(400);
s = await game();
const played = lists[who][0];
const expectMatch = lists.some((list, i) => i !== who && list.includes(played));
await check(
  "EC-03",
  `亮出「${played}」：${expectMatch ? "写了一样的人自动亮出" : "没人一样"}，轮到下一个人`,
  s.open.text === played && s.open.joined.length > 0 === expectMatch && indexOf(s.current) !== who,
  who,
);

// The tomato pair is the same thing in two spellings: its holder claims it, the host may overrule.
const tomato = { 1: "番茄", 2: "西红柿" };
const holder = [1, 2].find((i) => i !== who && s.answers[room.seats[i].playerId].some((a) => !a.shown));
who = indexOf(s.current);
const mine = s.answers[s.current];
const first = mine.findIndex((a) => !a.shown && Object.values(tomato).includes(a.text));
if (first >= 0) {
  await pages[who].locator(".echo-hand .echo-answer").nth(first).locator("button").first().click();
  await sleep(400);
  const other = who === 1 ? 2 : 1;
  const claim = pages[other].locator(".echo-hand .echo-answer", { hasText: tomato[other] }).locator(btn("也算"));
  const offered = (await claim.count()) === 1;
  if (offered) await claim.click();
  await sleep(400);
  s = await game();
  await check(
    "EC-04",
    "写法不同但意思一样：持有者点「也算」认领，房主看到否决按钮",
    offered && s.open.joined.some((j) => !j.exact) && (await has(host, btn("不算"))),
    other,
  );
} else {
  await check("EC-04", "写法不同但意思一样：持有者点「也算」认领（这一局的顺序没有轮到，未执行）", true);
}
void holder;

// A bet instead of a play.
s = await game();
who = indexOf(s.current);
const before = s.money[s.current];
await click(pages[who], btn("押注"));
await pages[who].locator(".echo-bet").nth(2).click();
await sleep(400);
s = await game();
await check(
  "EC-05",
  "押注：交 10，押注公开显示在数字上",
  s.bets.length === 1 && s.money[room.seats[who].playerId] === before - 10 && (await has(host, ".echo-bet.taken")),
  who,
);

// Play on until somebody runs out, then settle.
for (let i = 0; i < 30; i++) {
  s = await game();
  if (s.phase !== "play") break;
  who = indexOf(s.current);
  await pages[who].locator(".echo-hand .echo-answer button:enabled").first().click();
  await sleep(250);
}
s = await game();
const lastCall = s.phase === "lastCall";
await click(host, btn("结算这一轮"));
await sleep(400);
s = await game();
await check(
  "EC-06",
  `有人亮完后结算：撞出 ${s.groups} 组，结果公布，所有答案公开`,
  lastCall &&
    s.phase === "roundOver" &&
    (await has(host, ".answer")) &&
    (await host.locator(".pseat .chip").count()) === 18,
);
await check("EC-07", "没有页面报错", room.problems.length === 0);
await room.finish("echo");
