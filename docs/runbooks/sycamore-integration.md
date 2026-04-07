# Sycamore Integration Runbook

## Purpose

Validate and operate the Sycamore discipline integration for the admin app.

## Prerequisites

- A Sycamore bearer token created from the Sycamore UI under `My Organizer -> Applications`
- The correct Sycamore `schoolId`
- Network reachability from the web app runtime to the Sycamore API host

## Required environment variables

```bash
SYCAMORE_API_ENABLED=true
SYCAMORE_ACCESS_TOKEN=...
SYCAMORE_SCHOOL_ID=...
SYCAMORE_API_BASE_URL=https://app.sycamoreschool.com/api/v1
SYCAMORE_DISCIPLINE_PATH_TEMPLATE=/School/{schoolId}/Discipline
CRON_SECRET=...
SYCAMORE_REQUEST_DELAY_MS=150
SYCAMORE_FALLBACK_DISCOVERY_CONCURRENCY=4
SYCAMORE_SCHOOL_YEAR_START_MONTH=8
SYCAMORE_SCHOOL_YEAR_START_DAY=1
SYCAMORE_INCREMENTAL_OVERLAP_DAYS=1
```

## Scheduler configuration

Signal now uses GitHub Actions as the scheduler source of truth on Vercel Hobby.

Configure these values before enabling the workflows:

- Vercel environment variable:
  - `CRON_SECRET`
- GitHub repository secret:
  - `SIGNAL_CRON_SECRET`
- GitHub repository variable:
  - `SIGNAL_BASE_URL`

GitHub setup path:

- open the repository on GitHub
- go to `Settings -> Secrets and variables -> Actions`
- add `SIGNAL_CRON_SECRET` under `Secrets`
- add `SIGNAL_BASE_URL` under `Variables`

Required value rules:

- `SIGNAL_CRON_SECRET` must exactly match the Vercel `CRON_SECRET`
- `SIGNAL_BASE_URL` must be the stable production origin without a trailing slash
- use the production URL, not a preview URL

GitHub Actions schedules:

- `Sycamore Sync Scheduler`: `7,37 * * * *` UTC
- `Sycamore Sync Worker`: `4-59/5 * * * *` UTC

Operational meaning:

- the scheduler calls `GET /api/sycamore/sync` every 30 minutes
- the worker calls `GET /api/sycamore/sync/jobs/run` every 5 minutes
- GitHub scheduled workflows are best-effort and can drift by a few minutes

## Probe the connection

Run a live probe once the variables are present:

```bash
npm run sycamore:probe --workspace @syc/web -- --date=2026-03-10
```

Expected outcome:

- discipline fetch succeeds for the requested date
- sample keys are printed for the school list and detail response shapes

If the probe fails:

- `401` or `403`: verify the token and the permissions on the Sycamore user that created it
- `404`: verify the base URL and path template
- `204` on discipline: the date may simply have no discipline records
- If the school-level discipline feed stays empty while student discipline endpoints return data, the app will fall back to a roster scan using `/Student/{id}/Discipline`

## Operating modes

- Manual range sync: use the dashboard or ingestion page and submit `startDate` and `endDate`
- Default sync: use the dashboard button, the ingestion page action, or GitHub Actions against `GET /api/sycamore/sync`

Default sync behavior:

- first successful run: current school-year backfill
- later runs: incremental window from the last successful sync with the configured overlap

Scheduler behavior:

- repeated scheduler calls are safe because the app reuses the active batch instead of queueing duplicates
- the worker can return `executed: false` when there is no claimable queued job
- the scheduler can return `alreadyQueued: true` when a batch is already active

Manual recovery:

- use GitHub Actions `workflow_dispatch` on `Sycamore Sync Scheduler` to enqueue the next incremental batch immediately
- use GitHub Actions `workflow_dispatch` on `Sycamore Sync Worker` to advance queued jobs immediately
- use the admin ingestion page and `/api/sycamore/sync/jobs` status surfaces to confirm batch state, heartbeat freshness, and recent results

## Notes

- The integration is pull-only. It does not write data back to Sycamore.
- Imported rows are written directly to `sycamore_discipline_logs` and `sycamore_sync_log`.
- `sycamore_discipline_logs` stores normalized analytics fields alongside the raw payload, including `points`, `level`, `violation`, `violation_raw`, `resolution`, `author_name`, and `author_name_raw`.
- This dataset is read-only for dashboard/reporting in v1. It does not create review tasks, approved incidents, notifications, or interventions automatically.
- Local student linking is opportunistic through `students.external_id`.
- Idempotency is based on Sycamore `sycamore_log_id`.
- The app prefers the school-wide discipline feed first, then falls back to per-student discipline discovery if the school feed returns no rows for the requested window.
- For large schools, the per-student fallback can still take several minutes. Tune `SYCAMORE_REQUEST_DELAY_MS` and `SYCAMORE_FALLBACK_DISCOVERY_CONCURRENCY` together if the deployment runtime is too slow.
- GitHub Actions is the active automation path. The repo no longer relies on Vercel cron configuration for Sycamore ingestion scheduling.
