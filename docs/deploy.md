# 部署

## 用 Docker Compose 部署

需要 Docker 与 Docker Compose v2。

```bash
cp .env.example .env
# 编辑 .env：至少设置 ADMIN_PASSWORD（≥8 位）和 POSTGRES_PASSWORD；AI 相关可全部留空
docker compose up -d --build
```

打开 `http://<服务器地址>:3000`，用管理员密码创建房间，在大厅复制邀请链接发给朋友。

- **健康检查**：`GET /api/health`；`docker compose ps` 可看到容器健康状态。日志：`docker compose logs -f app`。
- **升级**：先备份（见下），再 `git pull && GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build`。数据库迁移在启动时自动执行，都是追加式的（只加表、加列），数据保存在 `pgdata` 卷中，重建容器不会丢失。`GIT_SHA` 可省略，它只是写进试玩报告方便对应代码版本。
- **从旧版本升级到 VNext**：旧房间、玩家、聊天和成绩都保留。升级时还在进行的派对沿用旧计分方式（游戏内得分直接累加），界面上标「旧计分」；房主「结束本场派对」后，新开的派对才使用名次奖励。旧成绩不会被换算。
- **备份**：`docker compose exec db pg_dump -U apr apr > backup.sql`
- **恢复**：`docker compose exec -T db psql -U apr apr < backup.sql`（恢复到空库）
- **HTTPS**：本项目不自带证书。公网使用请放在反向代理（Caddy / Nginx 等）之后启用 HTTPS，代理需支持 WebSocket 升级，并设置 `TRUST_PROXY=1`。Caddy 示例：

  ```
  party.example.com {
      reverse_proxy localhost:3000
  }
  ```

- **安全提示**：邀请链接是随机令牌，拿到链接的人都能加入，请只发给朋友；管理员密码不是邀请码。模型密钥只在服务端使用，不会发送到浏览器。

## 作者自己那台服务器的部署

`compose.production.yaml` 复用现有 Nginx 的 `homepage-web_default` 网络，应用别名为 `nanoparty-app`，宿主端口仅绑定 `127.0.0.1:3100`。数据库使用独立的 `nanoparty_pgdata` 卷。

```bash
docker compose -f docker-compose.yml -f compose.production.yaml up -d --build
docker compose -f docker-compose.yml -f compose.production.yaml ps
docker compose -f docker-compose.yml -f compose.production.yaml logs --tail=50 app
```

HTTPS、WebSocket 反代与证书续期沿用服务器现有入口。仅管理员密码持有者能创建房间；房主能获取和更换邀请链接，朋友凭邀请链接加入，无需管理员密码。当前没有独立的管理员账号登录系统。邀请链接属于凭证，反代不记录此站访问日志，并设置 `Referrer-Policy: no-referrer`。

停止时使用同一组 Compose 文件执行 `down`；保留数据库卷，勿添加 `--volumes`。开发模式仍使用内嵌 PGlite，与正式数据库分开。
