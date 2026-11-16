/**
 * Prepared lines for the static demo: what the stand-in host and the scripted players say.
 * The host only comments on what the visitor's own screen already shows (the two views passed
 * in are that player's view before and after a step), so it cannot give anything away.
 */
import type { GameMeta, SettlementRow } from "@apr/shared";
import { formatTenths } from "@apr/shared";

// biome-ignore lint/suspicious/noExplicitAny: views are game-specific
type View = any;
type Name = (id: string) => string;

const any = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)] as T;

const INTROS: Record<string, string> = {
  estimate: "估数字。我报一个问题，各位写一个数，离答案最近的拿分。不许查手机，查了我也不知道，但你良心会痛。",
  wager: "估数下注。先各自估个数，再押你觉得谁最准——可以押自己，也可以押那个看起来很有把握的人。",
  quip: "脑洞问答。一道题，每人写一个答案，然后匿名投票。不求正确，只求离谱得恰到好处。",
  mostlikely: "谁最可能。我念一个情境，你们投在场的一个人。被投中不丢人，没人投才丢人。",
  percent: "百分比竞猜。大家先悄悄答是或否，再由一个人猜有几个人答了「是」，其他人押他猜高了还是猜低了。",
  pollmine: "猜大家选。两队轮流翻选项：翻到有人选的得分，翻到没人选的掉一条命。",
  nothanks: "拒牌筹码。牌面就是罚分，不想要就交一个筹码让给下家。筹码用完了？那就只能含泪收下。",
  rowcards: "别拿第六张。所有人同时出牌，从小到大接到四行牌的末尾；谁的牌成了某一行的第六张，就把前五张全收走。",
  seven: "攒七张。摸一张、弃一张，手里永远七张。牌和牌之间会互相加分、互相作废，弃牌区摆满就结算。",
  platter: "凑一桌。每回合拿一张规则牌或者两张材料。规则牌决定你的材料值多少分，所以先看清自己盘子里有什么。",
};

export const hostIntro = (gameId: string, meta: GameMeta) => INTROS[gameId] ?? `${meta.name}。${meta.rulesSummary}`;

function estimateReveal(v: View, name: Name): string | null {
  const results = [...(v.reveal?.results ?? [])].sort((a: View, b: View) => a.diff - b.diff);
  const best = results[0];
  const worst = results[results.length - 1];
  if (!best) return `答案是 ${v.reveal.answer}${v.question.unit}。没人交卷，这题算我自言自语。`;
  const tail =
    worst && worst !== best
      ? `${name(worst.playerId)} 报了 ${worst.guess}，离谱得很有想法。`
      : "一个人的比赛，也算赢。";
  return `答案是 ${v.reveal.answer}${v.question.unit}。${name(best.playerId)} 最接近，${tail}`;
}

type React = (before: View, now: View, name: Name) => (string | null)[];

const REACTIONS: Record<string, React> = {
  estimate: (b, v, name) => [b.phase !== "reveal" && v.phase === "reveal" && v.reveal ? estimateReveal(v, name) : null],
  wager: (b, v, name) => [
    b.phase !== "bet" && v.phase === "bet" ? "数字都亮出来了。押一个你信得过的人，押自己也行，没人笑你。" : null,
    b.phase !== "reveal" && v.phase === "reveal" && v.reveal
      ? `答案是 ${v.reveal.answer}${v.question.unit}。${
          v.reveal.closest.length ? `${v.reveal.closest.map(name).join("、")} 最接近` : "没有人接近"
        }，押对的人可以得意十秒。`
      : null,
  ],
  quip: (b, v, name) => {
    if (b.phase !== "vote" && v.phase === "vote") return ["答案收齐，匿名投票。不许投自己，我盯着呢。"];
    if (b.phase !== "reveal" && v.phase === "reveal" && v.reveal?.length) {
      const top = [...v.reveal].sort((x: View, y: View) => y.voters.length - x.voters.length)[0];
      return [
        top.voters.length === 0
          ? "一票都没投出去，各位互相看不上，挺好。"
          : `「${top.text}」拿了 ${top.voters.length} 票。${name(top.playerId)}，这个脑回路我先记下了。`,
      ];
    }
    return [];
  },
  mostlikely: (b, v, name) => [
    b.phase !== "reveal" && v.phase === "reveal" && v.reveal
      ? v.reveal.top.length === 1
        ? `${name(v.reveal.top[0])} 众望所归。别解释，解释就是掩饰。`
        : `${v.reveal.top.map(name).join("、")} 并列。看来嫌疑人不止一位。`
      : null,
  ],
  percent: (b, v, name) => [
    b.phase !== "guess" && v.phase === "guess"
      ? `都答完了。${name(v.guesser)}，你觉得有几个人答了「是」？`
      : b.phase !== "bet" && v.phase === "bet"
        ? `${name(v.guesser)} 猜 ${v.guess} 个。其他人押：实际比这多，还是比这少？`
        : null,
    b.phase !== "reveal" && v.phase === "reveal" && v.reveal
      ? `实际是 ${v.reveal.yes} 个人答了「是」，${name(v.guesser)} 猜的是 ${v.guess}。${
          v.reveal.yes === v.guess ? "分毫不差，建议去买彩票。" : "人心难测。"
        }`
      : null,
  ],
  pollmine: (b, v) => [
    b.phase !== "hunt" && v.phase === "hunt" ? "票投完了。两队轮流翻：猜大家选了哪个，别翻到没人选的。" : null,
    b.phase !== "reveal" && v.phase === "reveal" ? "这一轮翻完了，看看大家到底怎么选的。" : null,
  ],
  nothanks: (b, v, name) => {
    if (b.phase === "play" && v.phase !== "play") {
      return [`牌发完了。${v.winners.map(name).join("、")} 罚分最少，赢下这一局。`];
    }
    const taker = (v.players as string[]).find((p) => (v.cards[p]?.length ?? 0) > (b.cards?.[p]?.length ?? 0));
    if (!taker || b.card === null) return [];
    if (b.card >= 28 && b.pot <= 2) return [`${name(taker)} 收下了 ${b.card}，筹码才 ${b.pot} 个。这是没得选了吧。`];
    if (b.pot >= 6) return [`${name(taker)} 拿走 ${b.card}，顺便卷走 ${b.pot} 个筹码。这波不亏。`];
    return [];
  },
  rowcards: (b, v, name) => {
    if (b.phase === "choose" && v.phase === "handOver") return ["这一手打完了，数数各自收了多少牛头。"];
    if (v.trick === b.trick && v.hand === b.hand) return [];
    const worst = [...(v.lastTrick ?? [])]
      .filter((p: View) => p.took)
      .sort((x: View, y: View) => y.took.length - x.took.length)[0];
    return [
      worst && worst.took.length >= 4
        ? `${name(worst.playerId)} 的 ${worst.card} 成了第六张，一口气收走 ${worst.took.length} 张。`
        : null,
    ];
  },
  seven: (b, v, name) => [
    v.phase !== "finished" && v.discards.length === v.endAt - 2 && b.discards.length < v.discards.length
      ? "弃牌区只差两张就满了，想换牌的抓紧。"
      : null,
    b.phase !== "finished" && v.phase === "finished" ? `摊牌。${v.winners.map(name).join("、")} 的七张最能打。` : null,
  ],
  platter: (b, v, name) => [
    b.phase !== "finished" && v.phase === "finished"
      ? `桌子清空了。${v.winners.map(name).join("、")} 这一盘配得最好。`
      : null,
  ],
};

export function hostReact(gameId: string, before: unknown, now: unknown, name: Name): string[] {
  const react = REACTIONS[gameId];
  if (!react || !before || !now) return [];
  try {
    return react(before, now, name).filter((line): line is string => typeof line === "string");
  } catch {
    // A line that cannot be built is simply not said.
    return [];
  }
}

export function hostOutro(rows: SettlementRow[], name: Name): string {
  const first = rows.filter((r) => r.rank === 1);
  if (first.length === 0 || rows.every((r) => r.tenths === 0)) return "这一场没分出高下，就当热身。";
  const who = first.map((r) => name(r.playerId)).join("、");
  const reward = formatTenths(first[0]?.tenths ?? 0);
  return `这一场结束：${who} 第一，记 ${reward} 分派对积分。真实版本里这一步要房主点确认，我没有入账的权限。`;
}

const AFTER_REVEAL = [
  "这也行？",
  "不服，再来一把",
  "哈哈哈哈哈哈",
  "我怀疑有人开了",
  "下把我必拿第一",
  "刚才那个是我手滑",
  "笑死，谁写的",
  "稳了稳了",
  "这把不算",
  "别看我，我乱选的",
];
const REPLIES = ["确实", "笑死", "你认真的吗", "别聊了，快出牌", "哈哈哈哈", "+1", "有道理，但我不听", "所以到谁了？"];

/** Something a scripted player blurts out after a result, or null (most of the time). */
export function playerBanter(_gameId: string, before: unknown, now: unknown): string | null {
  const b = before as View;
  const v = now as View;
  const revealed = b?.phase !== v?.phase && ["reveal", "handOver", "gameOver", "finished"].includes(v?.phase);
  return revealed && Math.random() < 0.6 ? any(AFTER_REVEAL) : null;
}

export const playerReply = () => any(REPLIES);
