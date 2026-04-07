import { enqueueSycamoreSyncBatch, type EnqueueSycamoreSyncBatchResult } from "@/lib/sycamore-sync-jobs";

export type QueueCronSycamoreSyncResult = {
  status: number;
  body: {
    sycamoreSync: EnqueueSycamoreSyncBatchResult["batch"];
    alreadyQueued: boolean;
  };
};

export async function queueCronSycamoreSync(options?: {
  enqueueBatch?: typeof enqueueSycamoreSyncBatch;
}): Promise<QueueCronSycamoreSyncResult> {
  const enqueueBatch = options?.enqueueBatch ?? enqueueSycamoreSyncBatch;
  const queued = await enqueueBatch({
    triggeredBy: "cron",
    actorEmail: "system:cron"
  });

  return {
    status: queued.alreadyQueued ? 200 : 202,
    body: {
      sycamoreSync: queued.batch,
      alreadyQueued: queued.alreadyQueued
    }
  };
}
