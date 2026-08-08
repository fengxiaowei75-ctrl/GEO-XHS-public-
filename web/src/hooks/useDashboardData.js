import { useCallback, useEffect, useState } from "react";
import { sampleDashboard } from "../sampleData.js";
import { requestJson } from "./useRequestJson";

export function useDashboardData({ currentUser, apiDate, contentStart, contentEnd, onUnauthorized } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const userId = currentUser?.user_id;

  const loadDashboard = useCallback(
    async (options = {}) => {
      if (!userId) return;
      const isBackground = Boolean(options.background);
      if (!isBackground) {
        setLoading(true);
        setError("");
      }
      try {
        const selectedApiDate = options.apiDateOverride ?? apiDate;
        const selectedContentStart = options.contentStartOverride ?? contentStart;
        const selectedContentEnd = options.contentEndOverride ?? contentEnd;
        const params = new URLSearchParams();
        if (selectedApiDate) params.set("apiDate", selectedApiDate);
        if (selectedContentStart) params.set("contentStart", selectedContentStart);
        if (selectedContentEnd) params.set("contentEnd", selectedContentEnd);
        const query = params.toString() ? `?${params.toString()}` : "";
        const payload = await requestJson(`/api/dashboard${query}`);
        setData(payload);
      } catch (err) {
        if (err.status === 401) {
          onUnauthorized?.(null);
          setData(null);
          return;
        }
        setData((current) => current || sampleDashboard);
        if (!isBackground && !String(err.message || "").includes("Unexpected token '<'")) {
          setError(`使用样例数据预览：${err.message}`);
        }
      } finally {
        if (!isBackground) setLoading(false);
      }
    },
    [apiDate, contentEnd, contentStart, onUnauthorized, userId],
  );

  useEffect(() => {
    if (!userId) {
      setData(null);
      setLoading(false);
      return undefined;
    }
    loadDashboard();
    const timer = window.setInterval(() => loadDashboard({ background: true }), 30000);
    return () => window.clearInterval(timer);
  }, [loadDashboard, userId]);

  return { data, loading, error, setError, loadDashboard };
}
