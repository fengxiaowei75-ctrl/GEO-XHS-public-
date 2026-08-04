# 数据库 Migrations

PostgreSQL 结构变更文件放在这里。

命名规则：

```text
YYYYMMDDHHMM_short_description.sql
```

约束：

- 先写 migration，再改依赖它的 `server/` 或 `web/` 代码。
- 尽量使用幂等 SQL 和 transaction。
- 已经应用到生产数据库的 migration 不能重写；新增一个 migration 修正。
- 数据库变更必须按根目录 `ARCHITECTURE.md` 的确认步骤执行，不能跳步。
