import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, AuditEvent, Intervention, Notification, Student } from "@syc/domain";

import { buildStudentDetailSnapshot, buildStudentDirectoryRows } from "../lib/student-profiles";
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
    },
    {
      id: "stu_2",
      externalId: "student-2",
      fullName: "John Roe",
      grade: "7",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  ];
}

function seedIncidents(): ApprovedIncident[] {
  return [
    {
      id: "inc_sycamore_jane",
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
      fingerprint: "fp_sycamore_jane",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_manual_jane",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-1",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-14T09:15:00.000Z",
      writeupDate: "2026-03-14",
      points: 2,
      reason: "Unprepared",
      violation: "Unprepared",
      violationRaw: "Level 0: Unprepared",
      level: 0,
      comment: "",
      description: "Arrived without required materials",
      resolution: "Family reminder",
      teacherName: "Ms Smith",
      authorName: "Ms Smith",
      authorNameRaw: null,
      sourceJobId: "run_manual_jane",
      fingerprint: "fp_manual_jane",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-14T10:00:00.000Z"
    },
    {
      id: "inc_manual_john",
      studentId: "stu_2",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf-2",
      externalStudentId: "student-2",
      gradeAtEvent: "7",
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
      teacherName: "Ms Jones",
      authorName: "Ms Jones",
      authorNameRaw: null,
      sourceJobId: "run_manual",
      fingerprint: "fp_manual_john",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-12T12:00:00.000Z"
    }
  ];
}

function seedInterventions(): Intervention[] {
  return [
    {
      id: "int_1",
      studentId: "stu_1",
      policyVersion: 1,
      milestoneLabel: "Parent outreach",
      status: "open",
      dueDate: "2026-03-15T00:00:00.000Z",
      completedAt: null,
      assignedTo: "Dean",
      notes: "Follow up this week"
    }
  ];
}

function seedNotifications(): Notification[] {
  return [
    {
      id: "notif_1",
      studentId: "stu_1",
      interventionId: "int_1",
      channel: "email",
      recipient: "family@example.com",
      status: "sent",
      providerId: "provider_1",
      sentAt: "2026-03-12T15:00:00.000Z",
      error: ""
    }
  ];
}

function seedAuditEvents(): AuditEvent[] {
  return [
    {
      id: "audit_1",
      eventType: "student.synced",
      entityType: "student",
      entityId: "stu_1",
      actor: "system",
      payloadJson: JSON.stringify({ studentId: "stu_1", externalId: "student-1" }),
      createdAt: "2026-03-12T16:00:00.000Z"
    }
  ];
}

function withoutSupabaseEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalPublicSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  return run().finally(() => {
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  });
}

test("buildStudentDirectoryRows defaults to merged incidents for student totals", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const rows = await buildStudentDirectoryRows(storage, {});

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, "stu_1");
    assert.equal(rows[0]?.totalPoints, 6);
    assert.equal(rows[0]?.incidentCount, 2);
    assert.equal(rows[0]?.interventionCount, 1);
    assert.equal(rows[1]?.id, "stu_2");
    assert.equal(rows[1]?.totalPoints, 2);
    assert.equal(rows[1]?.incidentCount, 1);
  });
});

test("buildStudentDirectoryRows matches partial student names", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const rows = await buildStudentDirectoryRows(storage, { search: "ane" });

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "stu_1");
    assert.equal(rows[0]?.fullName, "Jane Doe");
  });
});

test("buildStudentDirectoryRows filters the communication ladder and exact handbook bands", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: [
        {
          ...seedIncidents()[0]!,
          points: 12
        },
        {
          ...seedIncidents()[2]!,
          points: 36
        }
      ],
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const ladderRows = await buildStudentDirectoryRows(storage, { bandId: "communication_ladder" });
    assert.equal(ladderRows.length, 2);
    assert.deepEqual(
      ladderRows.map((student) => student.id),
      ["stu_2", "stu_1"]
    );

    const tenToNineteenRows = await buildStudentDirectoryRows(storage, { bandId: "points_10_19" });
    assert.equal(tenToNineteenRows.length, 1);
    assert.equal(tenToNineteenRows[0]?.id, "stu_1");

    const twentyToThirtyNineRows = await buildStudentDirectoryRows(storage, { bandId: "points_20_39" });
    assert.equal(twentyToThirtyNineRows.length, 1);
    assert.equal(twentyToThirtyNineRows[0]?.id, "stu_2");
  });
});

test("buildStudentDirectoryRows merges split student identities before filtering 40+ bands", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: [
        {
          id: "inc_split_sycamore",
          studentId: "sycamore:student-1",
          sourceType: "sycamore_api",
          sourceRecordId: "disc-split-1",
          externalStudentId: "student-1",
          gradeAtEvent: "8",
          eventType: "discipline",
          occurredAt: "2026-03-01T10:00:00.000Z",
          writeupDate: "2026-03-01",
          points: 35,
          reason: "Repeated disruption",
          violation: "Repeated disruption",
          violationRaw: "Repeated disruption",
          level: 3,
          comment: "",
          description: "Repeated disruption",
          resolution: "Conference",
          teacherName: "Ms Smith",
          authorName: "Ms Smith",
          authorNameRaw: null,
          sourceJobId: "run_sycamore_split",
          fingerprint: "fp_split_sycamore",
          reviewedBy: "reviewer@school.org",
          reviewedAt: "2026-03-01T11:00:00.000Z"
        },
        {
          id: "inc_split_manual",
          studentId: "stu_1",
          sourceType: "manual_pdf",
          sourceRecordId: "pdf-split-1",
          externalStudentId: "student-1",
          gradeAtEvent: "8",
          eventType: "discipline",
          occurredAt: "2026-03-05T10:00:00.000Z",
          writeupDate: "2026-03-05",
          points: 10,
          reason: "Hallway conduct",
          violation: "Hallway conduct",
          violationRaw: "Hallway conduct",
          level: 1,
          comment: "",
          description: "Hallway conduct",
          resolution: "Warning",
          teacherName: "Ms Smith",
          authorName: "Ms Smith",
          authorNameRaw: null,
          sourceJobId: "run_manual_split",
          fingerprint: "fp_split_manual",
          reviewedBy: "reviewer@school.org",
          reviewedAt: "2026-03-05T11:00:00.000Z"
        }
      ],
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const rows = await buildStudentDirectoryRows(storage, { bandId: "points_40_plus" });

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "stu_1");
    assert.equal(rows[0]?.totalPoints, 45);
    assert.equal(rows[0]?.incidentCount, 2);
  });
});

test("buildStudentDetailSnapshot returns merged incident history for the selected student by default", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const detail = await buildStudentDetailSnapshot(storage, "stu_1");

    assert.ok(detail);
    assert.equal(detail?.student.id, "stu_1");
    assert.equal(detail?.warnings.guardianContactsUnavailable, false);
    assert.equal(detail?.incidents.length, 2);
    assert.deepEqual(detail?.incidents.map((incident) => incident.sourceType), ["manual_pdf", "sycamore_api"]);
    assert.equal(detail?.incidents[0]?.reason, "Unprepared");
    assert.equal(detail?.incidents[0]?.authorName, "Ms Smith");
    assert.equal(detail?.incidents[0]?.resolution, "Family reminder");
    assert.equal(detail?.interventions.length, 1);
    assert.equal(detail?.notifications.length, 1);
    assert.equal(detail?.auditEvents.length, 1);
  });
});

test("buildStudentDetailSnapshot still supports a single-source filter", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    const detail = await buildStudentDetailSnapshot(storage, "stu_1", "sycamore_api");

    assert.ok(detail);
    assert.equal(detail?.incidents.length, 1);
    assert.equal(detail?.incidents[0]?.sourceType, "sycamore_api");
    assert.equal(detail?.incidents[0]?.reason, "Disrespect");
  });
});

test("buildStudentDetailSnapshot degrades gracefully when guardian_contacts is unavailable", async () => {
  await withoutSupabaseEnv(async () => {
    const storage = createInMemoryStorage({
      parseRuns: [],
      rawIncidents: [],
      reviewTasks: [],
      students: seedStudents(),
      approvedIncidents: seedIncidents(),
      interventions: seedInterventions(),
      notifications: seedNotifications(),
      auditEvents: seedAuditEvents()
    });

    storage.guardianContacts.listByStudent = async () => {
      throw new Error(
        `Supabase filter by student id failed for table "guardian_contacts": Could not find the table 'public.guardian_contacts' in the schema cache`
      );
    };

    const detail = await buildStudentDetailSnapshot(storage, "stu_1");

    assert.ok(detail);
    assert.equal(detail?.student.id, "stu_1");
    assert.equal(detail?.warnings.guardianContactsUnavailable, true);
    assert.deepEqual(detail?.guardianContacts, []);
    assert.equal(detail?.incidents.length, 2);
    assert.equal(detail?.interventions.length, 1);
    assert.equal(detail?.notifications.length, 1);
    assert.equal(detail?.auditEvents.length, 1);
  });
});
