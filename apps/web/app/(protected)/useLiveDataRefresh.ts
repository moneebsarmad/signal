"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase-browser-client";

const SOURCE_STATUS_POLL_MS = 5000;
const AUTO_REFRESH_COOLDOWN_MS = 60_000;
const AUTO_REFRESH_STORAGE_KEY = "signal:sycamore-live-refresh-at";
const REALTIME_EVENT_DEBOUNCE_MS = 1500;
const REALTIME_SAFETY_POLL_MS = 10_000;

type SycamoreSyncStatus = "running" | "success" | "partial" | "failed" | "canceled";
type SupabaseRealtimeStatus = "disabled" | "connecting" | "live" | "fallback";

interface SycamoreLiveStatus {
  configured: boolean;
  error?: string;
  lastSync: {
    id: string;
    completedAt: string | null;
    status: SycamoreSyncStatus;
  } | null;
}

interface UseLiveDataRefreshOptions {
  canManageSycamore: boolean;
  loadData: () => Promise<void>;
  backgroundLoadData?: () => Promise<void>;
  autoRefreshOnMount?: boolean;
  cooldownMs?: number;
  realtimeTables?: string[];
  realtimeDebounceMs?: number;
  safetyPollMs?: number;
  refreshOnFocus?: boolean;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function readLastAutoRefreshAt(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.sessionStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function markAutoRefreshStarted(now = Date.now()): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(now));
}

async function fetchSycamoreStatus(): Promise<SycamoreLiveStatus> {
  const response = await fetch("/api/sycamore/status", { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as
    | (SycamoreLiveStatus & { error?: string })
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.error || "Failed to load Sycamore status.");
  }

  return {
    configured: Boolean((body as SycamoreLiveStatus | null)?.configured),
    error: body?.error,
    lastSync: (body as SycamoreLiveStatus | null)?.lastSync ?? null
  };
}

async function runIncrementalSycamoreRefresh(): Promise<void> {
  const response = await fetch("/api/sycamore/sync/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incremental: true })
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Failed to refresh Sycamore source.");
  }

  const payload = await response.text();
  const lines = payload
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string; error?: string });
  const errorLine = lines.find((line) => line.type === "error");
  if (errorLine?.error) {
    throw new Error(errorLine.error);
  }
}

export function useLiveDataRefresh({
  canManageSycamore,
  loadData,
  backgroundLoadData,
  autoRefreshOnMount = true,
  cooldownMs = AUTO_REFRESH_COOLDOWN_MS,
  realtimeTables = [],
  realtimeDebounceMs = REALTIME_EVENT_DEBOUNCE_MS,
  safetyPollMs = REALTIME_SAFETY_POLL_MS,
  refreshOnFocus = true
}: UseLiveDataRefreshOptions) {
  const [isRefreshingSource, setIsRefreshingSource] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SycamoreLiveStatus | null>(null);
  const [isRealtimeRefreshing, setIsRealtimeRefreshing] = useState(false);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<SupabaseRealtimeStatus>(
    realtimeTables.length > 0 ? "connecting" : "disabled"
  );
  const [lastRealtimeEventAt, setLastRealtimeEventAt] = useState<string | null>(null);
  const autoRefreshStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const loadDataRef = useRef(loadData);
  const backgroundLoadDataRef = useRef(backgroundLoadData ?? loadData);
  const realtimeReloadTimerRef = useRef<number | null>(null);
  const realtimeReloadInFlightRef = useRef(false);
  const realtimeReloadQueuedRef = useRef(false);
  const hiddenChangePendingRef = useRef(false);

  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  useEffect(() => {
    backgroundLoadDataRef.current = backgroundLoadData ?? loadData;
  }, [backgroundLoadData, loadData]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (realtimeReloadTimerRef.current !== null) {
        window.clearTimeout(realtimeReloadTimerRef.current);
      }
    };
  }, []);

  const loadSourceStatus = useCallback(async () => {
    const status = await fetchSycamoreStatus();
    if (mountedRef.current) {
      setSourceStatus(status);
    }
    return status;
  }, []);

  const reloadPageData = useCallback(async (options?: { background?: boolean }) => {
    const reload = options?.background ? backgroundLoadDataRef.current : loadDataRef.current;
    await reload();
  }, []);

  const runPassiveReload = useCallback(async () => {
    if (mountedRef.current) {
      setIsRealtimeRefreshing(true);
      setRealtimeError(null);
    }

    try {
      await reloadPageData({ background: true });
    } catch (error) {
      if (mountedRef.current) {
        setRealtimeError(getErrorMessage(error, "Failed to refresh live Supabase data."));
      }
    } finally {
      if (mountedRef.current) {
        setIsRealtimeRefreshing(false);
      }
    }
  }, [reloadPageData]);

  const runRealtimeReload = useCallback(async () => {
    if (realtimeReloadInFlightRef.current) {
      realtimeReloadQueuedRef.current = true;
      return;
    }

    realtimeReloadInFlightRef.current = true;
    if (mountedRef.current) {
      setIsRealtimeRefreshing(true);
      setRealtimeError(null);
    }

    try {
      await reloadPageData({ background: true });
    } catch (error) {
      if (mountedRef.current) {
        setRealtimeError(getErrorMessage(error, "Failed to refresh live Supabase data."));
      }
    } finally {
      realtimeReloadInFlightRef.current = false;
      if (mountedRef.current) {
        setIsRealtimeRefreshing(false);
      }

      if (realtimeReloadQueuedRef.current) {
        realtimeReloadQueuedRef.current = false;
        if (mountedRef.current) {
          realtimeReloadTimerRef.current = window.setTimeout(() => {
            realtimeReloadTimerRef.current = null;
            void runRealtimeReload();
          }, realtimeDebounceMs);
        }
      }
    }
  }, [realtimeDebounceMs, reloadPageData]);

  const queueRealtimeReload = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    setLastRealtimeEventAt(new Date().toISOString());

    if (document.visibilityState !== "visible") {
      hiddenChangePendingRef.current = true;
      return;
    }

    if (realtimeReloadTimerRef.current !== null) {
      realtimeReloadQueuedRef.current = true;
      return;
    }

    realtimeReloadTimerRef.current = window.setTimeout(() => {
      realtimeReloadTimerRef.current = null;
      void runRealtimeReload();
    }, realtimeDebounceMs);
  }, [realtimeDebounceMs, runRealtimeReload]);

  const pollUntilSourceSettles = useCallback(async () => {
    setIsRefreshingSource(true);
    setRefreshError(null);

    try {
      while (mountedRef.current) {
        const status = await loadSourceStatus();
        if (status.lastSync?.status !== "running") {
          break;
        }
        await wait(SOURCE_STATUS_POLL_MS);
      }

      if (mountedRef.current) {
        await reloadPageData({ background: true });
      }
    } catch (error) {
      if (mountedRef.current) {
        setRefreshError(getErrorMessage(error, "Failed to refresh the live Sycamore source."));
      }
    } finally {
      if (mountedRef.current) {
        setIsRefreshingSource(false);
      }
    }
  }, [loadSourceStatus, reloadPageData]);

  const refreshData = useCallback(async () => {
    if (!canManageSycamore) {
      try {
        await reloadPageData();
      } catch (error) {
        setRefreshError(getErrorMessage(error, "Failed to refresh page data."));
      }
      return;
    }

    let status: SycamoreLiveStatus;
    try {
      status = await loadSourceStatus();
    } catch (error) {
      setRefreshError(getErrorMessage(error, "Failed to load Sycamore status."));
      try {
        await reloadPageData();
      } catch (reloadError) {
        setRefreshError(getErrorMessage(reloadError, "Failed to refresh page data."));
      }
      return;
    }

    if (!status.configured) {
      try {
        await reloadPageData();
      } catch (error) {
        setRefreshError(getErrorMessage(error, "Failed to refresh page data."));
      }
      return;
    }

    if (status.lastSync?.status === "running") {
      await pollUntilSourceSettles();
      return;
    }

    setIsRefreshingSource(true);
    setRefreshError(null);
    markAutoRefreshStarted();

    try {
      await runIncrementalSycamoreRefresh();
      await loadSourceStatus();
      await reloadPageData({ background: true });
    } catch (error) {
      setRefreshError(getErrorMessage(error, "Failed to refresh the live Sycamore source."));
      await reloadPageData({ background: true });
    } finally {
      if (mountedRef.current) {
        setIsRefreshingSource(false);
      }
    }
  }, [canManageSycamore, loadSourceStatus, pollUntilSourceSettles, reloadPageData]);

  useEffect(() => {
    if (!canManageSycamore) {
      return;
    }

    let cancelled = false;

    async function initialize() {
      try {
        const status = await loadSourceStatus();
        if (cancelled || !mountedRef.current) {
          return;
        }

        if (status.lastSync?.status === "running") {
          await pollUntilSourceSettles();
          return;
        }

        if (!autoRefreshOnMount || autoRefreshStartedRef.current || !status.configured) {
          return;
        }

        const lastAutoRefreshAt = readLastAutoRefreshAt();
        if (lastAutoRefreshAt !== null && Date.now() - lastAutoRefreshAt < cooldownMs) {
          return;
        }

        autoRefreshStartedRef.current = true;
        await refreshData();
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          setRefreshError(getErrorMessage(error, "Failed to initialize live data refresh."));
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [autoRefreshOnMount, canManageSycamore, cooldownMs, loadSourceStatus, pollUntilSourceSettles, refreshData]);

  useEffect(() => {
    if (!realtimeTables.length) {
      setRealtimeStatus("disabled");
      setRealtimeError(null);
      return;
    }

    let isActive = true;
    const client = createSupabaseBrowserClient();

    if (!client) {
      setRealtimeStatus("fallback");
      return;
    }

    setRealtimeStatus("connecting");
    const channel = realtimeTables.reduce(
      (currentChannel, table) =>
        currentChannel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => {
            if (!isActive || !mountedRef.current) {
              return;
            }
            queueRealtimeReload();
          }
        ),
      client.channel(`signal-live:${realtimeTables.join(",")}:${Math.random().toString(36).slice(2)}`)
    );

    channel.subscribe((status) => {
      if (!isActive || !mountedRef.current) {
        return;
      }

      if (status === "SUBSCRIBED") {
        setRealtimeStatus("live");
        setRealtimeError(null);
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setRealtimeStatus("fallback");
        setRealtimeError("Supabase live updates were unavailable, so the page fell back to timed refreshes.");
        return;
      }

      if (status === "CLOSED") {
        setRealtimeStatus("fallback");
      }
    });

    return () => {
      isActive = false;
      void client.removeChannel(channel);
    };
  }, [queueRealtimeReload, realtimeTables]);

  useEffect(() => {
    if (!refreshOnFocus) {
      return;
    }

    function refreshWhenVisible() {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (hiddenChangePendingRef.current) {
        hiddenChangePendingRef.current = false;
      }

      void runPassiveReload();
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshOnFocus, runPassiveReload]);

  useEffect(() => {
    if (safetyPollMs <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void runPassiveReload();
    }, safetyPollMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [runPassiveReload, safetyPollMs]);

  return {
    isRefreshingSource,
    isRealtimeRefreshing,
    lastRealtimeEventAt,
    refreshError,
    realtimeError,
    realtimeStatus,
    refreshData,
    sourceStatus
  };
}
