/**
 * Turns word lists published by other people into bundled content, keeping where each came from.
 * The raw files are fetched by hand into a folder first (see docs/content-sources.md):
 *   node tools/content/import-external.mjs <folder with the downloaded files>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
if (!dir) throw new Error("usage: import-external.mjs <download folder>");
const item = (id, type, theme, source, payload) => ({
  id,
  version: 1,
  type,
  theme,
  source,
  verification: "unverified",
  payload,
});

// 1. Word pairs: github.com/Yue-Zeyi/undercover, server/word-bank/*.ts — rows of ['a', 'b', difficulty, …].
const THEME = {
  culture: "文化",
  daily: "日常",
  food: "吃喝",
  jobs: "职业",
  nature: "自然",
  places: "地点",
  sports: "运动",
  tech: "数码",
};
const own = ["content.json", "content.net.json"].flatMap((f) =>
  JSON.parse(readFileSync(`packages/games/src/undercover/${f}`, "utf8")),
);
const seen = new Set(own.flatMap((x) => [`${x.payload.a}|${x.payload.b}`, `${x.payload.b}|${x.payload.a}`]));
const pairs = [];
for (const file of readdirSync(dir)
  .filter((f) => /^yz-(\w+)\.ts$/.test(f) && f !== "yz-types.ts")
  .sort()) {
  const key = file.slice(3, -3);
  for (const m of readFileSync(`${dir}/${file}`, "utf8").matchAll(
    /^\s*\['([^']+)', '([^']+)', '(easy|medium|hard)'/gm,
  )) {
    const [, a, b] = m;
    if (seen.has(`${a}|${b}`)) continue;
    seen.add(`${a}|${b}`).add(`${b}|${a}`);
    pairs.push(
      item(
        `wordpair-yz-${key}-${String(pairs.length + 1).padStart(3, "0")}`,
        "word-pair",
        THEME[key] ?? key,
        "github.com/Yue-Zeyi/undercover（词对表，作者未声明许可；注明出处引用）",
        { a, b },
      ),
    );
  }
}
writeFileSync("packages/games/src/undercover/content.imported.json", `${JSON.stringify(pairs, null, 2)}\n`);

// 2. Soup puzzles: github.com/AZHi-xinxin/haiguitang-coop, samples/sample_soups.json (MIT).
// Only the ones whose story holds together are taken (two samples contradict their own opening),
// each with the words an adaptation may swap and the ones the logic rests on.
const SOUP_WORDS = {
  soup_sample_001: { fixed: ["闹钟", "单次"], adaptable: ["手机"] },
  soup_sample_002: { fixed: ["鱼缸", "矿泉水", "水温"], adaptable: ["热带鱼"] },
  soup_sample_005: { fixed: ["信", "银行", "催款单"], adaptable: ["邮递员"] },
};
const soups = JSON.parse(readFileSync(`${dir}/soups.json`, "utf8"))
  .filter((s) => SOUP_WORDS[s.id])
  .map((s, i) =>
    item(
      `soup-hgt-${String(i + 1).padStart(3, "0")}`,
      "soup",
      "日常反转",
      "github.com/AZHi-xinxin/haiguitang-coop（samples/sample_soups.json，MIT）",
      {
        surface: s.soup_face,
        solution: s.soup_bottom,
        ...(Array.isArray(s.key_elements)
          ? { facts: s.key_elements.slice(0, 8).map((f) => String(f).slice(0, 80)) }
          : {}),
        ...SOUP_WORDS[s.id],
      },
    ),
  );
writeFileSync("packages/games/src/soup/content.imported.json", `${JSON.stringify(soups, null, 2)}\n`);
console.log("word pairs:", pairs.length, "soups:", soups.length);
