const { clearSessionCookie, logout, sendJson } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
    return;
  }

  try {
    await logout(req);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(req) });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "退出失败" }, { "Set-Cookie": clearSessionCookie(req) });
  }
};
