"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCcw,
  Server,
  ShieldAlert,
  Workflow
} from "lucide-react";

import {
  Button,
  EmptyState,
  InlineAlert,
  Panel,
  SectionHeader,
  SoftPanel,
  StatCard,
  StatusBadge,
  buttonStyles,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLiveDataRefresh } from "../useLiveDataRefresh";

interface DataOpsIssue {
  id: string;
  severity: "warning" | "critical";
  title: string;
  description: string;
  href: string;
  hrefLabel: string;
  count?: number;
}

interface DataOpsSnapshot {
  generatedAt: string;
  storage: {
    mode: "supabase" | "google_sheets" | "local_file";
    label: string;
    detail: string;
  };
  parser: {
    configured: boolean;
    ok: boolean | null;
    baseUrl: string | null;
    status?: number;
    error?: string;
  };
  ingestion: {
    totalJobs: number;
    failedJobs: number;
    reviewRequiredJobs: number;
    activeJobs: number;
    flaggedRows: number;
    lastCompletedAt: string | null;
    bySource: Record<
      string,
      {
        totalJobs: number;
        failedJobs: number;
        reviewRequiredJobs: number;
        activeJobs: number;
        flaggedRows: number;
        lastCompletedAt: string | null;
      }
    >;
  };
  sycamore: {
    configured: boolean;
    baseUrl: string;
    schoolId: string | null;
    pathTemplate: string;
    totalLogs: number;
    linkedLogs: number;
    totalSyncs: number;
    failedSyncs: number;
    lastCompletedAt: string | null;
    lastSuccessfulCompletedAt: string | null;
    lastFailedAt: string | null;
    lastWindow: {
      startDate: string;
      endDate: string;
    } | null;
    lastSuccessfulWindow: {
      startDate: string;
      endDate: string;
    } | null;
    lastRecordsDiscovered: number | null;
    lastRecordsUpserted: number | null;
    lastSyncMode: "initial_backfill" | "manual_range" | "incremental" | "specific_dates" | null;
    error?: string;
  };
  review: {
    open: number;
    approved: number;
    edited: number;
    rejected: number;
  };
  backlog: {
    queuedNotifications: number;
    overdueInterventions: number;
    activeInterventions: number;
  };
  health: {
    status: "healthy" | "warning" | "critical";
    headline: string;
    summary: string;
    openIssues: number;
    criticalIssues: number;
    warningIssues: number;
    lastSuccessfulSyncAt: string | null;
    syncWarningAfterHours: number;
    syncCriticalAfterHours: number;
  };
  attentionItems: DataOpsIssue[];
  recentFailures: Array<{
    id: string;
    kind: "parse_run" | "notification";
    label: string;
    createdAt: string;
  }>;
}

function sourceLabel(sourceType: string): string {
  return sourceType === "sycamore_api" ? "Sycamore sync" : sourceType === "manual_pdf" ? "Legacy PDF import" : sourceType;
}

function formatSurfaceValue(value: string): string {
  return value.replace(/\.$/, "");
}

function summarizeEndpoint(value: string | null): string {
  if (!value) {
    return "Not configured";
  }

  const trimmed = formatSurfaceValue(value.replace(/^Project URL\s+/i, ""));

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed;
  }
}

function parserTone(parser: DataOpsSnapshot["parser"]): "neutral" | "warning" | "success" | "danger" {
  if (!parser.configured) {
    return "warning";
  }
  if (parser.ok === null) {
    return "neutral";
  }
  return parser.ok ? "success" : "danger";
}

function parserLabel(parser: DataOpsSnapshot["parser"]): string {
  if (!parser.configured) {
    return "retired";
  }
  if (parser.ok === null) {
    return "unknown";
  }
  return parser.ok ? "healthy" : "failing";
}

function healthTone(status: DataOpsSnapshot["health"]["status"]): "success" | "warning" | "danger" {
  return status === "critical" ? "danger" : status === "warning" ? "warning" : "success";
}

function issueTone(severity: DataOpsIssue["severity"]): "warning" | "danger" {
  return severity === "critical" ? "danger" : "warning";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    return value;
  }

  return new Date(epoch).toLocaleString();
}

function formatRelativeAge(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    return "Unknown";
  }

  const elapsedMs = Date.now() - epoch;
  if (elapsedMs < 60 * 60 * 1000) {
    return `${Math.max(1, Math.round(elapsedMs / (60 * 1000)))}m ago`;
  }
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    return `${Math.max(1, Math.round(elapsedMs / (60 * 60 * 1000)))}h ago`;
  }
  return `${Math.max(1, Math.round(elapsedMs / (24 * 60 * 60 * 1000)))}d ago`;
}

const DATA_OPS_REALTIME_TABLES = [
  "students",
  "guardian_contacts",
  "incidents_raw",
  "incidents_approved",
  "parse_runs",
  "review_tasks",
  "interventions",
  "notifications",
  "audit_events"
];

function DiagnosticsSurface({
  label,
  title,
  tone,
  badge,
  rows,
  footer,
  error
}: {
  label: string;
  title: string;
  tone: "info" | "warning" | "success" | "danger" | "neutral";
  badge: string;
  rows: Array<{ key: string; value: string }>;
  footer?: string;
  error?: string;
}) {
  return (
    <SoftPanel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">{label}</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{title}</h3>
        </div>
        <StatusBadge tone={tone}>{badge}</StatusBadge>
      </div>
      <dl className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-4">
            <dt className="text-[var(--color-subtle)]">{row.key}</dt>
            <dd className="max-w-[16rem] text-right font-medium text-[var(--color-ink)] break-all">{row.value}</dd>
          </div>
        ))}
      </dl>
      {footer ? <p className="text-sm leading-6 text-[var(--color-muted)]">{footer}</p> : null}
      {error ? <p className="text-sm leading-6 text-[var(--color-danger)]">{error}</p> : null}
    </SoftPanel>
  );
}

export function DataOpsClient({ canManageSycamore }: { canManageSycamore: boolean }) {
  const [data, setData] = useState<DataOpsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async (options?: { background?: boolean }) => {
    if (!options?.background) {
      setIsLoading(true);
    }
    setError(null);

    const response = await fetch("/api/data-ops/status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as DataOpsSnapshot | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Failed to load data operations status.");
      if (!options?.background) {
        setIsLoading(false);
      }
      return;
    }

    setData(body as DataOpsSnapshot);
    if (!options?.background) {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const { isRefreshingSource, refreshError, refreshData } = useLiveDataRefresh({
    canManageSycamore,
    loadData: async () => {
      await loadStatus();
    },
    backgroundLoadData: async () => {
      await loadStatus({ background: true });
    },
    realtimeTables: DATA_OPS_REALTIME_TABLES
  });

  const primaryActionHref = data?.health.openIssues ? "#needs-attention" : "#current-workload";
  const primaryActionLabel = data?.health.openIssues ? "Review issues" : "View workload";

  return (
    <div className="space-y-6">
      {error ? (
        <InlineAlert tone="danger" title="System health could not be loaded.">
          {error}
        </InlineAlert>
      ) : null}
      {refreshError ? (
        <InlineAlert tone="danger" title="Live source refresh failed.">
          {refreshError}
        </InlineAlert>
      ) : null}
      {isRefreshingSource ? (
        <InlineAlert tone="info" title="Refreshing Sycamore source.">
          System health will reload after the mirrored intake dataset catches up to the latest Sycamore source data.
        </InlineAlert>
      ) : null}

      {data ? (
        <>
          <Panel className="overflow-hidden bg-[linear-gradient(135deg,rgba(17,94,89,0.07),rgba(255,255,255,0.98)_42%,rgba(173,124,44,0.05))]">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Admin controls</p>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={healthTone(data.health.status)}>{data.health.headline}</StatusBadge>
                    <StatusBadge tone="info">{data.storage.label}</StatusBadge>
                  </div>
                </div>

                <div className="space-y-2">
                  <h1 className="font-display text-3xl text-[var(--color-ink)]">System health</h1>
                  <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                    Use this page for a quick check of syncs, backlog, and anything that needs follow-up.
                  </p>
                  <p className="max-w-3xl text-sm leading-6 text-[var(--color-ink)]">{data.health.summary}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <SoftPanel className="space-y-1.5 bg-white/80">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Last checked</p>
                    <p className="text-base font-semibold text-[var(--color-ink)]">{formatDateTime(data.generatedAt)}</p>
                    <p className="text-sm leading-6 text-[var(--color-muted)]">Snapshot time for this health check.</p>
                  </SoftPanel>
                  <SoftPanel className="space-y-1.5 bg-white/80">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Last successful sync</p>
                    <p className="text-base font-semibold text-[var(--color-ink)]">
                      {data.health.lastSuccessfulSyncAt ? formatDateTime(data.health.lastSuccessfulSyncAt) : "No successful sync yet"}
                    </p>
                    <p className="text-sm leading-6 text-[var(--color-muted)]">
                      {data.health.lastSuccessfulSyncAt
                        ? `Health warnings start after ${data.health.syncWarningAfterHours} hours without a successful sync.`
                        : "Run intake to establish the first successful sync."}
                    </p>
                  </SoftPanel>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 xl:max-w-sm xl:justify-end">
                <Link href={primaryActionHref} className={buttonStyles({ variant: data.health.openIssues ? "primary" : "secondary" })}>
                  {primaryActionLabel}
                </Link>
                <Button type="button" variant="secondary" onClick={() => void refreshData()} disabled={isLoading || isRefreshingSource}>
                  <RefreshCcw className={cn("h-4 w-4", isLoading || isRefreshingSource ? "animate-spin" : "")} />
                  {isRefreshingSource ? "Refreshing live source..." : isLoading ? "Refreshing..." : "Refresh status"}
                </Button>
              </div>
            </div>
          </Panel>

          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Last successful sync"
              value={formatRelativeAge(data.health.lastSuccessfulSyncAt)}
              description={formatDateTime(data.health.lastSuccessfulSyncAt)}
              icon={CheckCircle2}
              href="/ingestion"
              linkLabel="Open intake"
            />
            <StatCard
              label="Open issues"
              value={data.health.openIssues}
              description={
                data.health.openIssues > 0
                  ? `${data.health.criticalIssues} critical, ${data.health.warningIssues} warning.`
                  : "No action needed right now."
              }
              icon={ShieldAlert}
              href="#needs-attention"
              linkLabel="Review issues"
            />
            <StatCard
              label="Queued notifications"
              value={data.backlog.queuedNotifications}
              description="Waiting for dispatch."
              icon={BellRing}
              href="/notifications"
            />
            <StatCard
              label="Overdue interventions"
              value={data.backlog.overdueInterventions}
              description="Students who need follow-up."
              icon={Clock3}
              href="/students"
            />
          </section>

          <section id="needs-attention" className="space-y-4">
            <SectionHeader
              title="Needs attention"
              description="Only the items that require follow-up this week are listed here."
            />
            {data.attentionItems.length === 0 ? (
              <EmptyState
                title="No action needed"
                description="Core workflows look healthy. Check workload and diagnostics only if you want more detail."
              />
            ) : (
              <div className="grid gap-3">
                {data.attentionItems.map((item) => (
                  <Panel key={item.id} className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={issueTone(item.severity)}>
                          {item.severity === "critical" ? "Critical" : "Needs attention"}
                        </StatusBadge>
                        {typeof item.count === "number" ? <StatusBadge tone="neutral">{item.count} open</StatusBadge> : null}
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-lg font-semibold text-[var(--color-ink)]">{item.title}</h3>
                        <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)]">{item.description}</p>
                      </div>
                    </div>
                    <Link href={item.href} className={buttonStyles({ variant: "secondary", className: "shrink-0" })}>
                      {item.hrefLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Panel>
                ))}
              </div>
            )}
          </section>

          <section id="current-workload" className="space-y-4">
            <SectionHeader
              title="Current workload"
              description="Use these counts for routine follow-up, not emergency troubleshooting."
            />
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Review-required imports"
                value={data.ingestion.reviewRequiredJobs}
                description="Legacy/manual jobs still waiting for review."
                icon={Workflow}
                href="/ingestion"
              />
              <StatCard
                label="Active interventions"
                value={data.backlog.activeInterventions}
                description="Students currently carrying intervention work."
                icon={ShieldAlert}
                href="/students"
              />
              <StatCard
                label="Legacy flagged rows"
                value={data.ingestion.flaggedRows}
                description="Historical flagged rows that may still need cleanup."
                icon={AlertCircle}
                href="/ingestion"
              />
              <StatCard
                label="Recent failures"
                value={data.recentFailures.length}
                description="Recent sync or notification failures surfaced in this environment."
                icon={Server}
                href="#advanced-diagnostics"
                linkLabel="Open diagnostics"
              />
            </div>
          </section>

          <details id="advanced-diagnostics" className="group rounded-[1.5rem] border border-[var(--color-line)] bg-white/95 p-4 shadow-card backdrop-blur sm:p-5">
            <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Diagnostics</p>
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Advanced diagnostics</h2>
                <p className="text-sm leading-6 text-[var(--color-muted)]">
                  Expand this section only when you need environment details, historical imports, or the recent failure log.
                </p>
              </div>
              <StatusBadge tone="neutral" className="group-open:hidden">
                Show details
              </StatusBadge>
              <StatusBadge tone="info" className="hidden group-open:inline-flex">
                Hide details
              </StatusBadge>
            </summary>

            <div className="mt-5 space-y-5">
              <section className="space-y-4">
                <SectionHeader
                  title="System connections"
                  description="Configuration and source targets used by the current environment."
                />
                <div className="grid gap-3 lg:grid-cols-3">
                  <DiagnosticsSurface
                    label="Storage"
                    title={data.storage.label}
                    tone="info"
                    badge={data.storage.mode.replace(/_/g, " ")}
                    rows={[
                      { key: "Endpoint", value: summarizeEndpoint(data.storage.detail) },
                      { key: "Detail", value: formatSurfaceValue(data.storage.detail) }
                    ]}
                  />
                  <DiagnosticsSurface
                    label="Legacy parser"
                    title="PDF lane"
                    tone={parserTone(data.parser)}
                    badge={parserLabel(data.parser)}
                    rows={[
                      {
                        key: "Host",
                        value: data.parser.configured ? summarizeEndpoint(data.parser.baseUrl) : "Retired in this environment"
                      },
                      {
                        key: "Status",
                        value: !data.parser.configured
                          ? "Inactive"
                          : data.parser.ok === null
                            ? "No health probe recorded"
                            : data.parser.ok
                              ? "Healthy"
                              : `Failed${data.parser.status ? ` (${data.parser.status})` : ""}`
                      }
                    ]}
                    footer={
                      !data.parser.configured
                        ? "Kept only for historical context. Active intake runs through Sycamore sync."
                        : data.parser.error || undefined
                    }
                  />
                  <DiagnosticsSurface
                    label="Sycamore"
                    title="Live source target"
                    tone={data.sycamore.configured ? "success" : "warning"}
                    badge={data.sycamore.configured ? "configured" : "not configured"}
                    rows={[
                      { key: "Host", value: summarizeEndpoint(data.sycamore.baseUrl) },
                      { key: "School", value: data.sycamore.schoolId ? `#${data.sycamore.schoolId}` : "Missing" },
                      {
                        key: "Last window",
                        value: data.sycamore.lastWindow
                          ? `${data.sycamore.lastWindow.startDate} to ${data.sycamore.lastWindow.endDate}`
                          : "No sync window"
                      }
                    ]}
                    footer={`Path ${data.sycamore.pathTemplate}`}
                    error={data.sycamore.error}
                  />
                </div>
              </section>

              <section className="space-y-4">
                <SectionHeader
                  title="Operational details"
                  description="Useful when investigating sync quality or backlog trends."
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  <SoftPanel className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Sycamore sync</p>
                        <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">Latest run details</h3>
                      </div>
                      <StatusBadge tone={healthTone(data.health.status)}>{data.health.headline}</StatusBadge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Last successful sync</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                          {formatDateTime(data.sycamore.lastSuccessfulCompletedAt)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Last completed sync</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                          {formatDateTime(data.sycamore.lastCompletedAt)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Sync mode</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                          {data.sycamore.lastSyncMode ? data.sycamore.lastSyncMode.replace(/_/g, " ") : "No runs yet"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Failed syncs</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.sycamore.failedSyncs}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Discovered</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.sycamore.lastRecordsDiscovered ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Upserted</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.sycamore.lastRecordsUpserted ?? 0}</p>
                      </div>
                    </div>
                  </SoftPanel>

                  <SoftPanel className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">Workflow totals</p>
                        <h3 className="mt-2 text-lg font-semibold text-[var(--color-ink)]">Queue and review counts</h3>
                      </div>
                      <Database className="h-4 w-4 text-[var(--color-primary)]" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Open review tasks</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.review.open}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Approved</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.review.approved}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Edited</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.review.edited}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Rejected</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.review.rejected}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Mirrored logs</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                          {data.sycamore.linkedLogs} / {data.sycamore.totalLogs}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">Active parse jobs</p>
                        <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">{data.ingestion.activeJobs}</p>
                      </div>
                    </div>
                  </SoftPanel>
                </div>
              </section>

              {Object.keys(data.ingestion.bySource).length > 0 ? (
                <section className="space-y-4">
                  <SectionHeader
                    title="Past import activity"
                    description="Historical job counts by source for audit and cleanup visibility."
                  />
                  <div className={tableShellClassName}>
                    <div className="overflow-x-auto">
                      <table className={tableClassName}>
                        <thead>
                          <tr>
                            <th className={tableHeadCellClassName}>Source</th>
                            <th className={tableHeadCellClassName}>Last completed</th>
                            <th className={tableHeadCellClassName}>Jobs</th>
                            <th className={tableHeadCellClassName}>Failed</th>
                            <th className={tableHeadCellClassName}>Review</th>
                            <th className={tableHeadCellClassName}>Flagged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-line)]">
                          {Object.entries(data.ingestion.bySource).map(([key, summary]) => (
                            <tr key={key}>
                              <td className={tableCellClassName}>{sourceLabel(key)}</td>
                              <td className={tableCellClassName}>{formatDateTime(summary.lastCompletedAt)}</td>
                              <td className={tableCellClassName}>{summary.totalJobs}</td>
                              <td className={tableCellClassName}>{summary.failedJobs}</td>
                              <td className={tableCellClassName}>{summary.reviewRequiredJobs}</td>
                              <td className={tableCellClassName}>{summary.flaggedRows}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="space-y-4">
                <SectionHeader
                  title="Failure log"
                  description="Recent sync and notification failures retained for troubleshooting."
                />
                {data.recentFailures.length === 0 ? (
                  <EmptyState
                    title="No recent failures"
                    description="No recent Sycamore sync issues or failed notifications are currently visible in this environment."
                  />
                ) : (
                  <div className={tableShellClassName}>
                    <div className="overflow-x-auto">
                      <table className={tableClassName}>
                        <thead>
                          <tr>
                            <th className={tableHeadCellClassName}>Time</th>
                            <th className={tableHeadCellClassName}>Kind</th>
                            <th className={tableHeadCellClassName}>Label</th>
                            <th className={tableHeadCellClassName}>Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-line)]">
                          {data.recentFailures.map((failure) => (
                            <tr key={failure.id}>
                              <td className={tableCellClassName}>{formatDateTime(failure.createdAt)}</td>
                              <td className={tableCellClassName}>
                                <StatusBadge tone={failure.kind === "parse_run" ? "danger" : "warning"}>
                                  {failure.kind === "parse_run" ? "legacy import" : failure.kind.replace(/_/g, " ")}
                                </StatusBadge>
                              </td>
                              <td className={tableCellClassName}>{failure.label}</td>
                              <td className={tableCellClassName}>
                                <Link
                                  href={failure.kind === "parse_run" ? "/ingestion" : "/notifications"}
                                  className="font-semibold text-[var(--color-primary)] transition hover:text-[var(--color-primary-strong)]"
                                >
                                  Open
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
