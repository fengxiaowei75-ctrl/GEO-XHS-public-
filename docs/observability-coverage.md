# geo-xhs 日志覆盖审计

## 已覆盖

- `watch_geo_note_ingest_queue.py`：常驻服务启动、心跳、异常退出、既有队列事件。
- `embed_geo_content_assets.py`：常驻服务启动、心跳、异常退出、既有向量事件。
- `geo_ops_gateway.py`：所有既有 `geo_ops_script_events` 同步生成统一运行事件。
- `geo_ops_gateway.py`：Endata、Ark Chat、Ark Vision、Ark Embedding、Kimi 和图片下载等已通过现有 Gateway 调用日志记录。
- systemd：worker stdout/stderr 仍写入原文件；新增 JSONL 运行事件写入 `/opt/xhs-sync/logs/geo-observability.jsonl`。

## 仍需专项补强

- Vercel `web/api/*` 的用户请求尚未全部写入统一 `observability_events`；当前仍依赖函数错误响应和 Gateway API 调用日志。
- `sync_xhs_note_by_id.py`、Excel 导入和图片分析子进程的独立运行边界仍由父 worker 的 `run_id` 关联，后续可以增加独立 `step_id`。
- 服务器部署后需要安装 `/etc/logrotate.d/geo-xhs`，并确认 `OBSERVABILITY_LOG_DIR` 与实际权限。
- 生产数据库必须先执行 Gateway `006_observability_and_ai_diagnostics.sql`，再将项目 service token 配置到 GEO worker 环境。

## 扫描结论

当前没有发现 GEO 业务脚本绕过 `geo_ops_gateway.py` 直接调用已识别的收费供应商；发现的 `subprocess.run` 均属于本地子流程，应该通过父级 `run_id` 和事件记录定位。Web API 的异常日志接入是下一阶段缺口，不应在本次迁移中把业务响应和 API 成本日志混为一谈。
