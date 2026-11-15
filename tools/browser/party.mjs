/**
 * Browser acceptance: a party from the first game to the recap, with four isolated players.
 * Covers the non-host picker, candidate history, the two chat buttons, settlement, a negotiated
 * adjustment, ending the party, the recap and the second party.
 *   node tools/browser/party.mjs            (server: pnpm dev:test)
 */
import { click, has, openRoom, sleep, text } from "./lib.mjs";

const room = await openRoom({
  players: 4,
  names: ["阿明", "小白", "老陈", "琪琪"],
  outDir: "reports/artifacts/browser/party",
});
const { pages, check, api, seats } = room;
const [host] = pages;
const btn = (t) => `button:has-text("${t}")`;

// ---- Lobby: party status, direct play and preferences side by side (AC-03, AC-26)
await check(
  "AC-26",
  "大厅显示派对状态、偏好入口和带封面的游戏卡",
  (await has(host, ".party-card")) && (await has(host, ".game-card .cover")),
);
await click(pages[1], 'summary:has-text("调整派对偏好")');
await pages[1].locator('.prefs input[placeholder^="我的建议"]').fill("想玩魂系主题");
await click(pages[1], btn("提建议"));
await click(host, 'summary:has-text("调整派对偏好")');
await host.locator('.prefs input[placeholder^="例如：换换口味"]').fill("魂系");
await click(host, btn("保存偏好"));
await sleep(300);
await check(
  "AC-03",
  "成员提建议、房主保存偏好；不需要先设偏好也能开玩",
  (await text(pages[2], ".party-card")).includes("想玩 魂系"),
);

// ---- Start 谁最可能 with endless rounds; the picker is not always the host
await host
  .locator(".game-card", { has: host.locator('.cover-name:text-is("谁最可能")') })
  .locator("button.primary")
  .click();
await host.waitForSelector(".topic-picker");
let state = await room.state();
if (state.segment.state.pick.picker === seats[0].playerId) {
  // Let the host's own turn pass so that the next picker is a guest.
  await click(host, ".pick.scale-card");
  await click(host, btn("确认使用"));
  await api("/autoplay", {});
  await click(host, btn("下一轮"));
  await host.waitForSelector(".topic-picker");
  state = await room.state();
}
const pickerIndex = room.indexOf(state.segment.state.pick.picker);
const picker = pages[pickerIndex];
const outsider = pages.find((p, i) => i !== pickerIndex && i !== 0);
const firstBatch = await picker.locator(".pick-grid .pick").allInnerTexts();

// Non-picker cannot act: the cards are disabled and there is no confirm button.
await check(
  "AC-07",
  "非题主看得到候选但不能选或确认",
  (await outsider.locator(".pick-grid .pick").first().isDisabled()) && !(await has(outsider, btn("确认使用"))),
  pages.indexOf(outsider),
);
// Picker: refresh (free), look at the history, select, then confirm.
await click(picker, btn("换一批"));
await sleep(300);
await click(picker, 'button.tab:has-text("历史候选")');
await sleep(300);
const historyTexts = await picker.locator(".pick-grid .pick").allInnerTexts();
await check(
  "AC-08",
  "换一批后，上一批没选的题出现在「历史候选」里",
  firstBatch.every((label) => historyTexts.some((h) => h.includes(label.split("\n")[0]))),
  pickerIndex,
);
await click(picker, ".pick-grid .pick");
const before = (await room.state()).segment.state.phase;
await check(
  "AC-07",
  "题主点卡片只是选中，还没有消耗题目",
  before === "pick" && (await has(picker, ".pick.selected")),
  pickerIndex,
);
await click(picker, btn("确认使用"));
await host.waitForSelector(".game .question, .game h2");
await check("AC-07", "非房主题主独立完成选题并确认", (await room.state()).segment.state.phase === "vote", pickerIndex);

// ---- Chat: plain send vs. send-and-ask-AI (AC-04)
const aiCalls = async () => (await text(host, ".chat-list")).split("（模拟 AI）").length - 1;
const callsBefore = await aiCalls();
await pages[2].locator(".chat-input textarea").fill("这题有点意思");
await click(pages[2], '.chat-buttons button:has-text("发送"):not(.ask-ai)');
await sleep(1200);
const afterPlain = await aiCalls();
await pages[2].locator(".chat-input textarea").fill("推荐个游戏吧");
await click(pages[2], "button.ask-ai");
await host.waitForFunction(
  (n) => document.querySelector(".chat-list").innerText.split("（模拟 AI）").length - 1 > n,
  afterPlain,
  { timeout: 8000 },
);
await check(
  "AC-04",
  "普通发送不触发 AI；「发送并找 AI」触发一次并公开消息",
  afterPlain === callsBefore && (await aiCalls()) === afterPlain + 1,
  2,
);

// ---- Play the round, then end and settle (AC-17, AC-18)
await api("/autoplay", {});
await host.waitForSelector(btn("下一轮"));
await check(
  "AC-17",
  "游戏内得分显示在左侧，右侧派对积分还是 0",
  (await has(host, ".raw-scores")) && !/[1-9]/.test(await text(host, ".scoreboard strong")),
);
await click(host, btn("结束并结算"));
await pages[1].waitForSelector('.tag:has-text("结算")');
await check(
  "AC-18",
  "无限轮玩法「结束并结算」：出现结算页，预计派对积分按名次给出",
  await has(pages[1], "table.results"),
  1,
);
await check("AC-17", "非房主只能等待，看不到确认按钮", !(await has(pages[1], btn("接受并返回大厅"))), 1);

// ---- Negotiation: a player asks the AI; here the host uses the manual form (works without AI) (AC-19)
await click(host, 'summary:has-text("手动调分")');
await host.locator(".manual-adjust .options input").nth(1).fill("5");
await host.locator(".manual-adjust .options input").nth(2).fill("-20");
await host.locator('.manual-adjust input[placeholder^="理由"]').fill("小白这把纯 C，老陈交手续费");
await click(host, btn("提出方案"));
await pages[2].waitForSelector(".adjustment");
const boardBefore = await text(pages[2], ".scoreboard");
await check(
  "AC-19",
  "调分方案对所有人可见、标明未生效；右侧积分没有变化",
  (await text(pages[2], ".adjustment")).includes("尚未生效") &&
    !/[1-9]/.test(await text(pages[2], ".scoreboard strong")),
  2,
);
await check("AC-19", "非房主没有批准按钮", !(await has(pages[2], btn("批准此方案并结算"))), 2);
await click(host, btn("批准此方案并结算"));
await host.waitForSelector(".lobby");
await sleep(400);
const board = await text(pages[3], ".scoreboard");
await check(
  "AC-19",
  "房主批准后一次入账：名次奖励 + 调整，可出现负分",
  board !== boardBefore && board.includes("-"),
  3,
);

// ---- A second game is abandoned: no party points (AC-18)
await host
  .locator(".game-card", { has: host.locator('.cover-name:text-is("谁最可能")') })
  .locator("button.primary")
  .click();
await host.waitForSelector(".topic-picker");
await api("/autoplay", {});
await click(host, btn("放弃本场"));
await host.waitForSelector(".lobby");
await sleep(300);
await check(
  "AC-18",
  "「放弃本场」不发派对积分",
  (await text(pages[3], ".scoreboard")) === board && (await text(host, ".lobby")).includes("已放弃"),
  3,
);

// ---- Reconnect: a reload brings the same player back with everything intact
const mine = await text(pages[2], ".scoreboard");
await pages[2].reload();
await pages[2].waitForSelector(".lobby");
await check(
  "AC-02",
  "刷新页面后恢复同一身份和派对积分",
  (await text(pages[2], ".scoreboard")) === mine && mine.includes("-"),
  2,
);

// ---- End the party → recap; the next party starts from zero (AC-01, AC-21)
await click(host, btn("结束本场派对"));
await host.waitForFunction(() => document.querySelector(".party-card")?.innerText.includes("第 2 场"));
await check(
  "AC-01",
  "结束派对后新的一场从零开始，成员保留",
  !/[1-9]/.test(await text(pages[1], ".scoreboard strong")) && (await pages[1].locator(".scoreboard li").count()) === 4,
  1,
);
await click(pages[1], btn("上一场回顾"));
await pages[1].waitForSelector(".recap");
await sleep(3500);
const recap = await text(pages[1], ".recap");
await check(
  "AC-21",
  "回顾包含最终排名、逐场战绩、批准的调整、积分变化和经过",
  ["最终排名", "谁最可能", "小白这把纯 C", "积分变化", "经过", "放弃"].every((w) => recap.includes(w)),
  1,
);
await check("AC-21", "AI 总结异步生成（这里是模拟模型，已标注），不阻塞回顾和新派对", recap.includes("AI 主持的话"), 1);
await click(pages[1], btn("返回大厅"));
await click(pages[1], 'summary:has-text("历史派对")');
await sleep(500);
await check("AC-01", "历史派对列表里能找到第 1 场", (await text(pages[1], ".history-list")).includes("第 1 场"), 1);

await room.finish("party");
