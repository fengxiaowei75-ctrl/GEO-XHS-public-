import { useEffect, useState } from "react";
import { requestJson } from "./useRequestJson";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [permissionCatalog, setPermissionCatalog] = useState({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    requestJson("/api/me")
      .then((payload) => {
        if (!alive) return;
        setPermissionCatalog(payload.permissions || {});
        if (payload.authenticated && payload.user) {
          setUser(payload.user);
        } else {
          setUser(null);
        }
      })
      .catch((error) => {
        if (!alive) return;
        setUser(null);
        setLoginError(error.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function login(username, password) {
    setLoginLoading(true);
    setLoginError("");
    try {
      const payload = await requestJson("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setPermissionCatalog(payload.permissions || {});
      setUser(payload.user);
      return payload.user;
    } catch (error) {
      setLoginError(error.message);
      return null;
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    try {
      await requestJson("/api/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // Local state still needs clearing even if the session was already expired.
    }
    setUser(null);
    setLoginError("");
  }

  return { user, setUser, loading, login, logout, loginLoading, loginError, setLoginError, permissionCatalog };
}
