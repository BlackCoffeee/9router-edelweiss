"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import {
  parseQuotaData,
  getConnectionLabel,
  formatFreebucksHeader,
} from "./ProviderLimits/utils";
import QuotaTable from "./ProviderLimits/QuotaTable";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;
const fmtRequests = (n) => String(n || 0);

const VIEW_MODES = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "cost", label: "Cost" },
  { value: "quota", label: "Quota" },
];

const VIEW_CONFIG = {
  tokens:   { dataKey: "tokens",   color: "#6366f1", gradId: "gradTokens",   formatter: fmtTokens,   label: "Tokens" },
  requests: { dataKey: "requests", color: "#14b8a6", gradId: "gradRequests", formatter: fmtRequests, label: "Requests" },
  cost:     { dataKey: "cost",     color: "#f59e0b", gradId: "gradCost",     formatter: fmtCost,     label: "Cost" },
};

const USAGE_SUPPORTED = new Set(USAGE_SUPPORTED_PROVIDERS);
const AUTO_REFRESH_ENABLED_KEY = "usageChartQuotaAutoRefresh";
const AUTO_REFRESH_SECONDS_KEY = "usageChartQuotaAutoRefreshSeconds";
const VIEW_MODE_STORAGE_KEY = "usageChartViewMode";
const QUOTA_PROVIDER_STORAGE_KEY = "usageChartQuotaProvider";
const DEFAULT_AUTO_REFRESH_SECONDS = 60;
const MIN_AUTO_REFRESH_SECONDS = 10;
const MAX_AUTO_REFRESH_SECONDS = 3600;
const VALID_VIEW_MODES = new Set(VIEW_MODES.map((m) => m.value));

function readStoredViewMode() {
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored && VALID_VIEW_MODES.has(stored)) return stored;
  } catch { /* ignore */ }
  return "tokens";
}

function readStoredQuotaProvider() {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(QUOTA_PROVIDER_STORAGE_KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  return "all";
}

function clampRefreshSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AUTO_REFRESH_SECONDS;
  return Math.min(MAX_AUTO_REFRESH_SECONDS, Math.max(MIN_AUTO_REFRESH_SECONDS, Math.round(n)));
}

function isUsableQuotaRow(quota) {
  if (!quota || quota.name === "error") return false;
  return true;
}

export default function UsageChart({ period = "7d", providers = [] }) {
  const [data, setData] = useState([]);
  const [quotaCards, setQuotaCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [viewMode, setViewMode] = useState("tokens");
  const [quotaProvider, setQuotaProvider] = useState(readStoredQuotaProvider);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_AUTO_REFRESH_SECONDS);
  const [secondsInput, setSecondsInput] = useState(String(DEFAULT_AUTO_REFRESH_SECONDS));
  const [countdown, setCountdown] = useState(DEFAULT_AUTO_REFRESH_SECONDS);
  const [editingInterval, setEditingInterval] = useState(true);
  const [hasHydratedAutoRefresh, setHasHydratedAutoRefresh] = useState(false);
  const [hasHydratedViewMode, setHasHydratedViewMode] = useState(false);
  const refreshIntervalRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const fetchQuotaSnapshotRef = useRef(null);

  const quotaProviderOptions = useMemo(() => {
    const ids = [...new Set(
      providers
        .map((p) => p.provider)
        .filter((id) => id && USAGE_SUPPORTED.has(id)),
    )].sort();
    return ids;
  }, [providers]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  const fetchQuotaSnapshot = useCallback(async () => {
    if (quotaProviderOptions.length === 0) {
      setQuotaCards([]);
      return;
    }

    setQuotaLoading(true);
    try {
      const allowed = new Set(
        quotaProvider === "all" ? quotaProviderOptions : [quotaProvider],
      );

      const providersRes = await fetch("/api/providers");
      if (!providersRes.ok) {
        setQuotaCards([]);
        return;
      }
      const providersJson = await providersRes.json();
      const connections = (providersJson.connections || []).filter(
        (c) => c.isActive !== false && allowed.has(c.provider),
      );

      const cards = await Promise.all(
        connections.map(async (connection) => {
          const label = getConnectionLabel(connection) || connection.provider;
          try {
            const res = await fetch(`/api/usage/${connection.id}`);
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              return {
                connection,
                label,
                quotas: [],
                message: null,
                error: errBody.error || errBody.message || `HTTP ${res.status}`,
                raw: null,
              };
            }
            const data = await res.json();
            const quotas = parseQuotaData(connection.provider, data)
              .filter(isUsableQuotaRow);
            return {
              connection,
              label,
              quotas,
              message: data.message || null,
              error: null,
              raw: data,
            };
          } catch (e) {
            return {
              connection,
              label,
              quotas: [],
              message: null,
              error: e.message || "Failed to load",
              raw: null,
            };
          }
        }),
      );

      setQuotaCards(cards);
    } catch (e) {
      console.error("Failed to fetch quota snapshot:", e);
      setQuotaCards([]);
    } finally {
      setQuotaLoading(false);
    }
  }, [quotaProvider, quotaProviderOptions]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (viewMode !== "quota") return;
    if (quotaProvider !== "all" && quotaProviderOptions.length > 0 && !quotaProviderOptions.includes(quotaProvider)) {
      setQuotaProvider("all");
      return;
    }
    fetchQuotaSnapshot();
  }, [viewMode, fetchQuotaSnapshot, quotaProvider, quotaProviderOptions]);

  useEffect(() => {
    fetchQuotaSnapshotRef.current = fetchQuotaSnapshot;
  }, [fetchQuotaSnapshot]);

  useEffect(() => {
    setViewMode(readStoredViewMode());
    setHasHydratedViewMode(true);
    try {
      const enabled = window.localStorage.getItem(AUTO_REFRESH_ENABLED_KEY);
      const seconds = window.localStorage.getItem(AUTO_REFRESH_SECONDS_KEY);
      const wasEnabled = enabled === "true";
      if (enabled != null) setAutoRefresh(wasEnabled);
      if (seconds != null) {
        const clamped = clampRefreshSeconds(seconds);
        setRefreshSeconds(clamped);
        setSecondsInput(String(clamped));
        setCountdown(clamped);
      }
      // Previously saved interval → show countdown, not the editor.
      if (wasEnabled || seconds != null) setEditingInterval(false);
    } catch { /* ignore */ }
    setHasHydratedAutoRefresh(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedViewMode) return;
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch { /* ignore */ }
  }, [viewMode, hasHydratedViewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(QUOTA_PROVIDER_STORAGE_KEY, quotaProvider);
    } catch { /* ignore */ }
  }, [quotaProvider]);

  useEffect(() => {
    if (!hasHydratedAutoRefresh) return;
    try {
      window.localStorage.setItem(AUTO_REFRESH_ENABLED_KEY, String(autoRefresh));
      window.localStorage.setItem(AUTO_REFRESH_SECONDS_KEY, String(refreshSeconds));
    } catch { /* ignore */ }
  }, [autoRefresh, refreshSeconds, hasHydratedAutoRefresh]);

  useEffect(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    const active = viewMode === "quota" && autoRefresh && hasHydratedAutoRefresh;
    if (!active) return undefined;

    setCountdown(refreshSeconds);
    refreshIntervalRef.current = setInterval(() => {
      fetchQuotaSnapshotRef.current?.();
      setCountdown(refreshSeconds);
    }, refreshSeconds * 1000);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? refreshSeconds : prev - 1));
    }, 1000);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      refreshIntervalRef.current = null;
      countdownIntervalRef.current = null;
    };
  }, [viewMode, autoRefresh, refreshSeconds, hasHydratedAutoRefresh]);

  const saveRefreshInterval = () => {
    const clamped = clampRefreshSeconds(secondsInput);
    setRefreshSeconds(clamped);
    setSecondsInput(String(clamped));
    setCountdown(clamped);
    setAutoRefresh(true);
    setEditingInterval(false);
  };

  const cfg = VIEW_CONFIG[viewMode] || VIEW_CONFIG.tokens;
  const isQuota = viewMode === "quota";
  const chartLoading = isQuota ? quotaLoading : loading;
  const hasUsageData = data.some((d) => (d[cfg.dataKey] || 0) > 0);
  const hasQuotaCards = quotaCards.length > 0;
  const emptyMessage = isQuota
    ? (quotaProviderOptions.length === 0
      ? "No quota-capable providers on Usage"
      : "No quota data for selected provider")
    : "No data for this period";

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="grid w-full items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start"
          style={{ gridTemplateColumns: `repeat(${VIEW_MODES.length}, minmax(0, 1fr))` }}
        >
          {VIEW_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setViewMode(m.value)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === m.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {isQuota && quotaProviderOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={quotaProvider}
              onChange={(e) => setQuotaProvider(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
              style={{ colorScheme: "auto" }}
              aria-label="Filter quota by provider"
            >
              <option value="all">All selected providers</option>
              {quotaProviderOptions.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setAutoRefresh((prev) => !prev)}
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
            >
              <span
                className={`material-symbols-outlined text-[14px] ${
                  autoRefresh ? "text-primary" : "text-text-muted"
                }`}
              >
                {autoRefresh ? "toggle_on" : "toggle_off"}
              </span>
              <span className="hidden text-text-primary sm:inline">Auto</span>
            </button>

            {editingInterval ? (
              <>
                <label className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs text-text-muted">
                  <span className="hidden sm:inline">every</span>
                  <input
                    type="number"
                    min={MIN_AUTO_REFRESH_SECONDS}
                    max={MAX_AUTO_REFRESH_SECONDS}
                    value={secondsInput}
                    onChange={(e) => setSecondsInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRefreshInterval();
                    }}
                    className="w-14 bg-transparent text-center text-xs font-medium text-text-primary tabular-nums outline-none"
                    aria-label="Auto-refresh interval in seconds"
                    title={`Refresh every N seconds (${MIN_AUTO_REFRESH_SECONDS}–${MAX_AUTO_REFRESH_SECONDS})`}
                  />
                  <span>s</span>
                </label>
                <button
                  type="button"
                  onClick={saveRefreshInterval}
                  className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                  title="Save interval and start countdown"
                >
                  <span className="material-symbols-outlined text-[14px]">save</span>
                  <span>Simpan</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSecondsInput(String(refreshSeconds));
                  setEditingInterval(true);
                }}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                title="Click to edit interval"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "bg-primary animate-pulse" : "bg-text-muted"}`} />
                <span className="text-text-muted">next</span>
                <span className="font-medium text-text-primary tabular-nums">
                  {autoRefresh ? `${countdown}s` : `${refreshSeconds}s`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={fetchQuotaSnapshot}
              disabled={quotaLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              title="Refresh quotas"
              aria-label="Refresh quotas"
            >
              <span className={`material-symbols-outlined text-[18px] text-text-muted ${quotaLoading ? "animate-spin" : ""}`}>
                refresh
              </span>
            </button>
          </div>
        )}
      </div>

      {chartLoading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : isQuota ? (
        !hasQuotaCards ? (
          <div className="h-48 flex items-center justify-center text-text-muted text-sm">{emptyMessage}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {quotaCards.map((card) => (
              <div
                key={card.connection.id}
                className="min-w-0 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
                  <ProviderIcon
                    src={`/providers/${card.connection.provider}.png`}
                    alt={card.connection.provider}
                    size={20}
                    fallbackText={(card.connection.provider || "?").slice(0, 2).toUpperCase()}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {card.label}
                    </div>
                    <div className="truncate text-[10px] text-text-muted">
                      {card.connection.provider}
                      {card.connection.email && card.connection.email !== card.label
                        ? ` · ${card.connection.email}`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="px-2 py-1.5">
                  {card.raw?.freebucks && !card.error && (
                    <div className="mb-1.5 rounded-md bg-black/[0.03] px-2 py-1.5 text-[10px] leading-relaxed text-text-muted dark:bg-white/[0.03]">
                      {formatFreebucksHeader(card.raw.freebucks)}
                    </div>
                  )}
                  {card.error ? (
                    <div className="py-5 text-center">
                      <span className="material-symbols-outlined text-[28px] text-red-500">error</span>
                      <p className="mt-1.5 text-xs text-text-muted">{card.error}</p>
                    </div>
                  ) : card.message && card.quotas.length === 0 ? (
                    <div className="py-5 text-center">
                      <p className="text-xs text-text-muted">{card.message}</p>
                    </div>
                  ) : card.quotas.length === 0 ? (
                    <div className="py-5 text-center text-xs text-text-muted">No quotas</div>
                  ) : (
                    <QuotaTable quotas={card.quotas} compact sortMode="default" />
                  )}
                  {card.message && card.quotas.length > 0 && (
                    <p className="mt-2 px-1 text-[10px] leading-relaxed text-text-muted">
                      {card.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : !hasUsageData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">{emptyMessage}</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={cfg.formatter}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => [cfg.formatter(value), cfg.label]}
            />
            <Area
              type="monotone"
              dataKey={cfg.dataKey}
              stroke={cfg.color}
              strokeWidth={2}
              fill={`url(#${cfg.gradId})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  providers: PropTypes.arrayOf(PropTypes.object),
};
