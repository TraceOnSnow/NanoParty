/**
 * Measures text contrast (WCAG ratio) on the static build: the landing page, the same-code room
 * with every one of its games, and the demo room with the first screen of every scripted game. Lists each text style below 4.5:1 (3:1 for large text).
 *   pnpm demo:build && pnpm demo:preview
 *   node tools/browser/contrast.mjs
 * Backgrounds drawn with gradients or pictures are measured by their plain colour only.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173/";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
page.on("dialog", (d) => d.accept());

const found = new Map();
async function audit(where) {
  const rows = await page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 1];
      const p = m[1].split(/[ ,/]+/).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    };
    const over = (top, under) => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
    };
    const lum = (c) => {
      const f = (value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const background = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255, 1]);
    };
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join("");
      if (!text || !/[一-鿿A-Za-z0-9]/.test(text)) continue;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (box.width === 0 || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      let opacity = 1;
      for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      const bg = background(el);
      const colour = parse(style.color);
      const fg = over([colour[0], colour[1], colour[2], colour[3] * opacity], bg);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const hex = (c) =>
        `#${c
          .slice(0, 3)
          .map((v) => Math.round(v).toString(16).padStart(2, "0"))
          .join("")}`;
      out.push({
        ratio: (hi + 0.05) / (lo + 0.05),
        need: large ? 3 : 4.5,
        fg: hex(fg),
        bg: hex(bg),
        size,
        disabled: Boolean(el.closest(":disabled")),
        cls: `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} < ${String(el.parentElement?.className).split(" ")[0]}`,
        text: text.slice(0, 14),
      });
    }
    return out;
  });
  for (const r of rows) {
    if (r.ratio >= r.need) continue;
    const key = `${r.fg} on ${r.bg} ${r.cls}${r.disabled ? " (disabled)" : ""}`;
    const seen = found.get(key) ?? { ...r, where: new Set() };
    seen.where.add(where);
    found.set(key, seen);
  }
}

await page.goto(BASE);
await page.waitForSelector(".static-landing");
await audit("首页");
// The same-code room: every game, with its secrets opened.
await page.locator("form.static-mode button[type=submit]").click();
await page.waitForSelector(".seed-room .game-list");
await page.waitForTimeout(600);
await audit("同号大厅");
for (const name of await page.locator(".seed-room .game-tile:not([disabled]) .cover-name").allInnerTexts()) {
  await page.locator(".game-tile", { hasText: name }).first().click();
  for (let i = 0; i < 3 && (await page.locator(".seed-ask").count()) > 0; i++) {
    await audit(`同号·${name}`);
    await page.locator(".seed-ask .static-count button").first().click();
  }
  for (const head of await page.locator(".seed-secret-head").all()) await head.click();
  await page.waitForTimeout(150);
  await audit(`同号·${name}`);
  await page.locator(".room-bar button", { hasText: "换游戏" }).click();
}
await page.locator(".room-bar button", { hasText: "退出" }).click();

// The demo room: the first screen of every scripted game.
await page.getByText("进入演示房间").click();
await page.waitForSelector(".game-list");
await page.waitForTimeout(1500);
await audit("演示大厅");
for (const name of await page.locator(".game-tile .cover-name").allInnerTexts()) {
  await page.locator(".game-tile", { hasText: name }).first().click();
  await page.locator(".game-detail button.primary").click();
  await page.waitForTimeout(700);
  await audit(`演示·${name}`);
  const candidate = page.locator(".candidate, .candidates button").first();
  if (await candidate.isVisible().catch(() => false)) {
    await candidate.click().catch(() => {});
    await page.waitForTimeout(700);
    await audit(`演示·${name}`);
  }
  await page.locator(".room-bar button", { hasText: "结束这局" }).click();
  await page.waitForTimeout(300);
  const back = page.getByText("换个游戏");
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.waitForSelector(".game-list");
}
await browser.close();

const list = [...found.values()].sort((a, b) => a.ratio - b.ratio);
for (const r of list) {
  console.log(
    `${r.ratio.toFixed(2)} (need ${r.need}) ${r.fg} on ${r.bg} ${r.size}px ${r.cls}${r.disabled ? " [disabled]" : ""} 「${r.text}」 @ ${[...r.where].slice(0, 4).join(",")}`,
  );
}
console.log(
  `${list.length} text styles below the threshold (${list.filter((r) => !r.disabled).length} not counting disabled controls)`,
);
