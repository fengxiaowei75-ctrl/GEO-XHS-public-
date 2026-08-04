# GEO XHS

GEO 小红书内容资产项目，包含网站驾驶舱和云服务器后台脚本。

## Structure

```text
web/       Vercel 部署的网站和 Serverless API
server/    云服务器运行的抓取、Kimi 分析、pgvector 刷新脚本
docs/      数据库字段、内容逻辑和 Agent 使用说明
```

## Secrets

明文密钥不提交到 GitHub。需要入库备份的环境变量使用 `sops + age` 加密，存放在 `server/secrets/*.enc.env`。

本机 age 私钥位置：

```bash
/tmp/geo-xhs/age-keys.txt
```

解密示例：

```bash
sops -d server/secrets/sync.enc.env
```
