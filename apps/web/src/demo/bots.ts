/**
 * Scripted players of the static demo. They make sensible-looking legal moves from their own
 * view, like a client would. The one exception is number guessing, where a believable guess
 * needs to be somewhere near the answer: there the script reads the answer from the local state
 * (this build has no server to keep it from anyone anyway) and adds a wide error.
 */
import { botAction } from "@apr/games";

// biome-ignore lint/suspicious/noExplicitAny: views are game-specific
type View = any;
type Move = Record<string, unknown> | null;
type Script = (v: View, me: string, state: View) => Move;

const any = <T>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];
const chance = (p: number) => Math.random() < p;

/** All-purpose answers for open questions: they read as a joke under almost any prompt. */
const QUIPS = [
  "问就是在摸鱼",
  "这题我妈不让我答",
  "先发个疯再说",
  "建议直接躺平",
  "V 我 50 我就告诉你",
  "我选择当场下线",
  "答案写在老板的脸色里",
  "不如问问我家猫",
  "这是可以说的吗",
  "已读不回",
  "把锅甩给实习生",
  "先敲十下电子木鱼",
  "因为那天没带伞",
  "做成表情包群发",
  "看我的精神状态就知道了",
  "下次一定",
  "先点一杯奶茶压压惊",
  "假装信号不好",
  "交给明天的我",
  "连夜买站票跑路",
  "装作在开会",
  "发个朋友圈仅自己可见",
];
const used = new Set<string>();
function quip(): string {
  if (used.size >= QUIPS.length) used.clear();
  const text = any(QUIPS.filter((q) => !used.has(q))) ?? "下次一定";
  used.add(text);
  return text;
}

/** A guess around the true value: usually within a factor of two, sometimes far off. */
function nearby(answer: number, unit: string): number {
  // Years are guessed by offset, not by ratio.
  if (unit.includes("年") && Number.isInteger(answer) && answer > 1000 && answer < 2100) {
    return answer + Math.round((Math.random() - 0.5) * (chance(0.2) ? 60 : 14));
  }
  const spread = chance(0.2) ? 1.3 : 0.45;
  const value = answer * Math.exp((Math.random() * 2 - 1) * spread);
  if (Number.isInteger(answer)) {
    const digits = Math.max(0, Math.floor(Math.log10(Math.max(1, Math.abs(value)))) - 1);
    const unitStep = 10 ** digits;
    return Math.round(value / unitStep) * unitStep;
  }
  return Math.round(value * 10) / 10;
}

/** How bad a card is in the row game: the length of the row it would land in. */
function rowRisk(card: number, rows: number[][]): number {
  let best: number[] | null = null;
  for (const row of rows) {
    const last = row[row.length - 1] ?? 0;
    if (last < card && (!best || last > (best[best.length - 1] ?? 0))) best = row;
  }
  return best ? best.length : 4;
}

const scripts: Record<string, Script> = {
  estimate(v, me, state) {
    if (v.phase !== "answering" || v.myGuess !== null || !v.participants.includes(me)) return null;
    return { type: "submit", value: nearby(state.question.answer, v.question.unit) };
  },
  wager(v, me, state) {
    if (!v.participants.includes(me)) return null;
    if (v.phase === "guess" && v.myGuess === null) {
      return { type: "guess", value: nearby(state.question.answer, v.question.unit) };
    }
    if (v.phase === "bet" && v.myBet === null && v.guesses?.length) {
      // Bet on someone in the middle of the pack, as most people do.
      const middle = v.guesses.slice(Math.floor((v.guesses.length - 1) / 2), Math.ceil((v.guesses.length + 1) / 2));
      return { type: "bet", on: (any(chance(0.7) ? middle : v.guesses) as { playerId: string }).playerId };
    }
    return null;
  },
  quip(v, me) {
    if (!v.participants.includes(me)) return null;
    if (v.phase === "write" && v.myAnswer === null) return { type: "answer", text: quip() };
    if (v.phase === "vote" && v.options && v.myVote === null) {
      const choice = any(v.options.filter((o: { mine: boolean }) => !o.mine)) as { index: number } | undefined;
      return choice ? { type: "vote", index: choice.index } : null;
    }
    return null;
  },
  mostlikely(v, me) {
    if (v.phase !== "vote" || v.myVote !== null || !v.participants.includes(me)) return null;
    const others = v.participants.filter((p: string) => p !== me);
    // The visitor gets picked on a little more often: it is funnier to be the target.
    const target = chance(0.45) ? others[0] : any(others);
    return target ? { type: "vote", target } : null;
  },
  percent(v, me) {
    if (!v.participants.includes(me)) return null;
    if (v.phase === "answer" && v.myAnswer === null) return { type: "answer", yes: chance(0.5) };
    if (v.phase === "guess" && v.guesser === me) {
      return { type: "guess", count: Math.round(v.answered.length * (0.25 + Math.random() * 0.5)) };
    }
    if (v.phase === "bet" && v.guesser !== me && v.myBet === null) {
      const side = v.guess >= v.answered.length ? "lower" : v.guess <= 0 ? "higher" : chance(0.5) ? "higher" : "lower";
      return { type: "bet", side };
    }
    return null;
  },
  pollmine(v) {
    if (v.myTeam === null) return null;
    if (v.phase === "vote" && v.myVote === null) {
      return { type: "vote", option: Math.floor(Math.random() * v.options.length) };
    }
    if (v.phase === "hunt" && v.turn === v.myTeam) {
      const taken = new Set(v.opened.map((o: { option: number }) => o.option));
      const free = v.options.map((_: string, i: number) => i).filter((i: number) => !taken.has(i));
      const option = any(free);
      return option === undefined ? null : { type: "open", option };
    }
    return null;
  },
  nothanks(v, me) {
    if (v.phase !== "play" || v.current !== me || v.card === null) return null;
    const mine: number[] = v.cards[me] ?? [];
    const joins = mine.includes(v.card - 1) || mine.includes(v.card + 1);
    const broke = (v.myChips ?? 0) <= 0;
    const worthIt = joins ? v.pot >= 1 || chance(0.4) : v.pot >= v.card / 3;
    return { type: broke || worthIt ? "take" : "pass" };
  },
  rowcards(v, me) {
    if (v.phase !== "choose" || v.myCard !== null || !v.players.includes(me) || v.myHand.length === 0) return null;
    const ranked = [...v.myHand].sort((a: number, b: number) => rowRisk(a, v.rows) - rowRisk(b, v.rows));
    const safest = ranked.filter((c: number) => rowRisk(c, v.rows) === rowRisk(ranked[0], v.rows));
    return { type: "play", card: any(safest) };
  },
  seven(v, me) {
    if (v.current !== me || !v.hand) return null;
    if (v.phase === "draw") {
      const total = v.myTotal ?? 0;
      const offers = Object.entries((v.ifTake ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
      const best = offers[0];
      if (best && best[1] >= total + 6) return { type: "take", cardId: best[0] };
      if (v.deckLeft > 0) return { type: "draw" };
      return best ? { type: "take", cardId: best[0] } : null;
    }
    if (v.phase === "discard") {
      const options = Object.entries((v.ifDiscard ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
      const cardId = options[0]?.[0] ?? v.hand[0]?.id;
      return cardId ? { type: "discard", cardId } : null;
    }
    return null;
  },
  platter(v, me) {
    if (v.phase !== "play" || v.current !== me) return null;
    const rules = (v.piles as { top: { worth: number | null } | null }[])
      .map((pile, col) => ({ col, worth: pile.top ? (pile.top.worth ?? 0) : null }))
      .filter((r): r is { col: number; worth: number } => r.worth !== null)
      .sort((a, b) => b.worth - a.worth);
    const slots: { col: number; row: number }[] = [];
    (v.market as (object | null)[][]).forEach((column, col) => {
      column.forEach((item, row) => {
        if (item) slots.push({ col, row });
      });
    });
    const best = rules[0];
    const wantRule = best && (v.mustTake === 0 || best.worth >= 3 || (best.worth > 0 && chance(0.5)) || chance(0.12));
    if (best && wantRule) return { type: "takeRule", pile: best.col };
    if (v.mustTake === 0) return null;
    const taken: { col: number; row: number }[] = [];
    while (taken.length < v.mustTake && slots.length > 0) {
      taken.push(...slots.splice(Math.floor(Math.random() * slots.length), 1));
    }
    return { type: "takeItems", slots: taken };
  },
  climb(v, me) {
    if (v.current !== me) return null;
    if (v.phase === "move") return { type: "move", option: Math.floor(Math.random() * v.options.length) };
    if (v.phase !== "decide") return null;
    const steps = Object.entries((v.climbers ?? {}) as Record<string, number>).reduce(
      (sum, [column, height]) => sum + height - (v.saved[me]?.[column] ?? 0),
      0,
    );
    // Greedier with little at stake; almost always banks once three climbers are out.
    const out = Object.keys(v.climbers ?? {}).length;
    const stop = steps > 0 && (out >= 3 ? chance(0.8) : steps >= 3 ? chance(0.6) : chance(0.15));
    return { type: stop ? "stop" : "roll" };
  },
  flipout(v, me) {
    const live = (v.players as string[]).filter((p) => v.status[p] !== "bust");
    if (v.phase === "turn" && v.current === me) {
      const mine = (v.cards[me] ?? []) as { kind: string; special?: string }[];
      const numbers = mine.filter((c) => c.kind === "num").length;
      const mustHit = mine.some((c) => c.special === "zero");
      return mustHit || numbers < 3 || (numbers < 5 && chance(0.45)) ? { type: "hit" } : { type: "stay" };
    }
    if (v.pending?.by !== me) return null;
    const others = live.filter((p) => p !== me);
    if (v.phase === "assign") {
      // Bad cards go to whoever is ahead this round; "one more" and "flip four" too.
      const lead = [...others].sort((a, b) => (v.preview[b] ?? 0) - (v.preview[a] ?? 0))[0];
      return { type: "give", target: lead ?? me };
    }
    if (v.phase === "use") {
      const act = v.pending.card.act as string;
      const holders = (act === "steal" ? others : live).filter((p) => (v.cards[p] ?? []).length > 0);
      const pickOf = (p: string) => ({ player: p, cardId: (any(v.cards[p]) as { id: string }).id });
      const chosen = act === "swap" ? holders.slice(0, 2) : [any(holders.filter((p) => p !== me)) ?? holders[0]];
      return { type: "use", cards: chosen.filter(Boolean).map((p) => pickOf(p as string)) };
    }
    return null;
  },
  liar(v, me) {
    if (v.phase !== "bid" || v.current !== me || !v.myDice) return null;
    const mine = (face: number) =>
      (v.myDice as number[]).filter((d) => d === face || (v.onesWild && face !== 1 && d === 1)).length;
    // What the table probably holds of a face: my own plus a third of everyone else's dice.
    const likely = (face: number) => mine(face) + (v.totalDice - 5) / (v.onesWild && face !== 1 ? 3 : 6);
    if (!v.bid) {
      const face = [2, 3, 4, 5, 6].sort((a, b) => mine(b) - mine(a))[0] as number;
      return { type: "bid", quantity: v.minOpening, face };
    }
    if (v.bid.quantity > likely(v.bid.face) + (chance(0.3) ? 1.5 : 0.5)) return { type: "open" };
    const best = [2, 3, 4, 5, 6].sort((a, b) => mine(b) - mine(a))[0] as number;
    const sameCount = best > v.bid.face && v.bid.face !== 1;
    return { type: "bid", quantity: sameCount ? v.bid.quantity : v.bid.quantity + 1, face: best };
  },
  delve(v, me) {
    if (v.phase !== "choose" || !v.inside.includes(me) || v.myChoice !== null) return null;
    const hazards = (v.path as { kind: string }[]).filter((c) => c.kind === "hazard").length;
    const carried = v.carried[me] ?? 0;
    // The more danger showing and the more in hand, the likelier a script walks out.
    const leave = carried > 0 && chance(Math.min(0.9, hazards * 0.18 + carried * 0.035));
    return { type: "choose", stay: !leave };
  },
  dish(v, me) {
    const unseen = (v.players as string[]).filter((p) => p !== me && !(v.pass?.seen ?? []).includes(p));
    if (v.phase === "offer" && v.current === me && v.myHand?.length) {
      const kind = any(v.myHand as string[]) as string;
      const target = any((v.players as string[]).filter((p) => p !== me)) as string;
      return { type: "offer", kind, target, claim: chance(0.5) ? kind : (any(v.kinds as string[]) as string) };
    }
    if (v.phase === "respond" && v.pass?.holder === me) {
      if (unseen.length > 0 && chance(0.25)) return { type: "peek" };
      return { type: "call", truth: chance(0.5) };
    }
    if (v.phase === "relay" && v.pass?.holder === me && unseen.length > 0) {
      const truth = v.pass.card as string;
      return { type: "relay", target: any(unseen), claim: chance(0.5) ? truth : (any(v.kinds as string[]) as string) };
    }
    return null;
  },
  spell(v, me) {
    if (v.phase !== "play" || v.current !== me) return null;
    if (v.casts > 0 && chance(0.6)) return { type: "end" };
    // Call the number with the most stones this script cannot see anywhere.
    const seen = (n: number) =>
      (v.board[n] ?? 0) +
      (Object.values(v.hands) as number[][]).reduce((sum, hand) => sum + hand.filter((x) => x === n).length, 0);
    const options = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => n >= v.floor).sort((a, b) => b - seen(b) - (a - seen(a)));
    return options[0] ? { type: "cast", number: options[0] } : { type: "end" };
  },
};

/** Games in which the scripted players can hold up their end of the table. */
export const SCRIPTED_GAMES = Object.keys(scripts);

export function scriptedMove(gameId: string, view: unknown, me: string, state: unknown): Move {
  const v = view as View;
  if (!v || typeof v !== "object") return null;
  // Topic choice: any candidate, so the demo does not always open with the same one.
  if (v.phase === "pick" && v.pick?.picker === me && (v.pick.candidates?.length ?? 0) > 0) {
    return { type: "choose", index: Math.floor(Math.random() * v.pick.candidates.length), step: v.step };
  }
  const script = scripts[gameId];
  if (!script) return botAction(gameId, view, me);
  const move = script(v, me, state as View);
  if (!move) return null;
  return typeof v.step === "number" ? { ...move, step: v.step } : { ...move, round: v.round };
}
