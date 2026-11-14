import type { Ack, RoomView } from "@apr/shared";
import type { ComponentType } from "react";
import { BluffGame } from "./bluff/BluffGame.tsx";
import { CategoriesGame } from "./categories/CategoriesGame.tsx";
import { EstimateGame } from "./estimate/EstimateGame.tsx";
import { MostLikelyGame } from "./mostlikely/MostLikelyGame.tsx";
import { OneClueGame } from "./oneclue/OneClueGame.tsx";
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
