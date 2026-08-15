# Secrets

本目录不保存密钥文件。供应商凭证统一由 Central Gateway 加密管理；GEO 的数据库密码和 Gateway service token 只注入服务器或 Vercel 的运行环境。

不要提交明文或加密后的 `.env`、`sync.env`、`*.plain` 或解密临时文件。
