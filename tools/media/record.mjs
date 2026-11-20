/**
 * Records the short clips used in the README and on the static site's front page.
 * Each clip is a series of screenshots taken at meaningful moments, joined into a GIF by ffmpeg
 * (several players' screens are placed side by side).
 *
 *   node tools/media/record.mjs phones   # four phones in one room of the full version (pnpm dev:test)
 *   node tools/media/record.mjs desk     # one desktop screen of the full version    (pnpm dev:test)
 *   node tools/media/record.mjs demo     # the static site's scripted demo           (pnpm demo:preview)
 *   node tools/media/record.mjs seed     # the static site's same-room-code play     (pnpm demo:preview)
 *
 * Needs ffmpeg on the PATH and fonts for Chinese text and emoji. Output: docs/media/<clip>.gif
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const clip = process.argv[2];
const STATIC = process.env.STATIC ?? "http://127.0.0.1:4173/";
const frames = `reports/artifacts/media-frames/${clip}`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
mkdirSync("docs/media", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let count = 0;
/** One frame: every page's visible screen, saved as <frame>-<page>.png. */
async function shot(pages) {
  const n = String(count++).padStart(3, "0");
  await Promise.all(pages.map((p, i) => p.screenshot({ path: `${frames}/${n}-${i}.png` })));
}
/** Repeats the last frame so the eye can rest on it. */
async function hold(pages, times) {
  for (let i = 0; i < times; i++) await shot(pages);
}

function gif(columns, fps, width) {
  const inputs = Array.from({ length: columns }, (_, i) => [
    "-framerate",
    String(fps),
    "-i",
    `${frames}/%03d-${i}.png`,
  ]).flat();
  const stack =
    columns > 1 ? `${Array.from({ length: columns }, (_, i) => `[${i}:v]`).join("")}hstack=inputs=${columns},` : "";
  const filter = `${stack}scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    filter,
    "-loop",
    "0",
    `docs/media/${clip}.gif`,
  ]);
  // The static site's front page shows the phones clip, so it keeps its own copy.
  if (clip === "phones") copyFileSync("docs/media/phones.gif", "apps/web/src/demo/media/phones.gif");
  console.log(`docs/media/${clip}.gif  (${count} frames)`);
}

if (clip === "phones" || clip === "desk") {
  process.env.WIDTH = clip === "phones" ? "390" : "1280";
  const { openRoom, startGame } = await import("../browser/lib.mjs");
  const names = ["阿明", "小白", "老陈", "琪琪"];
  const room = await openRoom({ players: 4, names, outDir: frames });
  const { pages, api, state } = room;
  for (const p of pages)
    await p.setViewportSize(clip === "phones" ? { width: 390, height: 760 } : { width: 1280, height: 760 });
  const shown = clip === "phones" ? pages : [pages[0]];
  // No frames of the lobby: it can show notes from a private content pack loaded on this machine.
  await startGame(pages[0], clip === "phones" ? "吹牛骰子" : "贪心登顶");
  await pages[0].waitForSelector(clip === "phones" ? ".liar" : ".climb-board");
  await sleep(500);
  for (const p of pages) await p.evaluate(() => window.scrollTo(0, 0));
  await hold(shown, 3);
  // The test players make plain legal moves through the normal command path; one frame per move.
  let last = "";
  for (let i = 0; i < (clip === "phones" ? 40 : 90) && count < (clip === "phones" ? 34 : 60); i++) {
    const s = (await state()).segment?.state;
    if (!s || s.phase === "finished") break;
    if (s.phase === "roundOver" || s.phase === "gameOver" || s.phase === "reveal") {
      await sleep(300);
      await hold(shown, 4);
      break;
    }
    await api("/autoplay", { players: [s.current] });
    await sleep(350);
    const now = JSON.stringify((await state()).segment?.state?.step);
    if (now !== last) await shot(shown);
    last = now;
  }
  await hold(shown, 3);
  gif(shown.length, clip === "phones" ? 1.2 : 2.5, clip === "phones" ? 1200 : 1000);
  await pages[0].context().browser().close();
  process.exit(0);
}

const browser = await chromium.launch();
if (clip === "demo") {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await page.goto(STATIC);
  await page.waitForSelector(".static-landing");
  await hold([page], 3);
  await page.getByText("进入演示房间").click();
  await page.waitForSelector(".game-list");
  await hold([page], 2);
  await page.locator(".game-tile", { hasText: "估数字" }).first().click();
  await hold([page], 2);
  await page.locator(".game-detail button.primary").click();
  await page.waitForSelector(".game input");
  await hold([page], 3);
  await page.locator(".game input").first().fill("42");
  await shot([page]);
  await page.locator(".game button.primary").first().click();
  // The scripted players answer on their own and the stand-in host talks: sample twice a second.
  for (let i = 0; i < 26; i++) {
    await sleep(500);
    await shot([page]);
  }
  gif(1, 2.5, 1000);
} else if (clip === "seed") {
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 560 } })).newPage();
    await page.goto(STATIC);
    await page.waitForSelector(".static-landing");
    pages.push(page);
  }
  await hold(pages, 2);
  for (const page of pages) {
    await page.getByLabel("房间号").fill("8270");
    await page.locator(".static-count button", { hasText: /^3$/ }).click();
  }
  await hold(pages, 2);
  for (const page of pages) await page.locator("form.static-mode button[type=submit]").click();
  await pages[2].waitForSelector(".seed-room .game-list");
  await hold(pages, 2);
  for (const page of pages) await page.locator(".game-tile", { hasText: "谁是卧底" }).first().click();
  await hold(pages, 2);
  for (const [i, page] of pages.entries()) {
    await page.locator(".seed-ask .static-count button", { hasText: String(i + 1) }).click();
    await shot(pages);
  }
  await hold(pages, 1);
  for (const page of pages) {
    await page.locator(".seed-secret-head").click();
    await shot(pages);
  }
  await hold(pages, 5);
  gif(3, 1.2, 1000);
} else {
  console.error("usage: node tools/media/record.mjs phones|desk|demo|seed");
  process.exit(1);
}
await browser.close();
