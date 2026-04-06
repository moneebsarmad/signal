"use client";

import { DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, RefreshCcw, Sparkles } from "lucide-react";

import type { ParseRun } from "@syc/domain";
import {
  Button,
  Field,
  EmptyState,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  Select,
  SoftPanel,
  StatusBadge,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface JobsResponse {
  jobs: ParseRun[];
}

type SycamoreSyncBatchStatus = "queued" | "running" | "canceling" | "canceled" | "success" | "partial" | "failed";
type IntakeSyncMode = "default" | "range" | "specific_dates";

interface SycamoreSyncBatch {
  batchId: string;
  syncLogId: string | null;
  status: SycamoreSyncBatchStatus;
  syncMode: "initial_backfill" | "manual_range" | "incremental" | "specific_dates";
  selectedDates: string[] | null;
  window: {
    startDate: string;
    endDate: string;
  };
  overallWindow: {
    startDate: string;
    endDate: string;
  };
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  canceledChunks: number;
  activeChunkIndex: number;
  currentWindow: {
    startDate: string;
    endDate: string;
  };
  chunkSizeDays: number;
  recordsDiscovered: number;
  recordsUpserted: number;
  failedJobs: Array<{
    jobId: string;
    sequenceIndex: number;
    window: {
      startDate: string;
      endDate: string;
    };
    syncLogId: string | null;
    errorMessage: string | null;
    warnings: string[];
    warningsCount: number;
    completedAt: string | null;
  }>;
  warnings: string[];
  warningsCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  activeJobStartedAt: string | null;
  lastHeartbeatAt: string | null;
  staleAfterMinutes: number;
  isStalled: boolean;
  triggeredBy: string;
  progress: SycamoreSyncProgressSnapshot | null;
}

interface JobActionResponse {
  parseRun?: ParseRun;
  parseRuns?: ParseRun[];
  uploadResults?: Array<{
    fileName: string;
    parseRun?: ParseRun;
    parserVersion?: string;
    parserWarnings?: string[];
    error?: string;
    parseRunId?: string;
  }>;
  uploadErrors?: string[];
  parserWarnings?: string[];
  sourceWarnings?: string[];
  sycamoreSync?: SycamoreSyncBatch;
  activeSycamoreSync?: SycamoreSyncBatch | null;
  recentSycamoreSyncs?: SycamoreSyncBatch[];
  alreadyQueued?: boolean;
  alreadyTerminal?: boolean;
  deprecated?: boolean;
  replacementPath?: string;
  error?: string;
}

interface SycamoreSyncWorkerResponse {
  executed: boolean;
  jobId: string | null;
  sycamoreSync?: SycamoreSyncBatch | null;
  error?: string;
}

interface SycamoreSyncProgressSnapshot {
  syncLogId: string;
  syncMode: "initial_backfill" | "manual_range" | "incremental" | "specific_dates";
  window: {
    startDate: string;
    endDate: string;
  };
  startedAt: string;
  updatedAt: string;
  stage: "roster" | "discovery" | "detail_fetch" | "upsert" | "complete" | "failed";
  stageIndex: number;
  stageCount: number;
  stageLabel: string;
  stageDescription: string;
  stageProgress: number | null;
  overallProgress: number;
  rosterStudentsFetched: number;
  rosterStudentsUpserted: number;
  rosterStudentsLinked: number;
  discoveryStudentsProcessed: number;
  discoveryStudentsTotal: number;
  discoveredRecords: number;
  detailRecordsProcessed: number;
  detailRecordsTotal: number;
  recordsUpserted: number;
  warningsCount: number;
  message: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SYNC_WINDOW_DAYS = 3;
const MAX_SPECIFIC_SYNC_DATES = 31;

function parseIsoDate(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function inclusiveDaySpan(startDate: string, endDate: string): number {
  return Math.floor((parseIsoDate(endDate) - parseIsoDate(startDate)) / DAY_MS) + 1;
}

function formatSyncWindow(window: { startDate: string; endDate: string }): string {
  return window.startDate === window.endDate ? window.startDate : `${window.startDate} to ${window.endDate}`;
}

function normalizeSpecificDates(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function syncModeLabel(value: SycamoreSyncBatch["syncMode"] | SycamoreSyncProgressSnapshot["syncMode"] | null): string {
  if (value === "initial_backfill") {
    return "Initial backfill";
  }
  if (value === "incremental") {
    return "Incremental";
  }
  if (value === "specific_dates") {
    return "Specific dates";
  }
  if (value === "manual_range") {
    return "Manual range";
  }
  return "Not run yet";
}

function formatSpecificDatesSummary(dates: string[], maxVisible = 3): string {
  if (dates.length === 0) {
    return "No dates selected";
  }
  if (dates.length === 1) {
    return dates[0]!;
  }

  const visibleDates = dates.slice(0, maxVisible).join(", ");
  const overflow = dates.length > maxVisible ? ` +${dates.length - maxVisible} more` : "";
  return `${dates.length} dates: ${visibleDates}${overflow}`;
}

function formatBatchScope(batch: Pick<SycamoreSyncBatch, "syncMode" | "selectedDates" | "overallWindow">, maxVisible = 3): string {
  return batch.syncMode === "specific_dates" && batch.selectedDates?.length
    ? formatSpecificDatesSummary(batch.selectedDates, maxVisible)
    : formatSyncWindow(batch.overallWindow);
}

function latestFailedJob(batch: SycamoreSyncBatch): SycamoreSyncBatch["failedJobs"][number] | null {
  return batch.failedJobs.at(-1) ?? batch.failedJobs[0] ?? null;
}

function formatFailedBatchDescription(batch: SycamoreSyncBatch): string {
  const failedJobsLabel = `${batch.failedChunks} of ${batch.totalChunks} background job${batch.totalChunks === 1 ? "" : "s"}`;
  if (batch.completedChunks === batch.totalChunks) {
    return `${failedJobsLabel} failed. All queued jobs reached an end state, and completed jobs can include failures.`;
  }
  return `${failedJobsLabel} failed while ${batch.completedChunks} of ${batch.totalChunks} queued jobs reached an end state.`;
}

function formatFailedBatchMessage(batch: SycamoreSyncBatch): string {
  const failedJob = latestFailedJob(batch);
  if (failedJob?.errorMessage?.trim()) {
    return `Job ${failedJob.sequenceIndex + 1} of ${batch.totalChunks} failed for ${formatSyncWindow(failedJob.window)}. ${failedJob.errorMessage.trim()}`;
  }
  if (failedJob) {
    return `Job ${failedJob.sequenceIndex + 1} of ${batch.totalChunks} failed for ${formatSyncWindow(failedJob.window)}.`;
  }
  return batch.warnings.join("\n") || "One or more Sycamore background jobs failed.";
}

function sourceLabel(sourceType: ParseRun["sourceType"]): string {
  return sourceType === "sycamore_api" ? "Sycamore API" : "Fallback PDF";
}

function toneForJobStatus(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
    case "processing":
      return "info";
    case "failed":
      return "danger";
    case "queued":
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function pickPdfFiles(files: FileList | null | undefined): { files: File[]; error: string | null } {
  if (!files || files.length === 0) {
    return { files: [], error: null };
  }

  const nextFiles = Array.from(files);
  if (nextFiles.some((file) => !isPdfFile(file))) {
    return { files: [], error: "Only PDF files are supported." };
  }

  return { files: nextFiles, error: null };
}

function uploadHeading(selectedFiles: File[], isDragActive: boolean): string {
  if (selectedFiles.length === 0) {
    return isDragActive ? "Drop fallback PDFs here" : "Drop fallback PDFs or browse";
  }
  if (selectedFiles.length === 1) {
    return selectedFiles[0]?.name ?? "1 PDF ready";
  }
  return `${selectedFiles.length} PDFs ready`;
}

function selectionSummary(selectedFiles: File[]): string {
  if (selectedFiles.length === 0) {
    return "No fallback files added yet.";
  }
  if (selectedFiles.length === 1) {
    return `Ready to import ${selectedFiles[0]?.name} through the fallback parser flow.`;
  }
  const preview = selectedFiles
    .slice(0, 3)
    .map((file) => file.name)
    .join(", ");
  const overflow = selectedFiles.length > 3 ? ` +${selectedFiles.length - 3} more` : "";
  return `Ready to import ${selectedFiles.length} fallback PDFs: ${preview}${overflow}.`;
}

function parseStudentNamesInput(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

const syncStageKeys = ["roster", "discovery", "detail_fetch", "upsert"] as const;

function formatDuration(startedAt: string, nowValue: number): string {
  const elapsedMs = Math.max(0, nowValue - Date.parse(startedAt));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatBatchTimestamp(batch: SycamoreSyncBatch): string {
  return new Date(batch.startedAt ?? batch.createdAt).toLocaleString();
}

function syncStageSubtitle(progress: SycamoreSyncProgressSnapshot, stage: (typeof syncStageKeys)[number]): string {
  switch (stage) {
    case "roster":
      return progress.rosterStudentsUpserted > 0
        ? `${progress.rosterStudentsUpserted} students refreshed`
        : "Preparing student links";
    case "discovery":
      return progress.discoveryStudentsTotal > 0
        ? `${progress.discoveryStudentsProcessed} of ${progress.discoveryStudentsTotal} students scanned`
        : progress.discoveredRecords > 0
          ? `${progress.discoveredRecords} records found`
          : "Finding matching incidents";
    case "detail_fetch":
      return progress.detailRecordsTotal > 0
        ? `${progress.detailRecordsProcessed} of ${progress.detailRecordsTotal} detailed`
        : "Waiting for discovered records";
    case "upsert":
      return progress.recordsUpserted > 0 ? `${progress.recordsUpserted} rows written` : "Waiting to write normalized rows";
  }
}

function splitWarningCode(warning: string): { code: string; detail: string | null } {
  const separatorIndex = warning.indexOf(":");
  if (separatorIndex === -1) {
    return {
      code: warning,
      detail: null
    };
  }

  return {
    code: warning.slice(0, separatorIndex),
    detail: warning.slice(separatorIndex + 1) || null
  };
}

function humanizeWarningCode(code: string): string {
  return code
    .replace(/^sycamore_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatSycamoreWarningDetail(warning: string): {
  title: string;
  description: string | null;
  reference: string | null;
} {
  const { code, detail } = splitWarningCode(warning);

  switch (code) {
    case "sycamore_no_records":
      return {
        title: "No records found",
        description: "Sycamore returned no discipline records for part of the requested window.",
        reference: detail
      };
    case "sycamore_student_overview_discovery_used":
      return {
        title: "Student timeline fallback used",
        description: "The sync had to scan student timelines because the normal school-wide feed was not reliable enough.",
        reference: detail
      };
    case "sycamore_school_list_empty_fallback_used":
      return {
        title: "School feed was empty",
        description: "The school-wide feed returned no usable rows, so the sync fell back to student timeline scanning.",
        reference: detail
      };
    case "sycamore_school_rows_out_of_window_skipped":
      return {
        title: "Out-of-window rows skipped",
        description: "Sycamore returned rows outside the selected date range and the sync ignored them.",
        reference: detail
      };
    case "sycamore_school_rows_missing_ids_fallback_used":
      return {
        title: "Feed rows missing IDs",
        description: "Some school-feed rows were missing stable IDs, so the sync used a safer fallback path.",
        reference: detail
      };
    case "sycamore_school_rows_missing_ids_candidate_fallback_used":
      return {
        title: "Candidate fallback used",
        description: "The school feed lacked stable IDs, so the sync derived candidate students and scanned those timelines.",
        reference: detail
      };
    case "sycamore_existing_logs_skipped":
      return {
        title: "Existing mirrored rows skipped",
        description: "These records were already mirrored locally and were not written again.",
        reference: detail
      };
    case "sycamore_target_student_id_not_found":
      return {
        title: "Target student ID not found",
        description: "A requested student ID could not be matched to a roster record.",
        reference: detail
      };
    case "sycamore_target_student_name_not_found":
      return {
        title: "Target student name not found",
        description: "A requested student name could not be matched to a roster record.",
        reference: detail
      };
    case "sycamore_student_scan_skipped_missing_id":
      return {
        title: "Student scan skipped",
        description: "A roster entry was missing the Sycamore student ID required for discovery.",
        reference: detail
      };
    case "sycamore_student_scan_failed": {
      const [studentId, ...messageParts] = detail?.split(":") ?? [];
      return {
        title: "Student scan failed",
        description: "The sync could not scan one student's timeline.",
        reference:
          [studentId ? `Student ${studentId}` : null, messageParts.length > 0 ? messageParts.join(":") : null]
            .filter(Boolean)
            .join(" | ") || detail
      };
    }
    case "sycamore_skipped_entry_missing_ids":
      return {
        title: "Discovered row missing IDs",
        description: "A discovered discipline row was missing the student ID or log ID needed for detail fetch.",
        reference: detail
      };
    case "sycamore_detail_fetch_failed": {
      const [studentId, logId, ...messageParts] = detail?.split(":") ?? [];
      return {
        title: "Discipline detail fetch failed",
        description: "The sync found a record but could not load its full discipline detail page.",
        reference:
          [
            studentId ? `Student ${studentId}` : null,
            logId ? `Log ${logId}` : null,
            messageParts.length > 0 ? messageParts.join(":") : null
          ]
            .filter(Boolean)
            .join(" | ") || detail
      };
    }
    case "sycamore_detention_fetch_failed": {
      const [studentId, detentionId, ...messageParts] = detail?.split(":") ?? [];
      return {
        title: "Detention detail fetch failed",
        description: "The discipline row loaded, but the linked detention detail could not be fetched.",
        reference:
          [
            studentId ? `Student ${studentId}` : null,
            detentionId ? `Detention ${detentionId}` : null,
            messageParts.length > 0 ? messageParts.join(":") : null
          ]
            .filter(Boolean)
            .join(" | ") || detail
      };
    }
    case "sycamore_roster_sync_failed":
      return {
        title: "Roster sync failed",
        description: "The student roster refresh encountered a problem during this batch.",
        reference: detail
      };
    case "sycamore_student_target_sync":
      return {
        title: "Targeted student sync",
        description: "This batch was intentionally scoped to selected students.",
        reference: detail
      };
    default:
      return {
        title: humanizeWarningCode(code),
        description: code.startsWith("sycamore_") ? "The Sycamore sync reported a warning for this batch." : null,
        reference: detail
      };
  }
}

export function IngestionClient() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [jobs, setJobs] = useState<ParseRun[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isStartingSync, setIsStartingSync] = useState(false);
  const [isRunningWorker, setIsRunningWorker] = useState(false);
  const [isCancelingSync, setIsCancelingSync] = useState(false);
  const [syncModeSelection, setSyncModeSelection] = useState<IntakeSyncMode>("range");
  const [syncStartDate, setSyncStartDate] = useState(todayIsoDate);
  const [syncEndDate, setSyncEndDate] = useState(todayIsoDate);
  const [syncSpecificDateInput, setSyncSpecificDateInput] = useState(todayIsoDate);
  const [syncSpecificDates, setSyncSpecificDates] = useState<string[]>([]);
  const [syncStudentNamesText, setSyncStudentNamesText] = useState("");
  const [syncGrade, setSyncGrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<JobActionResponse | null>(null);
  const [syncBatch, setSyncBatch] = useState<SycamoreSyncBatch | null>(null);
  const [recentSyncBatches, setRecentSyncBatches] = useState<SycamoreSyncBatch[]>([]);
  const [syncNow, setSyncNow] = useState(() => Date.now());
  const [showFallbackTools, setShowFallbackTools] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedWarningBatchId, setSelectedWarningBatchId] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const warningsPanelRef = useRef<HTMLDivElement | null>(null);
  const syncProgress = syncBatch?.progress ?? null;
  const isSyncing =
    isStartingSync || Boolean(syncBatch && (syncBatch.status === "queued" || syncBatch.status === "running" || syncBatch.status === "canceling"));

  function setCandidateFiles(nextFiles: File[]) {
    setSelectedFiles(nextFiles);
    if (nextFiles.length > 0) {
      setError(null);
    }
  }

  function handleIncomingFiles(files: FileList | null | undefined) {
    const { files: nextFiles, error: nextError } = pickPdfFiles(files);
    if (nextError) {
      setError(nextError);
      return;
    }
    setCandidateFiles(nextFiles);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function changeSyncMode(nextMode: IntakeSyncMode) {
    setSyncModeSelection(nextMode);
    setError(null);
  }

  function addSpecificSyncDate(nextDate: string) {
    const normalizedDate = nextDate.trim();
    if (!normalizedDate) {
      setError("Choose a date before adding it to the specific-date batch.");
      return;
    }

    const normalizedDates = normalizeSpecificDates([...syncSpecificDates, normalizedDate]);
    if (normalizedDates.length > MAX_SPECIFIC_SYNC_DATES) {
      setError(`Specific-date syncs can include up to ${MAX_SPECIFIC_SYNC_DATES} dates.`);
      return;
    }

    setSyncSpecificDates(normalizedDates);
    setError(null);
  }

  function removeSpecificSyncDate(date: string) {
    setSyncSpecificDates((currentDates) => currentDates.filter((value) => value !== date));
    setError(null);
  }

  function onSpecificDateInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    addSpecificSyncDate(syncSpecificDateInput);
  }

  function onDropZoneDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function onDropZoneDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDropZoneDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function onDropZoneDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    handleIncomingFiles(event.dataTransfer.files);
  }

  function onDropZoneKeyDown(event: KeyboardEvent<HTMLLabelElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    openFilePicker();
  }

  async function loadJobs() {
    setIsLoadingJobs(true);
    try {
      const response = await fetch("/api/ingestion/jobs", { cache: "no-store" });
      if (!response.ok) {
        setError("Could not load ingestion jobs.");
        return;
      }

      const body = (await response.json()) as JobsResponse;
      setJobs(body.jobs || []);
    } catch (error) {
      setError(getErrorMessage(error, "Could not load ingestion jobs."));
    } finally {
      setIsLoadingJobs(false);
    }
  }

  useEffect(() => {
    void loadJobs();
    void loadSycamoreSyncJobs();
  }, []);

  useEffect(() => {
    if (!isSyncing || !syncBatch) {
      return;
    }

    const interval = window.setInterval(() => {
      setSyncNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isSyncing, syncBatch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setError("Add at least one PDF before uploading.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setLastResult(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/ingestion/upload", {
        method: "POST",
        body: formData
      });

      const body = (await response.json().catch(() => null)) as JobActionResponse | null;
      if (!response.ok) {
        setError(body?.error || "Upload failed.");
        return;
      }

      setLastResult(body);
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadJobs();
    } catch (error) {
      setError(getErrorMessage(error, "Upload failed."));
    } finally {
      setIsUploading(false);
    }
  }

  async function loadSycamoreSyncJobs() {
    try {
      const response = await fetch("/api/sycamore/sync/jobs", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as JobActionResponse | null;
      if (!response.ok) {
        return;
      }

      setSyncBatch((currentBatch) => body?.activeSycamoreSync ?? currentBatch);
      setRecentSyncBatches(body?.recentSycamoreSyncs ?? []);
    } catch {
      // Ignore startup polling failures and let the manual action surface real errors later.
    }
  }

  async function loadSyncBatch(batchId: string): Promise<SycamoreSyncBatch | null> {
    const response = await fetch(`/api/sycamore/sync/jobs?batchId=${encodeURIComponent(batchId)}`, {
      cache: "no-store"
    });
    const body = (await response.json().catch(() => null)) as JobActionResponse | null;
    if (!response.ok) {
      throw new Error(body?.error || "Could not load the queued Sycamore sync.");
    }
    return body?.sycamoreSync ?? null;
  }

  async function enqueueSync(payload: Record<string, unknown>): Promise<SycamoreSyncBatch> {
    const response = await fetch("/api/sycamore/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = (await response.json().catch(() => null)) as JobActionResponse | null;
    if (!response.ok || !body?.sycamoreSync) {
      throw new Error(body?.error || "Could not queue the Sycamore sync.");
    }
    return body.sycamoreSync;
  }

  async function runSync(payload: Record<string, unknown>) {
    setIsStartingSync(true);
    setError(null);
    setLastResult(null);
    setSyncBatch(null);
    setSyncNow(Date.now());

    try {
      const batch = await enqueueSync(payload);
      setSyncBatch(batch);
      setLastResult({ sycamoreSync: batch });
      setRecentSyncBatches((currentBatches) => [
        batch,
        ...currentBatches.filter((entry) => entry.batchId !== batch.batchId)
      ]);
      setSyncNow(Date.now());
    } catch (error) {
      setError(getErrorMessage(error, "Sycamore sync failed."));
    } finally {
      setIsStartingSync(false);
    }
  }

  async function onSyncSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (syncModeSelection === "default") {
      await onIncrementalSync();
      return;
    }

    const payload: Record<string, unknown> = {};

    if (syncModeSelection === "range") {
      if (!syncStartDate || !syncEndDate) {
        setError("Choose both a start date and end date for the Sycamore sync.");
        return;
      }
      if (syncStartDate > syncEndDate) {
        setError("Sycamore sync start date must be on or before the end date.");
        return;
      }

      payload.startDate = syncStartDate;
      payload.endDate = syncEndDate;
    }

    if (syncModeSelection === "specific_dates") {
      if (syncSpecificDates.length === 0) {
        setError("Add at least one specific date for the Sycamore sync.");
        return;
      }

      payload.dates = syncSpecificDates;
    }

    if (parsedSyncStudentNames.length > 0) {
      payload.studentNames = parsedSyncStudentNames;
    }
    if (syncGrade) {
      payload.grade = syncGrade;
    }

    await runSync(payload);
  }

  async function onIncrementalSync() {
    await runSync({
      incremental: true
    });
  }

  async function runQueuedSyncJobNow() {
    setIsRunningWorker(true);
    setError(null);

    try {
      const response = await fetch("/api/sycamore/sync/jobs/run", {
        method: "POST"
      });
      const body = (await response.json().catch(() => null)) as SycamoreSyncWorkerResponse | null;
      if (!response.ok) {
        throw new Error(body?.error || "Could not run the queued Sycamore sync job.");
      }

      if (body?.sycamoreSync) {
        setSyncBatch(body.sycamoreSync);
        setLastResult({ sycamoreSync: body.sycamoreSync });
        setRecentSyncBatches((currentBatches) => [
          body.sycamoreSync!,
          ...currentBatches.filter((entry) => entry.batchId !== body.sycamoreSync?.batchId)
        ]);
        setSyncNow(Date.now());
      }
    } catch (workerError) {
      setError(getErrorMessage(workerError, "Could not run the queued Sycamore sync job."));
    } finally {
      setIsRunningWorker(false);
    }
  }

  async function cancelSyncBatch(batchId: string) {
    setIsCancelingSync(true);
    setError(null);

    try {
      const response = await fetch("/api/sycamore/sync/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId })
      });
      const body = (await response.json().catch(() => null)) as JobActionResponse | null;
      if (!response.ok || !body?.sycamoreSync) {
        throw new Error(body?.error || "Could not cancel the Sycamore sync batch.");
      }

      setSyncBatch(body.sycamoreSync);
      setLastResult({ sycamoreSync: body.sycamoreSync });
      setRecentSyncBatches((currentBatches) => [
        body.sycamoreSync!,
        ...currentBatches.filter((entry) => entry.batchId !== body.sycamoreSync?.batchId)
      ]);
      setSyncNow(Date.now());
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, "Could not cancel the Sycamore sync batch."));
    } finally {
      setIsCancelingSync(false);
    }
  }

  function showBatchWarnings(batch: SycamoreSyncBatch) {
    setSelectedWarningBatchId(batch.batchId);
    window.requestAnimationFrame(() => {
      warningsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const activeSyncBatchId = syncBatch?.batchId ?? null;
  const activeSyncBatchStatus = syncBatch?.status ?? null;

  useEffect(() => {
    if (
      !activeSyncBatchId ||
      (activeSyncBatchStatus !== "queued" && activeSyncBatchStatus !== "running" && activeSyncBatchStatus !== "canceling")
    ) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const nextBatch = await loadSyncBatch(activeSyncBatchId);
        if (cancelled || !nextBatch) {
          return;
        }

        setSyncBatch(nextBatch);
        setRecentSyncBatches((currentBatches) => [
          nextBatch,
          ...currentBatches.filter((entry) => entry.batchId !== nextBatch.batchId)
        ]);
        setSyncNow(Date.now());

        if (nextBatch.status !== "queued" && nextBatch.status !== "running" && nextBatch.status !== "canceling") {
          setLastResult({ sycamoreSync: nextBatch });
          if (nextBatch.status === "failed") {
            setError(formatFailedBatchMessage(nextBatch));
          }
          void loadSycamoreSyncJobs();
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(getErrorMessage(pollError, "Could not refresh the background Sycamore sync."));
        }
      }
    };

    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSyncBatchId, activeSyncBatchStatus]);

  const summary = useMemo(() => {
    if (lastResult?.sycamoreSync) {
      const result = lastResult.sycamoreSync;
      const syncLabel = syncModeLabel(result.syncMode);
      const scopeLabel = formatBatchScope(result, 4);
      if (result.status === "queued") {
        return `${syncLabel} Sycamore sync for ${scopeLabel} is queued in the background as ${result.totalChunks} job${result.totalChunks === 1 ? "" : "s"}.`;
      }
      if (result.status === "running") {
        return `${syncLabel} Sycamore sync for ${scopeLabel} is running in the background. ${result.completedChunks} of ${result.totalChunks} job${result.totalChunks === 1 ? "" : "s"} finished so far.`;
      }
      if (result.status === "canceling") {
        return `${syncLabel} Sycamore sync for ${scopeLabel} is canceling. Remaining queued jobs will not run, and the active chunk will stop at the next safe checkpoint.`;
      }
      if (result.status === "canceled") {
        return `${syncLabel} Sycamore sync for ${scopeLabel} was canceled after storing ${result.recordsUpserted} record${result.recordsUpserted === 1 ? "" : "s"}. Rows written before cancel took effect remain mirrored in Supabase.`;
      }
      if (result.status === "failed") {
        return `${syncLabel} Sycamore sync for ${scopeLabel} finished with failures after storing ${result.recordsUpserted} record${result.recordsUpserted === 1 ? "" : "s"}. ${formatFailedBatchMessage(result)}`;
      }
      return `${syncLabel} Sycamore sync for ${scopeLabel} stored ${result.recordsUpserted} record${result.recordsUpserted === 1 ? "" : "s"}${result.status === "partial" ? " with warnings" : ""}.`;
    }

    return null;
  }, [lastResult]);

  const summaryTone = useMemo<"info" | "success" | "warning" | "danger">(() => {
    const sycamoreStatus = lastResult?.sycamoreSync?.status;
    if (sycamoreStatus === "queued" || sycamoreStatus === "running") {
      return "info";
    }
    if (sycamoreStatus === "canceling" || sycamoreStatus === "canceled") {
      return "warning";
    }
    if (sycamoreStatus === "failed") {
      return "danger";
    }
    return "success";
  }, [lastResult]);

  const summaryTitle = useMemo(() => {
    const sycamoreStatus = lastResult?.sycamoreSync?.status;
    if (sycamoreStatus === "queued") {
      return "Sycamore sync queued.";
    }
    if (sycamoreStatus === "running") {
      return "Sycamore sync running.";
    }
    if (sycamoreStatus === "canceling") {
      return "Sycamore sync canceling.";
    }
    if (sycamoreStatus === "canceled") {
      return "Sycamore sync canceled.";
    }
    if (sycamoreStatus === "failed") {
      return "Sycamore sync finished with failures.";
    }
    return "Latest intake updated.";
  }, [lastResult]);

  const selectedWarningBatch = useMemo(() => {
    if (selectedWarningBatchId) {
      if (syncBatch?.batchId === selectedWarningBatchId) {
        return syncBatch;
      }
      return recentSyncBatches.find((batch) => batch.batchId === selectedWarningBatchId) ?? null;
    }

    if (syncBatch?.warnings.length) {
      return syncBatch;
    }

    return lastResult?.sycamoreSync?.warnings.length ? lastResult.sycamoreSync : null;
  }, [lastResult, recentSyncBatches, selectedWarningBatchId, syncBatch]);

  const actionWarnings = useMemo(() => {
    return [
      ...(lastResult?.sourceWarnings ?? []),
      ...(selectedWarningBatch?.warnings ?? []),
    ];
  }, [lastResult, selectedWarningBatch]);
  const primaryFailedJob = syncBatch ? latestFailedJob(syncBatch) : null;

  const parsedSyncStudentNames = useMemo(() => parseStudentNamesInput(syncStudentNamesText), [syncStudentNamesText]);
  const hasTargetedSyncFilters = parsedSyncStudentNames.length > 0 || Boolean(syncGrade);
  const isDefaultSyncMode = syncModeSelection === "default";
  const isRangeSyncMode = syncModeSelection === "range";
  const isSpecificDateSyncMode = syncModeSelection === "specific_dates";
  const flaggedRows = jobs.reduce((total, job) => total + job.rowsFlagged, 0);
  const selectedRangeDays = isRangeSyncMode ? inclusiveDaySpan(syncStartDate, syncEndDate) : 0;
  const willChunkSelectedRange = isRangeSyncMode && selectedRangeDays > MAX_SYNC_WINDOW_DAYS;
  const specificDateJobCount = syncSpecificDates.length;
  const syncQueuedAt = syncBatch?.createdAt ?? null;
  const syncStartedAt = syncBatch?.activeJobStartedAt ?? syncProgress?.startedAt ?? null;
  const syncElapsedLabel =
    syncBatch?.status === "queued"
      ? syncQueuedAt
        ? `${formatDuration(syncQueuedAt, syncNow)} in queue`
        : null
      : syncBatch?.status === "running" || syncBatch?.status === "canceling"
        ? syncStartedAt
          ? `${formatDuration(syncStartedAt, syncNow)} elapsed`
          : null
        : null;
  const syncHeartbeatLabel =
    (syncBatch?.status === "running" || syncBatch?.status === "canceling") && syncBatch.lastHeartbeatAt
      ? syncBatch.isStalled
        ? `No heartbeat for ${formatDuration(syncBatch.lastHeartbeatAt, syncNow)}`
        : `Heartbeat ${formatDuration(syncBatch.lastHeartbeatAt, syncNow)} ago`
      : null;
  const canRunWorkerNow = Boolean(syncBatch && (syncBatch.status === "queued" || syncBatch.isStalled));
  const canCancelSyncBatch = Boolean(syncBatch && (syncBatch.status === "queued" || syncBatch.status === "running"));
  const batchOverallProgress = syncBatch
    ? Math.min(
        1,
        (syncBatch.completedChunks +
          (syncBatch.completedChunks < syncBatch.totalChunks ? (syncProgress?.overallProgress ?? 0) : 0)) /
          syncBatch.totalChunks
      )
    : null;
  const displayedOverallProgress = batchOverallProgress ?? syncProgress?.overallProgress ?? 0;
  const syncStageLabel =
    syncBatch?.isStalled ?
      "Stalled"
    : (syncProgress?.stageLabel ??
        (syncBatch?.status === "queued"
          ? "Queued"
          : syncBatch?.status === "canceling"
            ? "Canceling"
            : syncBatch?.status === "canceled"
              ? "Canceled"
          : syncBatch?.status === "failed"
            ? "Failed"
            : syncBatch?.status === "success" || syncBatch?.status === "partial"
              ? "Completed"
              : "Starting"));
  const syncStageDescription =
    syncBatch?.isStalled ?
      `The current background job has not reported a heartbeat for over ${syncBatch.staleAfterMinutes} minutes. It likely hit the 300-second worker limit or the worker was interrupted.`
    : (syncProgress?.stageDescription ??
        (syncBatch?.status === "queued"
          ? "This queued Sycamore sync will run when the daily cron advances the queue, or immediately if you use Run next job now. Queued time does not count against the 300-second worker limit."
          : syncBatch?.status === "canceling"
            ? "Cancel is in progress. Remaining queued jobs are being discarded, and the current chunk will stop at the next safe checkpoint."
            : syncBatch?.status === "canceled"
              ? "This batch was canceled before all queued jobs finished. Any rows written before cancellation remain mirrored in Supabase."
          : syncBatch?.status === "failed"
            ? formatFailedBatchDescription(syncBatch)
            : syncBatch?.status === "success" || syncBatch?.status === "partial"
              ? "The background Sycamore sync batch has finished."
              : "Preparing the background Sycamore sync."));
  const syncMessage =
    syncBatch?.isStalled ?
      `${syncBatch.lastHeartbeatAt ? `Last worker heartbeat was ${formatDuration(syncBatch.lastHeartbeatAt, syncNow)} ago.` : "The worker has not reported a heartbeat recently."} ${syncBatch.status === "canceling" ? "Use Run next job now to finalize the cancellation." : "Use Run next job now to resume from the next claimable chunk."}`
    : (syncProgress?.message ??
        (syncBatch?.status === "queued"
          ? `Queued ${syncBatch.totalChunks} background job${syncBatch.totalChunks === 1 ? "" : "s"} for ${formatBatchScope(syncBatch, 4)}.`
          : syncBatch?.status === "canceling"
            ? "Cancel requested. No additional queued chunks will start."
            : syncBatch?.status === "canceled"
              ? `Canceled after ${syncBatch.completedChunks} of ${syncBatch.totalChunks} job${syncBatch.totalChunks === 1 ? "" : "s"} reached a terminal state.`
          : syncBatch?.status === "failed"
            ? formatFailedBatchMessage(syncBatch)
            : syncBatch?.status === "success" || syncBatch?.status === "partial"
              ? `Background sync batch finished with ${syncBatch.recordsUpserted} stored row${syncBatch.recordsUpserted === 1 ? "" : "s"}.`
              : "Waiting for the queued Sycamore job to report progress."));
  const syncStatusTone =
    syncBatch?.isStalled || syncBatch?.status === "failed"
      ? "danger"
      : syncBatch?.status === "success" || syncBatch?.status === "partial"
        ? "success"
        : syncBatch?.status === "queued" || syncBatch?.status === "canceling" || syncBatch?.status === "canceled"
          ? "warning"
          : "info";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sources"
        title="Manage Sycamore syncs"
        description="Run the Sycamore sync pipeline, monitor background jobs, and keep the discipline dataset current."
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void loadJobs();
              void loadSycamoreSyncJobs();
            }}
            disabled={isLoadingJobs}
          >
            <RefreshCcw className={cn("h-4 w-4", isLoadingJobs ? "animate-spin" : "")} />
            {isLoadingJobs ? "Refreshing..." : "Refresh intake"}
          </Button>
        }
      />

      <section className="space-y-5">
        <Panel className="space-y-5 border-white/80 bg-[linear-gradient(135deg,rgba(17,94,89,0.08),rgba(255,255,255,0.98)_48%,rgba(173,124,44,0.05))]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone="success">Sycamore primary</StatusBadge>
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Sycamore intake</h2>
                <p className="max-w-2xl text-sm text-[var(--color-muted)]">
                  Daily intake runs here. Use a date range or exact selected dates for backfill, validation, or targeted checks.
                </p>
              </div>
            </div>

            <div className="rounded-[1rem] border border-[var(--color-line)] bg-white/80 px-4 py-3 text-sm leading-6 text-[var(--color-muted)]">
              PDF upload and parser-driven intake have been retired. All active discipline intake now runs through
              Sycamore sync.
            </div>
          </div>

          <form onSubmit={onSyncSubmit} className="space-y-5">
            <Field
              label="Sync mode"
              hint="Choose a routine refresh, a contiguous backfill window, or a non-consecutive set of exact dates."
            >
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  {
                    value: "default" as const,
                    label: "Default sync",
                    description: "Resume from the last successful Sycamore window."
                  },
                  {
                    value: "range" as const,
                    label: "Date range",
                    description: "Backfill or validate a continuous window."
                  },
                  {
                    value: "specific_dates" as const,
                    label: "Specific dates",
                    description: "Queue exact, non-consecutive dates in one batch."
                  }
                ].map((option) => {
                  const selected = syncModeSelection === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => changeSyncMode(option.value)}
                      className={cn(
                        "rounded-[1.1rem] border px-4 py-3 text-left transition",
                        selected
                          ? "border-[var(--color-primary)] bg-[rgba(17,94,89,0.08)] shadow-[0_12px_30px_rgba(17,94,89,0.08)]"
                          : "border-[var(--color-line)] bg-white/80 hover:border-[var(--color-primary)]/40"
                      )}
                    >
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{option.label}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </Field>

            {!isDefaultSyncMode ? (
              <div className="grid gap-4 md:grid-cols-[1.45fr_0.55fr]">
                <Field
                  label="Student name"
                  hint="Optional. Enter one name or use commas/new lines for multiple students."
                >
                  <Input
                    value={syncStudentNamesText}
                    onChange={(event) => setSyncStudentNamesText(event.currentTarget.value)}
                    placeholder="e.g. Aybach Charkas"
                  />
                </Field>
                <Field label="Grade" hint="Optional grade filter for targeted syncs.">
                  <Select value={syncGrade} onChange={(event) => setSyncGrade(event.currentTarget.value)}>
                    <option value="">All grades</option>
                    {["6", "7", "8", "9", "10", "11", "12"].map((grade) => (
                      <option key={grade} value={grade}>
                        Grade {grade}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}

            {isRangeSyncMode ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Start date">
                  <Input type="date" value={syncStartDate} onChange={(event) => setSyncStartDate(event.currentTarget.value)} />
                </Field>
                <Field label="End date">
                  <Input type="date" value={syncEndDate} onChange={(event) => setSyncEndDate(event.currentTarget.value)} />
                </Field>
              </div>
            ) : null}

            {isSpecificDateSyncMode ? (
              <div className="space-y-3">
                <Field
                  label="Specific dates"
                  hint="Add exact dates for a non-consecutive Sycamore batch. Duplicates are ignored."
                >
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      type="date"
                      value={syncSpecificDateInput}
                      onChange={(event) => setSyncSpecificDateInput(event.currentTarget.value)}
                      onKeyDown={onSpecificDateInputKeyDown}
                    />
                    <Button type="button" variant="secondary" onClick={() => addSpecificSyncDate(syncSpecificDateInput)}>
                      Add date
                    </Button>
                  </div>
                </Field>

                <div className="rounded-[1.1rem] border border-[var(--color-line)] bg-white/80 px-4 py-3">
                  {syncSpecificDates.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {syncSpecificDates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => removeSpecificSyncDate(date)}
                          className="rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-1 text-sm font-medium text-[var(--color-ink)] transition hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]"
                        >
                          {date} ×
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-muted)]">No specific dates selected yet.</p>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={isDefaultSyncMode ? "info" : hasTargetedSyncFilters ? "warning" : "info"}>
                    {isDefaultSyncMode
                      ? "Default sync resumes from the last successful window"
                      : isSpecificDateSyncMode
                        ? `${specificDateJobCount} specific date${specificDateJobCount === 1 ? "" : "s"} selected`
                        : hasTargetedSyncFilters
                          ? "Explicit dates selected for targeted sync"
                          : "Manual date range"}
                  </StatusBadge>
                  {isSpecificDateSyncMode && specificDateJobCount > 0 ? (
                    <StatusBadge tone="warning">
                      {specificDateJobCount} queued job{specificDateJobCount === 1 ? "" : "s"}
                    </StatusBadge>
                  ) : null}
                  {willChunkSelectedRange ? (
                    <StatusBadge tone="warning">{MAX_SYNC_WINDOW_DAYS}-day chunking enabled</StatusBadge>
                  ) : null}
                </div>
                <p className="text-sm text-[var(--color-muted)]">
                  {isDefaultSyncMode
                    ? "Use the default action for routine refreshes. The worker resumes from the last successful Sycamore window."
                    : isSpecificDateSyncMode
                      ? `Targeted filters are allowed here. Queue up to ${MAX_SPECIFIC_SYNC_DATES} exact dates, and each selected date will run as its own job.`
                      : hasTargetedSyncFilters
                        ? "Student and grade filters run against the explicit range you choose."
                        : "Use a contiguous date range for backfill and validation. Wider windows will be split into background jobs automatically."}
                </p>
              </div>
              <Button type="submit" variant="primary" disabled={isSyncing}>
                {isSyncing
                  ? "Syncing Sycamore..."
                  : isDefaultSyncMode
                    ? "Default sync"
                    : isSpecificDateSyncMode
                      ? hasTargetedSyncFilters
                        ? "Sync filtered dates"
                        : "Sync selected dates"
                      : hasTargetedSyncFilters
                        ? "Sync filtered range"
                        : "Sync selected range"}
              </Button>
            </div>
          </form>

          {syncBatch ? (
            <SoftPanel className="space-y-5 border-white/70 bg-white/88">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">
                    Sync progress
                  </p>
                  <div className="space-y-1">
                    <h3 className="font-display text-2xl text-[var(--color-ink)]">{syncStageLabel}</h3>
                    <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                      {syncStageDescription}
                    </p>
                    {syncBatch ? (
                      <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
                        Background batching is active for {formatBatchScope(syncBatch, 4)}. Current job{" "}
                        {syncBatch.activeChunkIndex + 1} of {syncBatch.totalChunks}: {formatSyncWindow(syncBatch.currentWindow)}.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {canRunWorkerNow ? (
                    <Button type="button" variant="secondary" size="sm" disabled={isRunningWorker} onClick={() => void runQueuedSyncJobNow()}>
                      <RefreshCcw className={cn("h-4 w-4", isRunningWorker ? "animate-spin" : "")} />
                      {isRunningWorker
                        ? syncBatch.status === "canceling"
                          ? "Finalizing..."
                          : syncBatch.isStalled
                            ? "Resuming..."
                            : "Starting..."
                        : syncBatch.status === "canceling" && syncBatch.isStalled
                          ? "Finalize cancel"
                          : syncBatch.isStalled
                            ? "Resume stalled job"
                            : "Run next job now"}
                    </Button>
                  ) : null}
                  {canCancelSyncBatch ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isCancelingSync}
                      onClick={() => void cancelSyncBatch(syncBatch.batchId)}
                    >
                      {isCancelingSync ? "Canceling..." : "Cancel batch"}
                    </Button>
                  ) : null}
                  <StatusBadge tone={syncStatusTone}>
                    {syncBatch.isStalled
                      ? "Stalled"
                      : syncBatch.status === "queued"
                      ? "Queued"
                      : syncBatch.status === "canceling"
                        ? "Canceling"
                        : syncBatch.status === "canceled"
                          ? "Canceled"
                      : syncBatch.status === "running"
                        ? "Running"
                        : syncBatch.status === "failed"
                          ? "Failed"
                          : "Completed"}
                  </StatusBadge>
                  {syncBatch ? (
                    <StatusBadge tone="warning">
                      Job {syncBatch.activeChunkIndex + 1} of {syncBatch.totalChunks}
                    </StatusBadge>
                  ) : null}
                  {syncBatch && batchOverallProgress !== null ? (
                    <StatusBadge tone="neutral">{Math.round(batchOverallProgress * 100)}% overall</StatusBadge>
                  ) : null}
                  {syncElapsedLabel ? <StatusBadge tone="neutral">{syncElapsedLabel}</StatusBadge> : null}
                  {syncHeartbeatLabel ? (
                    <StatusBadge tone={syncBatch.isStalled ? "danger" : "neutral"}>{syncHeartbeatLabel}</StatusBadge>
                  ) : null}
                </div>
              </div>

              {syncBatch.isStalled ? (
                <InlineAlert tone="danger" title="This background job looks stalled.">
                  No worker heartbeat has been recorded within the expected window. The current chunk may have hit the
                  300-second platform limit or the worker was interrupted. Use{" "}
                  <span className="font-semibold">
                    {syncBatch.status === "canceling" ? "Finalize cancel" : "Resume stalled job"}
                  </span>{" "}
                  to reclaim the chunk.
                </InlineAlert>
              ) : null}

              {syncBatch.status === "canceling" ? (
                <InlineAlert tone="warning" title="Cancellation requested.">
                  Remaining queued jobs are being discarded. The active chunk will stop at the next safe checkpoint, and
                  rows already mirrored in Supabase will remain in place.
                </InlineAlert>
              ) : null}

              {syncBatch.status === "canceled" ? (
                <InlineAlert tone="warning" title="This sync batch was canceled.">
                  The queue is cleared, but {syncBatch.recordsUpserted} mirrored row{syncBatch.recordsUpserted === 1 ? "" : "s"} written
                  before cancel took effect remain in Supabase.
                </InlineAlert>
              ) : null}

              {syncBatch.status === "failed" && primaryFailedJob ? (
                <InlineAlert tone="danger" title={`Job ${primaryFailedJob.sequenceIndex + 1} failed.`}>
                  {formatSyncWindow(primaryFailedJob.window)}
                  {primaryFailedJob.errorMessage?.trim() ? `: ${primaryFailedJob.errorMessage.trim()}` : "."}
                </InlineAlert>
              ) : null}

              {syncBatch ? (
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      {syncBatch.syncMode === "specific_dates" ? "Selected dates" : "Overall window"}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                      {formatBatchScope(syncBatch, 4)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncBatch.syncMode === "specific_dates"
                        ? `${syncBatch.selectedDates?.length ?? syncBatch.totalChunks} explicit date job${(syncBatch.selectedDates?.length ?? syncBatch.totalChunks) === 1 ? "" : "s"} queued`
                        : `${syncModeLabel(syncBatch.syncMode)} plan`}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Current job
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--color-ink)]">
                      {formatSyncWindow(syncBatch.currentWindow)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncBatch.syncMode === "specific_dates"
                        ? "One explicit date per queued run"
                        : `Up to ${syncBatch.chunkSizeDays} days per queued run`}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Jobs completed
                    </p>
                    <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                      {syncBatch.completedChunks} / {syncBatch.totalChunks}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncBatch.canceledChunks > 0
                        ? `${syncBatch.canceledChunks} canceled chunk${syncBatch.canceledChunks === 1 ? "" : "s"}; completed includes successful, failed, and canceled jobs.`
                        : syncBatch.failedChunks > 0
                        ? `${syncBatch.failedChunks} failed chunk${syncBatch.failedChunks === 1 ? "" : "s"}; completed includes both successful and failed jobs.`
                        : "Each background job is written and tracked separately."}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Rows stored so far
                    </p>
                    <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">{syncBatch.recordsUpserted}</p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncBatch.warningsCount > 0
                        ? `${syncBatch.warningsCount} warning${syncBatch.warningsCount === 1 ? "" : "s"} across completed chunks`
                        : "No warnings across completed chunks"}
                    </p>
                    {syncBatch.warningsCount > 0 ? (
                      <div className="mt-3">
                        <Button type="button" variant="ghost" size="sm" onClick={() => showBatchWarnings(syncBatch)}>
                          View warnings
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {syncProgress ? (
                <div className="space-y-3">
                <div className="h-2 overflow-hidden rounded-full bg-[var(--color-soft-surface)]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      syncProgress.stage === "failed" ? "bg-[var(--color-danger)]" : "bg-[var(--color-primary)]"
                    )}
                    style={{ width: `${Math.max(8, Math.round(displayedOverallProgress * 100))}%` }}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {syncStageKeys.map((stageKey, index) => {
                    const isComplete =
                      syncProgress.stage === "complete" ||
                      (syncProgress.stage !== "failed" && index < syncProgress.stageIndex);
                    const isCurrent = syncProgress.stage === stageKey;
                    const fill = isComplete ? 1 : isCurrent ? (syncProgress.stageProgress ?? 0.42) : 0;

                    return (
                      <div key={stageKey} className="space-y-2">
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-soft-surface)]">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              isComplete || isCurrent
                                ? syncProgress.stage === "failed" && isCurrent
                                  ? "bg-[var(--color-danger)]"
                                  : "bg-[var(--color-primary)]"
                                : "bg-transparent",
                              isCurrent && syncProgress.stageProgress === null ? "animate-pulse" : ""
                            )}
                            style={{ width: `${Math.round(fill * 100)}%` }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-[var(--color-ink)]">
                            {stageKey === "roster"
                              ? "Roster"
                              : stageKey === "discovery"
                                ? "Discovery"
                                : stageKey === "detail_fetch"
                                  ? "Detail fetch"
                                  : "Upsert"}
                          </p>
                          <p className="text-xs leading-6 text-[var(--color-muted)]">
                            {syncStageSubtitle(syncProgress, stageKey)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              ) : null}

              {syncProgress ? (
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Roster
                    </p>
                    <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                      {syncProgress.rosterStudentsUpserted}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncProgress.rosterStudentsFetched > 0
                        ? `${syncProgress.rosterStudentsFetched} students fetched`
                        : "Waiting for roster scan"}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Discovery
                    </p>
                    <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                      {syncProgress.discoveredRecords}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncProgress.discoveryStudentsTotal > 0
                        ? `${syncProgress.discoveryStudentsProcessed} of ${syncProgress.discoveryStudentsTotal} students scanned`
                        : "Incidents found in the selected window"}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Detail fetch
                    </p>
                    <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">
                      {syncProgress.detailRecordsProcessed}
                      {syncProgress.detailRecordsTotal > 0 ? ` / ${syncProgress.detailRecordsTotal}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncProgress.detailRecordsTotal > 0
                        ? `${Math.max(syncProgress.detailRecordsTotal - syncProgress.detailRecordsProcessed, 0)} left`
                        : "Waiting for detail stage"}
                    </p>
                  </div>
                  <div className="rounded-[1.25rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                      Upsert
                    </p>
                    <p className="mt-2 font-display text-2xl text-[var(--color-ink)]">{syncProgress.recordsUpserted}</p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {syncProgress.warningsCount > 0
                        ? `${syncProgress.warningsCount} warning${syncProgress.warningsCount === 1 ? "" : "s"}`
                        : "No warnings so far"}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[1.3rem] border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-sm leading-7 text-[var(--color-muted)]">
                {syncMessage}
              </div>
            </SoftPanel>
          ) : null}
        </Panel>

        <Panel className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl text-[var(--color-ink)]">Recent Sycamore jobs</h2>
            {recentSyncBatches.length > 0 ? (
              <StatusBadge tone="neutral">{recentSyncBatches.length} shown</StatusBadge>
            ) : null}
          </div>

          {recentSyncBatches.length === 0 ? (
            <EmptyState
              title="No background Sycamore jobs yet"
              description="Queued sync batches will appear here once the first manual or scheduled job is created."
            />
          ) : (
            <div className={tableShellClassName}>
              <div className="overflow-x-auto">
                <table className={tableClassName}>
                  <thead>
                    <tr>
                      <th className={tableHeadCellClassName}>Started</th>
                      <th className={tableHeadCellClassName}>Scope</th>
                      <th className={tableHeadCellClassName}>Status</th>
                      <th className={tableHeadCellClassName}>Jobs</th>
                      <th className={tableHeadCellClassName}>Rows stored</th>
                      <th className={tableHeadCellClassName}>Warnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {recentSyncBatches.map((batch) => (
                      <tr key={batch.batchId}>
                        <td className={tableCellClassName}>{formatBatchTimestamp(batch)}</td>
                        <td className={tableCellClassName}>
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--color-ink)]">
                              {formatBatchScope(batch, 3)}
                            </p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">
                              {syncModeLabel(batch.syncMode)}
                            </p>
                          </div>
                        </td>
                        <td className={tableCellClassName}>
                          <StatusBadge
                            tone={
                              batch.isStalled
                                ? "danger"
                                : batch.status === "failed"
                                  ? "danger"
                                  : batch.status === "running"
                                    ? "info"
                                    : batch.status === "queued" || batch.status === "canceling" || batch.status === "canceled"
                                      ? "warning"
                                      : "success"
                            }
                          >
                            {batch.isStalled ? "stalled" : batch.status}
                          </StatusBadge>
                        </td>
                        <td className={tableCellClassName}>
                          {batch.completedChunks} / {batch.totalChunks}
                        </td>
                        <td className={tableCellClassName}>{batch.recordsUpserted}</td>
                        <td className={tableCellClassName}>
                          <div className="flex items-center gap-3">
                            <span>{batch.warningsCount}</span>
                            {batch.warningsCount > 0 ? (
                              <Button type="button" variant="ghost" size="sm" onClick={() => showBatchWarnings(batch)}>
                                View
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>

        {showFallbackTools ? (
          <Panel className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge tone="warning">Fallback</StatusBadge>
                  <StatusBadge tone="neutral">{jobs.length} PDF job{jobs.length === 1 ? "" : "s"}</StatusBadge>
                  <StatusBadge tone={flaggedRows > 0 ? "warning" : "neutral"}>
                    {flaggedRows} row{flaggedRows === 1 ? "" : "s"} flagged
                  </StatusBadge>
                </div>
                <div className="space-y-1">
                  <h2 className="font-display text-2xl text-[var(--color-ink)]">PDF backfill intake</h2>
                  <p className="max-w-2xl text-sm text-[var(--color-muted)]">
                    Use only when Sycamore is missing records or a historical PDF backfill is required.
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowFallbackTools(false)}>
                Hide
              </Button>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <label
                htmlFor="discipline-pdf"
                tabIndex={0}
                onKeyDown={onDropZoneKeyDown}
                onDragEnter={onDropZoneDragEnter}
                onDragOver={onDropZoneDragOver}
                onDragLeave={onDropZoneDragLeave}
                onDrop={onDropZoneDrop}
                className={cn(
                  "group flex cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border border-dashed px-6 py-10 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-panel)]",
                  isDragActive
                    ? "border-[var(--color-primary)] bg-white shadow-card"
                    : "border-[var(--color-line-strong)] bg-[var(--color-soft-surface)] hover:border-[var(--color-primary)] hover:bg-white"
                )}
              >
                <div
                  className={cn(
                    "rounded-full p-4 text-[var(--color-primary)] shadow-card transition",
                    isDragActive ? "bg-[var(--color-soft-surface)]" : "bg-white"
                  )}
                >
                  <FileUp className="h-6 w-6" />
                </div>
                <p className="mt-4 font-display text-2xl text-[var(--color-ink)]">
                  {uploadHeading(selectedFiles, isDragActive)}
                </p>
                <p className="mt-2 max-w-md text-sm text-[var(--color-muted)]">
                  Drag PDFs here or click to browse. Each file creates its own parse run.
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                  {isDragActive ? "Release to add files" : "PDFs only"}
                </p>
                <input
                  id="discipline-pdf"
                  ref={fileInputRef}
                  name="files"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    handleIncomingFiles(event.currentTarget.files);
                  }}
                  required
                />
              </label>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-[var(--color-muted)]">{selectionSummary(selectedFiles)}</div>
                <Button type="submit" variant="secondary" disabled={isUploading}>
                  {isUploading
                    ? `Uploading ${selectedFiles.length || 1} PDF${selectedFiles.length === 1 ? "" : "s"}...`
                    : `Upload ${selectedFiles.length > 1 ? "PDFs" : "PDF"}`}
                </Button>
              </div>
            </form>
          </Panel>
        ) : null}
      </section>

      {error ? (
        <InlineAlert tone="danger" title="Data intake action failed.">
          {error}
        </InlineAlert>
      ) : null}

      {summary ? (
        <InlineAlert tone={summaryTone} title={summaryTitle}>
          {summary}
        </InlineAlert>
      ) : null}

      {actionWarnings.length > 0 ? (
        <Panel ref={warningsPanelRef} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[#fff7e8] p-3 text-[var(--color-warning)]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-2xl text-[var(--color-ink)]">Sync warnings</h2>
                <p className="text-sm text-[var(--color-muted)]">
                  {selectedWarningBatch
                    ? `Showing ${selectedWarningBatch.warningsCount} warning${selectedWarningBatch.warningsCount === 1 ? "" : "s"} for ${formatBatchScope(selectedWarningBatch, 4)}.`
                    : "Use these to understand what still needs follow-up after the latest Sycamore sync."}
                </p>
              </div>
            </div>
            {selectedWarningBatchId ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedWarningBatchId(null)}>
                Show current warnings
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3">
            {actionWarnings.map((warning, index) => {
              const warningDetail = formatSycamoreWarningDetail(warning);
              return (
                <div
                  key={`${warning}-${index}`}
                  className="rounded-[1.25rem] border border-[#ead7aa] bg-[#fdf7e6] px-4 py-3 text-sm leading-6 text-[var(--color-warning)]"
                >
                  <p className="font-semibold text-[var(--color-ink)]">{warningDetail.title}</p>
                  {warningDetail.description ? (
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{warningDetail.description}</p>
                  ) : null}
                  {warningDetail.reference ? (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-subtle)]">
                      Refers to: {warningDetail.reference}
                    </p>
                  ) : null}
                  <p className="mt-2 break-all font-mono text-xs text-[var(--color-warning)]">{warning}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {showFallbackTools ? (
        <Panel className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Fallback activity</p>
              <h2 className="mt-2 font-display text-3xl text-[var(--color-ink)]">Recent PDF import jobs</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
              This table lists parser jobs only; Sycamore sync status is tracked separately.
            </div>
          </div>

          {jobs.length === 0 ? (
            <EmptyState
              title="No fallback PDF jobs yet"
              description="Use PDF import only for exceptions or backfill when Sycamore is missing needed records."
            />
          ) : (
            <div className={tableShellClassName}>
              <div className="overflow-x-auto">
                <table className={tableClassName}>
                  <thead>
                    <tr>
                      <th className={tableHeadCellClassName}>Started</th>
                      <th className={tableHeadCellClassName}>Source</th>
                      <th className={tableHeadCellClassName}>File</th>
                      <th className={tableHeadCellClassName}>Status</th>
                      <th className={tableHeadCellClassName}>Rows extracted</th>
                      <th className={tableHeadCellClassName}>Flagged</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-line)]">
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td className={tableCellClassName}>{new Date(job.startedAt).toLocaleString()}</td>
                        <td className={tableCellClassName}>
                          <StatusBadge tone="neutral">{sourceLabel(job.sourceType)}</StatusBadge>
                        </td>
                        <td className={tableCellClassName}>
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--color-ink)]">{job.fileName}</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-subtle)]">{job.id}</p>
                          </div>
                        </td>
                        <td className={tableCellClassName}>
                          <StatusBadge tone={toneForJobStatus(job.status)}>{job.status}</StatusBadge>
                        </td>
                        <td className={tableCellClassName}>{job.rowsExtracted}</td>
                        <td className={tableCellClassName}>{job.rowsFlagged}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
