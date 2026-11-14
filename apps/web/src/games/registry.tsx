import type { Ack, RoomView } from "@apr/shared";
import type { ComponentType } from "react";
import { EstimateGame } from "./estimate/EstimateGame.tsx";
import { SpectrumGame } from "./spectrum/SpectrumGame.tsx";
import { UndercoverGame } from "./undercover/UndercoverGame.tsx";

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
  estimate: EstimateGame,
};
