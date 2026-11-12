import assert from "node:assert/strict";
import test from "node:test";

import type { ApprovedIncident, Intervention, Notification, ParseRun, Policy, Student } from "@syc/domain";

import { buildDashboardSnapshot, readDashboardFilters } from "../lib/dashboard";
import { createInMemoryStorage } from "./review-actions.test";

function seedPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    version: 1,
    baseThreshold: 10,
    warningOffsets: [-3, -1],
    milestones: [0, 10, 20, 30],
    interventionTemplates: "[]",
    communicationBands: "[]",
    createdBy: "admin@school.org",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides
  };
}

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
      grade: "8",
      active: true,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    },
    {
      id: "stu_3",
      externalId: "student-3",
      fullName: "Jamie Poe",
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
      id: "inc_old_manual",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf_old",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-02-05T10:00:00.000Z",
      points: 12,
      reason: "Disrespect",
      comment: "",
      teacherName: "Ms Smith",
      sourceJobId: "run_manual_old",
      fingerprint: "fp_old_manual",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-02-05T11:00:00.000Z"
    },
    {
      id: "inc_window_manual",
      studentId: "stu_1",
      sourceType: "manual_pdf",
      sourceRecordId: "pdf_new",
      externalStudentId: "student-1",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-10T10:00:00.000Z",
      points: 4,
      reason: "Disrespect",
      comment: "",
      teacherName: "Ms Smith",
      sourceJobId: "run_manual_new",
      fingerprint: "fp_new_manual",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-10T11:00:00.000Z"
    },
    {
      id: "inc_window_sycamore",
      studentId: "stu_2",
      sourceType: "sycamore_api",
      sourceRecordId: "disc-2",
      externalStudentId: "student-2",
      gradeAtEvent: "8",
      eventType: "discipline",
      occurredAt: "2026-03-11T10:00:00.000Z",
      points: 11,
      reason: "Class disruption",
      comment: "",
      teacherName: "Mr Adams",
      sourceJobId: "run_sycamore_new",
      fingerprint: "fp_new_sycamore",
      reviewedBy: "reviewer@school.org",
      reviewedAt: "2026-03-11T11:00:00.000Z"
    }
  ];
}

function seedParseRuns(): ParseRun[] {
  return [
    {
      id: "run_manual_new",
      sourceType: "manual_pdf",
      fileName: "discipline.pdf",
      uploadedBy: "admin@school.org",
      triggeredBy: "admin@school.org",
      metadataJson: "{}",
      cursorJson: null,
      status: "completed",
      rowsExtracted: 1,
      rowsFlagged: 0,
      startedAt: "2026-03-10T09:00:00.000Z",
      completedAt: "2026-03-10T09:05:00.000Z"
    },
    {
      id: "run_sycamore_new",
      sourceType: "sycamore_api",
      fileName: "sycamore.json",
      uploadedBy: "admin@school.org",
      triggeredBy: "admin@school.org",
      metadataJson: "{\"startDate\":\"2026-03-11\",\"endDate\":\"2026-03-11\"}",
      cursorJson: null,
      status: "review_required",
      rowsExtracted: 1,
      rowsFlagged: 0,
      startedAt: "2026-03-11T09:00:00.000Z",
      completedAt: "2026-03-11T09:05:00.000Z"
    }
  ];
}

function seedInterventions(): Intervention[] {
  return [
    {
      id: "int_1",
      studentId: "stu_3",
      policyVersion: 1,
      milestoneLabel: "Parent outreach",
      status: "open",
      dueDate: "2026-03-12T00:00:00.000Z",
      completedAt: null,
      assignedTo: "Dean",
      notes: "Needs follow-up."
    }
  ];
}

function seedNotifications(): Notification[] {
  return [
    {
      id: "notif_1",
      studentId: "stu_3",
      interventionId: "int_1",
      channel: "email",
      recipient: "family3@example.com",
      status: "queued",
      providerId: "provider_1",
      sentAt: null,
      error: "",
      kind: "parent_outreach",
      draftSubject: "Parent outreach",
      draftBody: "Please contact the school."
    }
  ];
}

test("readDashboardFilters defaults the dashboard to merged sources when no source is supplied", () => {
  const filters = readDashboardFilters(new URLSearchParams("grade=8&from=2026-03-01&to=2026-03-31"));
  assert.equal(filters.sourceType, "all");
});

test("buildDashboardSnapshot surfaces cumulative escalation posture for the live source slice", async () => {
  const storage = createInMemoryStorage({
    parseRuns: seedParseRuns(),
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    policies: [seedPolicy()],
    interventions: seedInterventions(),
    notifications: seedNotifications()
  });

  const marchSnapshot = await buildDashboardSnapshot(storage, {
    grade: "8"
  });
  assert.equal(Number.isNaN(Date.parse(marchSnapshot.generatedAt)), false);
  assert.equal(marchSnapshot.metrics.studentsTracked, 2);
  assert.equal(marchSnapshot.metrics.studentsAt5Plus, 2);
  assert.equal(marchSnapshot.metrics.incidentsTracked, 3);
  assert.equal(marchSnapshot.metrics.totalPoints, 27);
  assert.equal(marchSnapshot.metrics.openInterventions, 1);
  assert.equal(marchSnapshot.metrics.queuedNotifications, 1);
  assert.equal(marchSnapshot.metrics.studentsMissingParentEmailAt5Plus, 2);
  assert.equal(marchSnapshot.warnings.guardianContactsUnavailable, false);
  assert.equal(marchSnapshot.actionQueue[0]?.studentId, "stu_1");
  assert.equal(marchSnapshot.actionQueue[0]?.currentBandId, "points_10_19");
  assert.match(marchSnapshot.actionQueue[0]?.parentCommunication ?? "", /administrator conference/i);
  assert.deepEqual(marchSnapshot.parseRunSourceCounts, { manual_pdf: 1, sycamore_api: 1 });

  const pdfExceptionSnapshot = await buildDashboardSnapshot(storage, {
    grade: "8",
    sourceType: "manual_pdf"
  });
  assert.equal(pdfExceptionSnapshot.metrics.studentsTracked, 1);
  assert.equal(pdfExceptionSnapshot.metrics.incidentsTracked, 2);
  assert.equal(pdfExceptionSnapshot.metrics.totalPoints, 16);
  assert.equal(pdfExceptionSnapshot.metrics.studentsAt5Plus, 1);
  assert.equal(pdfExceptionSnapshot.actionQueue[0]?.studentId, "stu_1");
  assert.equal(pdfExceptionSnapshot.actionQueue[0]?.currentBandId, "points_10_19");
  assert.deepEqual(pdfExceptionSnapshot.parseRunSourceCounts, { manual_pdf: 1 });
});

test("buildDashboardSnapshot uses editable ladder copy from the saved policy", async () => {
  const storage = createInMemoryStorage({
    parseRuns: seedParseRuns(),
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    policies: [
      seedPolicy({
        communicationBands: JSON.stringify([
          {
            id: "points_10_19",
            label: "10 to 19 handbook points",
            shortLabel: "10-19",
            parentCommunication: "Call and email the parent or guardian.",
            adminAction: "Document the outreach and note program risk.",
            adminMessage: "Use the handbook script for first-level outreach.",
            policyImpact: "The student enters the first escalation band."
          }
        ])
      })
    ],
    interventions: seedInterventions(),
    notifications: seedNotifications()
  });

  const snapshot = await buildDashboardSnapshot(storage, {
    grade: "8"
  });

  assert.equal(snapshot.bandCounts.find((band) => band.id === "points_10_19")?.parentCommunication, "Call and email the parent or guardian.");
  assert.equal(snapshot.actionQueue.find((student) => student.currentBandId === "points_10_19")?.adminAction, "Document the outreach and note program risk.");
});

test("buildDashboardSnapshot merges split student identities before assigning ladder bands", async () => {
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
        points: 35,
        reason: "Repeated disruption",
        comment: "",
        teacherName: "Ms Smith",
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
        points: 10,
        reason: "Hallway conduct",
        comment: "",
        teacherName: "Ms Smith",
        sourceJobId: "run_manual_split",
        fingerprint: "fp_split_manual",
        reviewedBy: "reviewer@school.org",
        reviewedAt: "2026-03-05T11:00:00.000Z"
      },
      {
        id: "inc_threshold_35",
        studentId: "stu_2",
        sourceType: "manual_pdf",
        sourceRecordId: "pdf-threshold-35",
        externalStudentId: "student-2",
        gradeAtEvent: "8",
        eventType: "discipline",
        occurredAt: "2026-03-07T10:00:00.000Z",
        points: 35,
        reason: "Class disruption",
        comment: "",
        teacherName: "Mr Adams",
        sourceJobId: "run_manual_35",
        fingerprint: "fp_threshold_35",
        reviewedBy: "reviewer@school.org",
        reviewedAt: "2026-03-07T11:00:00.000Z"
      }
    ],
    policies: [seedPolicy()],
    interventions: [],
    notifications: []
  });

  const snapshot = await buildDashboardSnapshot(storage, {
    grade: "8"
  });

  assert.equal(snapshot.metrics.studentsTracked, 2);
  assert.equal(snapshot.metrics.studentsAt5Plus, 2);
  assert.equal(snapshot.metrics.studentsAt40Plus, 1);
  assert.equal(snapshot.bandCounts.find((band) => band.id === "points_10_19")?.count, 0);
  assert.equal(snapshot.bandCounts.find((band) => band.id === "points_30_39")?.count, 1);
  assert.equal(snapshot.bandCounts.find((band) => band.id === "points_40_plus")?.count, 1);
  assert.equal(snapshot.actionQueue[0]?.studentId, "stu_1");
  assert.equal(snapshot.actionQueue[0]?.currentBandId, "points_40_plus");
  assert.equal(snapshot.gradePressure[0]?.criticalCount, 1);
});

test("buildDashboardSnapshot tolerates a missing guardian contacts table", async () => {
  const storage = createInMemoryStorage({
    parseRuns: seedParseRuns(),
    rawIncidents: [],
    reviewTasks: [],
    students: seedStudents(),
    approvedIncidents: seedIncidents(),
    policies: [seedPolicy()],
    interventions: seedInterventions(),
    notifications: seedNotifications()
  });

  storage.guardianContacts.list = async () => {
    throw new Error(
      `Supabase select failed for table "guardian_contacts": Could not find the table 'public.guardian_contacts' in the schema cache`
    );
  };

  const snapshot = await buildDashboardSnapshot(storage, {
    grade: "8"
  });

  assert.equal(snapshot.metrics.studentsTracked, 2);
  assert.equal(snapshot.metrics.studentsMissingParentEmailAt5Plus, null);
  assert.equal(snapshot.warnings.guardianContactsUnavailable, true);
  assert.equal(snapshot.actionQueue[0]?.studentId, "stu_1");
});
