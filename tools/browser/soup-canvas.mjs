/**
 * Browser acceptance: AI-hosted soup on the left panel, a multi-step canvas flow composed by the
 * AI host, secrets on the wire, and the single-window test room.
 * The model here is the labelled development stand-in (AI_MOCK); real-model results are separate.
 *   node tools/browser/soup-canvas.mjs      (server: pnpm dev:test with AI_MOCK=true)
 */
import { chromium } from "playwright";
import { BASE, click, has, openRoom, sleep, text } from "./lib.mjs";

const outDir = "reports/artifacts/browser/soup-canvas";
const room = await openRoom({ players: 4, names: ["阿明", "小白", "老陈", "琪琪"], outDir });
const { pages, check, seats } = room;
const [host] = pages;
const btn = (t) => `button:has-text("${t}")`;
const card = (name) => host.locator(".game-card", { has: host.locator(`.cover-name:text-is("${name}")`) });

// ---------------------------------------------------------------- AI soup (AC-12, AC-13, AC-14, AC-10)
await card("海龟汤").locator('summary:has-text("设置")').click();
await card("海龟汤").locator('input[type="checkbox"]').check();
await card("海龟汤").locator("button.primary").click();
await host.waitForSelector(".topic-picker");
let state = await room.state();
const picker = pages[room.indexOf(state.segment.state.pick.picker)];
await click(picker, ".pick-grid .pick");
await click(picker, btn("确认使用"));
await host.waitForSelector(".soup-log");
state = await room.state();
const solution = state.segment.state.puzzle.solution;

const ask = async (i, q) => {
  await pages[i].locator('.game input[placeholder^="问一个"]').fill(q);
  await click(pages[i], btn("提问"));
};
await ask(1, "和过去的经历有关吗？");
await ask(2, "他是坏人吗？");
await pages[3].waitForFunction(() => document.querySelectorAll(".soup-log li strong").length >= 2, null, {
  timeout: 8000,
});
const log = await text(pages[3], ".soup-log");
await check(
  "AC-12",
  "玩家在左侧提问，AI 自动判定，所有人看到同一条记录（不用去右侧 @AI）",
  log.includes("和过去的经历有关吗？") && log.includes("是") && log.includes("不是"),
  3,
);

// Correction: a player flags, the host asks for a re-judge.
await click(pages[2], btn("判错了？"));
await sleep(300);
await check(
  "AC-13",
  "玩家标记「判错了」后所有人看到标记；只有房主有「让 AI 重判」",
  (await text(host, ".soup-log")).includes("觉得判错了") &&
    !(await has(pages[2], btn("让 AI 重判"))) &&
    (await has(host, btn("让 AI 重判"))),
);
await click(host, btn("让 AI 重判"));
await sleep(1500);

// The host looks at the solution (spoiler warning accepted) — only the host sees it.
await click(host, btn("查看汤底（剧透）"));
await host.waitForSelector(".soup-solution");
await check(
  "AC-13",
  "房主确认剧透后才看到汤底，并可手动更正；其他人看不到",
  (await has(host, btn("更正"))) && !(await has(pages[1], ".soup-solution")),
);
await click(host, btn("更正"));
await click(host, 'button:has-text("改为")');
await sleep(400);
await check("AC-13", "人工更正保留原判并公开显示", (await text(pages[1], ".soup-log")).includes("已更正"), 1);

// Secrets on the wire: no frame sent to players 1–3 carries the solution; the host's does only after peeking.
const leaked = room.network.filter((f) => f.player !== 0 && f.data.includes(solution.slice(0, 12)));
await check(
  "AC-10",
  "发给非知情玩家的网络消息里没有汤底",
  leaked.length === 0 && room.network.some((f) => f.player === 0 && f.data.includes(solution.slice(0, 12))),
  1,
);

// Takeover: a player knowingly becomes the soup master.
await click(pages[3], btn("我来当汤主"));
await pages[3].waitForSelector(".soup-solution");
await check(
  "AC-14",
  "玩家知情接管为汤主：只有 TA 多看到汤底，问答记录保留",
  (await text(pages[3], ".game-head")).includes("汤主") &&
    !(await has(pages[2], ".soup-solution")) &&
    (await text(pages[2], ".soup-log")).includes("和过去的经历有关吗？"),
  3,
);
await click(host, btn("放弃，公布汤底"));
await pages[2].waitForSelector(".soup-solution");
await click(host, btn("放弃本场"));
await host.waitForSelector(".lobby");

// ---------------------------------------------------------------- Canvas multi-step flow (AC-16, AC-09)
await card("猜刻度").locator("button.primary").click();
await host.waitForSelector(".topic-picker");
state = await room.state();
const giverIndex = room.indexOf(state.segment.state.giver);
const giver = pages[giverIndex];
const asker = pages[(giverIndex + 1) % 4];
await asker.locator(".chat-input textarea").fill("先让大家各报一个主题，匿名投票，再按主题出题");
await click(asker, "button.ask-ai");
await host.waitForSelector(".canvas input", { timeout: 10000 });
await check("AC-16", "AI 第一步：在主面板发起「每人填一个主题」的互动", await has(pages[2], ".canvas input"), 2);
const themes = ["英雄联盟", "火锅", "英雄联盟", "宝可梦"];
for (const [i, p] of pages.entries()) {
  await p.locator(".canvas input").fill(themes[i]);
  await click(p, ".canvas button.primary, .canvas button[type=submit]");
}
await host.waitForSelector('.canvas button:has-text("英雄联盟")', { timeout: 10000 });
await check(
  "AC-16",
  "AI 第二步：读取大家填的主题，发起投票（选项来自上一步的结果）",
  (await has(host, '.canvas button:has-text("火锅")')) && (await has(host, '.canvas button:has-text("宝可梦")')),
);
for (const [i, p] of pages.entries()) await click(p, `.canvas button:has-text("${i === 1 ? "火锅" : "英雄联盟"}")`);
await host.waitForFunction(() => document.querySelector(".canvas")?.innerText.includes("匿名"), null, {
  timeout: 10000,
});
await check("AC-16", "投票是匿名的：只显示票数，不显示谁投了什么", !(await text(host, ".canvas")).includes("小白"));
await giver.waitForFunction(() => document.querySelector(".topic-picker")?.innerText.includes("英雄联盟"), null, {
  timeout: 12000,
});
await check(
  "AC-16",
  "AI 第三步：按得票最高的主题写题卡，题主在左侧看到并可以选",
  (await text(giver, ".topic-picker")).includes("英雄联盟"),
  giverIndex,
);
const cardLabel = "英雄联盟新手";
await click(giver, `.pick:has-text("${cardLabel}")`);
await click(giver, btn("确认使用"));
await sleep(500);
await check(
  "AC-09",
  "题主选用 AI 出的题并确认，正式开始",
  (await room.state()).segment.state.scale.left.includes("英雄联盟"),
  giverIndex,
);
await click(host, btn("放弃本场"));
await host.waitForSelector(".lobby");

// ---------------------------------------------------------------- Single-window test room (AC-23)
const solo = await chromium.launch();
const page = await (await solo.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
await page.goto(`${BASE}/test`);
await click(page, btn("创建测试房间"));
await page.waitForSelector(".test-bar");
await page
  .locator(".game-card", { has: page.locator('.cover-name:text-is("谁最可能")') })
  .locator("button.primary")
  .click();
await page.waitForSelector(".topic-picker");
await click(page, btn("其他人各走一步"));
await click(page, btn("其他人各走一步"));
await sleep(500);
await page.locator(".test-bar a.seat").nth(2).click();
await page.waitForSelector(".test-bar a.seat.on");
const who = await page.locator(".test-bar a.seat.on").innerText();
await page.screenshot({ path: `${outDir}/AC-23-single-window.png`, fullPage: true });
room.results.push({
  id: "AC-23",
  text: "单人一键创建多玩家房间，同一窗口切换视角，其他玩家可代走合法操作",
  ok: who === "测试3" && (await has(page, ".game")),
  evidence: "AC-23-single-window.png",
});
console.log(`${who === "测试3" ? "✓" : "✗"} AC-23 单窗口切换到 ${who} 的视角`);
await solo.close();

void seats;
await room.finish("soup-canvas");
