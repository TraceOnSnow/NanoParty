import type { Ack, RoomView } from "@apr/shared";
import type { ComponentType } from "react";
import { BluffGame } from "./bluff/BluffGame.tsx";
import { CategoriesGame } from "./categories/CategoriesGame.tsx";
import { EstimateGame } from "./estimate/EstimateGame.tsx";
import { MostLikelyGame } from "./mostlikely/MostLikelyGame.tsx";
import { OneClueGame } from "./oneclue/OneClueGame.tsx";
import type { CustomField } from "./PickPanel.tsx";
import { QuipGame } from "./quip/QuipGame.tsx";
import { RankingGame } from "./ranking/RankingGame.tsx";
import { RowCardsGame } from "./rowcards/RowCardsGame.tsx";
import { SpectrumGame } from "./spectrum/SpectrumGame.tsx";
import { UndercoverGame } from "./undercover/UndercoverGame.tsx";
import { WagerGame } from "./wager/WagerGame.tsx";

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
  ranking: [
    { key: "text", label: "情境", placeholder: "情境，如 说一种食物" },
    { key: "low", label: "1 分", placeholder: "1 分代表，如 最难吃" },
    { key: "high", label: "10 分", placeholder: "10 分代表，如 最好吃" },
  ],
  oneclue: [{ key: "word", label: "目标词", placeholder: "一个常见名词" }],
};
