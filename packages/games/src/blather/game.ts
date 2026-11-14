/**
 * 「词块描述」— the describer may only speak through fill-in sentence frames with a small fixed
 * vocabulary; everyone else races to type the secret word. Rule spec: docs/games/blather.md
 */
import { defineGame, type GameContext, type GameResult, type PlayerId } from "@apr/shared";
import { z } from "zod";
import { oneclueContentSchema } from "../oneclue/game.ts";
import {
  applyPick,
  emptyPick,
  isPickAction,
  offerToPick,
  openPick,
  type PickState,
  type PickView,
  pickActionSchemas,
  pickOnTimeout,
  pickSecondsOption,
  pickView,
  rotatePicker,
} from "../pick.ts";
import { norm, roundsOption, timer } from "../util.ts";

/** Sentence frames: `text` has one ____ filled from `words`. */
export const FRAMES: readonly { text: string; words: readonly string[] }[] = [
  { text: "它是一种____", words: ["东西", "地方", "人物", "动物", "食物", "活动", "自然现象", "抽象概念"] },
  {
    text: "它____",
    words: [
      "很大",
      "很小",
      "很热",
      "很冷",
      "很贵",
      "很便宜",
      "很危险",
      "很可爱",
      "很常见",
      "很稀有",
      "很古老",
      "很现代",
      "很吵",
      "很安静",
      "很软",
      "很硬",
      "会动",
      "会发光",
      "有生命",
      "能吃",
    ],
  },
  {
    text: "它常出现在____",
    words: [
      "家里",
      "学校",
      "公司",
      "街上",
      "野外",
      "水里",
      "天上",
      "厨房",
      "医院",
      "商店",
      "节日里",
      "夜晚",
      "夏天",
      "冬天",
      "故事里",
    ],
  },
  {
    text: "人们用它来____",
    words: [
      "吃",
      "喝",
      "玩",
      "看",
      "听",
      "穿",
      "坐",
      "交流",
      "出行",
      "工作",
      "学习",
      "庆祝",
      "清洁",
      "保护自己",
      "赚钱",
      "休息",
    ],
  },
  { text: "它让人感到____", words: ["开心", "害怕", "放松", "紧张", "饿", "困", "无聊", "兴奋", "怀念", "安全"] },
  { text: "它的颜色通常是____", words: ["红色", "黄色", "蓝色", "绿色", "白色", "黑色", "透明", "五颜六色", "说不准"] },
];
const POINTS_GUESS = 2;
const POINTS_DESCRIBE = 1;

const payload = oneclueContentSchema;
type Word = z.infer<typeof payload>;
const configSchema = z.object({
  pickSeconds: z.number().int().min(0).max(600).default(60),
  rounds: z.number().int().min(0).max(30).default(6),
  roundSeconds: z.number().int().min(30).max(600).default(150),
});
type Config = z.infer<typeof configSchema>;

const actionSchema = z.discriminatedUnion("type", [
  ...pickActionSchemas,
  z.object({
    type: z.literal("say"),
    step: z.number().int(),
    frame: z
      .number()
      .int()
      .min(0)
      .max(FRAMES.length - 1),
    word: z.number().int().min(0),
  }),
  z.object({ type: z.literal("guess"), step: z.number().int(), text: z.string().trim().min(1).max(20) }),
  /** Describer reacts to a wrong guess. */
  z.object({ type: z.literal("react"), step: z.number().int(), index: z.number().int().min(0), close: z.boolean() }),
  z.object({ type: z.literal("advance"), step: z.number().int() }),
]);
type Action = z.infer<typeof actionSchema>;

export interface BlatherState {
  config: Config;
  pick: PickState<Word>;
  round: number;
  step: number;
  phase: "pick" | "describe" | "reveal" | "finished";
  participants: PlayerId[];
  describer: PlayerId;
  word: { contentId: string | null; text: string };
  sentences: string[];
  guesses: { by: PlayerId; text: string; close: boolean | null }[];
  winner: PlayerId | null;
  deadlineAt: number | null;
}

export interface BlatherView extends Omit<BlatherState, "config" | "pick" | "word"> {
  totalRounds: number;
  pick: PickView | null;
  /** The describer always; everyone after the reveal. */
  word: string | null;
  /** The sentence frames, sent to the describer while describing. */
  frames: typeof FRAMES | null;
}

const PICK = { schema: payload, contentType: "guess-word", allowCustom: true };

function openRound(state: BlatherState, ctx: GameContext): GameResult<BlatherState> {
  state.phase = "pick";
  state.step += 1;
  state.participants = [...ctx.players];
  state.describer = rotatePicker(state.pick, state.participants);
  openPick(state.pick, state.describer, payload, ctx);
  state.deadlineAt = timer(state.config.pickSeconds, ctx);
  return { ok: true, state };
}

function startRound(state: BlatherState, c: { contentId: string | null; data: Word }, ctx: GameContext) {
  state.word = { contentId: c.contentId, text: c.data.word };
  state.sentences = [];
  state.guesses = [];
  state.winner = null;
  state.phase = "describe";
  state.step += 1;
  state.deadlineAt = timer(state.config.roundSeconds, ctx);
}

function reveal(state: BlatherState): GameResult<BlatherState> {
  state.phase = "reveal";
  state.step += 1;
  state.deadlineAt = null;
  return { ok: true, state };
}

function advance(state: BlatherState, ctx: GameContext): GameResult<BlatherState> {
  if ((state.config.rounds > 0 && state.round >= state.config.rounds) || ctx.players.length < 3) {
    state.phase = "finished";
    state.step += 1;
    state.deadlineAt = null;
    return { ok: true, state, finished: true };
  }
  state.round += 1;
  return openRound(state, ctx);
}

export const blatherGame = defineGame<BlatherState, Action, BlatherView, Config>({
  meta: {
    id: "blather",
    name: "词块描述",
    description: "描述者不能自由说话，只能用几个固定句式和一小撮词拼句子。「它是一种东西」「它会发光」——猜猜是什么？",
    minPlayers: 3,
    maxPlayers: 8,
    rulesSummary:
      "每轮一名描述者（轮流）秘密选一个词（别人看不到候选）。描述者只能从固定句式里选词拼出句子，例如「它是一种____」「它常出现在____」，每句都会显示给所有人；不能在语音里补充。其他人随时在网页上输入猜测，描述者可以给猜错的答案标「接近」或「不对」。有人猜中或时间到，本轮结束。中途加入的玩家从下一轮开始参与。",
    scoringSummary: `猜中的人 +${POINTS_GUESS}，描述者 +${POINTS_DESCRIBE}；没人猜中都不得分。`,
    contentType: "guess-word",
    options: [
      roundsOption(6),
      { key: "roundSeconds", label: "每轮时限（秒）", min: 30, max: 600, default: 150 },
      pickSecondsOption,
    ],
  },
  configSchema,
  actionSchema,

  setup(config, ctx) {
    if (ctx.players.length < 3) return { ok: false, error: "至少需要 3 名玩家" };
    const state: BlatherState = {
      config,
      pick: emptyPick(),
      round: 1,
      step: 0,
      phase: "pick",
      participants: [],
      describer: "",
      word: { contentId: null, text: "" },
      sentences: [],
      guesses: [],
      winner: null,
      deadlineAt: null,
    };
    return openRound(state, ctx);
  },

  apply(state, action, actor, ctx) {
    if (actor.kind !== "player") return { ok: false, error: "无效的操作来源" };
    if (state.phase === "finished") return { ok: false, error: "游戏已结束" };
    if (action.step !== state.step) return { ok: false, error: "该操作已过期" };
    const me = actor.playerId;
    if (isPickAction(action)) {
      if (state.phase !== "pick") return { ok: false, error: "这一轮的词已经选好了" };
      const r = applyPick(state.pick, action, me, ctx, PICK);
      if (!r.ok) return r;
      if (!r.chosen) return { ok: true, state };
      startRound(state, r.chosen, ctx);
      return { ok: true, state, contributed: r.contributed };
    }
    if (action.type === "advance") {
      if (!actor.isHost) return { ok: false, error: "只有房主可以推进" };
      if (state.phase === "describe") return reveal(state);
      if (state.phase === "reveal") return advance(state, ctx);
      return { ok: false, error: "描述者正在选词" };
    }
    if (state.phase !== "describe") return { ok: false, error: "现在不是描述阶段" };
    switch (action.type) {
      case "say": {
        if (me !== state.describer) return { ok: false, error: "只有描述者可以拼句子" };
        const frame = FRAMES[action.frame];
        const word = frame?.words[action.word];
        if (!frame || !word) return { ok: false, error: "没有这个词块" };
        const sentence = frame.text.replace("____", word);
        if (state.sentences.includes(sentence)) return { ok: false, error: "这句已经说过了" };
        if (state.sentences.length >= 20) return { ok: false, error: "句子已经够多了" };
        state.sentences.push(sentence);
        return { ok: true, state };
      }
      case "guess": {
        if (me === state.describer) return { ok: false, error: "描述者不能猜" };
        if (!state.participants.includes(me)) return { ok: false, error: "你将从下一轮开始参与" };
        if (norm(action.text) !== norm(state.word.text)) {
          state.guesses.push({ by: me, text: action.text, close: null });
          if (state.guesses.length > 40) state.guesses.shift();
          return { ok: true, state };
        }
        state.winner = me;
        const r = reveal(state);
        return {
          ...r,
          scores: [
            { playerId: me, points: POINTS_GUESS, reason: "猜中", key: `r${state.round}:guess` },
            {
              playerId: state.describer,
              points: POINTS_DESCRIBE,
              reason: "描述被猜中",
              key: `r${state.round}:describe`,
            },
          ],
        } as GameResult<BlatherState>;
      }
      case "react": {
        if (me !== state.describer) return { ok: false, error: "只有描述者可以评价猜测" };
        const g = state.guesses[action.index];
        if (!g) return { ok: false, error: "没有这条猜测" };
        g.close = action.close;
        return { ok: true, state };
      }
    }
  },

  skip: {
    key: (state) => (state.phase === "describe" ? `r${state.round}` : null),
    voters: (state) => state.participants,
    apply: (state, ctx) => advance(state, ctx),
  },
  currentContentId: (state) => (state.phase === "reveal" ? state.word.contentId : null),
  offer(state, items) {
    const r = offerToPick(state.pick, state.phase === "pick", items, payload, "词块描述");
    return r.ok ? { ok: true, state, message: `${r.message}（只有描述者看得到）` } : r;
  },
  atSafePoint: (state) => state.phase === "pick" || state.phase === "reveal",
  deadline: (state) => (state.phase === "pick" || state.phase === "describe" ? state.deadlineAt : null),
  onTimeout(state, ctx) {
    if (state.phase === "pick") {
      const c = pickOnTimeout(state.pick, ctx);
      if (!c) return advance(state, ctx);
      startRound(state, c, ctx);
      return { ok: true, state };
    }
    return state.phase === "describe" ? reveal(state) : { ok: true, state };
  },
  onResume(state, ctx) {
    if (state.phase === "pick") state.deadlineAt = timer(state.config.pickSeconds, ctx);
    if (state.phase === "describe") state.deadlineAt = timer(state.config.roundSeconds, ctx);
    return state;
  },

  view(state, viewer) {
    const { config, pick, word, ...rest } = state;
    const open = state.phase === "reveal" || state.phase === "finished";
    return {
      ...rest,
      totalRounds: config.rounds,
      pick: state.phase === "pick" ? pickView(pick, (d) => d.word, PICK.allowCustom, viewer === state.describer) : null,
      word: state.phase !== "pick" && (open || viewer === state.describer) ? word.text : null,
      frames: state.phase === "describe" && viewer === state.describer ? FRAMES : null,
    };
  },

  publicSummary(state) {
    if (state.phase === "pick") return `词块描述 第 ${state.round} 轮：描述者正在选词`;
    const base = `词块描述 第 ${state.round} 轮。句子：${state.sentences.join("；") || "暂无"}。猜测：${state.guesses.map((g) => g.text).join("、") || "暂无"}`;
    return state.phase === "describe" ? `${base}（答案未公开）` : `${base}。答案「${state.word.text}」（已揭晓）`;
  },
});
