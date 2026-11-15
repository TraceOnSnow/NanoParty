# Technical Design

本文描述「怎样实现」。产品需求见 PRD；关键取舍的理由见 `docs/adr/`。

## 总览

```
浏览器 (React)                              服务端 (单个 Node 进程，单端口)
┌──────────────────────┐   REST /api   ┌──────────────────────────────────────────┐
│ 首页 / 加入页         │──────────────▶│ http/routes   建房、邀请校验、加入、健康检查 │
│ 房间页               │               │                                          │
│  ├ 主面板 (大厅/游戏) │   WebSocket   │ rooms/PartyRoom  (Colyseus 适配层，很薄)   │
│  └ 群聊 + 积分        │◀─────────────▶│        │                                 │
└──────────────────────┘  每人一份视图   │ rooms/RoomRuntime  房间权威状态与命令处理   │
                                        │   ├─ @apr/games   游戏模块（纯函数）       │
                                        │   ├─ content/     题库：选题、去重、使用记录│
                                        │   └─ agent/       共享 AI 主持（可缺席）    │
                                        │ db/  Drizzle ── PostgreSQL（开发: PGlite） │
                                        └──────────────────────────────────────────┘
```

技术栈：pnpm monorepo、TypeScript、React + Vite、Node.js、Colyseus（实时传输）、Drizzle ORM、PostgreSQL、Anthropic TypeScript SDK（Tool Runner）、Vitest、Biome。

## 领域对象与数据表

| PRD 对象 | 表 | 说明 |
| --- | --- | --- |
| 房间 Room | `rooms`、`players` | 邀请令牌、房主；玩家的会话令牌只存 SHA-256 |
| 聚会 Session | `party_sessions` | 每房间至多一个 `active`（部分唯一索引保证） |
| 游戏段 Segment | `segments` | `state` 为完整权威状态（含秘密），`status`: active / paused / finished / aborted |
| 成绩 | `score_events` | 只追加的流水；`(segment_id, award_key)` 唯一 |
| 群聊 | `chat_messages` | 玩家 / AI / 系统消息 |
| 题目 Content | `content_items`、`content_usage`、`content_feedback` | 按 `(id, version)` 存版本；使用记录用于本场去重 |
| AI 用量 | `ai_calls` | 每次模型调用一行，用于观察与每日额度 |

「回合」不是平台概念，由各游戏在自己的 `state` 里定义。

## 游戏内核（`packages/shared/src/game.ts`）

一款游戏是一个 `GameModule`：对可 JSON 序列化的 `state` 进行操作的一组纯函数。

- `setup(config, ctx)` / `apply(state, action, actor, ctx)` 返回新状态、可选的计分奖励和是否结束。
- `view(state, playerId)`：某位玩家能看到的内容——**秘密信息隔离的唯一出口**。
- `publicSummary(state)`：给 AI 主持的、不含秘密的文字描述。
- `deadline / onTimeout / onResume`：计时由运行时调度，模块只声明截止时间和超时后的状态变化。
- `ctx` 注入一切外部因素：`now`、`random`、当前成员、`drawContent()`。

平台不提供通用规则 DSL；每款游戏自己写状态机，复用的是房间、身份、计时、内容、成绩这些平台能力。

## 房间运行时（`apps/server/src/rooms/RoomRuntime.ts`）

每个房间一个 `RoomRuntime`，与传输层无关（测试中直接驱动它）。

- **串行化**：所有变更经 `exclusive()` 排队执行，没有并发写。
- **先写库后生效**：一次命令 = 一个事务（段状态 + 计分流水 + 内容使用记录）。事务成功后才更新内存并广播；失败则内存不变，客户端收到错误。
- **幂等**：命令带 `cmdId`，同一 id 的重发返回第一次的结果；游戏动作带 `segmentId` + 回合号，过期动作被拒绝；计分奖励靠唯一键去重。
- **同步模型**：每次变更后给每个连接发送**完整的个人视图快照** `RoomView`。状态很小（≤8 人），换来的是刷新、重连、重启恢复都走同一条路径，没有增量补丁的一致性问题。
- **权限**：服务端判定房主；游戏内的房主专属动作由模块根据 `actor.isHost` 判定。

### 身份、重连与重启恢复

- 加入时签发随机会话令牌（192 bit），浏览器存于 localStorage；服务端只存哈希。昵称仅用于显示。
- 断线：连接数归零只影响「在线」标记，身份、已提交内容都在运行时和数据库里。客户端用令牌重新加入即可（不依赖 Colyseus 的重连令牌，因此跨服务重启也有效）。
- 服务重启：运行时从数据库懒加载。发现未结束的游戏段时将其置为 `paused`，**由房主点击继续**；继续时调用模块的 `onResume` 重置计时，停机时间不算玩家超时。秘密和已提交内容原样恢复，不重新随机。

## 共享 AI 主持（`apps/server/src/agent/`）

- **触发**：仅 `@AI` 提及或「让 AI 推荐」按钮。普通聊天只入库，作为之后的上下文。
- **排队与合并**：每房间同一时刻至多一次模型调用；期间到达的请求排队，并合并进下一次调用。
- **限制**：每房间限速、全局并发、每日调用上限、单次超时。任一限制命中或调用失败 → 发一条节流的系统提示，游戏不受影响。
- **上下文**：权威状态的公开描述 + 近期群聊 + 已实现游戏列表 + 本次请求。不含未揭晓的答案或他人提交。
- **工具**：Agent 只能通过 `AgentRoomPort` 行动。目前唯一的工具是 `suggest_game`——在主面板展示推荐卡片，由房主决定是否开始。工具在执行时按最新状态重新校验，并返回如实的结果。
- **模型边界**：`AgentModel` 接口隔离了具体 SDK；默认实现用 Anthropic SDK 的 Tool Runner。未配置密钥时 `AgentService` 以「无模型」方式运行。

## 内容系统（`apps/server/src/content/`）

内置题库随仓库发布，启动时幂等地写入 `content_items`。开局时运行时取出「该类型、本场未用过」的题目洗牌成池，游戏通过同步的 `ctx.drawContent()` 取题；取用记录与游戏状态在同一事务提交。题池耗尽时游戏自行收尾，不等待生成。

后台生成、结构化导入、反馈驱动的选题都将实现在这个边界之内（生成结果入库后与内置内容同等对待）；后台任务计划用进程内队列 + 数据库表，不引入 Redis。

## 部署形态

一个应用容器（Node 进程同时提供 REST、WebSocket 和静态网页）+ 一个 PostgreSQL 容器。迁移在应用启动时自动执行。开发与测试在未设置 `DATABASE_URL` 时使用 PGlite（WASM 版 Postgres），因此无需任何外部服务。

## 平台级的房间操作

除游戏动作外，`RoomRuntime` 还直接处理这些命令（都在服务端校验权限）：

- **投票跳题**：游戏通过可选的 `skip`（当前可跳项的 key、有权投票的人、如何跳过）声明支持；投票本身由运行时管理。票绑定到 key，题目一变旧票作废；参与集合在第一票时固定；严格多数通过；跳过不计分。进行中的投票只在内存里，重启后需要重新投。
- **题目反馈**：`currentContentId` 声明屏幕上的题；反馈写入 `content_feedback`，目前只记录，尚未用于选题。
- **结束聚会**：把当前 `party_sessions` 置为 `ended` 并开新的一场；积分清零、聊天保留、题目去重范围重置。
- **更换邀请链接**：旧令牌立即失效，只影响新加入者。
- **移除成员**：仅限大厅；写入 `players.removed_at`，该玩家的会话令牌随即失效并断开连接。

## Dynamic Canvas

见 [ADR 0005](adr/0005-dynamic-canvas.md)。代码：`packages/shared/src/canvas.ts`（原语规格）、`apps/server/src/rooms/canvas.ts`（结果计算与视图）、`RoomRuntime` 的 canvas 部分（排队、回应、效果）、`AgentService` 的工具、`apps/web/src/components/CanvasPanel.tsx`。

## VNext：派对、结算与两种 AI

需求见 `NanoParty_VNext_PRD_v1.1.md`，验收见 `../reports/vnext-acceptance.md`。

**派对与计分。** `party_sessions.scoring` 区分 `raw-v1`（VNext 之前建的派对，原始分直接累加）和 `rank-v1`。`rank-v1` 下游戏结束（或房主「结束并结算」）后 segment 进入 `settling`：`rooms/party.ts` 用 `packages/shared/src/scoring.ts` 的名次表算出预计奖励，房主确认后在一个事务里写 `party_points`（`seg:<id>:rank:<player>`）并把快照存进 `segments.settlement`。调分方案存在 `adjustments`（pending / approved / cancelled / replaced / expired），批准时写 `adj:<id>:<player>`；对已结算游戏的调整记为 `correction`。结束派对把当前会话标为 ended 并开一条新的 `rank-v1` 会话；回顾（`rooms/recap.ts`）只读流水、结算快照和事件日志，AI 总结是会话上单独的一段文本，后台生成、可重试。

**候选历史。** `candidate_history` 按（派对, 内容）记录出现过的候选及其状态（shown / used / skipped）、来源和「谁看过」。运行时在 `ctx.peekContent(count, viewers)` 和 `ctx.consumeContent` 时记录，并通过 `ctx.history` 交给游戏；`pick.ts` 据此提供「历史候选」。AI 写的题只有在选题中且请求来自题主（或房主、或大家一起走的流程）时才替换当前候选，否则进历史。

**两种 AI。** Room AI（`agent/AgentService.ts`，带工具，人格与普通 / 搞怪模式在 `agent/prompt.ts`）和 Game AI（`agent/GameAi.ts`，无工具，只回 JSON）。游戏通过 `GameModule.judge` 声明待判任务；`RoomRuntime.pumpJudge` 在房间队列之外调用模型，回来后只在同一 segment 仍在进行、且游戏认这个任务 id 时应用结果，否则丢弃。海龟汤改编由 `packages/games/src/soup/adapt.ts` 校验并执行，模型只提替换词。

**事件与报告。** `events` 是只追加的公开事实日志（操作类型与结果，不含操作内容和秘密）；`feedback` 是玩家的原地反馈。`src/reportExport.ts` 据此生成脱敏报告，`src/report.ts` 是只读 CLI，`tools/pull-report.sh` 经 SSH 拉取。

**测试支撑。** `TEST_MODE` 下的 `/api/test/*`、`/test` 页面、`packages/games/src/bots.ts`（只看自己视图的朴素合法操作）、`apps/server/tools/tester.ts`（真实协议场景）、`tools/browser/*.mjs`（多隔离浏览器）、`apps/server/tools/model-eval.ts`（真实模型）。

## 已知的未实现项

主要包括：真实模型联调（Canvas 编排目前只用脚本化模型验证过）、题库导入与主题选择、偏好记录、题目生成后台任务、成绩修正/已结算题作废流程、房主离线时的控制权恢复、真实模型联调、管理端。
