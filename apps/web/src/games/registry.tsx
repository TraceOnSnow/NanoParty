import type { Ack, RoomView } from "@apr/shared";
import type { ComponentType } from "react";
import { BlatherGame } from "./blather/BlatherGame.tsx";
import { BluffGame } from "./bluff/BluffGame.tsx";
import { CategoriesGame } from "./categories/CategoriesGame.tsx";
import { ClimbGame } from "./climb/ClimbGame.tsx";
import { CloverGame } from "./clover/CloverGame.tsx";
import { CodeBreakGame } from "./codebreak/CodeBreakGame.tsx";
import { CrewGame } from "./crew/CrewGame.tsx";
import { DelveGame } from "./delve/DelveGame.tsx";
import { DishGame } from "./dish/DishGame.tsx";
import { DuelGame } from "./duel/DuelGame.tsx";
import { EchoGame } from "./echo/EchoGame.tsx";
import { EstimateGame } from "./estimate/EstimateGame.tsx";
import { FireworksGame } from "./fireworks/FireworksGame.tsx";
import { FlipoutGame } from "./flipout/FlipoutGame.tsx";
import { FlushGame } from "./flush/FlushGame.tsx";
import { LiarGame } from "./liar/LiarGame.tsx";
import { MostLikelyGame } from "./mostlikely/MostLikelyGame.tsx";
import { NoThanksGame } from "./nothanks/NoThanksGame.tsx";
import { OneClueGame } from "./oneclue/OneClueGame.tsx";
import type { CustomField } from "./PickPanel.tsx";
import { PercentGame } from "./percent/PercentGame.tsx";
import { PlatterGame } from "./platter/PlatterGame.tsx";
import { PollMineGame } from "./pollmine/PollMineGame.tsx";
import { QuipGame } from "./quip/QuipGame.tsx";
import { RankingGame } from "./ranking/RankingGame.tsx";
import { RowCardsGame } from "./rowcards/RowCardsGame.tsx";
import { SevenGame } from "./seven/SevenGame.tsx";
import { SkullGame } from "./skull/SkullGame.tsx";
import { SoupGame } from "./soup/SoupGame.tsx";
import { SpectrumGame } from "./spectrum/SpectrumGame.tsx";
import { SpellGame } from "./spell/SpellGame.tsx";
import { SplitGame } from "./split/SplitGame.tsx";
import { SpyGame } from "./spy/SpyGame.tsx";
import { SyncGame } from "./sync/SyncGame.tsx";
import { TabooGame } from "./taboo/TabooGame.tsx";
import { UndercoverGame } from "./undercover/UndercoverGame.tsx";
import { WagerGame } from "./wager/WagerGame.tsx";
import { WordGridGame } from "./wordgrid/WordGridGame.tsx";
import { WordHuntGame } from "./wordhunt/WordHuntGame.tsx";

export interface GameProps {
  /** Game-specific view, already filtered by the server for this player. */
  view: unknown;
  room: RoomView;
  paused: boolean;
  /** Submits a formal game action for the current segment. */
  act(action: unknown): Promise<Ack>;
}

/** Game id -> main-panel component. A new game adds its module in @apr/games and its UI here. */
export const gameComponents: Record<string, ComponentType<GameProps>> = {
  spectrum: SpectrumGame,
  undercover: UndercoverGame,
  categories: CategoriesGame,
  ranking: RankingGame,
  bluff: BluffGame,
  wager: WagerGame,
  mostlikely: MostLikelyGame,
  quip: QuipGame,
  oneclue: OneClueGame,
  rowcards: RowCardsGame,
  soup: SoupGame,
  split: SplitGame,
  wordhunt: WordHuntGame,
  crew: CrewGame,
  skull: SkullGame,
  nothanks: NoThanksGame,
  platter: PlatterGame,
  seven: SevenGame,
  climb: ClimbGame,
  flipout: FlipoutGame,
  spell: SpellGame,
  echo: EchoGame,
  fireworks: FireworksGame,
  dish: DishGame,
  spy: SpyGame,
  sync: SyncGame,
  delve: DelveGame,
  liar: LiarGame,
  flush: FlushGame,
  duel: DuelGame,
  wordgrid: WordGridGame,
  codebreak: CodeBreakGame,
  taboo: TabooGame,
  blather: BlatherGame,
  clover: CloverGame,
  pollmine: PollMineGame,
  percent: PercentGame,
  estimate: EstimateGame,
};

/** Fields of a player-written topic, per game (games without an entry do not allow writing one). */
export const customTopicFields: Record<string, CustomField[]> = {
  quip: [{ key: "text", label: "题目", placeholder: "一个开放的脑洞问题" }],
  mostlikely: [{ key: "text", label: "题目", placeholder: "谁最可能……？" }],
  categories: [
    { key: "name", label: "类别", placeholder: "类别名，如 水果园" },
    { key: "hint", label: "提示", placeholder: "提示（选填）", optional: true },
  ],
  echo: [
    { key: "name", label: "类别", placeholder: "类别名，如 水果" },
    { key: "hint", label: "提示", placeholder: "提示（选填）", optional: true },
  ],
  ranking: [
    { key: "text", label: "情境", placeholder: "情境，如 说一种食物" },
    { key: "low", label: "1 分", placeholder: "1 分代表，如 最难吃" },
    { key: "high", label: "10 分", placeholder: "10 分代表，如 最好吃" },
  ],
  oneclue: [{ key: "word", label: "目标词", placeholder: "一个常见名词" }],
  soup: [
    { key: "surface", label: "汤面", placeholder: "汤面：一个离奇的情境" },
    { key: "solution", label: "汤底", placeholder: "汤底：完整真相（只有你看得到）" },
  ],
  split: [{ key: "text", label: "题目", placeholder: "带一个 ____ 的两难题，如 按下就得一百万，但____。你按吗？" }],
  wordhunt: [{ key: "word", label: "秘密词", placeholder: "一个常见名词" }],
  blather: [{ key: "word", label: "要描述的词", placeholder: "一个常见名词" }],
  percent: [{ key: "text", label: "题目", placeholder: "一个大家都能答「是 / 否」的问题，如 你今天喝过咖啡吗？" }],
};
