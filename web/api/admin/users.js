const { listUsers, permissionCatalog, readJsonBody, requireAuth, saveUser, sendJson } = require("../_auth");

module.exports = async function handler(req, res) {
  try {
    const actor = await requireAuth(req, res, "admin");
    if (!actor) return;

    if (req.method === "GET") {
      const users = await listUsers();
      sendJson(res, 200, { ok: true, users, permissions: permissionCatalog });
      return;
    }

    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      const userId = await saveUser(payload, actor);
      const users = await listUsers();
      sendJson(res, 200, { ok: true, user_id: userId, users, permissions: permissionCatalog });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { ok: false, error: "仅支持 GET / POST 请求" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "账号管理失败" });
  }
};
