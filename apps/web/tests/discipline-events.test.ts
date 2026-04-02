import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Student } from "@syc/domain";

import { listDisciplineEvents } from "../lib/discipline-events";
import { createInMemoryStorage } from "./review-actions.test";

function seedStudents(): Student[] {
  return [
    {
      id: "stu_1",
      externalId: "student-1",
      fullName: "Jane Doe",
      grade: "8",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];
}

function seedIncidents(): ApprovedIncident[] {
  return [
    {
      id: "inc_sycamore",
      studentId: "stu_1",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-1",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      writeupDate: "2026-03-10",
      points: 4,
      reason: "Disrespect",
      violation: "Disrespect",
      violationRaw: "Level 1: Disrespect",
      level: 1,
      comment: "",
      description: "Talked back in class",
      resolution: "Lunch detention",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_sycamore",
      fingerprint: "fp_sycamore",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_manual_duplicate",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-1",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      writeupDate: "2026-03-10",
      points: 4,
      reason: "Disrespect",
      violation: "Disrespect",
      violationRaw: "Level 1: Disrespect",
      level: 1,
      comment: "",
      description: "Talked back in class",
      resolution: "Lunch detention",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_manual",
      fingerprint: "fp_manual_duplicate",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T12:00:00.000Z"
    },
    {
      id: "inc_manual_fallback",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-2",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-12T10:00:00.000Z",
      writeupDate: "2026-03-12",
      points: 2,
      reason: "Tardy",
      violation: "Tardy",
      violationRaw: "Level 0: Tardy",
      level: 0,
      comment: "",
      description: "Late to class",
      resolution: "Warning",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_manual",
      fingerprint: "fp_manual_fallback",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-12T12:00:00.000Z"
    }
  ];
}

test("listDisciplineEvents prefers Sycamore rows and keeps unmatched PDF rows as fallback", async () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents()
    });

    const events = await listDisciplineEvents(storage);

    assert.equal(events.length, 2);
    assert.equal(events[0]?.sourceType, "manual_pdf");
    assert.equal(events[0]?.isFallback, true);
    assert.equal(events[1]?.sourceType, "sycamore_api");
    assert.equal(events[1]?.hasSourceConflict, true);
    assert.deepEqual(
      events.map((event) => event.sourceRecordId).sort(),
      ["disc-1", "pdf-2"]
    );
  } finally {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test("listDisciplineEvents paginates through all Supabase discipline event rows", async () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  const rows = Array.from({ length: 1001 }, (_, index) => {
    const rowIndex = index + 1;
    const day = String(((rowIndex - 1) % 28) + 1).padStart(2, "0");
    return {
      event_key: `event-${rowIndex}`,
      source_type: "sycamore_api",
      source_priority: 1,
      source_record_id: `source-${rowIndex}`,
      student_id: `student-${rowIndex}`,
      local_student_id: `student-${rowIndex}`,
      student_external_id: `ext-${rowIndex}`,
      student_name: `Student ${rowIndex}`,
      grade: "8",
      incident_date: `2026-03-${day}`,
      occurred_at: `2026-03-${day}T10:00:00.000Z`,
      points: 1,
      level: 1,
      violation: "Disrespect",
      violation_raw: "Disrespect",
      reason: "Disrespect",
      description: "Incident",
      resolution: "Warning",
      author_name: "Teacher",
      source_table: "sycamore_discipline_logs",
      source_synced_at: `2026-03-${day}T11:00:00.000Z`,
      is_fallback: false,
      has_source_conflict: false
    };
  });

  const requestedRanges: Array<[number, number]> = [];

  const fakeClient = {
    from(table: "discipline_events") {
      assert.equal(table, "discipline_events");
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        eq() {
          return this;
        },
        or() {
          return this;
        },
        async range(from: number, to: number) {
          requestedRanges.push([from, to]);
          return {
            data: rows.slice(from, to + 1),
            error: null
          };
        }
      };
    }
  };

  try {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: [],
      approvedIncidents: []
    });

    const events = await listDisciplineEvents(storage, undefined, undefined, {
      supabaseClient: fakeClient
    });

    assert.equal(events.length, 1001);
    assert.deepEqual(requestedRanges, [
      [0, 999],
      [1000, 1999]
    ]);
    assert.equal(events[0]?.sourceRecordId, "source-1");
    assert.equal(events[1000]?.sourceRecordId, "source-1001");
  } finally {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});
