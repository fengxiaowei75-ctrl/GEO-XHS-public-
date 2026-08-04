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
