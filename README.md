# GEO XHS

GEO 小红书内容资产项目，包含网站驾驶舱和云服务器后台脚本。

## Structure

```text
web/       Vercel 部署的网站和 Serverless API
server/    云服务器运行的 GEO 抓取、分析、pgvector 刷新脚本；`server/scripts/麦富迪/` 保留但当前暂停
docs/      数据库字段、内容逻辑和 Agent 使用说明
docker-compose.yml  本地协同启动入口，能同时起 Web 和 GEO workers
```

## Change Rules

修改代码前先看 `ARCHITECTURE.md`。它定义了 web、server、暂停中的麦富迪、secrets、database migration 的修改范围、部署顺序和必须等待确认的场景。

## Docker

这是协同开发和本地起服务的补充入口，不替代当前生产链路。

```bash
cp .env.example .env
docker compose up --build web
docker compose --profile workers up --build
```

`web` 容器跑的是 Vite 本地站点；`workers` profile 跑的是 GEO 队列和向量常驻脚本。生产站点仍然走 Vercel，服务器常驻任务仍然走 systemd。

## Secrets

明文密钥不提交到 GitHub，也不在业务仓库保存加密后的供应商密钥备份。艺恩、火山方舟、Kimi、Duomi 和 Coze 等供应商凭证统一由 Central Gateway 加密保存和轮换。

GEO 运行环境只持有数据库凭证和 `GATEWAY_SERVICE_TOKEN`，服务器文件为 `/opt/xhs-sync/sync.env`，权限必须保持 `0600 root:root`。Vercel 密钥使用项目 Environment Variables，任何密钥都不能使用 `VITE_` 前缀。
