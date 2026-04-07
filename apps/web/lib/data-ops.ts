import { resolve } from "node:path";

import type { StorageRepositories } from "@syc/storage";

import { buildSycamoreDataOpsSummary } from "@/lib/sycamore-direct-sync";
import type { SycamoreStore } from "@/lib/sycamore-direct-store";

const SYNC_WARNING_AFTER_HOURS = 72;
const SYNC_CRITICAL_AFTER_HOURS = 168;
const QUEUED_NOTIFICATIONS_WARNING_COUNT = 10;

export interface DataOpsIssue {
  id: string;
  severity: "warning" | "critical";
  title: string;
  description: string;
  href: string;
  hrefLabel: string;
  count?: number;
}

export interface DataOpsSnapshot {
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

function hasSheetsEnv(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

function hasSupabaseEnv(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function localStoragePath(): string {
  const configured = process.env.LOCAL_STORAGE_FILE?.trim();
  if (configured) {
    return resolve(configured);
  }
  return resolve(process.cwd(), ".local", "web-storage.json");
}

function sycamoreBaseUrl(): string {
  return process.env.SYCAMORE_API_BASE_URL?.trim() || "https://app.sycamoreschool.com/api/v1";
}

function sycamorePathTemplate(): string {
  return process.env.SYCAMORE_DISCIPLINE_PATH_TEMPLATE?.trim() || "/School/{schoolId}/Discipline";
}

function summarizeParseRuns(parseRuns: Awaited<ReturnType<StorageRepositories["parseRuns"]["list"]>>) {
  const bySource: DataOpsSnapshot["ingestion"]["bySource"] = {};

  for (const parseRun of parseRuns) {
    const summary =
      bySource[parseRun.sourceType] ??
      {
        totalJobs: 0,
        failedJobs: 0,
        reviewRequiredJobs: 0,
        activeJobs: 0,
        flaggedRows: 0,
        lastCompletedAt: null
      };

    summary.totalJobs += 1;
    summary.failedJobs += parseRun.status === "failed" ? 1 : 0;
    summary.reviewRequiredJobs += parseRun.status === "review_required" ? 1 : 0;
    summary.activeJobs += parseRun.status === "pending" || parseRun.status === "processing" ? 1 : 0;
    summary.flaggedRows += parseRun.rowsFlagged;
    if (parseRun.completedAt) {
      const currentEpoch = Date.parse(summary.lastCompletedAt ?? "");
      const nextEpoch = Date.parse(parseRun.completedAt);
      if (summary.lastCompletedAt === null || (!Number.isNaN(nextEpoch) && nextEpoch > currentEpoch)) {
        summary.lastCompletedAt = parseRun.completedAt;
      }
    }
    bySource[parseRun.sourceType] = summary;
  }

  return bySource;
}

async function probeParser(): Promise<DataOpsSnapshot["parser"]> {
  return {
    configured: false,
    ok: null,
    baseUrl: null
  };
}

function elapsedHoursSince(value: string | null, now: Date): number | null {
  if (!value) {
    return null;
  }

  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    return null;
  }

  return Math.max(0, (now.getTime() - epoch) / (60 * 60 * 1000));
}

function buildAttentionItems(input: {
  now: Date;
  sycamore: DataOpsSnapshot["sycamore"];
  reviewRequiredJobs: number;
  queuedNotifications: number;
  overdueInterventions: number;
  failedNotificationCount: number;
}): DataOpsIssue[] {
  const { now, sycamore, reviewRequiredJobs, queuedNotifications, overdueInterventions, failedNotificationCount } = input;
  const items: DataOpsIssue[] = [];
  const lastSuccessfulAgeHours = elapsedHoursSince(sycamore.lastSuccessfulCompletedAt, now);

  if (sycamore.error) {
    items.push({
      id: "sycamore-sync-error",
      severity: "critical",
      title: "Sycamore sync reported an error",
      description: sycamore.error,
      href: "/ingestion",
      hrefLabel: "Open intake"
    });
  } else if (!sycamore.configured) {
    items.push({
      id: "sycamore-not-configured",
      severity: "warning",
      title: "Sycamore is not configured",
      description: "Live intake cannot run until the Sycamore connection is configured.",
      href: "/ingestion",
      hrefLabel: "Open intake"
    });
  } else if (sycamore.totalSyncs === 0) {
    items.push({
      id: "sycamore-no-syncs",
      severity: "warning",
      title: "No Sycamore sync has run yet",
      description: "Run the first sync so the app can mirror roster and discipline data.",
      href: "/ingestion",
      hrefLabel: "Open intake"
    });
  } else if (!sycamore.lastSuccessfulCompletedAt) {
    items.push({
      id: "sycamore-no-success",
      severity: "critical",
      title: "No successful Sycamore sync is recorded",
      description: "The app has attempted a sync, but no successful run has completed yet.",
      href: "/ingestion",
      hrefLabel: "Open intake"
    });
  } else if (lastSuccessfulAgeHours !== null && lastSuccessfulAgeHours >= SYNC_CRITICAL_AFTER_HOURS) {
    items.push({
      id: "sycamore-sync-critical-stale",
      severity: "critical",
      title: "Sycamore sync is stale",
      description: `No successful sync has completed within the last ${SYNC_CRITICAL_AFTER_HOURS} hours.`,
      href: "/ingestion",
      hrefLabel: "Open intake"
    });
  } else if (lastSuccessfulAgeHours !== null && lastSuccessfulAgeHours >= SYNC_WARNING_AFTER_HOURS) {
    items.push({
      id: "sycamore-sync-warning-stale",
      severity: "warning",
      title: "Sycamore sync needs review",
      description: `No successful sync has completed within the last ${SYNC_WARNING_AFTER_HOURS} hours.`,
      href: "/ingestion",
      hrefLabel: "Open intake"
    });
  } else if (sycamore.failedSyncs > 0) {
    items.push({
      id: "sycamore-failed-syncs",
      severity: "warning",
      title: "Failed Sycamore syncs need review",
      description: `${sycamore.failedSyncs} sync${sycamore.failedSyncs === 1 ? "" : "s"} failed and should be reviewed.`,
      href: "/ingestion",
      hrefLabel: "Open intake",
      count: sycamore.failedSyncs
    });
  }

  if (failedNotificationCount > 0) {
    items.push({
      id: "notification-failures",
      severity: "warning",
      title: "Notification deliveries failed",
      description: `${failedNotificationCount} notification${failedNotificationCount === 1 ? "" : "s"} failed and should be retried or reviewed.`,
      href: "/notifications",
      hrefLabel: "Open notifications",
      count: failedNotificationCount
    });
  }

  if (queuedNotifications >= QUEUED_NOTIFICATIONS_WARNING_COUNT) {
    items.push({
      id: "notification-backlog",
      severity: "warning",
      title: "Notification queue is building up",
      description: `${queuedNotifications} notifications are still queued for delivery.`,
      href: "/notifications",
      hrefLabel: "Open notifications",
      count: queuedNotifications
    });
  }

  if (overdueInterventions > 0) {
    items.push({
      id: "overdue-interventions",
      severity: "warning",
      title: "Interventions are overdue",
      description: `${overdueInterventions} intervention${overdueInterventions === 1 ? "" : "s"} need follow-up.`,
      href: "/students",
      hrefLabel: "Open students",
      count: overdueInterventions
    });
  }

  if (reviewRequiredJobs > 0) {
    items.push({
      id: "review-required-imports",
      severity: "warning",
      title: "Imports still require review",
      description: `${reviewRequiredJobs} import job${reviewRequiredJobs === 1 ? "" : "s"} are waiting for review.`,
      href: "/ingestion",
      hrefLabel: "Open intake",
      count: reviewRequiredJobs
    });
  }

  return items;
}

function buildHealthSummary(
  attentionItems: DataOpsIssue[],
  lastSuccessfulSyncAt: string | null
): DataOpsSnapshot["health"] {
  const criticalIssues = attentionItems.filter((item) => item.severity === "critical").length;
  const warningIssues = attentionItems.filter((item) => item.severity === "warning").length;
  const summaryFragments = [
    criticalIssues > 0 ? `${criticalIssues} critical issue${criticalIssues === 1 ? "" : "s"}` : null,
    warningIssues > 0 ? `${warningIssues} warning${warningIssues === 1 ? "" : "s"}` : null
  ].filter((fragment): fragment is string => Boolean(fragment));

  if (criticalIssues > 0) {
    return {
      status: "critical",
      headline: "Critical issues detected",
      summary: `${summaryFragments.join(" and ")} need follow-up.`,
      openIssues: attentionItems.length,
      criticalIssues,
      warningIssues,
      lastSuccessfulSyncAt,
      syncWarningAfterHours: SYNC_WARNING_AFTER_HOURS,
      syncCriticalAfterHours: SYNC_CRITICAL_AFTER_HOURS
    };
  }

  if (warningIssues > 0) {
    return {
      status: "warning",
      headline: "Needs attention",
      summary: `${warningIssues} item${warningIssues === 1 ? "" : "s"} should be reviewed this week.`,
      openIssues: attentionItems.length,
      criticalIssues,
      warningIssues,
      lastSuccessfulSyncAt,
      syncWarningAfterHours: SYNC_WARNING_AFTER_HOURS,
      syncCriticalAfterHours: SYNC_CRITICAL_AFTER_HOURS
    };
  }

  return {
    status: "healthy",
    headline: "Healthy",
    summary: "Core sync, notification, and intervention workflows look healthy.",
    openIssues: 0,
    criticalIssues: 0,
    warningIssues: 0,
    lastSuccessfulSyncAt,
    syncWarningAfterHours: SYNC_WARNING_AFTER_HOURS,
    syncCriticalAfterHours: SYNC_CRITICAL_AFTER_HOURS
  };
}

export async function buildDataOpsSnapshot(
  storage: StorageRepositories,
  options?: {
    sycamoreStore?: SycamoreStore;
    now?: Date;
  }
): Promise<DataOpsSnapshot> {
  const now = options?.now ?? new Date();
  const [parseRuns, openTasks, approvedTasks, editedTasks, rejectedTasks, interventions, notifications, parser] =
    await Promise.all([
      storage.parseRuns.list(),
      storage.reviewTasks.listByStatus("open"),
      storage.reviewTasks.listByStatus("approved"),
      storage.reviewTasks.listByStatus("edited"),
      storage.reviewTasks.listByStatus("rejected"),
      storage.interventions.list(),
      storage.notifications.list(),
      probeParser()
    ]);
  const ingestionBySource = summarizeParseRuns(parseRuns);
  const sycamore = await buildSycamoreDataOpsSummary(options?.sycamoreStore);

  const lastCompletedAt =
    [...parseRuns]
      .filter((run) => Boolean(run.completedAt))
      .sort((left, right) => Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? ""))[0]
      ?.completedAt ?? null;

  const failedRuns = [...parseRuns]
    .filter((run) => run.status === "failed")
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 5)
    .map((run) => ({
      id: run.id,
      kind: "parse_run" as const,
      label: run.fileName,
      createdAt: run.startedAt
    }));

  const failedNotifications = [...notifications]
    .filter((notification) => notification.status === "failed")
    .sort((left, right) => {
      const leftEpoch = Date.parse(left.sentAt ?? "1970-01-01T00:00:00.000Z");
      const rightEpoch = Date.parse(right.sentAt ?? "1970-01-01T00:00:00.000Z");
      return rightEpoch - leftEpoch;
    })
    .slice(0, 5)
    .map((notification) => ({
      id: notification.id,
      kind: "notification" as const,
      label: notification.recipient,
      createdAt: notification.sentAt ?? new Date(0).toISOString()
    }));

  const queuedNotifications = notifications.filter((notification) => notification.status === "queued").length;
  const overdueInterventions = interventions.filter((intervention) => intervention.status === "overdue").length;
  const activeInterventions = interventions.filter((intervention) =>
    ["open", "in_progress", "overdue"].includes(intervention.status)
  ).length;
  const reviewRequiredJobs = parseRuns.filter((run) => run.status === "review_required").length;
  const failedNotificationCount = notifications.filter((notification) => notification.status === "failed").length;
  const attentionItems = buildAttentionItems({
    now,
    sycamore,
    reviewRequiredJobs,
    queuedNotifications,
    overdueInterventions,
    failedNotificationCount
  });
  const health = buildHealthSummary(attentionItems, sycamore.lastSuccessfulCompletedAt);

  return {
    generatedAt: now.toISOString(),
    storage: hasSupabaseEnv()
      ? {
          mode: "supabase",
          label: "Supabase",
          detail: `Project URL ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}.`
        }
      : hasSheetsEnv()
      ? {
          mode: "google_sheets",
          label: "Google Sheets",
          detail: "Spreadsheet-backed adapter configured through service-account credentials."
        }
      : {
          mode: "local_file",
          label: "Local file",
          detail: `Development fallback at ${localStoragePath()}.`
        },
    parser,
    ingestion: {
      totalJobs: parseRuns.length,
      failedJobs: parseRuns.filter((run) => run.status === "failed").length,
      reviewRequiredJobs,
      activeJobs: parseRuns.filter((run) => run.status === "pending" || run.status === "processing").length,
      flaggedRows: parseRuns.reduce((sum, run) => sum + run.rowsFlagged, 0),
      lastCompletedAt,
      bySource: ingestionBySource
    },
    sycamore,
    review: {
      open: openTasks.length,
      approved: approvedTasks.length,
      edited: editedTasks.length,
      rejected: rejectedTasks.length
    },
    backlog: {
      queuedNotifications,
      overdueInterventions,
      activeInterventions
    },
    health,
    attentionItems,
    recentFailures: [...failedRuns, ...failedNotifications]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 8)
  };
}
