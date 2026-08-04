# GEO 运行监控与 API 网关设计

## 目标

在现有 `web/` 驾驶舱里新增“运行监控”模块，用来监控：

- 收费外部 API 调用次数、成功率、失败原因、延迟、token 用量。
- LLM/Embedding/图片解析模型的调用曲线，支持按小时、日、周切换。
- 后台脚本运行日志、运行状态、最近错误、耗时和处理量。
- API Key/模型配置、限流规则和未来成本估算。

这个模块的核心不是替代云厂商账单，而是先把“调用次数、失败率、模型维度、脚本维度”抓准。能拿到 token_usage 的模型再展示 token；拿不到费用或 token 的 API 先展示次数。

## 当前已识别的外部调用

当前仓库代码里实际在跑的外部调用分为 5 类，其中前 4 类应按收费 API 重点监控。

| 类型 | provider_code | 当前脚本 | endpoint/model | 当前可统计程度 |
| --- | --- | --- | --- | --- |
| 小红书详情 API | `endata_xhs_note_detail` | `import_xhs_note_details_from_excel.py`、`sync_xhs_note_by_id.py` | `GET https://dataapi.endata.com.cn/V2/Xhs/GetStandardNoteInfo` | 目前只能按 `note_details.detail_status` 统计结果，不能精确到重试次数 |
| 图片多模态解析 | `volcengine_ark_vision` | `analyze_xhs_geo_note_images.py` | Ark Responses，`doubao-seed-2-0-mini-260428` | 目前可按 `image_analysis.status/model_name` 统计结果，不能精确到重试次数 |
| Kimi 内容资产总结 | `kimi_chat` | `build_geo_content_assets.py` | OpenAI-compatible `/chat/completions`，`kimi-k2.6` | 已有 `geo_note_content_asset_runs`，可统计 status、latency、token_usage |
| Embedding 向量 | `volcengine_ark_embedding` | `embed_geo_content_assets.py` | Ark Embedding，`doubao-embedding-vision-251215` | 目前只能按 `geo_note_content_asset_vectors` 统计成功结果，失败和重试没有结构化日志 |
| 图片下载 | `xhs_image_download` | `analyze_xhs_geo_note_images.py` | 小红书/图片 CDN URL | 通常不是模型费用，但会影响图片解析成功率，应监控失败率和响应大小 |

当前仓库没有视频转录 API 调用代码，但 `note_details` 已有 `video_address`、`video_top_image` 字段。监控结构预留 `speech_to_text` 类型，未来接视频转录时不需要重新设计表。

## 当前数据库现状

线上当前相关表只有：

```text
note_details
image_analysis
geo_note_content_assets
geo_note_content_asset_runs
geo_note_content_asset_vectors
geo_note_ingest_queue
```

已有历史统计能力：

- Endata 笔记详情结果：`success=90`，`failed=110`。
- 图片解析结果：`doubao-seed-2-0-mini-260428 success=811`，`failed=23`。
- Kimi 运行：`kimi-k2.6 success=90 failed=4`，历史 token_usage 可统计；旧 `moonshot-v1-32k failed=2`。
- Kimi `kimi-k2.6` 已记录 total_tokens 约 `1,018,740`。
- Embedding 向量结果：`doubao-embedding-vision-251215 count=90`。
- 队列结果：`geo_note_ingest_queue success=199`。

当前缺口：

- 没有统一 API 调用日志表。
- 无法精确统计每次 retry 是否消耗 API。
- 无法按 API key 统计调用次数。
- 图片下载失败和模型调用失败没有统一归因。
- Embedding 失败没有长期结构化记录。
- 脚本 stdout/stderr 只在 log 文件里，不方便 web 查询。
- 没有 gateway 统一控制频率、限流、key 切换、模型切换。

## 推荐数据库结构

不要一个脚本一张日志表。应该用“注册表 + 运行表 + 事件表”的通用结构。

推荐新增：

```text
geo_ops_scripts              脚本注册表，记录脚本中文名、功能、路径、关联 service
geo_ops_script_runs          脚本每次运行记录
geo_ops_script_events        脚本运行过程事件流，用于滚动日志
geo_ops_api_registry         外部 API/provider 注册表
geo_ops_model_configs        大模型/embedding/视频转录模型配置
geo_ops_credentials          API key 元数据和加密密文/secret_ref，不存明文
geo_ops_api_call_logs        每一次外部 API 调用日志
geo_ops_rate_limit_rules     网关限流规则
geo_ops_usage_windows        网关限流窗口计数，可选用于强限流
geo_ops_api_usage_hourly     小时聚合 view
geo_ops_api_usage_daily      日聚合 view
geo_ops_api_usage_weekly     周聚合 view
```

这样新增脚本时，只需要：

1. 新脚本通过 gateway/logger 写 `script_run` 和 `script_event`。
2. 在 `geo_ops_scripts` 注册脚本中文名和描述。
3. web UI 查询注册表即可自动出现新脚本，不需要为每个脚本新增一张表。

## API 网关设计

先不要做独立 HTTP 网关服务，第一阶段做 server 端 Python 内嵌网关模块，改造成本最低。

建议新增：

```text
server/scripts/GEO/geo_ops_gateway.py
```

职责：

- 统一发起所有 `requests.get/post`。
- 自动写入 `geo_ops_api_call_logs`。
- 自动关联 `script_run_id`、`note_id`、`asset_id`、`image_analysis_id`。
- 读取 `geo_ops_model_configs` 和 `geo_ops_credentials`。
- 执行限流规则。
- 统一 retry、timeout、错误分类、延迟统计。
- 从响应里提取 usage，例如 Kimi 的 `prompt_tokens/completion_tokens/total_tokens`。
- 返回统一响应对象给业务脚本。

调用形态示例：

```python
gateway.call(
    provider_code="kimi_chat",
    operation="content_asset_summary",
    model_name=args.kimi_model,
    method="POST",
    url=f"{args.kimi_base_url}/chat/completions",
    headers=headers,
    json=body,
    context={"note_id": note_id, "script_run_id": script_run_id},
)
```

第一阶段要改造的调用点：

- `import_xhs_note_details_from_excel.py` 的 Endata note detail。
- `analyze_xhs_geo_note_images.py` 的图片下载。
- `analyze_xhs_geo_note_images.py` 的 Ark vision。
- `build_geo_content_assets.py` 的 Kimi chat completion。
- `embed_geo_content_assets.py` 的 Ark embedding。

## Key 与模型配置

你希望 web 里可以配置“大模型 key + 名称”，这个可以做，但必须先加访问控制，否则公网 dashboard 上暴露 key 配置入口风险很高。

安全设计：

- web UI 只展示 `credential_name`、provider、模型名、状态、最后 4 位 mask。
- API key 明文只在创建/更新那一刻进入后端，后端立刻加密后写入 `geo_ops_credentials.encrypted_secret`。
- 查询接口永远不返回明文 key。
- server 端用环境变量里的解密密钥解出 key。
- 如果暂时不做登录系统，第一阶段只做“只读配置展示”，不开放在线填写 key。

模型配置字段应支持：

- provider：Kimi、Moonshot、Volcengine Ark、OpenAI-compatible、自定义中转站。
- role：`llm_chat`、`llm_vision`、`embedding`、`speech_to_text`。
- model_name：例如 `kimi-k2.6`、`doubao-seed-2-0-mini-260428`。
- default flag：当前默认模型。
- thinking/temperature/dimensions/max_context_tokens 等模型参数。
- enabled/disabled：切换模型时不删历史配置。

## Web 看板设计

左侧新增导航：

```text
内容资产
运行监控
模型与 Key
```

### 运行监控页

顶部 KPI：

- 今日 API 调用次数
- 今日收费 API 调用次数
- 今日失败次数
- 成功率
- 平均延迟
- 今日 LLM total_tokens
- 最近 1 小时错误数
- 当前 active 服务数

时间控件：

- 最近 1 小时、24 小时、7 天、30 天
- 粒度：小时 / 日 / 周

API 调用模块：

- 下拉选择 API：
  - Endata 笔记详情
  - Ark 图片解析
  - Ark Embedding
  - 图片下载
  - 未来：视频转录
- 指标切换：
  - 调用次数
  - 成功/失败
  - 平均延迟
  - HTTP 状态码
  - 错误类型
  - 估算费用，后续接价格表再展示

大模型模块：

- 支持多选模型：
  - Kimi K2.6
  - Moonshot 旧模型
  - Doubao 图片解析
  - Doubao Embedding
  - 未来视频转录模型
- 折线图可切换：
  - 调用次数
  - total_tokens
  - prompt_tokens
  - completion_tokens
  - 平均延迟
  - 失败数

脚本运行日志模块：

- 左侧脚本列表：中文名 + 状态 + 最近运行时间。
- 右侧滚动日志：按 `geo_ops_script_events` 展示。
- 每次运行可展开：
  - trigger_type
  - command
  - started_at / finished_at / duration
  - exit_code
  - processed_count / success_count / failed_count
  - stdout_tail / stderr_tail
  - error_message

网关与限流模块：

- provider/model/key 维度调用次数。
- 每小时/每日调用上限。
- 每小时/每日 token 上限。
- 失败率超过阈值时显示告警。
- provider 余额不足、401、403、429、5xx 分开展示。

### 模型与 Key 页

第一阶段建议只读：

- provider
- 模型名
- 模型角色
- 默认模型
- 启用状态
- key 名称
- key mask
- 最近调用时间
- 最近错误

第二阶段加登录后再开放：

- 新增 key
- 禁用 key
- 切换默认模型
- 设置限流阈值
- 设置价格表

## 分阶段实施

### Phase 1：数据库和只读看板

- 执行 observability migration。
- web 增加运行监控页面。
- 用现有结果表回填基础统计。
- 不改线上脚本调用链。

优点：风险低，能快速看到历史结果。

### Phase 2：server 脚本接入 gateway

- 新增 `geo_ops_gateway.py`。
- 改造 5 个外部调用点。
- 每次脚本运行写 `script_runs/events`。
- 每次 API 调用写 `api_call_logs`。
- 同步 server 代码到云服务器并重启服务。

优点：开始精确记录每次 API 调用、retry、失败原因和延迟。

### Phase 3：限流与模型切换

- 启用 `geo_ops_rate_limit_rules`。
- 加模型配置 UI。
- 支持 provider/model 多选曲线。
- 支持默认模型切换。

### Phase 4：成本估算

- 增加价格表或在 `geo_ops_api_registry.config` 里配置单价。
- 按调用次数、token、图片张数或视频分钟数估算费用。

## 必须先处理的安全债

当前 `server/scripts/GEO` 里有硬编码 token/key 的历史痕迹。后续改造 server 脚本时，必须先移除这些硬编码默认值，统一从：

- `/opt/xhs-sync/sync.env`
- `server/secrets/sync.enc.env`
- `geo_ops_credentials`

读取密钥。不能再把真实 key 写进脚本。

如果这些 key 已经推送过 GitHub，即使仓库是私有，也建议后续轮换对应 key。
