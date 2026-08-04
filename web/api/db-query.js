const { Pool } = require("pg");

const ALLOWED_PREFIXES = ["SELECT", "WITH"];
const DANGEROUS_KEYWORDS = [
  "ALTER",
  "CALL",
  "COPY",
  "CREATE",
  "DELETE",
  "DROP",
  "EXECUTE",
  "GRANT",
  "INSERT",
  "MERGE",
  "REFRESH",
  "REINDEX",
  "RESET",
  "REVOKE",
  "SET",
  "TRUNCATE",
  "UPDATE",
  "VACUUM",
];

let pool;

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getPoolConfig() {
  const ssl = process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: 2,
      idleTimeoutMillis: 30000,
    };
  }

  const requiredEnv = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  if (!requiredEnv.every((key) => Boolean(process.env[key]))) return null;

  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl,
    max: 2,
    idleTimeoutMillis: 30000,
  };
}

function getPool() {
  const config = getPoolConfig();
  if (!config) return null;
  if (!pool) pool = new Pool(config);
  return pool;
}

function validateSql(sql) {
  const trimmedSql = sql.trim();
  const upperSql = trimmedSql.toUpperCase();

  if (!ALLOWED_PREFIXES.some((prefix) => upperSql.startsWith(prefix))) {
    return "仅允许 SELECT 查询";
  }

  if (trimmedSql.includes(";")) {
    return "不允许多语句 SQL";
  }

  const keywordPattern = new RegExp(`\\b(${DANGEROUS_KEYWORDS.join("|")})\\b`, "i");
  const match = upperSql.match(keywordPattern);
  if (match) {
    return `检测到危险操作: ${match[1].toUpperCase()}`;
  }

  return "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { success: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    const { sql, params } = await readJsonBody(req);

    if (!sql || typeof sql !== "string") {
      sendJson(res, 400, { success: false, error: "缺少 SQL 查询语句" });
      return;
    }

    const validationError = validateSql(sql);
    if (validationError) {
      sendJson(res, 403, { success: false, error: validationError });
      return;
    }

    const dbPool = getPool();
    if (!dbPool) {
      sendJson(res, 500, { success: false, error: "服务端缺少数据库环境变量" });
      return;
    }

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '15000ms'");
      const result = await client.query(sql, Array.isArray(params) ? params : []);
      await client.query("COMMIT");

      sendJson(res, 200, {
        success: true,
        rows: result.rows,
        rowCount: result.rowCount,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
