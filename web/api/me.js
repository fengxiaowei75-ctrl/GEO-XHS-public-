const { currentUser, permissionCatalog, sendJson } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "仅支持 GET 请求" });
    return;
  }

  try {
    const user = await currentUser(req);
    sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(user),
      user,
      permissions: permissionCatalog,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || "认证检查失败",
      permissions: permissionCatalog,
    });
  }
};
