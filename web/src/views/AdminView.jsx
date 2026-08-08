import { KeyRound, Save, Shield, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Stat } from "../components/data/StatCard";
import { StatusPill } from "../components/data/StatusPill";
import { SectionHeader } from "../components/layout/SectionHeader";
import { requestJson } from "../hooks/useRequestJson";
import { formatDateTimeSecond, formatNumber } from "../utils/formatters";

function emptyUserForm(permissionCatalog = {}) {
  return {
    user_id: "",
    username: "",
    password: "",
    role: "viewer",
    active: true,
    permissions: Object.fromEntries(Object.keys(permissionCatalog).map((key) => [key, key === "content" || key === "ops"])),
  };
}

export function AdminView({ currentUser, permissionCatalog }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(() => emptyUserForm(permissionCatalog));
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const permissionEntries = Object.entries(permissionCatalog || {});

  async function loadUsers() {
    setLoadingUsers(true);
    setMessage("");
    try {
      const payload = await requestJson("/api/admin/users");
      setUsers(payload.users || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setForm((current) => {
      const merged = { ...emptyUserForm(permissionCatalog), ...current };
      merged.permissions = { ...emptyUserForm(permissionCatalog).permissions, ...(current.permissions || {}) };
      return merged;
    });
  }, [permissionCatalog]);

  function resetForm() {
    setForm(emptyUserForm(permissionCatalog));
    setMessage("");
  }

  function editUser(user) {
    setForm({
      user_id: user.user_id,
      username: user.username || "",
      password: "",
      role: user.role || "viewer",
      active: user.active !== false,
      permissions: { ...emptyUserForm(permissionCatalog).permissions, ...(user.permissions || {}) },
    });
    setMessage(`正在编辑 ${user.username}`);
  }

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateRole(role) {
    setForm((current) => ({
      ...current,
      role,
      permissions: role === "admin" ? Object.fromEntries(permissionEntries.map(([key]) => [key, true])) : current.permissions,
    }));
  }

  function updatePermission(key, checked) {
    setForm((current) => ({
      ...current,
      permissions: { ...(current.permissions || {}), [key]: checked },
    }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        user_id: form.user_id || null,
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        active: form.active,
        permissions: form.permissions,
      };
      const result = await requestJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUsers(result.users || []);
      setMessage("已保存");
      if (!form.user_id) resetForm();
      else updateForm({ password: "" });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="stats-grid stats-grid-three">
        <Stat icon={Users} label="账号数量" value={formatNumber(users.length)} sub={loadingUsers ? "加载中" : "dashboard_users"} />
        <Stat
          icon={Shield}
          label="管理员"
          value={formatNumber(users.filter((user) => user.role === "admin").length)}
          sub={`当前 ${currentUser?.username || "-"}`}
          tone="teal"
        />
        <Stat
          icon={KeyRound}
          label="权限项"
          value={formatNumber(permissionEntries.length)}
          sub="页面级访问控制"
          tone="amber"
        />
      </section>

      <section className="admin-layout">
        <section className="panel">
          <SectionHeader
            icon={form.user_id ? Save : UserPlus}
            title={form.user_id ? "更新账号" : "创建账号"}
            action={
              <button className="copy-button" onClick={resetForm} type="button">
                新建
              </button>
            }
          />
          <form className="admin-form" onSubmit={save}>
            <label>
              <span>账号</span>
              <input value={form.username} onChange={(event) => updateForm({ username: event.target.value })} required />
            </label>
            <label>
              <span>{form.user_id ? "新密码" : "密码"}</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => updateForm({ password: event.target.value })}
                placeholder={form.user_id ? "留空不修改" : ""}
                required={!form.user_id}
              />
            </label>
            <div className="admin-form-row">
              <label>
                <span>角色</span>
                <select value={form.role} onChange={(event) => updateRole(event.target.value)}>
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label className="admin-check">
                <input checked={form.active} onChange={(event) => updateForm({ active: event.target.checked })} type="checkbox" />
                启用
              </label>
            </div>
            <div className="permission-grid">
              {permissionEntries.map(([key, label]) => (
                <label key={key} className={form.role === "admin" ? "disabled" : ""}>
                  <input
                    checked={form.role === "admin" || Boolean(form.permissions?.[key])}
                    disabled={form.role === "admin"}
                    onChange={(event) => updatePermission(key, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <button className="primary-button" disabled={saving} type="submit">
              保存账号
            </button>
            {message ? <div className="admin-message">{message}</div> : null}
          </form>
        </section>

        <section className="panel panel-table">
          <SectionHeader icon={Users} title="账号列表" />
          <div className="table-wrap">
            <table className="admin-user-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>权限</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id}>
                    <td>
                      <div className="note-title">{user.username}</div>
                      <div className="note-meta">#{user.user_id}</div>
                    </td>
                    <td>{user.role}</td>
                    <td>
                      <StatusPill tone={user.active ? "green" : "neutral"}>{user.active ? "active" : "disabled"}</StatusPill>
                    </td>
                    <td>
                      <div className="admin-perm-tags">
                        {permissionEntries
                          .filter(([key]) => user.role === "admin" || user.permissions?.[key])
                          .map(([key, label]) => (
                            <span key={`${user.user_id}-${key}`}>{label}</span>
                          ))}
                      </div>
                    </td>
                    <td>{formatDateTimeSecond(user.last_login_at)}</td>
                    <td>
                      <button className="copy-button" onClick={() => editUser(user)} type="button">
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
                {!users.length ? (
                  <tr>
                    <td colSpan="6">{loadingUsers ? "加载中" : "暂无账号"}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </>
  );
}
