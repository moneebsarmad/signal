import assert from "node:assert/strict";
import test from "node:test";

import type { EnqueueSycamoreSyncBatchResult } from "../lib/sycamore-sync-jobs";
import { queueCronSycamoreSync } from "../lib/sycamore-sync-cron";

function makeBatchResult(overrides: Partial<EnqueueSycamoreSyncBatchResult> = {}): EnqueueSycamoreSyncBatchResult {
  return {
    batch: {
      batchId: "batch_1",
      syncLogId: null,
      status: "queued",
      syncMode: "incremental",
      selectedDates: null,
      window: {
        startDate: "2026-04-06",
        endDate: "2026-04-07"
      },
      overallWindow: {
        startDate: "2026-04-06",
        endDate: "2026-04-07"
      },
      totalChunks: 1,
      completedChunks: 0,
      failedChunks: 0,
      canceledChunks: 0,
      activeChunkIndex: 0,
      currentWindow: {
        startDate: "2026-04-06",
        endDate: "2026-04-07"
      },
      chunkSizeDays: 2,
      recordsDiscovered: 0,
      recordsUpserted: 0,
      failedJobs: [],
      warnings: [],
      warningsCount: 0,
      createdAt: "2026-04-07T12:00:00.000Z",
      startedAt: null,
      completedAt: null,
      activeJobStartedAt: null,
      lastHeartbeatAt: null,
      staleAfterMinutes: 6,
      isStalled: false,
      triggeredBy: "cron",
      progress: null
    },
    jobs: [],
    alreadyQueued: false,
    ...overrides
  };
}

test("queueCronSycamoreSync enqueues cron work without starting inline execution", async () => {
  let callCount = 0;

  const result = await queueCronSycamoreSync({
    enqueueBatch: async (input) => {
      callCount += 1;
      assert.deepEqual(input, {
        triggeredBy: "cron",
        actorEmail: "system:cron"
      });
      return makeBatchResult();
    }
  });

  assert.equal(callCount, 1);
  assert.equal(result.status, 202);
  assert.equal(result.body.alreadyQueued, false);
  assert.equal(result.body.sycamoreSync.batchId, "batch_1");
  assert.equal(result.body.sycamoreSync.status, "queued");
});

test("queueCronSycamoreSync reuses an active batch with a 200 response", async () => {
  const result = await queueCronSycamoreSync({
    enqueueBatch: async () =>
      makeBatchResult({
        alreadyQueued: true,
        batch: makeBatchResult().batch
      })
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.alreadyQueued, true);
  assert.equal(result.body.sycamoreSync.batchId, "batch_1");
});
