# GEO XHS 项目架构与修改约束

这个仓库是 GEO 小红书内容资产项目的唯一代码源。

```text
web/       Vercel 网站驾驶舱和 Serverless API
server/    云服务器后台脚本、systemd 服务、数据库 migration、加密密钥备份
docs/      可选：数据库字段、内容逻辑、Agent skill、分析文档
```

生产数据通过同一个 PostgreSQL 数据库 `xhs_geo` 和 pgvector 表交换。Vercel 不运行抓取、图片解析、内容资产总结、向量刷新等后台任务；云服务器也不负责提供网站 UI。

## 收口状态

- `web/` 走 GitHub -> Vercel，负责前台和 Serverless API。
- `server/scripts/GEO/` 是 GEO 主链路，线上运行目录是 `/opt/xhs-sync/scripts/GEO`。
- `server/scripts/麦富迪/` 保留但已暂停，`xhs-realtime.service` 不再作为自动入口。
- `docker-compose.yml` 是本地协同入口，可以同时启动 Web 和 GEO worker；当前不替代线上 Vercel/systemd。
- GitHub Actions 触发服务器上的 `~/bin/deploy.sh`，再由仓库内的 `server/ops/deploy.sh` 同步 `server/scripts/GEO/` 到 `/opt/xhs-sync/scripts/GEO`，并只重启受影响的 GEO 服务。

## 本地协同 / 生产入口

- `docker-compose.yml` 只用于本地开发、联调和观察 worker 行为，不当作生产入口。
- 生产 Web 继续走 Vercel。
- 生产 GEO worker 继续走云服务器上的 `systemd`。
- 如果要改生产行为，改 GitHub 后仍要同步到服务器运行目录并重启对应服务，不要把本地 compose 当成线上部署替身。

## 数据库账号分层

数据库权限按用途拆分，详细模型见 [docs/02_db_access_model.md](docs/02_db_access_model.md)。

- `xhs_geo_ro`：只读账号，给画布项目、DBeaver、以及 dashboard 的纯查询接口使用。
- `xhs_geo_dashboard_rw`：Vercel Web 和认证/写日志接口使用，只碰 dashboard 自己需要写的表。
- `xhs_geo_worker_rw`：云服务器 GEO 脚本使用，只碰抓取、分析、资产、向量和运维表。
- `xhs_geo_migration_owner`：只用于 migration、DDL、grant 和回填，不进入任何运行时。

`web/api/db-query.js` 这类管理员查询入口即使保留，也只能走只读账号，最好进一步收窄到固定视图。

## Gateway Monitor

本项目必须接入 `gateway-monitor`。这是跨项目 API 网关、成本监控、限流和问题定位系统，不是可选文档。

强制规则：

- 所有 API 端点必须登记在 `gateway.manifest.json`。
- 所有 LLM、Embedding、图片生成、Coze、Domi、Kimi、艺恩/Endata 等高成本调用必须声明项目、功能、接口、provider 和 cost class。
- 新增 API 必须在同一个 commit 更新 `gateway.manifest.json`。
- 未登记业务身份的高成本 API 默认禁止上线或调用。
- GitHub Actions 的 `Gateway Contract` 检查必须保持通过。

第一阶段先登记和检查，不迁移真实 provider key。第二阶段再把高成本调用逐步改成通过 `gateway-monitor` SDK/服务代理，老项目只保留 `GATEWAY_SERVICE_TOKEN`。

## 当前运行环境

- GitHub 仓库：`fengxiaowei75-ctrl/geo-xhs`
- Vercel 项目：`example-org/example-project`
- Vercel Root Directory：`web`
- Vercel 生产域名：`https://example-project.vercel.app`
- 云服务器运行路径：`/opt/xhs-sync/scripts/GEO`
- 云服务器环境文件：`/opt/xhs-sync/sync.env`
- 云服务器常驻服务：
  - `xhs-geo-note-ingest-queue.service`
  - `xhs-geo-asset-vector.service`

明文密钥不进入 GitHub。需要入库备份的密钥使用 `sops + age` 加密，例如 `server/secrets/sync.enc.env`。

## 总原则

每次改代码，都必须让 GitHub 和真实运行环境保持一致。

- 改 `server/` 代码时，GitHub 里的对应文件和云服务器 `/opt/xhs-sync/scripts/GEO` 的运行文件都必须同步更新，任务才算完成。
- 改 `web/` 代码时，必须 commit 并 push 到 GitHub，让 Vercel 从 GitHub 自动部署。
- 改 Docker 启动入口时，必须同步更新 `docker-compose.yml`、`docker/` 和 README 中的启动说明。
- 涉及数据库结构变更时，必须先写 SQL migration 文件，不能直接临时改库。
- 不提交明文 key、密码、token、`.env.local`、`/opt/xhs-sync/sync.env`、日志、下载图片、缓存、`node_modules/`、构建产物。

## 修改范围规则

### 只改 Web

允许改：

- `web/`
- 根目录文档，例如 `README.md`、`ARCHITECTURE.md`

不能动：

- `server/scripts/`
- `server/systemd/`
- `server/secrets/`
- `server/migrations/`
- 数据库结构

必须检查：

```bash
cd web
npm run build
```

Vercel 更新方式：

```text
git commit
git push origin main
-> GitHub webhook 通知 Vercel
-> Vercel 从 web/ 目录安装依赖并执行 npm run build
-> 构建成功后自动更新生产站点
```

推送后验证：

```bash
npx vercel list geo-xhs-dashboard --json --limit 5 --scope vv13-886c
curl -I https://example-project.vercel.app
curl -s https://example-project.vercel.app/api/dashboard | head -c 140
```

### 只改 Server

允许改：

- `server/scripts/GEO/`
- `server/scripts/麦富迪/`，仅当用户明确恢复该项目时；当前默认暂停
- `server/requirements.txt`
- `server/systemd/`，仅当服务启动命令、重启策略、日志路径、环境变量加载方式发生变化
- `server/README.md`

不能动：

- `web/`
- Vercel 环境变量
- 数据库结构，除非任务明确要求改数据库

必须检查：

```bash
PYTHONPYCACHEPREFIX=/private/tmp/geo-pycache python3 -m py_compile server/scripts/GEO/*.py
```

改完 server 脚本后的必做动作：

```text
1. 先 commit 并 push server/ 变更到 GitHub。
2. 由 `server/ops/deploy-bootstrap.sh` 或服务器上的 `~/bin/deploy.sh` 拉取最新仓库。
3. 由仓库内的 `server/ops/deploy.sh` 把 `server/scripts/GEO/` 同步到 `/opt/xhs-sync/scripts/GEO`。
4. 如果 systemd service 文件变了，复制到 `/etc/systemd/system/` 并执行 `systemctl daemon-reload`。
5. 只重启受影响的服务。
6. 检查服务状态和最近日志。
```

常用服务命令：

```bash
systemctl restart xhs-geo-note-ingest-queue.service
systemctl restart xhs-geo-asset-vector.service
systemctl status xhs-geo-note-ingest-queue.service --no-pager -l
systemctl status xhs-geo-asset-vector.service --no-pager -l
tail -n 80 /opt/xhs-sync/logs/geo-note-ingest-queue.log
tail -n 80 /opt/xhs-sync/logs/geo-asset-vector.log
```

server 任务不算完成，除非 GitHub 代码和云服务器实际运行代码已经同步。

### 只改文档

允许改：

- `README.md`
- `ARCHITECTURE.md`
- `docs/`
- 各目录下的 README

不能动：

- `web/` 源码
- `server/scripts/`
- 数据库结构
- Vercel 项目设置

注意：当前 Vercel 已连接 GitHub。即使只是文档 push，也可能触发一次 Vercel 部署；只要网站代码没变，这是可接受的。以后如需避免文档/server 变更触发部署，可以单独配置 Vercel Ignored Build Step。

### 改密钥

允许改：

- `server/secrets/*.enc.env`
- Vercel Environment Variables
- 云服务器 `/opt/xhs-sync/sync.env`

不能提交明文密钥文件。

必须检查：

```bash
sops -d server/secrets/sync.enc.env | wc -c
git status --short --ignored
```

如果生产密钥变化，需要保持这些位置一致：

```text
云服务器 /opt/xhs-sync/sync.env
Vercel Environment Variables，如果 web/API 需要
server/secrets/sync.enc.env 加密备份
```

## 数据库变更协议

数据库结构是 PostgreSQL、`server/`、`web/` 的共同契约。涉及表结构、字段、索引、触发器、函数、视图、pgvector 结构时，不能跳步。

数据库结构变更任务必须每一步做完后等待用户确认，再进入下一步。

必须按顺序：

```text
1. 先写 SQL migration 文件，放在 server/migrations/。
2. 展示 migration 内容和影响范围，等待用户确认。
3. 在服务器或数据库上执行 migration。
4. 测试数据库兼容性和 server 脚本，等待用户确认。
5. 如有需要，再更新 server/ 代码。
6. 把 server/ 代码同步到云服务器，重启并验证相关服务，等待用户确认。
7. 如有需要，再更新 web/ API 和页面。
8. 执行 web 构建测试。
9. commit 并 push 到 GitHub。
10. 验证 Vercel 部署和线上 API。
```

Migration 文件命名：

```text
server/migrations/YYYYMMDDHHMM_short_description.sql
```

Migration 要求：

- 尽量写成幂等 SQL，例如 PostgreSQL 支持时使用 `IF NOT EXISTS`。
- 安全时使用 transaction。
- 查询路径需要时同步加索引。
- 旧数据需要默认值时写 backfill SQL。
- 非显然字段要加 comment。
- 除非用户明确确认，不能 drop 表、drop 字段、清空表、重写历史数据。

示例：

```text
目标：给 notes 表新增 status 字段
范围：数据库 + server/ + web/
步骤：
1. 新增 server/migrations/YYYYMMDDHHMM_add_notes_status.sql。
2. 等用户确认。
3. 执行 migration 并测试数据库。
4. 等用户确认。
5. 更新读写 notes.status 的 server 脚本。
6. 部署 server 代码到云服务器并重启受影响服务。
7. 等用户确认。
8. 更新 web API 和展示/筛选页面。
9. 执行 npm run build。
10. commit、push，并验证 Vercel。
```

当前 web 端通过 `web/api/dashboard.js` 直接使用 `pg` 查询数据库，目前没有 Prisma schema。未来如果引入 Prisma，必须更新本文件，把 Prisma schema/migration 步骤加入数据库变更协议。

## 未明确授权时不能动

- 只改 web 时，不能动 `server/secrets/`。
- 只改 server 时，不能动 Vercel 项目设置。
- 只改 UI/视觉时，不能改数据库结构。
- 除非任务涉及 server runtime，否则不能 stop、restart、edit systemd 服务。
- 不能从 GitHub 覆盖服务器文件，除非已经确认具体变更文件和受影响服务。
- 已经应用到生产数据库的 migration 不能重写；需要新增 migration。

## 完成任务前必须汇报

按实际修改范围汇报：

- GitHub commit SHA 和 push 状态
- web 变更对应的 Vercel deployment URL/status
- web 变更的 `npm run build` 结果
- server Python 变更的 `py_compile` 结果
- server runtime 变更的 `systemctl is-active` 结果
- 数据库变更的 migration 文件名和执行结果
- 无法验证的部分
