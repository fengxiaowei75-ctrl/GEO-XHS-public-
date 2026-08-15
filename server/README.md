# Server

云服务器后台脚本目录。线上当前运行路径是：

```bash
/opt/xhs-sync/scripts/GEO
```

当前只维护 GEO 主链路；`server/scripts/麦富迪/` 作为历史保留目录，已暂停，不进入当前自动化链路。

## Docker

本地协同可以用根目录 `docker-compose.yml` 启动 GEO workers：

```bash
cp .env.example .env
docker compose --profile workers up --build
```

Docker 容器读取 `.env` 中的 `PG*`、`GATEWAY_BASE_URL`、`GATEWAY_SERVICE_TOKEN` 和模型请求参数；供应商真实 Key 只保存在中央网关，生产服务器当前仍使用 systemd 托管 `/opt/xhs-sync/scripts/GEO` 下的 worker。

## Active Services

Service 文件备份在：

```bash
server/systemd/
```

```bash
systemctl status xhs-geo-note-ingest-queue.service --no-pager
systemctl status xhs-geo-asset-vector.service --no-pager
```

- `xhs-geo-note-ingest-queue.service`: 监听 `geo_note_ingest_queue`，自动抓取笔记详情、处理图片、调用豆包/Ark 内容模型总结并刷新资产。
- `xhs-geo-asset-vector.service`: 监听内容资产更新，持续刷新 pgvector 向量。

## Secrets

线上运行时环境文件仍在服务器：

```bash
/opt/xhs-sync/sync.env
```

仓库不保存环境文件备份。业务运行环境只保留数据库连接、网关地址、Gateway service token 和非敏感模型参数。供应商凭证统一在 Central Gateway 管理。

恢复服务器时，从受控的密钥管理位置重新创建 `/opt/xhs-sync/sync.env`，并设置 `0600 root:root`；不要从 GitHub 恢复密钥。

## Update Rule

GitHub 仍然是唯一代码源，服务器只保留运行副本和 bootstrap 脚本。

```text
修改 server/ 代码
-> commit / push 到 GitHub
-> 服务器上的 `~/bin/deploy.sh` 拉取最新仓库
-> 仓库内 `server/ops/deploy.sh` 同步 `/opt/xhs-sync/scripts/GEO`
-> 重启受影响的 systemd 服务
```

不要长期直接在 `/opt/xhs-sync/scripts/GEO` 手改线上脚本，否则 GitHub 版本和服务器实际运行版本会分叉。
