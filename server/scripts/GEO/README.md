# GEO 项目

## 数据库

默认数据库：`xhs_geo`

当前项目表：

- `public.note_details`: GEO 笔记详情表。来自 Excel 或手工 note_id，补充 Endata 实时详情。
- `public.image_analysis`: GEO 图片分析表。按笔记图片输出 OCR、选题、人群、决策阶段、知识点、内容逻辑、风格复原、image2 提示词等。
- `public.geo_note_content_assets`: GEO 笔记级内容资产表。聚合详情、图片解析、互动权重和时效权重，由豆包/Ark 内容模型输出结构化拆解。
- `public.geo_note_content_asset_runs`: 内容资产分析调用日志。
- `public.geo_note_content_asset_vectors`: 笔记级内容资产向量表，使用 pgvector `halfvec(2048)` 存储 2048 维 embedding，并使用 HNSW 余弦索引。

当前阶段只做内容资产分析、召回和向量化，不自动生成小红书笔记草稿。

## 脚本

- `import_xhs_note_details_from_excel.py`: 解析小红书 Excel，提取 note_id，调用 Endata 详情接口，写入 GEO 详情表。
- `analyze_xhs_geo_note_images.py`: 从 GEO 详情表读取图片，调用 Ark/豆包多模态模型分析，写入 GEO 图片分析表。
- `sync_xhs_note_by_id.py`: 手工按 note_id 或笔记链接补录。可选抓详情、分析图片、构建内容资产、写入资产向量。
- `build_geo_content_assets.py`: 聚合同一笔记的详情和图片解析，计算互动权重与时效权重，调用豆包/Ark 内容模型写入笔记级内容资产表。
- `embed_geo_content_assets.py`: 将 `geo_note_content_assets.asset_text` 转为 pgvector；支持一次性补量和 `--watch` 持续监听资产更新。
- `watch_geo_note_ingest_queue.py`: 常驻队列 worker。处理 `geo_note_ingest_queue` 中的新 note_id，自动抓详情、分析图片、构建内容资产并刷新向量。

## 常用入口

```bash
python /opt/xhs-sync/scripts/GEO/sync_xhs_note_by_id.py --note-id <note_id>
python /opt/xhs-sync/scripts/GEO/sync_xhs_note_by_id.py --note-id <note_id> --build-asset --embed-asset
python /opt/xhs-sync/scripts/GEO/build_geo_content_assets.py --min-fresh-score 300 --limit 10
python /opt/xhs-sync/scripts/GEO/embed_geo_content_assets.py --only-missing --limit 50
python /opt/xhs-sync/scripts/GEO/embed_geo_content_assets.py --watch --poll-interval 60
```

## 自动化队列

后台服务：

```bash
systemctl status xhs-geo-note-ingest-queue.service --no-pager
systemctl status xhs-geo-asset-vector.service --no-pager
```

以后录入新 note_id，推荐用数据库函数：

```sql
SELECT public.enqueue_geo_note_id('6a1ba9a10000000006031daa');
SELECT public.enqueue_geo_note_id('https://www.xiaohongshu.com/explore/6a1ba9a10000000006031daa');
```

也可以直接插入队列表：

```sql
INSERT INTO public.geo_note_ingest_queue (note_id, input_value, source_keyword, priority)
VALUES ('6a1ba9a10000000006031daa', '6a1ba9a10000000006031daa', 'manual_queue', 100)
ON CONFLICT (note_id) DO UPDATE SET
  status = 'pending',
  attempts = 0,
  last_error = NULL,
  updated_at = CURRENT_TIMESTAMP;
```

队列状态：

```sql
SELECT status, count(*)
FROM public.geo_note_ingest_queue
GROUP BY status
ORDER BY status;
```

worker 启动时会自动把 `note_details` 中尚未生成内容资产的历史笔记加入队列，历史任务优先级默认为 `200`；手工新录入任务优先级默认为 `100`，会优先于历史回填处理。

## 时效权重

原始互动权重：

```text
interaction_score = like_count + collected_count + comments_count * 2
```

时效加权：

```text
age_days = 当前日期 - publish_time 日期
recency_factor = 0.5 ^ (age_days / recency_half_life_days)
fresh_hot_score = interaction_score * recency_factor
```

默认半衰期为 45 天。

## 环境变量

从 `/opt/xhs-sync/sync.env`、环境变量或命令行参数读取：

- `PGPASSWORD`
- `ENDATA_TOKEN`
- `GEO_CONTENT_API_KEY` 或 `ARK_CHAT_API_KEY`，优先用于豆包/Ark 内容资产总结
- `GEO_CONTENT_BASE_URL` 或 `ARK_CHAT_BASE_URL`，默认 `https://ark.cn-beijing.volces.com/api/v3`
- `GEO_CONTENT_MODEL` 或 `ARK_CHAT_MODEL`，默认 `doubao-seed-2-0-mini-260428`
- `GEO_CONTENT_TEMPERATURE` 或 `ARK_CHAT_TEMPERATURE`，默认 `0.6`
- `GEO_CONTENT_THINKING` 或 `ARK_CHAT_THINKING`，默认 `disabled`，用于 Ark chat 请求关闭深度思考
- `KIMI_API_KEY` / `KIMI_BASE_URL` / `KIMI_MODEL` 仅作为历史兼容兜底
- `KIMI_TEMPERATURE` / `KIMI_THINKING` 仅作为历史兼容兜底
- `ARK_API_KEY` 或 `VOLC_API_KEY`
- `ARK_EMBEDDING_MODEL`，默认 `doubao-embedding-vision-251215`
