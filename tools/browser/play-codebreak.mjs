/** Plays 密码传递 for two rounds and keeps a screenshot of every role at every phase. */
import { openRoom, sleep, startGame } from "./lib.mjs";

const out = process.env.OUT ?? "reports/artifacts/browser/codebreak";
const room = await openRoom({ players: 4, names: ["阿明", "小白", "老陈", "琪琪"], outDir: out });
const { pages, state, api, seats } = room;
const game = async () => (await state()).segment?.state;
const act = (playerId, action) =>
  state().then((s) => api("/act", { playerId, command: { type: "gameAction", segmentId: s.segment.id, action } }));
const shot = (i, name) => pages[i].screenshot({ path: `${out}/${name}.png`, fullPage: true });
const idx = (playerId) => seats.findIndex((s) => s.playerId === playerId);

await startGame(pages[0], "密码传递");
await sleep(500);
for (let round = 1; round <= 2; round++) {
  let s = await game();
  const enc = s.encoders.map(idx);
  const other = [0, 1].map((t) => idx(s.teams[t].find((p) => p !== s.encoders[t])));
  await shot(enc[0], `r${round}-1-clue-encoder`);
  await shot(other[0], `r${round}-1-clue-teammate`);
  for (const t of [0, 1])
    await act(s.encoders[t], {
      type: "clues",
      step: s.step,
      clues: ["提示甲", "提示乙", "提示丙"].map((c) => `${c}${round}${t}`),
    });
  await sleep(400);
  await shot(enc[0], `r${round}-2-guess-encoder`);
  await shot(other[0], `r${round}-2-guess-teammate`);
  s = await game();
  if (round === 2) {
    // Through the real UI: drag the three clues of the own team into columns and submit.
    const page = pages[other[0]];
    const sheetOf = page.locator(".code-sheet.mine");
    const centre = async (l) => {
      const b = await l.boundingBox();
      return { x: b.x + b.width / 2, y: b.y + 20 };
    };
    for (const col of [2, 0, 3]) {
      const a = await centre(sheetOf.locator(".clue-tray button.clue-chip").first());
      const b = await centre(sheetOf.locator(".code-column").nth(col));
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
      await page.mouse.move(b.x, b.y + 40, { steps: 5 });
      await page.mouse.up();
      await sleep(150);
    }
    await shot(other[0], "r2-2b-guess-dragged");
    await sheetOf.locator("button.primary").click();
    await sleep(300);
    const g = (await game()).guesses;
    console.log("dragged guess recorded:", JSON.stringify(g));
  }
  for (const t of [0, 1]) {
    const mate = s.teams[t].find((p) => p !== s.encoders[t]);
    console.log(JSON.stringify(await act(mate, { type: "guess", step: s.step, target: t, code: [1, 2, 3] })));
    if (round > 1)
      console.log(
        JSON.stringify(await act(mate, { type: "guess", step: (await game()).step, target: 1 - t, code: [1, 2, 3] })),
      );
  }
  await sleep(400);
  s = await game();
  if (s.phase === "guess") await act(seats[0].playerId, { type: "advance", step: s.step });
  await sleep(400);
  await shot(other[0], `r${round}-3-reveal-teammate`);
  await shot(0, `r${round}-3-reveal-host`);
  s = await game();
  await act(seats[0].playerId, { type: "advance", step: s.step });
  await sleep(400);
}
await pages[1].setViewportSize({ width: 390, height: 780 });
await sleep(200);
await pages[1].screenshot({ path: `${out}/phone.png`, fullPage: true });
console.log("done");
process.exit(0);
