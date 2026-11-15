/**
 * Shared "choose this round's topic" phase for content games.
 *
 * Before a round formally starts, the round's picker sees a few candidate items from the
 * library and may take one, ask for others (unlimited, nothing is used up), or — where the
 * game allows it — write their own. Content offered from outside (e.g. by the AI host) replaces
 * the candidates, or waits for the next pick if a round is already running.
 * Changing the candidates before the start is not a skip.
 */
import type {
  CandidateRecord,
  CandidateStatus,
  ContentItem,
  ContributedContent,
  GameContext,
  PlayerId,
} from "@apr/shared";
import { z } from "zod";

export const PICK_CANDIDATES = 3;
const MAX_OFFERED = 6;
/** Limit for each text field of a player-written item. */
export const CUSTOM_FIELD_MAX = 60;

/** `contentId` is null for an item written by a player. */
export interface Candidate<T> {
  contentId: string | null;
  data: T;
}

export interface PickState<T> {
  picker: PlayerId;
  /** How many times each player has picked; drives fair rotation. */
  turns: Record<PlayerId, number>;
  candidates: Candidate<T>[];
  /** Legacy field of states saved before candidate history existed; no longer filled. */
  queued: Candidate<T>[];
  /**
   * Who may see the candidates when they are a secret (null = everyone). Decides which past
   * candidates this picker may be shown again.
   */
  viewers?: PlayerId[] | null;
  /** Earlier candidates of this party the picker may still use; refreshed when the pick opens. */
  history?: HistoryEntry<T>[];
}

export interface HistoryEntry<T> {
  contentId: string;
  data: T;
  status: CandidateStatus;
  origin: CandidateRecord["origin"];
}

/** What a player sees of the pick phase. */
export interface PickView {
  picker: PlayerId;
  /** Candidate labels; null when this viewer must not see them (e.g. the guesser of a secret word). */
  candidates: string[] | null;
  allowCustom: boolean;
  /** Past candidates of this party (null when this viewer must not see candidates). */
  history: { contentId: string; label: string; status: CandidateStatus; origin: CandidateRecord["origin"] }[] | null;
}

export const emptyPick = <T>(): PickState<T> => ({
  picker: "",
  turns: {},
  candidates: [],
  queued: [],
  viewers: null,
  history: [],
});

export const pickActionSchemas = [
  z.object({ type: z.literal("choose"), step: z.number().int(), index: z.number().int().min(0) }),
  z.object({ type: z.literal("refresh"), step: z.number().int() }),
  /** Take a candidate from this party's history (also the way to accept an AI suggestion). */
  z.object({ type: z.literal("chooseHistory"), step: z.number().int(), contentId: z.string() }),
  /** Reload the history list (e.g. after the AI host added suggestions). */
  z.object({ type: z.literal("history"), step: z.number().int() }),
  z.object({
    type: z.literal("custom"),
    step: z.number().int(),
    payload: z.record(z.string(), z.string().trim().min(1).max(CUSTOM_FIELD_MAX)),
  }),
] as const;

export type PickAction =
  | { type: "choose"; step: number; index: number }
  | { type: "refresh"; step: number }
  | { type: "chooseHistory"; step: number; contentId: string }
  | { type: "history"; step: number }
  | { type: "custom"; step: number; payload: Record<string, string> };

export const isPickAction = (action: { type: string }): action is PickAction =>
  action.type === "choose" ||
  action.type === "refresh" ||
  action.type === "custom" ||
  action.type === "chooseHistory" ||
  action.type === "history";

/** The eligible player who has picked least often (ties: join order). Counts the turn. */
export function rotatePicker<T>(pick: PickState<T>, eligible: PlayerId[]): PlayerId {
  let picker = eligible[0] as PlayerId;
  for (const p of eligible) if ((pick.turns[p] ?? 0) < (pick.turns[picker] ?? 0)) picker = p;
  pick.turns[picker] = (pick.turns[picker] ?? 0) + 1;
  return picker;
}

function toCandidates<T>(items: ContentItem[], schema: z.ZodType<T>): Candidate<T>[] {
  const out: Candidate<T>[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item.payload);
    if (parsed.success) out.push({ contentId: item.id, data: parsed.data });
  }
  return out;
}

/**
 * Past candidates this picker may be offered again. A secret item qualifies only if everyone
 * who has seen it is also allowed to see this round's candidates.
 */
function eligibleHistory<T>(pick: PickState<T>, schema: z.ZodType<T>, ctx: GameContext): HistoryEntry<T>[] {
  const viewers = pick.viewers ?? null;
  const out: HistoryEntry<T>[] = [];
  for (const record of ctx.history) {
    if (viewers !== null && record.seenBy !== null && !record.seenBy.every((p) => viewers.includes(p))) continue;
    // A secret item that was once shown to everyone is no longer a secret worth guessing.
    if (viewers !== null && record.seenBy === null) continue;
    const parsed = schema.safeParse(record.item.payload);
    if (!parsed.success) continue;
    if (pick.candidates.some((c) => c.contentId === record.item.id)) continue;
    out.push({ contentId: record.item.id, data: parsed.data, status: record.status, origin: record.origin });
  }
  return out.slice(0, 40);
}

/**
 * Opens the pick for `picker` with a look at the library. `viewers` = who may see the candidates
 * when they are a secret (e.g. only the describer); leave null when everyone may.
 */
export function openPick<T>(
  pick: PickState<T>,
  picker: PlayerId,
  schema: z.ZodType<T>,
  ctx: GameContext,
  viewers: PlayerId[] | null = null,
): void {
  pick.picker = picker;
  pick.viewers = viewers;
  pick.queued = [];
  pick.candidates = toCandidates(ctx.peekContent(PICK_CANDIDATES, viewers), schema);
  pick.history = eligibleHistory(pick, schema, ctx);
}

export type PickOutcome<T> =
  | { ok: false; error: string }
  | { ok: true; chosen: null }
  | { ok: true; chosen: Candidate<T>; contributed?: ContributedContent[] };

export function applyPick<T>(
  pick: PickState<T>,
  action: PickAction,
  actor: PlayerId,
  ctx: GameContext,
  opts: { schema: z.ZodType<T>; contentType: string; allowCustom: boolean },
): PickOutcome<T> {
  if (actor !== pick.picker) return { ok: false, error: "这一轮不是你选题" };
  switch (action.type) {
    case "history": {
      pick.history = eligibleHistory(pick, opts.schema, ctx);
      return { ok: true, chosen: null };
    }
    case "chooseHistory": {
      pick.history = eligibleHistory(pick, opts.schema, ctx);
      const entry = pick.history.find((h) => h.contentId === action.contentId);
      if (!entry) return { ok: false, error: "历史里没有这道题（或者它对你不可用）" };
      ctx.consumeContent(entry.contentId);
      pick.candidates = [];
      pick.history = [];
      return { ok: true, chosen: { contentId: entry.contentId, data: entry.data } };
    }
    case "refresh": {
      const fresh = toCandidates(ctx.peekContent(PICK_CANDIDATES, pick.viewers ?? null), opts.schema);
      if (fresh.length === 0) {
        return { ok: false, error: opts.allowCustom ? "题库里没有更多候选了，可以自己出一道" : "题库里没有更多候选了" };
      }
      pick.candidates = fresh;
      pick.history = eligibleHistory(pick, opts.schema, ctx);
      return { ok: true, chosen: null };
    }
    case "choose": {
      const chosen = pick.candidates[action.index];
      if (!chosen) return { ok: false, error: "没有这个候选" };
      if (chosen.contentId) ctx.consumeContent(chosen.contentId);
      pick.candidates = [];
      pick.history = [];
      return { ok: true, chosen };
    }
    case "custom": {
      if (!opts.allowCustom) return { ok: false, error: "这个游戏不能自己出题" };
      const parsed = opts.schema.safeParse(action.payload);
      if (!parsed.success) return { ok: false, error: "题目格式不对" };
      pick.candidates = [];
      pick.history = [];
      return {
        ok: true,
        chosen: { contentId: null, data: parsed.data },
        contributed: [{ type: opts.contentType, theme: "玩家自拟", payload: parsed.data, authorId: actor }],
      };
    }
  }
}

/**
 * Accepts outside candidates as the current candidates. The runtime only calls this while the
 * pick is open and the request came from the picker (or the host); everything else goes to the
 * party's candidate history instead, where the picker can take it.
 */
export function offerToPick<T>(
  pick: PickState<T>,
  picking: boolean,
  items: ContentItem[],
  schema: z.ZodType<T>,
  gameName: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const candidates = toCandidates(items, schema).slice(0, MAX_OFFERED);
  if (candidates.length === 0) return { ok: false, error: `这些内容不是「${gameName}」能用的题目` };
  if (!picking) return { ok: false, error: "这一轮的题目已经确定，不能再替换" };
  pick.candidates = candidates;
  return { ok: true, message: `已作为候选题展示给本轮出题人（${candidates.length} 道），由 TA 决定用哪道` };
}

/** On timeout the first candidate is taken (and marked used). Null if there is none. */
export function pickOnTimeout<T>(pick: PickState<T>, ctx: GameContext): Candidate<T> | null {
  const first = pick.candidates[0] ?? null;
  if (first?.contentId) ctx.consumeContent(first.contentId);
  pick.candidates = [];
  pick.history = [];
  return first;
}

export function pickView<T>(
  pick: PickState<T>,
  label: (data: T) => string,
  allowCustom: boolean,
  visible = true,
): PickView {
  return {
    picker: pick.picker,
    candidates: visible ? pick.candidates.map((c) => label(c.data)) : null,
    allowCustom,
    history: visible
      ? (pick.history ?? []).map((h) => ({
          contentId: h.contentId,
          label: label(h.data),
          status: h.status,
          origin: h.origin,
        }))
      : null,
  };
}

export const pickSecondsOption = {
  key: "pickSeconds",
  label: "选题时限（秒）",
  min: 0,
  max: 600,
  default: 60,
  hint: "0 = 不限时",
};
