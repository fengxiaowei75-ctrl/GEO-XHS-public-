const crypto = require("crypto");
const { Pool } = require("pg");

const SESSION_COOKIE = "geo_xhs_session";
const SESSION_TTL_SECONDS = Number(process.env.DASHBOARD_SESSION_TTL_SECONDS || 604800);
const PASSWORD_ITERATIONS = 260000;

const permissionCatalog = {
  content: "GEO红书需求洞察",
  ops: "运行监控",
  models: "模型配置",
  admin: "管理员配置",
};

let pool;

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

function sendJson(res, statusCode, payload, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function isSecureRequest(req) {
  return Boolean(process.env.VERCEL) || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(token, req) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function clearSessionCookie(req) {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), iterations = PASSWORD_ITERATIONS) {
  if (!password) throw new Error("password is required");
  const digest = crypto.pbkdf2Sync(String(password), salt, Number(iterations), 32, "sha256").toString("base64");
  return `pbkdf2_sha256$${iterations}$${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, iterations, salt, digest] = String(stored || "").split("$");
    if (scheme !== "pbkdf2_sha256" || !iterations || !salt || !digest) return false;
    const actual = hashPassword(password, salt, Number(iterations)).split("$")[3];
    const actualBuffer = Buffer.from(actual);
    const digestBuffer = Buffer.from(digest);
    if (actualBuffer.length !== digestBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, digestBuffer);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function allPermissions() {
  return Object.fromEntries(Object.keys(permissionCatalog).map((key) => [key, true]));
}

function normalizePermissions(value, role = "viewer") {
  if (role === "admin") return allPermissions();
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.keys(permissionCatalog)
      .filter((key) => key !== "admin")
      .map((key) => [key, Boolean(source[key])]),
  );
}

function userPayload(row) {
  if (!row) return null;
  const role = row.role || "viewer";
  return {
    user_id: Number(row.user_id),
    username: row.username,
    role,
    active: Boolean(row.active),
    permissions: normalizePermissions(row.permissions || {}, role),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  };
}

async function ensureAuthSchema(client) {
  await client.query("SELECT pg_advisory_lock(47094156199)");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.dashboard_users (
        user_id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.dashboard_sessions (
        session_id BIGSERIAL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id BIGINT NOT NULL REFERENCES public.dashboard_users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ,
        user_agent TEXT,
        remote_addr TEXT
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS dashboard_sessions_user_idx ON public.dashboard_sessions(user_id)");
    await client.query("CREATE INDEX IF NOT EXISTS dashboard_sessions_valid_idx ON public.dashboard_sessions(token_hash, expires_at) WHERE revoked_at IS NULL");

    const countResult = await client.query("SELECT count(*)::int AS count FROM public.dashboard_users");
    const initialPassword = process.env.DASHBOARD_INITIAL_ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD;
    if (countResult.rows[0]?.count === 0 && initialPassword) {
      const initialUser = process.env.DASHBOARD_INITIAL_ADMIN_USER || process.env.DASHBOARD_USER || "admin";
      await client.query(
        "INSERT INTO public.dashboard_users(username,password_hash,role,permissions,active) VALUES($1,$2,'admin',$3::jsonb,TRUE)",
        [initialUser, hashPassword(initialPassword), JSON.stringify(allPermissions())],
      );
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(47094156199)").catch(() => {});
  }
}

async function withAuthClient(callback) {
  const dbPool = getPool();
  if (!dbPool) {
    const error = new Error("服务端缺少数据库环境变量");
    error.statusCode = 500;
    throw error;
  }
  const client = await dbPool.connect();
  try {
    await ensureAuthSchema(client);
    return await callback(client);
  } finally {
    client.release();
  }
}

async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return withAuthClient(async (client) => {
    const result = await client.query(
      `
      SELECT u.*
      FROM public.dashboard_sessions s
      JOIN public.dashboard_users u ON u.user_id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.active = TRUE
      `,
      [hashToken(token)],
    );
    const user = userPayload(result.rows[0]);
    if (user) {
      await client.query("UPDATE public.dashboard_sessions SET last_seen_at = now() WHERE token_hash = $1", [hashToken(token)]);
    }
    return user;
  });
}

function hasPermission(user, permission) {
  return Boolean(user && (user.role === "admin" || user.permissions?.[permission] === true));
}

async function requireAuth(req, res, permission = null) {
  const user = await currentUser(req).catch((error) => {
    throw error;
  });
  if (!user) {
    sendJson(res, 401, { ok: false, error: "未登录" });
    return null;
  }
  if (permission && !hasPermission(user, permission)) {
    sendJson(res, 403, { ok: false, error: "无权限" });
    return null;
  }
  return user;
}

function remoteAddr(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim().slice(0, 100);
  return "";
}

async function login(req, username, password) {
  return withAuthClient(async (client) => {
    const result = await client.query("SELECT * FROM public.dashboard_users WHERE username = $1", [String(username || "").trim()]);
    const row = result.rows[0];
    if (!row || !row.active || !verifyPassword(password, row.password_hash)) {
      const error = new Error("账号或密码错误");
      error.statusCode = 401;
      throw error;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await client.query(
      `
      INSERT INTO public.dashboard_sessions(token_hash,user_id,expires_at,user_agent,remote_addr)
      VALUES($1,$2,now() + ($3 || ' seconds')::interval,$4,$5)
      `,
      [hashToken(token), row.user_id, SESSION_TTL_SECONDS, String(req.headers["user-agent"] || "").slice(0, 500), remoteAddr(req)],
    );
    await client.query("UPDATE public.dashboard_users SET last_login_at = now(), updated_at = now() WHERE user_id = $1", [row.user_id]);
    return { token, user: userPayload(row) };
  });
}

async function logout(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return;
  await withAuthClient(async (client) => {
    await client.query("UPDATE public.dashboard_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token)]);
  });
}

async function listUsers() {
  return withAuthClient(async (client) => {
    const result = await client.query(
      "SELECT user_id,username,role,permissions,active,created_at,updated_at,last_login_at FROM public.dashboard_users ORDER BY user_id",
    );
    return result.rows.map(userPayload);
  });
}

async function saveUser(payload, actor) {
  return withAuthClient(async (client) => {
    const username = String(payload.username || "").trim();
    if (username.length < 2) {
      const error = new Error("账号至少 2 个字符");
      error.statusCode = 400;
      throw error;
    }
    const role = payload.role === "admin" ? "admin" : "viewer";
    const permissions = normalizePermissions(payload.permissions || {}, role);
    const active = payload.active !== false;
    const password = String(payload.password || "");
    const userId = payload.user_id ? Number(payload.user_id) : null;

    if (userId) {
      const existing = await client.query("SELECT user_id FROM public.dashboard_users WHERE user_id = $1", [userId]);
      if (!existing.rows.length) {
        const error = new Error("账号不存在");
        error.statusCode = 404;
        throw error;
      }
      if (Number(actor.user_id) === userId && (!active || role !== "admin")) {
        const error = new Error("不能禁用自己或取消自己的管理员角色");
        error.statusCode = 400;
        throw error;
      }
      if (password) {
        await client.query(
          `
          UPDATE public.dashboard_users
          SET username = $1, role = $2, permissions = $3::jsonb, active = $4, password_hash = $5, updated_at = now()
          WHERE user_id = $6
          `,
          [username, role, JSON.stringify(permissions), active, hashPassword(password), userId],
        );
      } else {
        await client.query(
          `
          UPDATE public.dashboard_users
          SET username = $1, role = $2, permissions = $3::jsonb, active = $4, updated_at = now()
          WHERE user_id = $5
          `,
          [username, role, JSON.stringify(permissions), active, userId],
        );
      }
      return userId;
    }

    if (!password) {
      const error = new Error("新建账号必须填写密码");
      error.statusCode = 400;
      throw error;
    }
    const result = await client.query(
      `
      INSERT INTO public.dashboard_users(username,password_hash,role,permissions,active)
      VALUES($1,$2,$3,$4::jsonb,$5)
      RETURNING user_id
      `,
      [username, hashPassword(password), role, JSON.stringify(permissions), active],
    );
    return Number(result.rows[0].user_id);
  });
}

module.exports = {
  allPermissions,
  clearSessionCookie,
  currentUser,
  hasPermission,
  listUsers,
  login,
  logout,
  permissionCatalog,
  readJsonBody,
  requireAuth,
  withAuthClient,
  saveUser,
  sendJson,
  sessionCookie,
};
