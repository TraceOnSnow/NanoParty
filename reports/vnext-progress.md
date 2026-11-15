# NanoParty VNext — 进度记录

分支：`vnext`（从 `main` bb8cc9b 切出）。需求：`docs/NanoParty_VNext_PRD_v1.1.md`，交接：`docs/NanoParty_VNext_Coding_Handoff.md`。
本文件持续更新；中断后从「恢复入口」继续。

## 现状差异表（开工前核对，2026-11-14）

| 模块 | 状态 | 说明 / 关键文件 |
| --- | --- | --- |
| 房间、邀请、身份恢复、重启恢复（暂停等房主继续） | 已有 | `apps/server/src/rooms/RoomRuntime.ts`，`http/routes.ts` |
| 派对独立计分 | 需完善 | 已有 `party_sessions`（结束即开新场并清零），缺存档回顾、历史入口、偏好、聊天按派对分段 |
| 大厅 | 需完善 | `apps/web/src/components/Lobby.tsx`：有游戏卡与人数原因；缺派对状态、偏好入口、封面、AI 依赖标记 |
| 两种结束（结算 / 放弃） | 缺失 | 现在只有「结束本游戏」= aborted |
| 双发送入口 | 缺失 | `ChatPanel.tsx` 只有发送；服务端靠正文 `@AI` 触发 |
| AI 状态、限流、预算、失败降级 | 已有 | `agent/AgentService.ts` |
| 普通 / 搞怪模式 | 缺失 | `agent/prompt.ts` 只有一种口吻 |
| Room AI 与 Game AI 分离 | 缺失 | 只有 Room Agent |
| 选题阶段（题主选、换一批、自己出题） | 已有 | `packages/games/src/pick.ts` + 12 款游戏；`PickPanel.tsx` |
| 题主权限 / 房主覆盖 | 需完善 | 只有题主能操作；房主没有显式覆盖入口 |
| AI 出题联动 | 需完善 | `save_content`/`offer_content` 已有；不区分请求者，迟到结果会排到下一轮 |
| 候选历史（跨回合、跨题主、持久化） | 缺失 | 未选的候选不留痕 |
| 选中待确认 | 缺失 | 点击即确认 |
| 海龟汤真人主持 | 已有 | `packages/games/src/soup/game.ts` |
| 海龟汤 AI 裁判、纠错、接管、母题改编 | 缺失 | |
| Canvas 原语（collect/choose/show/confirm）与多步流程 | 已有 | `rooms/canvas.ts`、`packages/shared/src/canvas.ts`；缺匿名投票、真实模型验证 |
| 原始成绩流水 | 已有 | `score_events`（只追加、幂等 key） |
| 派对积分（名次奖励）、结算页、协商调分、更正 | 缺失 | 现在原始分直接累加进总榜 |
| 完整回顾、AI 总结 | 缺失 | |
| 局内反馈 | 需完善 | 只有对题目的四类反馈（`content_feedback`），无附言、无 AI 判定/界面类 |
| 事件记录、试玩报告导出 / 拉取 | 缺失 | |
| 多玩家测试房间、身份切换、代操作、测试驱动 | 缺失 | 以前用临时 Playwright 脚本 |
| 真实模型适配 | 已有 | Anthropic、Gemini（`agent/model.ts`、`agent/geminiModel.ts`）；`.env` 已配 Gemini 密钥 |
| 房主转交 / 管理员恢复 | 缺失 | |
| Docker Compose、PGlite 开发、迁移自动执行 | 已有 | |

## 会影响已有数据的变更

全部为追加式迁移（新表、新列带默认值），不删除、不改写旧记录：
- `party_sessions.scoring`：旧记录默认 `raw-v1`（原始分累加），新派对用 `rank-v1`（名次奖励）。旧的进行中派对沿用旧口径直到房主结束。
- `chat_messages.session_id`：旧消息为空（视为历史聊天，不进入新派对的 AI 上下文）。
- 新表：`party_points`、`adjustments`、`candidate_history`、`feedback`、`events`。

## 分批顺序

1. 第一批：事件/反馈/测试支撑；双发送；题主权限与房主覆盖；候选历史；AI 联动规则。
2. 第二批：海龟汤 AI 裁判、纠错、接管、母题改编；搞怪模式；真实模型验证。
3. 第三批：派对生命周期、名次奖励、协商调分、回顾、偏好、视觉。
4. 最终：Docker / 迁移验证、多浏览器回归、报告回流、验收文档。

## 决策记录

- **候选历史放在平台层**（表 `candidate_history`，按派对 + 内容类型）：游戏模块仍是纯函数，通过 `ctx.history` 读、`ctx.peekContent(count, viewers)` 写。秘密候选（不撞词、词块描述、问出秘密词的目标词）记录看过的人，只再提供给「看过的人都仍有权看」的题主。
- **AI 出题的应用规则在运行时判定**（`RoomRuntime.offerContent`）：选题中且请求来自题主 / 房主 / 多人流程 → 成为当前候选；其他人的请求和迟到结果 → 只进历史，标「未应用」。取消了旧的「排到下一轮自动展示」。
- **选中待确认是前端本地状态**：点卡片只是选中，「确认使用」才发命令，所以取消选择不消耗任何东西。
- **房主覆盖选题**：命令里显式带 `asPicker: true`，服务端校验是房主后以题主身份执行，并记 `pick.override` 事件。
- **Game AI 与 Room Agent 分开**：`agent/GameAi.ts`（无工具、无聊天、拿得到汤底、只回结构化 JSON）与 `agent/AgentService.ts`（只看 `publicSummary`）。可共用同一模型服务。
- **裁判输出是数据，不是规则**：游戏模块的 `judge.resolve` 用 zod 校验后才应用；不合格输出按失败处理，不编造判定。任务 id 带回合号，迟到结果不会落到新汤上。
- **海龟汤改编由程序执行**：模型只提「替换词对」，`packages/games/src/soup/adapt.ts` 校验（只能换 `adaptable` 里的词，`fixed` 关键词必须原样保留）并同时替换汤面、汤底、关键事实；不通过就保留母题。
- **测试模式**：`TEST_MODE=true` 才挂载 `/api/test/*`；未开启时路由不存在（404）。测试玩家的操作仍走 `handleCommand`。
- **真实模型额度**：`.env` 里的 Google AI Studio 密钥是免费层，`gemini-2.5-flash` 每天 20 次请求（2026-11-15 实测报错信息）。真实模型验收集中执行、按模型分摊，并在每份报告里写明模型名。

## 已完成

| 批次 | 提交 | 内容 | 对应需求 |
| --- | --- | --- | --- |
| 1 | 1b4389a | 候选历史、题主权限与房主覆盖、双发送、原地反馈、事件日志、测试模式 | CHAT-01/02、CONTENT-01…07、DATA-03、TEST-01/02/07、AUTH-01 |
| 1 | (tester) | `pnpm tester`：真实 HTTP + WebSocket 多玩家场景驱动 | TEST-03/05 |
| 2a | 74295dc | 海龟汤 AI 裁判、纠错、失败重试、知情接管、受约束改编 | SOUP-01…08、HOST-03 |

验证：`pnpm check` 205 个测试通过（含 `apps/server/test/vnext-content.test.ts`、`vnext-soup.test.ts`）；`pnpm tester tools/scenarios/picker-history.json` 14/14。

## 当前工作（2026-11-15 因用量上限中断于此）

第三批刚开始：
- 已提交：`packages/shared/src/scoring.ts`（名次奖励表、并列平分、调分数值校验）及测试。
- 未应用的草稿：`reports/artifacts/wip-batch3-protocol.patch`（协议扩展：`endSegment` 的 settle/abandon、`confirmSettlement`、`proposeAdjustment`、`decideAdjustment`、`setPrefs`、`suggestPrefs`、`transferHost`、`retrySummary`、`PartyPrefs`、`SettlementView`、`AdjustmentView`、`PartyInfo`）。它需要和运行时改动一起落地才能通过类型检查，所以没有提交。用 `git apply reports/artifacts/wip-batch3-protocol.patch` 取回。

第三批剩余（均未开始）：
1. `RoomRuntime`：rank-v1 派对的结算态（segment `settling`）、`party_points` 入账、调分方案（待确认 / 批准 / 取消 / 替换 / 过期）、更正流水、偏好与主持模式、房主转交、聊天按派对分段、结束派对并归档。数据表已在迁移 0003 中建好。
2. `rooms/recap.ts` + HTTP：派对列表与完整回顾；AI 总结异步生成、可重试。
3. Agent：`propose_adjustment` 工具；普通 / 搞怪两种模式的提示词。
4. 前端：结算页、大厅派对状态与偏好、历史与回顾页、「结束并结算 / 放弃本场」、封面与状态文案。
5. 测试：结算幂等、并列、负分、过期方案、新旧计分不混用、回顾内容。

之后：真实模型验收（海龟汤问答集、搞怪主持、Canvas 多步、改编）、多浏览器回归、报告导出 / 拉取脚本、Docker 迁移验证、`reports/vnext-acceptance.md`。

## 阻塞

- AC-22 的「从服务器拉取」：没有生产 SSH 条件，且本次不允许连接生产；只能在本机 Docker 上验证导出与拉取脚本。
- 14.5 真实朋友局：需要真人，无法由我执行。
- 真实模型额度很小（见决策记录），部分真实模型用例可能只能跑一遍或标 NOT RUN。

## 恢复入口

- `git log --oneline main..vnext` 查看已提交批次；`pnpm check` 验证。
- 独立测试实例：`PORT=3100 TEST_MODE=true AI_MOCK=true PGLITE_DIR=<临时目录> ADMIN_PASSWORD=... tsx apps/server/src/index.ts`（不碰 Docker 数据卷）。
- 场景驱动：`PORT=3100 pnpm tester tools/scenarios/<name>.json --out reports/artifacts/<name>.json`。
- 真实模型评测：`pnpm model-eval soup`（可用 `AI_MODEL=<模型>` 换模型）。
