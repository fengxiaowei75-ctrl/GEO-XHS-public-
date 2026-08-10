const { readJsonBody, requireAuth, sendJson, withAuthClient } = require("../_auth");

function parseRuleId(value) {
  const ruleId = Number(value);
  if (!Number.isInteger(ruleId) || ruleId <= 0) {
    const error = new Error("rule_id 必须是正整数");
    error.statusCode = 400;
    throw error;
  }
  return ruleId;
}

function parseMaxCalls(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error("max_calls 不能为空");
    error.statusCode = 400;
    throw error;
  }
  if (!/^\d+$/.test(text)) {
    const error = new Error("max_calls 必须是 0 或正整数");
    error.statusCode = 400;
    throw error;
  }
  const maxCalls = Number(text);
  if (!Number.isSafeInteger(maxCalls)) {
    const error = new Error("max_calls 超出范围");
    error.statusCode = 400;
    throw error;
  }
  return maxCalls;
}

async function listRateLimitRules(client) {
  const result = await client.query(
    `
    SELECT
      r.rule_id,
      r.provider_code,
      api.display_name_cn AS provider_display_name_cn,
      r.rule_name,
      r.period_seconds,
      r.max_calls,
      r.max_tokens,
      r.max_estimated_cost,
      r.hard_block,
      r.is_enabled,
      r.updated_at
    FROM public.geo_ops_rate_limit_rules r
    LEFT JOIN public.geo_ops_api_registry api ON api.provider_code = r.provider_code
    ORDER BY r.is_enabled DESC, r.provider_code, r.period_seconds, r.rule_id
    `,
  );
  return result.rows;
}

module.exports = async function handler(req, res) {
  try {
    const actor = await requireAuth(req, res, "admin");
    if (!actor) return;

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { ok: false, error: "仅支持 POST 请求" });
      return;
    }

    const payload = await readJsonBody(req);
    const ruleId = parseRuleId(payload.rule_id ?? payload.ruleId);
    const maxCalls = parseMaxCalls(payload.max_calls ?? payload.maxCalls);

    const response = await withAuthClient(async (client) => {
      const updated = await client.query(
        `
        UPDATE public.geo_ops_rate_limit_rules
        SET max_calls = $1, updated_at = now()
        WHERE rule_id = $2
        RETURNING
          rule_id,
          provider_code,
          rule_name,
          period_seconds,
          max_calls,
          max_tokens,
          max_estimated_cost,
          hard_block,
          is_enabled,
          updated_at
        `,
        [maxCalls, ruleId],
      );
      const rule = updated.rows[0];
      if (!rule) {
        const error = new Error("限流规则不存在");
        error.statusCode = 404;
        throw error;
      }
      return {
        rule,
        rules: await listRateLimitRules(client),
      };
    });

    sendJson(res, 200, { ok: true, ...response });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "限流规则更新失败" });
  }
};
