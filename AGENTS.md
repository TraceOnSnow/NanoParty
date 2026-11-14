# AGENTS.md

给在本仓库工作的 Coding Agent 与贡献者。产品需求以 `AI_Party_Room_PRD_v1.0.md` 为准；技术决策见 `docs/adr/`，整体结构见 `docs/architecture.md`。

## 常用命令

```bash
pnpm install
pnpm dev          # server :3000 + web :5173，无需 Docker/Postgres（内嵌 PGlite）
pnpm check        # lint + typecheck + test，提交前必须通过
pnpm db:generate  # 改了 apps/server/src/db/schema.ts 之后
```

## 不可违反的规则

1. **PRD 优先。** 不得静默改变权限、交互、无 AI 能力或产品范围。PRD 标为「待定」的事项（首发游戏、跳题门槛、许可等）不要自行定案；需要时列出选项请人决定。不要改动 PRD 文件本身。
2. **规则是确定性程序。** 游戏逻辑只写在 `packages/games` 的纯函数里：不做 IO、不读时钟（用 `ctx.now`）、不用 `Math.random`（用 `ctx.random`）、不调用模型。
3. **AI 不控制规则。** Agent 只能通过 `AgentRoomPort` 上的受控工具行动；新增工具必须在执行时重新检查最新状态与权限，并返回如实的结果字符串。模型输出和聊天文本永远不是授权依据。
4. **秘密信息只在服务端。** 客户端只会收到 `module.view(state, playerId)`；Agent 只会看到 `module.publicSummary(state)`。原始 `state` 不得进入网络消息、日志或提示词。新增游戏必须有「他人视图中不含秘密」的测试。
5. **先持久化，再生效。** 状态变更走 `RoomRuntime.exclusive()` 串行执行，并在一个事务里写库成功后才更新内存和广播。
6. **成绩只追加。** 分数来自 `score_events` 流水；每条奖励带段内唯一的 `key`，重复结算自动忽略。修正成绩 = 追加一条关联原记录的新流水，不许改写或删除。
7. **操作要绑定上下文。** 游戏动作带 `segmentId` 和回合号，过期请求必须被拒绝；客户端命令带 `cmdId`，重发不重复执行。
8. **无 AI 可用。** 任何功能都必须有不依赖模型的入口；模型调用不得阻塞游戏流程。
9. 令牌、邀请链接、密钥不得写入日志或仓库。

## 如何新增一款游戏

1. 在 `docs/games/<id>.md` 写规则规格（PRD §5.2 列出的各项）。
2. `packages/games/src/<id>/game.ts`：用 `defineGame` 实现 `GameModule`（`setup / apply / view / publicSummary`，需要计时再加 `deadline / onTimeout / onResume`），配套 `game.test.ts`。
3. 需要题库时添加 `content.json` 并在 `packages/games/src/index.ts` 的 `bundledContent` 中登记；内容类型用 `meta.contentType` 声明。
4. 在 `packages/games/src/index.ts` 的 `games` 注册表登记。
5. `apps/web/src/games/<id>/` 写主面板组件，并在 `apps/web/src/games/registry.tsx` 登记。

房间、身份、聊天、计时、持久化、恢复、积分都由平台提供，游戏模块不需要也不应该自己处理。不要为了「未来的游戏」提前抽象通用规则 DSL 或组件库——等第二个真实使用者出现再抽。

## 代码约定

- TypeScript strict，ESM，源码内 import 带 `.ts` 扩展名。workspace 包直接以 TS 源码被引用，没有单独的构建步骤。
- 格式与 lint 用 Biome（`pnpm format`）。面向玩家的文案用简体中文；代码标识符与注释用英文。
- 测试用 Vitest：规则单测放在模块旁（`*.test.ts`），服务端测试在 `apps/server/test`（内存 PGlite，不需要外部服务）。
- 数据库结构只通过 Drizzle schema + 生成的迁移修改；已发布的迁移不要手改。
- 依赖保持克制：新增运行时依赖前先确认现有代码无法简单解决。
