/**
 * Review helper: starts each listed game with four players, lets the test bots play a few
 * steps, and keeps a screenshot after every step from one player's seat.
 *   GAMES=wager,ranking OUT=reports/artifacts/browser/review node tools/browser/play-batch.mjs
 */
import { openRoom, sleep } from "./lib.mjs";

const out = process.env.OUT ?? "reports/artifacts/browser/review";
const ids = (process.env.GAMES ?? "").split(",").filter(Boolean);
const steps = Number(process.env.STEPS ?? 3);
const room = await openRoom({
  players: Number(process.env.PLAYERS ?? 4),
  names: ["阿明", "小白", "老陈", "琪琪", "大刘", "小七"],
  outDir: out,
});
const { pages, api, seats } = room;
const act = (playerId, command) => api("/act", { playerId, command });
for (const id of ids) {
  const started = await act(seats[0].playerId, { type: "startGame", gameId: id, config: {} });
  if (!started.ok) {
    console.log(id, "did not start:", started.error);
    continue;
  }
  await sleep(500);
  for (let i = 0; i <= steps; i++) {
    const seat = i % 2 === 0 ? 1 : 0;
    await pages[seat].screenshot({ path: `${out}/${id}-${i}-p${seat}.png`, fullPage: true });
    const moves = await api("/autoplay", {});
    await sleep(350);
    if (i === 0) console.log(id, "autoplay:", JSON.stringify(moves).slice(0, 160));
  }
  const s = await room.state();
  if (s.segment) await act(seats[0].playerId, { type: "endSegment", segmentId: s.segment.id, mode: "abandon" });
  await sleep(300);
}
console.log("problems:", room.problems.length, room.problems.slice(0, 5).join(" | "));
process.exit(0);
