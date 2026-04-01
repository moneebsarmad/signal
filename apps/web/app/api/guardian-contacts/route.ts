import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";

function isMissingGuardianContactsTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("guardian_contacts") &&
    (message.includes("could not find the table") ||
      message.includes("schema cache") ||
      message.includes('relation "guardian_contacts" does not exist') ||
      message.includes("relation 'guardian_contacts' does not exist"))
  );
}

export async function GET() {
  const session = getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storage = createStorageAdapter();
  await prepareStorage(storage);
  const students = await storage.students.list();
  let contacts = await Promise.resolve([] as Awaited<ReturnType<typeof storage.guardianContacts.list>>);
  let guardianContactsUnavailable = false;

  try {
    contacts = await storage.guardianContacts.list();
  } catch (error) {
    if (!isMissingGuardianContactsTableError(error)) {
      throw error;
    }
    guardianContactsUnavailable = true;
  }
  const studentMap = new Map(students.map((student) => [student.id, student] as const));

  const rows = contacts
    .map((contact) => ({
      ...contact,
      studentName: studentMap.get(contact.studentId)?.fullName || contact.studentId,
      grade: studentMap.get(contact.studentId)?.grade || "unknown"
    }))
    .sort((left, right) => left.studentName.localeCompare(right.studentName) || left.id.localeCompare(right.id));

  const summary = {
    totalContacts: rows.length,
    emailEnabledContacts: rows.filter((contact) => contact.isActive && contact.allowEmail && contact.email).length,
    studentsCovered: new Set(rows.filter((contact) => contact.email && contact.isActive).map((contact) => contact.studentId)).size
  };

  return NextResponse.json(
    {
      summary,
      rows,
      warnings: {
        guardianContactsUnavailable
      }
    },
    { status: 200 }
  );
}
