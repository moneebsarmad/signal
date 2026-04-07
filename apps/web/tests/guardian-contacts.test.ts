import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEvent, GuardianContact, Student } from "@syc/domain";
import type { StorageRepositories } from "@syc/storage";

import { syncGuardianContactsFromSycamore } from "../lib/guardian-contacts";

function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> | T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function createStorage(): StorageRepositories & {
  __students: Student[];
  __guardianContacts: GuardianContact[];
  __auditEvents: AuditEvent[];
} {
  const students: Student[] = [];
  const guardianContacts: GuardianContact[] = [];
  const auditEvents: AuditEvent[] = [];

  return {
    __students: students,
    __guardianContacts: guardianContacts,
    __auditEvents: auditEvents,
    students: {
      upsert: async (student) => {
        const index = students.findIndex((item) => item.id === student.id);
        if (index >= 0) {
          students[index] = student;
        } else {
          students.push(student);
        }
      },
      getById: async (id) => students.find((student) => student.id === id) ?? null,
      list: async () => [...students]
    },
    guardianContacts: {
      upsert: async (contact) => {
        const index = guardianContacts.findIndex((item) => item.id === contact.id);
        if (index >= 0) {
          guardianContacts[index] = contact;
        } else {
          guardianContacts.push(contact);
        }
      },
      getById: async (id) => guardianContacts.find((contact) => contact.id === id) ?? null,
      listByStudent: async (studentId) => guardianContacts.filter((contact) => contact.studentId === studentId),
      list: async () => [...guardianContacts]
    },
    rawIncidents: {} as StorageRepositories["rawIncidents"],
    approvedIncidents: {} as StorageRepositories["approvedIncidents"],
    parseRuns: {} as StorageRepositories["parseRuns"],
    reviewTasks: {} as StorageRepositories["reviewTasks"],
    policies: {} as StorageRepositories["policies"],
    interventions: {} as StorageRepositories["interventions"],
    notifications: {} as StorageRepositories["notifications"],
    auditEvents: {
      append: async (event) => {
        auditEvents.push(event);
      },
      listByEntity: async (entityType, entityId) =>
        auditEvents.filter((event) => event.entityType === entityType && event.entityId === entityId),
      list: async () => [...auditEvents]
    }
  };
}

test("syncGuardianContactsFromSycamore maps roster family ids to Sycamore contacts and family fallbacks", async () => {
  const storage = createStorage();
  const summary = await withEnv(
    {
      SYCAMORE_API_BASE_URL: "https://school.sycamoreeducation.com/api/v1",
      SYCAMORE_ACCESS_TOKEN: "secret-token",
      SYCAMORE_SCHOOL_ID: "1002"
    },
    async () =>
      syncGuardianContactsFromSycamore({
        storage,
        actorEmail: "admin@example.com",
        dependencies: {
          fetchImpl: async (input) => {
            const url = String(input);
            if (url.endsWith("/School/1002/Students")) {
              return new Response(
                JSON.stringify([
                  { ID: "student-1", FirstName: "Amina", LastName: "Ali", Grade: "6", FamilyID: 100, Family2ID: 101 },
                  { ID: "student-2", FirstName: "Bilal", LastName: "Khan", Grade: "7", FamilyID: 200 }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/School/1002/Families")) {
              return new Response(
                JSON.stringify([
                  { ID: 100, Name: "Ali Family", HomePhone: "" },
                  { ID: 101, Name: "Ali Family Secondary", HomePhone: "" },
                  { ID: 200, Name: "Khan Family", HomePhone: "555-0200" }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
            if (url.endsWith("/School/1002/Contacts")) {
              return new Response(
                JSON.stringify([
                  {
                    ID: 9001,
                    FamilyID: 100,
                    FirstName: "Fatima",
                    LastName: "Ali",
                    Email: "fatima@example.com",
                    Cell: "555-0100"
                  },
                  { ID: 9002, FamilyID: 100, FirstName: "Omar", LastName: "Ali", Email: "", Cell: "555-0101" },
                  { ID: 9003, FamilyID: 0, FirstName: "Ignore", LastName: "Me", Email: "ignore@example.com", Cell: "555-9999" }
                ]),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }

            throw new Error(`Unexpected URL: ${url}`);
          }
        }
      })
  );

  assert.equal(summary.studentsFetched, 2);
  assert.equal(summary.studentsUpserted, 2);
  assert.equal(summary.contactsUpserted, 3);
  assert.deepEqual(summary.warnings, []);

  assert.equal(storage.__students.length, 2);
  assert.equal(storage.__guardianContacts.length, 3);

  const amina = storage.__students.find((student) => student.externalId === "student-1");
  const bilal = storage.__students.find((student) => student.externalId === "student-2");
  assert.ok(amina);
  assert.ok(bilal);

  const aminaContacts = storage.__guardianContacts.filter((contact) => contact.studentId === amina?.id);
  assert.equal(aminaContacts.length, 2);
  assert.equal(aminaContacts.some((contact) => contact.email === "fatima@example.com" && contact.phone === "555-0100"), true);
  assert.equal(aminaContacts.some((contact) => contact.email === null && contact.phone === "555-0101"), true);
  assert.equal(aminaContacts.filter((contact) => contact.isPrimary).length, 1);

  const bilalContacts = storage.__guardianContacts.filter((contact) => contact.studentId === bilal?.id);
  assert.equal(bilalContacts.length, 1);
  assert.equal(bilalContacts[0]?.guardianName, "Khan Family");
  assert.equal(bilalContacts[0]?.phone, "555-0200");
  assert.equal(bilalContacts[0]?.relationship, "Family contact");
  assert.equal(bilalContacts[0]?.sourceRecordId, "family:200");

  assert.equal(storage.__auditEvents.length, 3);
});
