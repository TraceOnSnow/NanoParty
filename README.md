# NanoParty

源码公开、自部署的 AI Native 聚会游戏房间（Jackbox 风格）。2–8 位朋友在外部软件开语音，在网页里完成答题、投票等正式操作；左侧是游戏主面板，右侧是共享群聊、AI 主持和积分榜。

- 游戏规则由确定性程序执行；AI 主持只能通过受控工具与系统交互。
- **不配置 AI 也能完整游玩**：内置题库、计分和房主操作都不依赖模型。
- 单实例、Docker Compose 部署，数据在你自己的 PostgreSQL 里。

> 当前状态：工程基础 + 两款首发游戏「猜刻度」（光谱猜测）和「谁是卧底」（文字描述变体），以及一个早期用于验证架构的示例玩法「估数字」。各游戏规则见 [docs/games/](docs/games/)。产品需求见 [AI_Party_Room_PRD_v1.0.md](AI_Party_Room_PRD_v1.0.md)（文档中的「AI Party Room / AI 聚会房间」是本项目早期的功能性称呼）。

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

没有密钥时想体验 AI 相关界面，可设置 `AI_MOCK=true`：使用内置的模拟主持人（固定话术，不调用任何模型，仅供开发）。

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
