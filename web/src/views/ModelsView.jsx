import { Brain, Gauge, KeyRound, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Stat } from "../components/data/StatCard";
import { StatusPill } from "../components/data/StatusPill";
import { SectionHeader } from "../components/layout/SectionHeader";
import { requestJson } from "../hooks/useRequestJson";
import { formatDuration, formatNumber, providerDisplayName, providerTypeLabel, statusTone } from "../utils/formatters";

function formatRuleMaxCalls(value) {
  return value === null || value === undefined ? "" : String(value);
}

function ruleScopeLabel(item) {
  const parts = [item.provider_display_name_cn || providerDisplayName(item)];
  if (item.model_display_name_cn || item.model_name) parts.push(item.model_display_name_cn || item.model_name);
  if (item.credential_name) parts.push(item.credential_name);
  return parts.filter(Boolean).join(" · ");
}

function normalizeMaxCalls(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, error: "请填写调用次数" };
  if (!/^\d+$/.test(text)) return { ok: false, error: "调用次数必须是 0 或正整数" };
  const maxCalls = Number(text);
  if (!Number.isSafeInteger(maxCalls)) return { ok: false, error: "调用次数超出范围" };
  return { ok: true, value: maxCalls };
}

export function ModelsView({ data, currentUser, onRefresh }) {
  const ops = data?.ops || {};
  const rateLimitRules = ops.rateLimitRules || [];
  const rulesSignature = rateLimitRules.map((rule) => `${rule.rule_id}:${rule.max_calls}`).join("|");
  const canEditRateLimits = currentUser?.role === "admin" && data?.source === "database";
  const [drafts, setDrafts] = useState({});
  const [dirtyDrafts, setDirtyDrafts] = useState({});
  const [savingRuleId, setSavingRuleId] = useState(null);
  const [message, setMessage] = useState({ tone: "neutral", text: "" });

  useEffect(() => {
    setDrafts((current) => {
      const next = {};
      for (const rule of rateLimitRules) {
        const id = String(rule.rule_id);
        next[id] = dirtyDrafts[id] ? current[id] ?? formatRuleMaxCalls(rule.max_calls) : formatRuleMaxCalls(rule.max_calls);
      }
      return next;
    });
    setDirtyDrafts((current) => {
      const next = {};
      for (const rule of rateLimitRules) {
        const id = String(rule.rule_id);
        if (current[id]) next[id] = true;
      }
      return next;
    });
  }, [rulesSignature]);

  function updateDraft(ruleId, value) {
    const key = String(ruleId);
    setDrafts((current) => ({ ...current, [key]: value }));
    setDirtyDrafts((current) => ({ ...current, [key]: true }));
    setMessage({ tone: "neutral", text: "" });
  }

  async function saveRule(rule) {
    const key = String(rule.rule_id);
    const parsed = normalizeMaxCalls(drafts[key]);
    if (!parsed.ok) {
      setMessage({ tone: "red", text: parsed.error });
      return;
    }

    setSavingRuleId(rule.rule_id);
    setMessage({ tone: "neutral", text: "" });
    try {
      const result = await requestJson("/api/admin/rate-limit-rules", {
        method: "POST",
        body: JSON.stringify({ rule_id: rule.rule_id, max_calls: parsed.value }),
      });
      const updatedRule = result.rule || { ...rule, max_calls: parsed.value };
      setDrafts((current) => ({ ...current, [key]: formatRuleMaxCalls(updatedRule.max_calls) }));
      setDirtyDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage({ tone: "green", text: `${updatedRule.rule_name || rule.rule_name} 已更新` });
      void onRefresh?.({ background: true });
    } catch (error) {
      setMessage({ tone: "red", text: error.message });
    } finally {
      setSavingRuleId(null);
    }
  }

  return (
    <>
      <section className="stats-grid stats-grid-three">
        <Stat icon={Brain} label="模型配置" value={formatNumber((ops.modelConfigs || []).length)} sub="豆包 chat / vision / embedding / image" />
        <Stat icon={KeyRound} label="Key 元数据" value={formatNumber((ops.credentials || []).length)} sub="只展示 secret_ref 和 mask" tone="teal" />
        <Stat icon={Gauge} label="限流规则" value={formatNumber((ops.rateLimitRules || []).length)} sub="provider / model / key" tone="amber" />
      </section>

      <section className="panel">
        <SectionHeader icon={Brain} title="模型配置" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>Provider</th>
                <th>角色</th>
                <th>默认</th>
                <th>温度</th>
                <th>Thinking</th>
                <th>维度</th>
              </tr>
            </thead>
            <tbody>
              {(ops.modelConfigs || []).map((item) => (
                <tr key={item.model_config_id}>
                  <td>
                    <div className="note-title">{item.display_name_cn || item.model_name}</div>
                    <div className="note-meta">{item.model_name}</div>
                  </td>
                  <td>{item.provider_display_name_cn || item.provider_code}</td>
                  <td>{providerTypeLabel(item.model_role)}</td>
                  <td>
                    <StatusPill tone={item.is_default ? "green" : "neutral"}>{item.is_default ? "默认" : "备用"}</StatusPill>
                  </td>
                  <td>{item.temperature ?? "-"}</td>
                  <td>{item.thinking_mode || "-"}</td>
                  <td>{item.dimensions || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ops-grid">
        <section className="panel">
          <SectionHeader icon={KeyRound} title="Key 元数据" />
          <div className="ops-table-list">
            {(ops.credentials || []).map((item) => (
              <div className="ops-row" key={item.credential_id}>
                <div>
                  <strong>{item.credential_name}</strong>
                  <span>
                    {item.provider_display_name_cn || item.provider_code} · {item.secret_ref}
                  </span>
                </div>
                <div className="ops-metrics">
                  <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                  <small>{item.secret_mask}</small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <SectionHeader icon={Gauge} title="限流规则" />
          {message.text ? <div className={`rate-limit-message ${message.tone}`}>{message.text}</div> : null}
          {rateLimitRules.length ? (
            <div className="ops-table-list">
              {rateLimitRules.map((item) => {
                const key = String(item.rule_id);
                const draftValue = drafts[key] ?? formatRuleMaxCalls(item.max_calls);
                const parsed = normalizeMaxCalls(draftValue);
                const changed = draftValue !== formatRuleMaxCalls(item.max_calls);
                const canSave = canEditRateLimits && changed && parsed.ok && savingRuleId !== item.rule_id;

                return (
                  <div className="ops-row" key={item.rule_id}>
                    <div>
                      <strong>{item.rule_name}</strong>
                      <span>
                        {ruleScopeLabel(item)} · {formatDuration(Number(item.period_seconds || 0) * 1000)}
                      </span>
                    </div>
                    <div className="ops-metrics">
                      {canEditRateLimits ? (
                        <div className="rate-limit-editor">
                          <input
                            aria-label={`${item.rule_name} 调用上限`}
                            className="rate-limit-input"
                            disabled={savingRuleId === item.rule_id}
                            inputMode="numeric"
                            min="0"
                            onChange={(event) => updateDraft(item.rule_id, event.target.value)}
                            step="1"
                            type="number"
                            value={draftValue}
                          />
                          <button
                            aria-label="保存限流上限"
                            className="icon-button"
                            disabled={!canSave}
                            onClick={() => saveRule(item)}
                            title={canSave ? "保存限流上限" : "先修改为有效的上限值"}
                            type="button"
                          >
                            <Save size={16} />
                          </button>
                        </div>
                      ) : (
                        <b>{item.max_calls !== null && item.max_calls !== undefined ? `${formatNumber(item.max_calls)} calls` : "-"}</b>
                      )}
                      <StatusPill tone={item.is_enabled ? "green" : "neutral"}>{item.is_enabled ? "enabled" : "off"}</StatusPill>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">暂无限流规则</div>
          )}
        </section>
      </section>
    </>
  );
}
