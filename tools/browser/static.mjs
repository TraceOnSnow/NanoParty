/**
 * Acceptance run for the static build (demo + same-room-code play), which has no server at all.
 *   pnpm demo:build && pnpm demo:preview    # serves apps/web/dist-demo on :4173
 *   node tools/browser/static.mjs
 * BASE overrides the address; OUT the evidence folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
const OUT = process.env.OUT ?? "reports/artifacts/static";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
const problems = [];
const foreign = [];

async function open(width = 1366) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 860 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => !r.url().startsWith(BASE) && !r.url().startsWith("data:") && foreign.push(r.url()));
  await page.goto(BASE);
  await page.waitForSelector(".static-landing");
  return page;
}

async function check(page, id, text, ok) {
  const file = `${id}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  results.push({ id, text, ok: Boolean(ok), evidence: file });
  console.log(`${ok ? "✓" : "✗"} ${id} ${text}`);
}

const startGame = async (page, name) => {
  await page.locator(".game-tile", { hasText: name }).first().click();
  await page.locator(".game-detail button.primary").click();
};
const enterRoom = async (page, code, players = 4) => {
  await page.getByLabel("房间号").fill(code);
  await page.locator(".static-count button", { hasText: new RegExp(`^${players}$`) }).click();
  await page.locator("form.static-mode button[type=submit]").click();
  await page.waitForSelector(".seed-room .game-list");
};
const pickGame = (page, name) => page.locator(".game-tile", { hasText: name }).first().click();

// ---- landing
{
  const page = await open();
  const modes = await page.locator(".static-mode").count();
  await check(page, "ST-01", "首页有「线下开一桌」和「看演示」两个入口", modes === 2);
  await page.close();
}

// ---- demo: a round game against scripted players, with the stand-in host talking
{
  const page = await open();
  await page.getByText("进入演示房间").click();
  await page.waitForSelector(".game-list");
  const tiles = await page.locator(".game-tile").count();
  await startGame(page, "估数字");
  await page.waitForSelector(".game input");
  const question = await page.locator(".question").first().innerText();
  await page.locator(".game input").first().fill("42");
  await page.locator(".game button.primary").first().click();
  // The three scripted players answer on their own; the reveal follows the last answer.
  await page.locator(".msg.agent", { hasText: "答案是" }).waitFor({ timeout: 15000 });
  const hostLines = await page.locator(".msg.agent").count();
  await check(
    page,
    "ST-02",
    `演示：脚本玩家自己交了答案并揭晓（${tiles} 款可选；题目「${question.slice(0, 16)}…」）`,
    hostLines >= 2,
  );

  for (let i = 0; i < 6 && (await page.locator("table.results").count()) === 0; i++) {
    const next = page.locator(".game button.primary").first();
    if (await next.isVisible().catch(() => false)) {
      const input = page.locator(".game input").first();
      if (await input.isVisible().catch(() => false)) await input.fill(String(10 + i));
      await next.click();
    }
    await page.waitForTimeout(3500);
  }
  const rows = await page.locator("table.results tbody tr").count();
  const points = await page.locator(".scoreboard strong").allInnerTexts();
  await check(
    page,
    "ST-03",
    `演示：打完一场出结算，积分榜入账（${points.join(" / ")}）`,
    rows === 4 && points.some((p) => Number(p) > 0),
  );

  // A card game: the scripts take their turns and the table comes back to the visitor.
  await page.getByText("换个游戏").click();
  await startGame(page, "攒七张");
  await page.waitForSelector(".seven-deck");
  await page.locator(".seven-deck").click();
  await page.locator(".seven-hand .seven-card").first().click();
  await page.locator("button.primary.wide").click();
  const handedOver = await page.locator(".seven-deck[disabled]").count();
  await page.locator(".seven-deck:not([disabled])").waitFor({ timeout: 20000 });
  const turnLine = await page.locator(".turn-line").innerText();
  await check(
    page,
    "ST-04",
    "演示：牌类游戏里三个脚本玩家各走一回合后轮回到你",
    handedOver === 1 && turnLine.includes("轮到你"),
  );
  await page.close();
}

// ---- same room code on several phones: same topics, each phone only its own secret
{
  const phones = [await open(390), await open(390), await open(390), await open(390)];
  for (const page of phones) await enterRoom(page, "8270");

  for (const page of phones) await pickGame(page, "逛三园");
  const topics = await Promise.all(phones.map((p) => p.locator(".seed-big").first().innerText()));
  for (const page of phones) await page.locator(".seed-nav button.primary").click();
  const next = await Promise.all(phones.map((p) => p.locator(".seed-big").first().innerText()));
  await check(
    phones[0],
    "ST-05",
    `同号：四台手机看到同一题，一起翻页后还是同一题（「${topics[0]}」→「${next[0]}」）`,
    new Set(topics).size === 1 && new Set(next).size === 1 && topics[0] !== next[0],
  );

  for (const page of phones) await page.locator(".room-bar button", { hasText: "换游戏" }).click();
  for (const [i, page] of phones.entries()) {
    await pickGame(page, "谁是卧底");
    await page.locator(".seed-ask .static-count button", { hasText: String(i + 1) }).click();
  }
  const covered = await phones[0].locator(".seed-secret:not(.open)").count();
  const hidden = (await phones[0].locator(".seed-secret .seed-big").count()) === 0;
  const words = [];
  for (const page of phones) {
    await page.locator(".seed-secret-head").click();
    words.push(await page.locator(".seed-secret .seed-big").innerText());
  }
  const groups = [...new Set(words)].map((w) => words.filter((x) => x === w).length).sort();
  await check(
    phones[0],
    "ST-06",
    `同号：词先盖着，翻开后三人同词、一人是卧底（${groups.join("+")}）`,
    covered === 1 && hidden && groups.join() === "1,3",
  );

  for (const page of phones) await page.locator(".room-bar button", { hasText: "换游戏" }).click();
  await pickGame(phones[0], "暗号网格");
  await phones[0].getByText("我是队长").click();
  await pickGame(phones[1], "暗号网格");
  await phones[1].getByText("我是队员").click();
  const grid = (p) => p.locator(".seed-cell span").allInnerTexts();
  const sameGrid = (await grid(phones[0])).join() === (await grid(phones[1])).join();
  const captainSees = await phones[0].locator(".seed-cell[class*=own-]").count();
  const memberSees = await phones[1].locator(".seed-cell[class*=own-]").count();
  await phones[1].locator(".seed-cell").first().click();
  await phones[1].locator(".seed-confirm button.primary").click();
  const afterFlip = await phones[1].locator(".seed-cell[class*=own-]").count();
  await check(
    phones[0],
    "ST-07",
    "同号：队长看到全部归属，队员只看到词",
    sameGrid && captainSees === 25 && memberSees === 0,
  );
  const overflow = await phones[1].evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await check(
    phones[1],
    "ST-08",
    "同号：队员翻开一个词才看到它的归属；手机宽度不横向溢出",
    afterFlip === 1 && !overflow,
  );

  await check(phones[0], "ST-09", `整个过程没有访问页面以外的任何地址（${foreign.length} 次）`, foreign.length === 0);
  await check(phones[0], "ST-10", `没有页面报错（${problems.length} 条）`, problems.length === 0);
  for (const page of phones) await page.close();
}

await browser.close();
for (const p of problems) console.log("problem:", p);
writeFileSync(`${OUT}/results.json`, `${JSON.stringify({ base: BASE, results, problems, foreign }, null, 2)}\n`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
