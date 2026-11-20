/**
 * "Same room code" play: several phones, no server, nothing sent anywhere.
 *
 * Every phone works out what its holder should see from the room code, the round number and the
 * role the holder says they have. Nothing is recorded: the players run the game themselves at
 * the table, the page only deals topics and secrets. Only games that work this way are listed —
 * games whose table keeps changing (cards in hand, chips, tricks) are not.
 */
import { bundledContent, SPY_PLACES, undercoverCountFor, WORDS, wolvesFor } from "@apr/games";
import { seeded, shuffled } from "./rng.ts";

export type Owner = "red" | "blue" | "neutral" | "trap";

export type Block =
  | { kind: "line"; label?: string; text: string; big?: boolean }
  | { kind: "list"; label?: string; items: string[]; numbered?: boolean; struck?: boolean }
  | { kind: "scale"; left: string; right: string; target: number | null }
  | { kind: "grid"; words: string[]; owners: Owner[]; showAll: boolean }
  /** Hidden until tapped. `who` says who is allowed to open it. */
  | { kind: "secret"; label: string; who: string; body: Block[] };

export interface DealInput {
  code: string;
  round: number;
  players: number;
  /** 1-based seat number the holder chose. */
  seat: number;
  team: 0 | 1;
  captain: boolean;
}

export type Need = "seat" | "team" | "captain";

export interface SeedGame {
  id: string;
  name: string;
  /** What each phone has to be told besides the room code. */
  needs: Need[];
  minPlayers: number;
  maxPlayers: number;
  /** How to run it at the table, in a few sentences. */
  how: string;
  /** What one step of the counter is called. */
  unit: string;
  deal(input: DealInput): Block[];
}

const TEAM = ["红队", "蓝队"] as const;

// biome-ignore lint/suspicious/noExplicitAny: payload shapes differ per content type
type Payload = any;
const pools = new Map<string, Payload[]>();
/** The round-th item of a content type, in an order fixed by the room code. */
function item(code: string, type: string, round: number): Payload {
  const key = `${code}:${type}`;
  let pool = pools.get(key);
  if (!pool) {
    const items = bundledContent.filter((c) => c.type === type).map((c) => c.payload);
    pool = shuffled(items, seeded(key));
    pools.set(key, pool);
  }
  return pool[(round - 1) % pool.length];
}

const rand = (i: DealInput, game: string, tag = "") => seeded(`${i.code}:${game}:${i.round}:${tag}`);
/** Whose turn a rotating job is this round (1-based seat). */
const turn = (i: DealInput) => ((i.round - 1) % i.players) + 1;
const seats = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
const line = (text: string, label?: string): Block => ({ kind: "line", text, label });
const big = (text: string, label?: string): Block => ({ kind: "line", text, label, big: true });

export const SEED_GAMES: SeedGame[] = [
  {
    id: "categories",
    name: "逛三园",
    needs: [],
    minPlayers: 2,
    maxPlayers: 12,
    unit: "题",
    how: "按座位轮流，每人说一个属于这个类别的词。说不出来、说重复、说错的人受罚，然后换下一题。",
    deal(i) {
      const c = item(i.code, "category", i.round);
      return [big(c.name, "类别"), ...(c.hint ? [line(c.hint)] : [])];
    },
  },
  {
    id: "mostlikely",
    name: "谁最可能",
    needs: [],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "题",
    how: "一个人念题，数「三、二、一」，所有人同时指向在场的一个人。被指得最多的人认领这个称号。",
    deal: (i) => [big(item(i.code, "who-prompt", i.round).text)],
  },
  {
    id: "quip",
    name: "脑洞问答",
    needs: [],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "题",
    how: "每人想一个答案，轮流说出来（想保密就写在纸上打乱了念）。大家投最好笑的一个，不能投自己。",
    deal: (i) => [big(item(i.code, "quip-prompt", i.round).text)],
  },
  {
    id: "split",
    name: "五五开",
    needs: [],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "题",
    how: "每人把空格填上自己的条件，轮流念出来。每念一个，其他人同时表态。两边人数越接近，出题的人越厉害。",
    deal(i) {
      const c = item(i.code, "split-prompt", i.round);
      return [big(c.text), line(`表态：${c.yes ?? "愿意"} / ${c.no ?? "不愿意"}`)];
    },
  },
  {
    id: "percent",
    name: "百分比竞猜",
    needs: [],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "题",
    how: "指定一个人猜：他先闭眼，其他人用举手回答「是」。手放下后，他猜有几个人举了手，其他人押他猜多了还是猜少了。",
    deal: (i) => [big(item(i.code, "yesno-prompt", i.round).text)],
  },
  {
    id: "pollmine",
    name: "猜大家选",
    needs: [],
    minPlayers: 4,
    maxPlayers: 12,
    unit: "题",
    how: "每人心里选一个选项（可以写在手心）。分两队轮流猜「有人选了这个」：猜中得分，猜到没人选的扣一条命。最后大家亮出自己的选择。",
    deal(i) {
      const c = item(i.code, "poll", i.round);
      return [big(c.text), { kind: "list", items: c.options, numbered: true }];
    },
  },
  {
    id: "estimate",
    name: "估数字",
    needs: [],
    minPlayers: 2,
    maxPlayers: 12,
    unit: "题",
    how: "每人报一个数（同时亮手机计算器或写在纸上，免得跟风）。全部报完，再点开答案，最接近的人得分。",
    deal(i) {
      const c = item(i.code, "numeric-fact", i.round);
      return [
        big(c.text),
        line(`单位：${c.unit}`),
        {
          kind: "secret",
          label: "答案",
          who: "所有人都报完数再点开",
          body: [big(`${c.answer} ${c.unit}`), ...(c.note ? [line(c.note)] : [])],
        },
      ];
    },
  },
  {
    id: "bluff",
    name: "真假难辨",
    needs: [],
    minPlayers: 3,
    maxPlayers: 10,
    unit: "题",
    how: "轮流当读题人。读题人点开真答案记在心里；其他人各编一个假答案悄悄告诉他（或写纸条）。读题人把真假答案混在一起念，大家猜哪个是真的。",
    deal(i) {
      const c = item(i.code, "fact-blank", i.round);
      return [
        big(c.text),
        {
          kind: "secret",
          label: "真答案",
          who: "只有这一轮的读题人点开",
          body: [big(c.answer), ...(c.note ? [line(c.note)] : [])],
        },
      ];
    },
  },
  {
    id: "soup",
    name: "海龟汤",
    needs: [],
    minPlayers: 2,
    maxPlayers: 12,
    unit: "道",
    how: "选一个人当主持，只有他点开汤底。其他人只能问能用「是 / 不是 / 无关」回答的问题，直到有人还原出真相。",
    deal(i) {
      const c = item(i.code, "soup", i.round);
      return [
        { kind: "line", label: "汤面", text: c.surface, big: true },
        { kind: "secret", label: "汤底", who: "只有主持人点开", body: [line(c.solution)] },
      ];
    },
  },
  {
    id: "spectrum",
    name: "猜刻度",
    needs: [],
    minPlayers: 2,
    maxPlayers: 12,
    unit: "轮",
    how: "轮流出题。出题人点开目标位置，说一个提示词，让大家猜它落在刻度的哪里（0 是左端，100 是右端）。大家商量出一个数，再看差多少。",
    deal(i) {
      const c = item(i.code, "spectrum", i.round);
      const target = Math.round(rand(i, "spectrum")() * 100);
      return [
        { kind: "scale", left: c.left, right: c.right, target: null },
        {
          kind: "secret",
          label: "目标位置",
          who: "只有这一轮的出题人点开；猜完后大家一起看",
          body: [{ kind: "scale", left: c.left, right: c.right, target }],
        },
      ];
    },
  },
  {
    id: "taboo",
    name: "禁词描述",
    needs: [],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "张",
    how: "分两队。描述的人点开词卡，让队友猜出目标词，但不能说出目标词和任何禁词；对方派一个人也点开词卡负责监督。限时一分钟，猜中一张就换下一张。",
    deal(i) {
      const c = item(i.code, "taboo-card", i.round);
      return [
        {
          kind: "secret",
          label: "词卡",
          who: "描述的人和对方的监督员点开，猜的人别看",
          body: [big(c.word, "目标词"), { kind: "list", label: "不能说", items: c.taboo, struck: true }],
        },
      ];
    },
  },
  {
    id: "oneclue",
    name: "不撞词",
    needs: ["seat"],
    minPlayers: 3,
    maxPlayers: 10,
    unit: "轮",
    how: "每轮一个人猜，其他人都能看到目标词。看到词的人各自写下一个提示词；互相一对，撞了的提示作废，再把剩下的亮给猜的人。",
    deal(i) {
      const guesser = turn(i);
      if (i.seat === guesser) return [big("这一轮你来猜"), line("别看别人的屏幕。等大家把没撞的提示亮给你。")];
      return [
        line(`这一轮由 ${guesser} 号来猜。`),
        {
          kind: "secret",
          label: "目标词",
          who: `除了 ${guesser} 号，其他人都点开`,
          body: [big(item(i.code, "guess-word", i.round).word)],
        },
      ];
    },
  },
  {
    id: "undercover",
    name: "谁是卧底",
    needs: ["seat"],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "局",
    how: "每人点开自己的词，别让别人看到。按座位轮流用一句话描述自己的词，不能直接说出来。每轮描述完，大家同时指认一个人出局。卧底全部出局则平民赢；卧底人数不少于平民则卧底赢。",
    deal(i) {
      const pair = item(i.code, "word-pair", i.round);
      const random = rand(i, "undercover");
      const flip = random() < 0.5;
      const count = undercoverCountFor(i.players);
      const undercovers = shuffled(seats(i.players), random).slice(0, count);
      const mine = undercovers.includes(i.seat) === flip ? pair.a : pair.b;
      return [
        line(`${i.players} 个人里有 ${count} 个卧底。没人知道自己是不是。`),
        { kind: "secret", label: `${i.seat} 号的词`, who: "只有你自己看", body: [big(mine)] },
      ];
    },
  },
  {
    id: "spy",
    name: "地点疑云",
    needs: ["seat"],
    minPlayers: 3,
    maxPlayers: 12,
    unit: "局",
    how: "所有人点开自己的那一份：除了一个外人，大家看到的是同一个地点。然后互相提问——点名问一个人和这个地点有关的问题，被问的人答完再问别人。问得太直白会把地点漏给外人，答得太含糊会被当成外人。随时可以提议指认，大家举手表决；外人也可以随时喊停猜地点。",
    deal(i) {
      const random = rand(i, "spy");
      // Places follow one shuffled order per room, so a room does not see the same place twice in a row.
      const order = shuffled(SPY_PLACES, seeded(`${i.code}:spy:places`));
      const place = order[(i.round - 1) % order.length] as string;
      const outsider = 1 + Math.floor(random() * i.players);
      return [
        line(`${i.players} 个人里有 1 个外人。`),
        {
          kind: "secret",
          label: `${i.seat} 号看这里`,
          who: "只有你自己看",
          body: [i.seat === outsider ? big("你是外人", "你不知道地点") : big(place, "你们现在在")],
        },
        { kind: "list", label: "所有可能的地点（外人从这里面猜）", items: [...SPY_PLACES] },
      ];
    },
  },
  {
    id: "ranking",
    name: "排排座",
    needs: ["seat"],
    minPlayers: 3,
    maxPlayers: 10,
    unit: "轮",
    how: "每轮一个队长，其他人各有一个互不相同的秘密数字（1–10）。每人按情境说一个回答，程度要和自己的数字相符，不能说出数字。队长听完，把大家从小到大排好，再一起亮数字。",
    deal(i) {
      const c = item(i.code, "scale-scenario", i.round);
      const captain = turn(i);
      const numbers = shuffled(seats(10), rand(i, "ranking"));
      const head: Block[] = [big(c.text, "情境"), line(`1 = ${c.low}　　10 = ${c.high}`)];
      if (i.seat === captain) return [...head, line("这一轮你是队长：你没有数字，负责听完后把大家从小到大排好。")];
      return [
        ...head,
        line(`这一轮的队长是 ${captain} 号。`),
        { kind: "secret", label: `${i.seat} 号的数字`, who: "只有你自己看", body: [big(String(numbers[i.seat - 1]))] },
      ];
    },
  },
  {
    id: "wordhunt",
    name: "问出秘密词",
    needs: ["seat"],
    minPlayers: 4,
    maxPlayers: 10,
    unit: "轮",
    how: "每人点开自己的身份。村长如实回答大家的是非题，限时五分钟问出秘密词。问出来了：狼人指认谁是预言家，指对则狼人翻盘。没问出来：大家投票找狼人，找对则村民赢。",
    deal(i) {
      const mayor = turn(i);
      const others = shuffled(
        seats(i.players).filter((s) => s !== mayor),
        rand(i, "wordhunt"),
      );
      const wolves = wolvesFor(others.length);
      const at = others.indexOf(i.seat);
      const role = i.seat === mayor ? "村长" : at < wolves ? "狼人" : at === wolves ? "预言家" : "村民";
      const hint = {
        村长: "你知道秘密词，负责如实回答问题（是 / 不是 / 也许）。",
        狼人: "你知道秘密词。暗中把大家带偏；词被问出来后，指出预言家就能翻盘。",
        预言家: "你知道秘密词。悄悄引导大家问出来，但别让狼人看出你是预言家。",
        村民: "你不知道秘密词，靠提问把它问出来。",
      }[role];
      const word = item(i.code, "guess-word", i.round + 1000).word;
      return [
        line(`这一轮的村长是 ${mayor} 号（公开）。其余人里有 ${wolves} 个狼人、1 个预言家。`),
        {
          kind: "secret",
          label: `${i.seat} 号的身份`,
          who: "只有你自己看",
          body: [big(role), line(hint), ...(role === "村民" ? [] : [big(word, "秘密词")])],
        },
      ];
    },
  },
  {
    id: "wordgrid",
    name: "暗号网格",
    needs: ["captain"],
    minPlayers: 4,
    maxPlayers: 12,
    unit: "局",
    how: "分红蓝两队，各出一名队长。队长的手机显示每个词属于谁；队员的手机只显示词。队长轮流说「一个提示词 + 一个数字」，队员据此指词。指中的词由队长宣布颜色，大家在自己手机上点一下做记号。先指完本队所有词的队赢，指到陷阱词直接输。",
    deal(i) {
      const random = rand(i, "wordgrid");
      const first: Owner = random() < 0.5 ? "red" : "blue";
      const second: Owner = first === "red" ? "blue" : "red";
      const words = shuffled(WORDS, random).slice(0, 25);
      const owners = shuffled<Owner>(
        [...Array<Owner>(9).fill(first), ...Array<Owner>(8).fill(second), ...Array<Owner>(7).fill("neutral"), "trap"],
        random,
      );
      return [
        line(`${first === "red" ? "红队" : "蓝队"}先手，有 9 个词；另一队 8 个；1 个陷阱。`),
        { kind: "grid", words, owners, showAll: i.captain },
      ];
    },
  },
  {
    id: "codebreak",
    name: "密码传递",
    needs: ["team"],
    minPlayers: 4,
    maxPlayers: 12,
    unit: "轮",
    how: "两队各有 4 个只有自己人知道的关键词。每轮每队一名传令员点开三位密码，为每一位说一条提示，暗示对应编号的关键词。队友猜密码；对方也猜——从第二轮起，对方猜中算拦截一次，自己人猜错算失误一次。先拦截两次的队赢，先失误两次的队输。",
    deal(i) {
      // Keywords stay the same for the whole room; only the code changes each round.
      const words = shuffled(WORDS, seeded(`${i.code}:codebreak:words`));
      const mine = words.slice(i.team * 4, i.team * 4 + 4);
      const code = shuffled([1, 2, 3, 4], rand(i, "codebreak", String(i.team))).slice(0, 3);
      return [
        { kind: "list", label: `${TEAM[i.team]}的关键词（别让对方看到）`, items: mine, numbered: true },
        {
          kind: "secret",
          label: "这一轮的密码",
          who: `只有${TEAM[i.team]}这一轮的传令员点开`,
          body: [big(code.join(" - "))],
        },
      ];
    },
  },
];
