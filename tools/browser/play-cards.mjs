/**
 * Review helper: every player is driven through the real page (press a
 * card, confirm, pick a seat…), so it exercises the same controls a person uses.
 *   GAMES=rowcards,duel TICKS=30 OUT=reports/artifacts/browser/review node tools/browser/play-cards.mjs
 */
import { openRoom, sleep } from "./lib.mjs";

const out = process.env.OUT ?? "reports/artifacts/browser/review";
const ids = (process.env.GAMES ?? "rowcards,nothanks,flush,crew,skull,duel").split(",").filter(Boolean);
const ticks = Number(process.env.TICKS ?? 30);
/** Whose screens to keep, e.g. VIEW=0,1 */
const views = (process.env.VIEW ?? "1").split(",").map(Number);
const room = await openRoom({ players: 4, names: ["阿明", "小白", "老陈", "琪琪"], outDir: out });
const { pages, api, seats } = room;
const WORDS = ["猫", "火锅", "周一", "不能告诉任何人", "只有一次", "月亮", "加班", "外卖"];
const pickOne = async (page, selector) => {
  const all = page.locator(selector).locator("visible=true");
  const n = await all.count();
  if (n === 0) return false;
  await all
    .nth(Math.floor(Math.random() * n))
    .click({ timeout: 1500 })
    .catch(() => {});
  return true;
};
/** One thing a player would do next; returns a word for the log, or null if nothing to do. */
async function move(page) {
  if ((await page.locator(".topic-picker").count()) > 0) {
    if (!(await pickOne(page, ".topic-picker .pick-grid button.pick:not([disabled])"))) return null;
    await sleep(80);
    return (await pickOne(page, ".topic-picker .host-row button.primary:not([disabled])")) ? "topic" : null;
  }
  const input = page.locator(".game form.answer-row input:not([disabled])").locator("visible=true");
  if ((await input.count()) > 0) {
    const numeric = (await input.first().getAttribute("inputmode")) === "decimal";
    await input
      .first()
      .fill(numeric ? String(Math.floor(Math.random() * 9000)) : WORDS[Math.floor(Math.random() * WORDS.length)]);
    await input.first().press("Enter");
    return "text";
  }
  const choices = page.locator(".split-choice").locator("visible=true");
  if ((await choices.count()) > 0) {
    for (let i = 0; i < (await choices.count()); i++)
      await choices
        .nth(i)
        .locator("button")
        .nth(Math.random() < 0.5 ? 0 : 1)
        .click();
    await pickOne(page, ".game > button.primary:not([disabled])");
    return "stance";
  }
  if (await pickOne(page, ".slips button.slip:not([disabled])")) {
    await sleep(80);
    await pickOne(page, ".game > button.primary.wide:not([disabled])");
    return "slip";
  }
  if (await pickOne(page, ".game button.verdict-btn:not([disabled])")) return "verdict";
  if (await pickOne(page, ".poll-option:not([disabled])")) {
    await sleep(80);
    await pickOne(page, ".game > button.primary.wide:not([disabled])");
    return "poll";
  }
  if (await pickOne(page, "button.word-block:not([disabled])")) {
    await sleep(80);
    await pickOne(page, ".frames > button.primary:not([disabled])");
    return "block";
  }
  if (await pickOne(page, ".seven-hand .seven-card:not([disabled])")) {
    await sleep(80);
    await pickOne(page, ".game > button.primary.wide:not([disabled])");
    return "discard";
  }
  if ((await page.locator(".seven-deck:not([disabled])").count()) > 0) {
    if (Math.random() < 0.4 && (await pickOne(page, ".felt .seven-card:not(.seven-deck):not([disabled])"))) {
      await sleep(80);
      await pickOne(page, ".game > button.primary.wide:not([disabled])");
      return "take";
    }
    await page.locator(".seven-deck").click();
    return "draw";
  }
  if ((await page.locator(".platter-rule:not([disabled])").count()) > 0) {
    if (Math.random() < 0.6 && (await page.locator(".platter-item:not([disabled])").count()) >= 2) {
      await page.locator(".platter-item:not([disabled])").nth(0).click();
      await page.locator(".platter-item:not([disabled])").nth(1).click();
    } else await pickOne(page, ".platter-rule:not([disabled])");
    await sleep(80);
    await pickOne(page, ".game > button.primary.wide:not([disabled])");
    return "platter";
  }
  if (await pickOne(page, "button.task.open")) return "task";
  if (await pickOne(page, "button.pseat.pick")) return "seat";
  if (Math.random() < 0.3 && (await pickOne(page, ".bid-row button:not([disabled]):not(.stepper button)")))
    return "bid";
  if (await pickOne(page, ".play-hand .hand-slot:not([disabled])")) {
    await sleep(80);
    if (await pickOne(page, ".play-hand > button.primary")) return "card";
    if (await pickOne(page, "button.pseat.pick")) return "card→seat";
    return "lift";
  }
  if (await pickOne(page, ".bid-row button:not([disabled]):not(.stepper button)")) return "bid";
  if (await pickOne(page, ".chip-tray .host-row button:not([disabled])")) return "chips";
  if (await pickOne(page, ".game .host-row button.primary:not([disabled])")) return "next";
  return null;
}

for (const id of ids) {
  const started = await api("/act", {
    playerId: seats[0].playerId,
    command: { type: "startGame", gameId: id, config: {} },
  });
  if (!started.ok) {
    console.log(id, "did not start:", started.error);
    continue;
  }
  await sleep(600);
  const log = [];
  let shot = 0;
  for (let t = 0; t < ticks; t++) {
    for (const [i, page] of pages.entries()) {
      const did = await move(page);
      if (did) log.push(`${i}:${did}`);
      await sleep(120);
    }
    if (t % Math.ceil(ticks / 6) === 0 || t === ticks - 1) {
      for (const k of views) await pages[k].screenshot({ path: `${out}/${id}-${shot}-p${k}.png`, fullPage: true });
      shot++;
    }
  }
  console.log(id, log.length, "moves:", log.slice(0, 14).join(" "));
  const s = await room.state();
  if (s.segment) {
    await api("/act", {
      playerId: seats[0].playerId,
      command: { type: "endSegment", segmentId: s.segment.id, mode: "abandon" },
    });
  }
  await sleep(300);
}
console.log("problems:", room.problems.length, room.problems.slice(0, 5).join(" | "));
process.exit(0);
