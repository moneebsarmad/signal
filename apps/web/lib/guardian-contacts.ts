import { randomUUID } from "node:crypto";

import type { AuditEvent, GuardianContact, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import {
  fetchSycamoreContacts,
  fetchSycamoreFamilies,
  fetchSycamoreStudents,
  getSycamoreClientConfigFromEnv,
  type SycamoreClientDependencies
} from "@/lib/sycamore-client";
import { normalizeSycamoreStudentRecords } from "@/lib/sycamore-normalizer";
import { upsertRosterStudent } from "@/lib/student-identity";

interface ContactCandidate {
  email: string | null;
  phone: string | null;
  guardianName: string | null;
  relationship: string | null;
  isPrimary: boolean;
  sourceRecordId: string | null;
}

export interface GuardianContactImportSummary {
  rowsRead: number;
  contactsUpserted: number;
  warnings: string[];
}

export interface GuardianContactSyncSummary {
  studentsFetched: number;
  studentsUpserted: number;
  contactsUpserted: number;
  warnings: string[];
}

const ROSTER_CONTACT_GROUPS = [
  {
    relationship: "Primary guardian",
    isPrimary: true,
    emailKeys: [
      "PrimaryParentEmail",
      "PrimaryGuardianEmail",
      "ParentEmail",
      "ParentEmailAddress",
      "FamilyEmail"
    ],
    nameKeys: ["PrimaryParentName", "PrimaryGuardianName", "ParentName", "FamilyName"]
  },
  {
    relationship: "Mother",
    isPrimary: false,
    emailKeys: ["MotherEmail", "MotherEmailAddress", "MomEmail"],
    nameKeys: ["MotherName", "Mother", "MomName"]
  },
  {
    relationship: "Father",
    isPrimary: false,
    emailKeys: ["FatherEmail", "FatherEmailAddress", "DadEmail"],
    nameKeys: ["FatherName", "Father", "DadName"]
  },
  {
    relationship: "Guardian 1",
    isPrimary: false,
    emailKeys: ["Guardian1Email", "GuardianEmail1"],
    nameKeys: ["Guardian1Name", "GuardianName1"]
  },
  {
    relationship: "Guardian 2",
    isPrimary: false,
    emailKeys: ["Guardian2Email", "GuardianEmail2"],
    nameKeys: ["Guardian2Name", "GuardianName2"]
  }
] as const;

const SYCAMORE_FAMILY_ID_KEYS = ["FamilyID", "FamilyId", "familyId"] as const;
const SYCAMORE_SECONDARY_FAMILY_ID_KEYS = ["Family2ID", "Family2Id", "family2Id"] as const;

function pickFirst(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in source) {
      const value = source[key];
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }
  }
  return null;
}

function trimText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeEmail(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase() || "";
  if (!trimmed) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function normalizePhone(value: string | null): string | null {
  const trimmed = value?.trim() || "";
  return trimmed ? trimmed : null;
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhoneSeed(phone: string | null): string {
  if (!phone) {
    return "";
  }
  const digits = phone.replace(/\D+/g, "");
  return digits || normalizeLookup(phone);
}

function stableGuardianContactId(studentId: string, contact: ContactCandidate): string {
  const identity =
    contact.sourceRecordId?.trim() ||
    contact.email?.trim() ||
    normalizePhoneSeed(contact.phone) ||
    contact.guardianName?.trim() ||
    contact.relationship?.trim() ||
    "unknown";
  const relationship = contact.sourceRecordId ? "" : contact.relationship ?? "";
  const seed = `${normalizeLookup(studentId)}|${normalizeLookup(identity)}|${normalizeLookup(relationship)}`;
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }
  return `gct_${(hash >>> 0).toString(36)}`;
}

function createAuditEvent(input: {
  eventType: string;
  entityId: string;
  actor: string;
  payload: unknown;
}): AuditEvent {
  return {
    id: randomUUID(),
    eventType: input.eventType,
    entityType: "guardian_contact",
    entityId: input.entityId,
    actor: input.actor,
    payloadJson: JSON.stringify(input.payload),
    createdAt: new Date().toISOString()
  };
}

function extractGuardianCandidates(record: Record<string, unknown>): ContactCandidate[] {
  const found: ContactCandidate[] = [];
  const seen = new Set<string>();

  for (const group of ROSTER_CONTACT_GROUPS) {
    const email = normalizeEmail(trimText(pickFirst(record, group.emailKeys)));
    if (!email || seen.has(email)) {
      continue;
    }

    found.push({
      email,
      phone: null,
      guardianName: trimText(pickFirst(record, group.nameKeys)),
      relationship: group.relationship,
      isPrimary: group.isPrimary,
      sourceRecordId: null
    });
    seen.add(email);
  }

  return found;
}

function normalizeFamilyId(value: unknown): string | null {
  const familyId = trimText(value);
  if (!familyId || familyId === "0") {
    return null;
  }
  return familyId;
}

function rosterFamilyIds(record: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  for (const key of [...SYCAMORE_FAMILY_ID_KEYS, ...SYCAMORE_SECONDARY_FAMILY_ID_KEYS]) {
    const familyId = normalizeFamilyId(record[key]);
    if (familyId) {
      ids.add(familyId);
    }
  }
  return [...ids];
}

function sycamoreContactName(record: Record<string, unknown>): string | null {
  const firstName = trimText(pickFirst(record, ["FirstName", "firstName"]));
  const lastName = trimText(pickFirst(record, ["LastName", "lastName"]));
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || trimText(pickFirst(record, ["NickName", "nickName", "Nickname"])) || null;
}

function rankContactCandidate(candidate: ContactCandidate): number {
  return Number(Boolean(candidate.email)) * 4 + Number(Boolean(candidate.phone)) * 2 + Number(Boolean(candidate.guardianName));
}

function dedupeCandidates(candidates: ContactCandidate[]): ContactCandidate[] {
  const deduped: ContactCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key =
      candidate.sourceRecordId?.trim() ||
      candidate.email?.trim() ||
      normalizePhoneSeed(candidate.phone) ||
      candidate.guardianName?.trim() ||
      "unknown";
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function orderCandidates(candidates: ContactCandidate[]): ContactCandidate[] {
  const ordered = [...candidates].sort((left, right) => {
    const scoreDelta = rankContactCandidate(right) - rankContactCandidate(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return (left.guardianName ?? "").localeCompare(right.guardianName ?? "") || (left.sourceRecordId ?? "").localeCompare(right.sourceRecordId ?? "");
  });

  return ordered.map((candidate, index) => ({
    ...candidate,
    isPrimary: index === 0
  }));
}

function buildContactsByFamilyId(contactRecords: Array<Record<string, unknown>>, familyNames: Map<string, string | null>) {
  const contactsByFamilyId = new Map<string, ContactCandidate[]>();
  for (const record of contactRecords) {
    const familyId = normalizeFamilyId(pickFirst(record, [...SYCAMORE_FAMILY_ID_KEYS]));
    if (!familyId) {
      continue;
    }

    const candidate: ContactCandidate = {
      email: normalizeEmail(trimText(pickFirst(record, ["Email", "email"]))),
      phone: normalizePhone(trimText(pickFirst(record, ["Cell", "cell", "HomePhone", "homePhone", "WorkPhone", "workPhone"]))),
      guardianName: sycamoreContactName(record) ?? familyNames.get(familyId) ?? null,
      relationship: null,
      isPrimary: false,
      sourceRecordId: trimText(pickFirst(record, ["ID", "Id", "id"])) ? `contact:${trimText(pickFirst(record, ["ID", "Id", "id"]))}` : `family:${familyId}`
    };

    if (!candidate.email && !candidate.phone) {
      continue;
    }

    const existing = contactsByFamilyId.get(familyId) ?? [];
    existing.push(candidate);
    contactsByFamilyId.set(familyId, existing);
  }

  for (const [familyId, candidates] of contactsByFamilyId) {
    contactsByFamilyId.set(familyId, orderCandidates(dedupeCandidates(candidates)));
  }

  return contactsByFamilyId;
}

function buildFamilyFallbacks(familyRecords: Array<Record<string, unknown>>) {
  const familyNames = new Map<string, string | null>();
  const familyFallbacks = new Map<string, ContactCandidate[]>();

  for (const record of familyRecords) {
    const familyId = normalizeFamilyId(pickFirst(record, ["ID", "Id", "id"]));
    if (!familyId) {
      continue;
    }

    const familyName = trimText(pickFirst(record, ["Name", "name"]));
    familyNames.set(familyId, familyName);

    const phone = normalizePhone(trimText(pickFirst(record, ["HomePhone", "homePhone"])));
    if (!phone) {
      continue;
    }

    familyFallbacks.set(familyId, [
      {
        email: null,
        phone,
        guardianName: familyName,
        relationship: "Family contact",
        isPrimary: true,
        sourceRecordId: `family:${familyId}`
      }
    ]);
  }

  return {
    familyNames,
    familyFallbacks
  };
}

async function upsertGuardianContact(
  storage: StorageRepositories,
  student: Pick<Student, "id">,
  contact: ContactCandidate,
  sourceType: GuardianContact["sourceType"],
  sourceRecordId: string | null,
  notes: string,
  nowIso: string
): Promise<GuardianContact> {
  const id = stableGuardianContactId(student.id, contact);
  const existing = await storage.guardianContacts.getById(id);
  const next: GuardianContact = {
    id,
    studentId: student.id,
    guardianName: contact.guardianName ?? existing?.guardianName ?? null,
    relationship: contact.relationship ?? existing?.relationship ?? null,
    email: contact.email ?? existing?.email ?? null,
    phone: contact.phone ?? existing?.phone ?? null,
    isPrimary: contact.isPrimary || existing?.isPrimary || false,
    allowEmail: existing?.allowEmail ?? true,
    sourceType,
    sourceRecordId,
    lastSyncedAt: nowIso,
    isActive: existing?.isActive ?? true,
    notes: notes || existing?.notes || ""
  };
  await storage.guardianContacts.upsert(next);
  return next;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function resolveStudentFromCsvRow(
  row: Record<string, string>,
  students: Student[]
): Student | null {
  const studentId = row.student_id?.trim();
  if (studentId) {
    const byId = students.find((student) => student.id === studentId);
    if (byId) {
      return byId;
    }
  }

  const externalId = row.external_id?.trim();
  if (externalId) {
    const byExternalId = students.find((student) => student.externalId === externalId);
    if (byExternalId) {
      return byExternalId;
    }
  }

  const studentName = row.student_name?.trim();
  if (studentName) {
    const normalizedName = normalizeLookup(studentName);
    const matches = students.filter((student) => normalizeLookup(student.fullName) === normalizedName);
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
  }

  return null;
}

export async function importGuardianContactsCsv(input: {
  storage: StorageRepositories;
  actorEmail: string;
  csv: string;
}): Promise<GuardianContactImportSummary> {
  const lines = input.csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rowsRead: 0,
      contactsUpserted: 0,
      warnings: ["guardian_contacts_csv_requires_header_and_rows"]
    };
  }

  const headers = parseCsvLine(lines[0] ?? "").map((value) => value.trim().toLowerCase());
  const students = await input.storage.students.list();
  const nowIso = new Date().toISOString();
  let contactsUpserted = 0;
  const warnings: string[] = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const student = resolveStudentFromCsvRow(row, students);
    if (!student) {
      warnings.push(`guardian_contact_student_not_found:${line}`);
      continue;
    }

    const email = normalizeEmail(row.email ?? null);
    if (!email) {
      warnings.push(`guardian_contact_missing_email:${student.id}`);
      continue;
    }

    const contact = await upsertGuardianContact(
      input.storage,
      student,
      {
        email,
        phone: null,
        guardianName: row.guardian_name?.trim() || null,
        relationship: row.relationship?.trim() || null,
        isPrimary: parseBoolean(row.is_primary?.trim() || null, false),
        sourceRecordId: null
      },
      "csv_import",
      null,
      row.notes?.trim() || "",
      nowIso
    );
    contactsUpserted += 1;

    await input.storage.auditEvents.append(
      createAuditEvent({
        eventType: "guardian_contact_imported",
        entityId: contact.id,
        actor: input.actorEmail,
        payload: {
          studentId: student.id,
          email: contact.email
        }
      })
    );
  }

  return {
    rowsRead: lines.length - 1,
    contactsUpserted,
    warnings
  };
}

export async function syncGuardianContactsFromSycamore(input: {
  storage: StorageRepositories;
  actorEmail: string;
  dependencies?: SycamoreClientDependencies;
}): Promise<GuardianContactSyncSummary> {
  const config = getSycamoreClientConfigFromEnv();
  const nowIso = new Date().toISOString();
  const rosterRecords = await fetchSycamoreStudents(config, input.dependencies);
  let familyRecords: Array<Record<string, unknown>> = [];
  let contactRecords: Array<Record<string, unknown>> = [];
  const normalizedStudents = normalizeSycamoreStudentRecords(rosterRecords, nowIso);

  const studentByExternalId = new Map<string, Student>();
  let studentsUpserted = 0;
  for (const studentRow of normalizedStudents.students) {
    const upserted = await upsertRosterStudent(input.storage, studentRow, nowIso);
    studentsUpserted += 1;
    if (upserted.externalId) {
      studentByExternalId.set(upserted.externalId, upserted);
    }
  }

  let contactsUpserted = 0;
  const warnings = [...normalizedStudents.warnings];

  try {
    familyRecords = await fetchSycamoreFamilies(config, input.dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore family sync failure.";
    warnings.push(`sycamore_family_sync_failed:${message}`);
  }

  try {
    contactRecords = await fetchSycamoreContacts(config, input.dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sycamore contact sync failure.";
    warnings.push(`sycamore_contact_sync_failed:${message}`);
  }

  const { familyNames, familyFallbacks } = buildFamilyFallbacks(familyRecords);
  const contactsByFamilyId = buildContactsByFamilyId(contactRecords, familyNames);

  for (const record of rosterRecords) {
    const externalStudentId =
      trimText(pickFirst(record, ["ID", "Id", "id", "StudentID", "StudentId"])) ?? null;
    if (!externalStudentId) {
      continue;
    }
    const student = studentByExternalId.get(externalStudentId);
    if (!student) {
      warnings.push(`guardian_contact_student_missing_after_roster_sync:${externalStudentId}`);
      continue;
    }

    const candidates: ContactCandidate[] = [];
    for (const familyId of rosterFamilyIds(record)) {
      candidates.push(...(contactsByFamilyId.get(familyId) ?? []));
    }
    if (candidates.length === 0) {
      for (const familyId of rosterFamilyIds(record)) {
        candidates.push(...(familyFallbacks.get(familyId) ?? []));
      }
    }
    if (candidates.length === 0) {
      candidates.push(...extractGuardianCandidates(record));
    }

    const orderedCandidates = orderCandidates(dedupeCandidates(candidates));
    if (orderedCandidates.length === 0) {
      continue;
    }

    for (const candidate of orderedCandidates) {
      const contact = await upsertGuardianContact(
        input.storage,
        student,
        candidate,
        "sycamore_roster",
        candidate.sourceRecordId ?? externalStudentId,
        "",
        nowIso
      );
      contactsUpserted += 1;
      await input.storage.auditEvents.append(
        createAuditEvent({
          eventType: "guardian_contact_synced_from_sycamore",
          entityId: contact.id,
          actor: input.actorEmail,
          payload: {
            studentId: student.id,
            externalStudentId,
            email: contact.email,
            phone: contact.phone
          }
        })
      );
    }
  }

  return {
    studentsFetched: rosterRecords.length,
    studentsUpserted,
    contactsUpserted,
    warnings
  };
}
