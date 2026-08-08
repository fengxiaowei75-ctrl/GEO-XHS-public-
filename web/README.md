# GEO XHS Dashboard

GEO 小红书内容资产驾驶舱，读取 PostgreSQL 内容资产表和 pgvector 状态，展示队列、Kimi 资产、向量、爆文、人群、漏斗、行业、痛点和视觉资产。

## Local

```bash
cd web
npm install
npm run build
npm run preview -- --port 5175
```

本地普通 Vite 预览不会运行 Vercel `/api/dashboard`，页面会自动切到样例数据。使用真实数据库时走 Vercel Serverless API。

Docker 本地入口：

```bash
docker compose up --build web
```

容器内同样是 Vite 本地站点，端口是 `http://localhost:5173`。

固定内容流只读取 `xhs_geo` 里已经沉淀好的内容资产和原图预览，不写库、不改库，也不主动触发云服务器脚本；只有用户点击洗稿时，前端才会调用现有生图和文案接口。

## Vercel Env

在 Vercel 项目里配置：

```text
PGHOST=localhost
PGPORT=5432
PGDATABASE=xhs_geo
PGUSER=app_user
PGPASSWORD=<数据库密码>
PGSSLMODE=
```

不要把 `PGPASSWORD` 提交到代码仓库。

## Deploy

```bash
npx vercel project inspect --non-interactive
npx vercel deploy
npx vercel --prod
```

如果项目还没绑定，先确认是创建新 Vercel 项目还是绑定已有项目。
