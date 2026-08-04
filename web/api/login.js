const { login, permissionCatalog, readJsonBody, sendJson, sessionCookie } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await login(req, body.username, body.password);
    sendJson(
      res,
      200,
      {
        ok: true,
        user: result.user,
        permissions: permissionCatalog,
      },
      { "Set-Cookie": sessionCookie(result.token, req) },
    );
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "登录失败" });
  }
};
