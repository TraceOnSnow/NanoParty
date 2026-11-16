/**
 * Simple legal moves for test players, so one person (or a test script) can fill a room.
 * A bot only ever looks at its own player view, exactly like a real client, and its action
 * goes through the normal command path. These are not opponents: they do the plainest legal
 * thing, and only player actions — never the host's "next round" or "end" decisions.
 */
import type { PlayerId } from "@apr/shared";

// biome-ignore lint/suspicious/noExplicitAny: views are game-specific
type View = any;
type Bot = (v: View, me: PlayerId) => Record<string, unknown> | null;

/** Topic choice shared by every game with a pick phase: take the first candidate. */
const pick: Bot = (v, me) =>
  v.phase === "pick" && v.pick?.picker === me && (v.pick.candidates?.length ?? 0) > 0
    ? { type: "choose", index: 0 }
    : null;

const other = (ids: PlayerId[], me: PlayerId) => ids.find((p) => p !== me) ?? me;

const bots: Record<string, Bot> = {
  spell(v, me) {
    if (v.phase !== "play" || v.current !== me) return null;
    if (v.casts > 0) return { type: "end" };
    // Call the number with the most stones the bot cannot account for.
    const seen = (n: number) =>
      (v.board[n] ?? 0) +
      (Object.values(v.hands) as number[][]).reduce((sum, hand) => sum + hand.filter((x) => x === n).length, 0);
    const best = [8, 7, 6, 5, 4, 3, 2].sort((a, b) => b - seen(b) - (a - seen(a)))[0];
    return { type: "cast", number: best };
  },
  flipout(v, me) {
    const live = (v.players as PlayerId[]).filter((p) => v.status[p] !== "bust");
    if (v.phase === "turn" && v.current === me) {
      const mine = (v.cards[me] ?? []) as { kind: string; special?: string }[];
      const numbers = mine.filter((c) => c.kind === "num").length;
      return mine.some((c) => c.special === "zero") || numbers < 3 ? { type: "hit" } : { type: "stay" };
    }
    if (v.pending?.by !== me) return null;
    if (v.phase === "assign") return { type: "give", target: other(live, me) };
    if (v.phase === "use") {
      const act = v.pending.card.act as string;
      const holders = live.filter((p) => (v.cards[p] ?? []).length > 0 && (act !== "steal" || p !== me));
      const pickOf = (p: PlayerId) => ({ player: p, cardId: v.cards[p][0].id });
      const cards = holders.slice(0, act === "swap" ? 2 : 1).map(pickOf);
      return { type: "use", cards };
    }
    return null;
  },
  climb(v, me) {
    if (v.current !== me) return null;
    if (v.phase === "move") return { type: "move", option: 0 };
    if (v.phase !== "decide") return null;
    // Bank after two advances in a turn; otherwise keep rolling.
    const steps = Object.entries(v.climbers as Record<string, number>).reduce(
      (sum, [column, height]) => sum + height - (v.saved[me]?.[column] ?? 0),
      0,
    );
    return steps >= 2 ? { type: "stop" } : { type: "roll" };
  },
  spectrum(v, me) {
    if (v.phase === "pick") return v.giver === me && v.candidates.length > 0 ? { type: "choose", index: 0 } : null;
    if (v.phase === "clue") return v.giver === me ? { type: "clue", text: "差不多中间偏右" } : null;
    if (v.phase === "guessing" && v.giver !== me && v.myGuess === null && v.participants.includes(me)) {
      return { type: "guess", value: 60 };
    }
    return null;
  },
  mostlikely(v, me) {
    if (v.phase === "vote" && v.myVote === null && v.participants.includes(me)) {
      return { type: "vote", target: other(v.participants, me) };
    }
    return null;
  },
  quip(v, me) {
    if (!v.participants.includes(me)) return null;
    if (v.phase === "write" && v.myAnswer === null) {
      return { type: "answer", text: `测试回答 ${me.slice(-3)}` };
    }
    if (v.phase === "vote" && v.options && v.myVote === null) {
      const choice = v.options.find((o: { mine: boolean }) => !o.mine);
      return choice ? { type: "vote", index: choice.index } : null;
    }
    return null;
  },
  bluff(v, me) {
    if (!v.participants.includes(me)) return null;
    if (v.phase === "write" && v.myLie === null) {
      return { type: "lie", text: `假答案${me.slice(-3)}` };
    }
    if (v.phase === "select" && v.options && v.myPick === null) {
      const choice = v.options.find((o: { mine: boolean }) => !o.mine);
      return choice ? { type: "pick", index: choice.index } : null;
    }
    return null;
  },
  undercover(v, me) {
    if (!v.alive.includes(me) || v.outcome) return null;
    if (v.phase === "describe" && v.myDescription === null) return { type: "describe", text: "日常能见到的东西" };
    if (v.phase === "vote" && v.myVote === null) return { type: "vote", target: other(v.alive, me) };
    return null;
  },
  percent(v, me) {
    if (!v.participants.includes(me)) return null;
    if (v.phase === "answer" && v.myAnswer === null)
      return { type: "answer", yes: v.participants.indexOf(me) % 2 === 0 };
    if (v.phase === "guess" && v.guesser === me) return { type: "guess", count: Math.floor(v.answered.length / 2) };
    if (v.phase === "bet" && v.guesser !== me && v.myBet === null) return { type: "bet", side: "higher" };
    return null;
  },
  pollmine(v, me) {
    if (v.myTeam === null) return null;
    if (v.phase === "vote" && v.myVote === null)
      return { type: "vote", option: v.teams.flat().indexOf(me) % v.options.length };
    if (v.phase === "hunt" && v.turn === v.myTeam) {
      const taken = new Set(v.opened.map((o: { option: number }) => o.option));
      const option = v.options.findIndex((_: string, i: number) => !taken.has(i));
      return option >= 0 ? { type: "open", option } : null;
    }
    return null;
  },
  soup(v, me) {
    if (v.phase !== "play" || v.master === me || !v.participants.includes(me)) return null;
    const waiting = v.log.some((e: { by: string; verdict: unknown }) => e.by === me && e.verdict === null);
    const asked = v.log.filter((e: { by: string }) => e.by === me).length;
    return waiting || asked >= 2 ? null : { type: "ask", text: asked === 0 ? "和人有关吗？" : "是意外吗？" };
  },
};

/** The next plain legal action for `me`, or null when there is nothing for this player to do. */
export function botAction(gameId: string, view: unknown, me: PlayerId): Record<string, unknown> | null {
  const v = view as View;
  if (!v || typeof v !== "object") return null;
  const action = pick(v, me) ?? bots[gameId]?.(v, me) ?? null;
  if (!action) return null;
  // Every action is bound to the step (or round) the bot was looking at.
  return typeof v.step === "number" ? { ...action, step: v.step } : { ...action, round: v.round };
}

/** Games the bots know how to play (others still get the shared topic choice). */
export const BOT_GAMES = Object.keys(bots);
