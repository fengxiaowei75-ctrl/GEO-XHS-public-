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

Docker 容器读取 `.env` 中的 `PG*`、`ENDATA_TOKEN`、`ARK_API_KEY` 等变量；生产服务器当前仍使用 systemd 托管 `/opt/xhs-sync/scripts/GEO` 下的 worker。

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

线上明文环境文件仍在服务器：

```bash
/opt/xhs-sync/sync.env
```

仓库内只保存加密备份：

```bash
server/secrets/sync.enc.env
```

本机解密：

```bash
sops -d server/secrets/sync.enc.env
```

恢复到服务器时，不要把明文提交进 GitHub：

```bash
sops -d server/secrets/sync.enc.env > /private/tmp/sync.env
scp /private/tmp/sync.env root@47.94.156.199:/opt/xhs-sync/sync.env
```

## Update Rule

推荐以后把 GitHub 作为唯一代码源：

```text
修改 server/ 代码
-> commit / push 到 GitHub
-> 云服务器拉取新代码
-> 重启对应 systemd 服务
```

不要长期直接在 `/opt/xhs-sync/scripts/GEO` 手改线上脚本，否则 GitHub 版本和服务器实际运行版本会分叉。
