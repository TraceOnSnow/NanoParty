# NanoParty

源码公开、自部署的 AI Native 聚会游戏房间（Jackbox 风格）。2–8 位朋友在外部软件开语音，在网页里完成答题、投票等正式操作；左侧是游戏主面板，右侧是共享群聊、AI 主持和积分榜。

- 游戏规则由确定性程序执行；AI 主持只能通过受控工具与系统交互。
- **不配置 AI 也能完整游玩**：内置题库、计分和房主操作都不依赖模型。
- 单实例、Docker Compose 部署，数据在你自己的 PostgreSQL 里。

> 当前状态：平台基础 + 25 款游戏（10 款首发 + 15 款第二批）（另有一个早期的架构验证示例「估数字」）。内置题库只是起步量，后续通过导入扩充。AI 主持可以在主面板组织多人互动（收集、投票、挑选、确认），并为「猜刻度」出候选题；尚未用真实模型联调。产品需求见 [AI_Party_Room_PRD_v1.0.md](AI_Party_Room_PRD_v1.0.md)（文档中的「AI Party Room / AI 聚会房间」是本项目早期的功能性称呼）。

| 游戏 | 人数 | 一句话 |
| --- | --- | --- |
| 猜刻度 | 2–8 | 提示者看到刻度上的秘密位置并给一句提示，其他人猜位置 |
| 谁是卧底 | 3–8 | 秘密发词，各自写描述、统一公开，讨论后投票 |
| 逛三园 | 2–8 | 围绕一个类别轮流打词，不能重复、不能超时 |
| 排排座 | 3–8 | 合作：按秘密数字回答情境，队长把回答排对 |
| 真假难辨 | 3–8 | 给冷知识编假答案，混入真答案互相欺骗 |
| 估数下注 | 3–8 | 先各自估数，再押谁估得最准 |
| 谁最可能 | 3–8 | 投票选出最符合情境的朋友 |
| 脑洞问答 | 3–8 | 写搞笑回答，匿名展示后投票 |
| 不撞词 | 3–8 | 合作猜词：每人给一个线索，撞了的线索作废 |
| 别拿第六张 | 2–8 | 纯规则卡牌：同时出牌，别当放下第六张的人 |
| 海龟汤 | 3–8 | 汤主知道真相，大家用是非问题还原离奇故事 |
| 五五开 | 3–8 | 补全两难题，让朋友们刚好分成两派 |
| 问出秘密词 | 4–8 | 限时问出村长的秘密词，狼人和预言家暗中较量 |
| 合作吃墩 | 3–5 | 合作打牌：让每个任务都由指定的人赢下 |
| 翻牌诈唬 | 3–8 | 暗叠花与骷髅，喊价后翻牌，别翻到骷髅 |
| 拒牌筹码 | 3–7 | 花筹码拒绝负分牌，或者连牌带筹码收下 |
| 压牌出清 | 3–8 | 大牌压掉小牌，相同的牌结盟，先出清手牌 |
| 暗牌对决 | 2–6 | 手里一张牌，摸一打一，用效果淘汰对手 |
| 暗号网格 | 4–8 | 两队对抗：队长用一个词加数字提示队友找词，别碰陷阱 |
| 密码传递 | 4–8 | 两队对抗：用提示传三位密码，同时破译对方 |
| 禁词描述 | 3–8 | 语音描述目标词但不能说禁词，其他人打字抢答 |
| 词块描述 | 3–8 | 只能用固定句式和词块拼句子来描述 |
| 四叶联想 | 3–6 | 合作：给相邻词对写提示，再凭提示还原彼此的卡片 |
| 猜大家选 | 4–8 | 先秘密投票，两队轮流猜哪些选项有人选 |
| 百分比竞猜 | 3–8 | 猜在场有多少比例的人答「是」，其他人押高低 |

各游戏完整规则见 [docs/games/](docs/games/)。这些游戏只借鉴常见的聚会游戏机制，名称、内容与分值均为本项目自定。

平台已有：邀请加入、房主权限、群聊、累计积分、投票跳题（严格多数）、题目反馈、开局设置、结束聚会并清零、更换邀请链接、移除成员、断线重连、重启恢复。

## 用 Docker Compose 部署

需要 Docker 与 Docker Compose v2。

```bash
cp .env.example .env
# 编辑 .env：至少设置 ADMIN_PASSWORD（≥8 位）和 POSTGRES_PASSWORD；AI 相关可全部留空
docker compose up -d --build
```

打开 `http://<服务器地址>:3000`，用管理员密码创建房间，在大厅复制邀请链接发给朋友。

- **健康检查**：`GET /api/health`；`docker compose ps` 可看到容器健康状态。日志：`docker compose logs -f app`。
- **升级**：`git pull && docker compose up -d --build`。数据库迁移在启动时自动执行，数据保存在 `pgdata` 卷中，重建容器不会丢失。
- **备份**：`docker compose exec db pg_dump -U apr apr > backup.sql`
- **恢复**：`docker compose exec -T db psql -U apr apr < backup.sql`（恢复到空库）
- **HTTPS**：本项目不自带证书。公网使用请放在反向代理（Caddy / Nginx 等）之后启用 HTTPS，代理需支持 WebSocket 升级，并设置 `TRUST_PROXY=1`。Caddy 示例：

  ```
  party.example.com {
      reverse_proxy localhost:3000
  }
  ```

- **安全提示**：邀请链接是随机令牌，拿到链接的人都能加入，请只发给朋友；管理员密码不是邀请码。模型密钥只在服务端使用，不会发送到浏览器。

## 启用 AI 主持（可选）

在 `.env` 中填写 `ANTHROPIC_API_KEY` 后重启。玩家在群聊里 `@AI`，或在大厅点「让 AI 推荐」时才会调用模型；普通聊天不会触发调用。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_MODEL` | `claude-opus-5-5` | 想降低成本可改为 `claude-sonnet-5-5` / `claude-haiku-5-5` |
| `AI_EFFORT` | `low` | 思考力度 |
| `AI_ROOM_CALLS_PER_MINUTE` | `6` | 每房间限速 |
| `AI_DAILY_CALL_LIMIT` | `300` | 全实例每日调用上限；用完后停止调用，游戏照常 |
| `AI_MAX_CONCURRENCY` / `AI_TIMEOUT_MS` | `2` / `45000` | 并发与超时 |
| `AI_REFUSAL_FALLBACK` | `true` | 模型拒答时由 API 自动切换备用模型；网关不支持时设为 `false` |

没有密钥时想体验 AI 相关界面，可设置 `AI_MOCK=true`：使用内置的模拟主持人（按固定脚本行动，不调用任何模型，仅供开发）。在猜刻度里说「@AI 按主题出题」可以看到收集主题 → 投票 → 生成题卡的完整流程。

调用记录保存在 `ai_calls` 表（时间、房间、状态、token 数），可直接用 SQL 查看用量。

## 本地开发

需要 Node.js ≥ 22（推荐 24）和 pnpm 11。**不需要 Docker 或本机 PostgreSQL**：未设置 `DATABASE_URL` 时使用内嵌的 PGlite，数据在 `./data/pglite`。

```bash
pnpm install
cp .env.example .env      # 设置 ADMIN_PASSWORD 即可
pnpm dev                  # 服务端 :3000 + 网页 :5173（热更新）
```

打开 <http://localhost:5173>。想在一台电脑上模拟多名玩家，请用不同浏览器或无痕窗口（玩家身份保存在浏览器的 localStorage 中）。

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动开发环境 |
| `pnpm test` | 全部自动化测试（规则单测、运行时、Agent、HTTP+WebSocket 端到端） |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | 类型检查 / Biome 检查 / 自动修复 |
| `pnpm check` | lint + typecheck + test |
| `pnpm build` && `pnpm start` | 生产构建并以单进程运行（服务端同时托管网页） |
| `pnpm db:generate` | 修改 `apps/server/src/db/schema.ts` 后生成迁移 |

在真实 PostgreSQL 上跑端到端测试：`TEST_DATABASE_URL=postgres://... pnpm vitest run apps/server/test/e2e.test.ts`

## 仓库结构

```
apps/server      Node 服务端：REST、实时房间、Agent、内容系统、数据库
apps/web         React 网页
packages/shared  游戏内核契约（GameModule）与前后端协议类型
packages/games   游戏模块与内置题库（纯函数，无 IO）
docs/            架构说明、ADR、各游戏规则规格
```

进一步阅读：[docs/architecture.md](docs/architecture.md)、[docs/adr/](docs/adr/)、[AGENTS.md](AGENTS.md)（给 Coding Agent 和贡献者的工作约定）。

## 题库来源

内置题目位于 `packages/games/src/*/content.json`，目前均为项目自制的示例题，状态标记为「未核实」（`verification: "unverified"`）。

## 许可

[PolyForm Noncommercial License 1.0.0](LICENSE.md)：可以自由用于个人和其他非商业用途（自己部署和朋友玩、学习、修改、分享）；不允许商业使用。内置题库与代码采用相同许可。
