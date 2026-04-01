import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_lib/route-errors";
import { getCurrentSession } from "@/lib/session";
import { createStorageAdapter, prepareStorage } from "@/lib/storage";
import {
  buildStudentDirectoryRows,
  normalizeStudentBandFilter,
  normalizeStudentSourceType
} from "@/lib/student-profiles";

export async function GET(request: NextRequest) {
  try {
    const session = getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const search = (request.nextUrl.searchParams.get("search") || "").trim().toLowerCase();
    const grade = (request.nextUrl.searchParams.get("grade") || "").trim();
    const sourceType = normalizeStudentSourceType(request.nextUrl.searchParams.get("sourceType") || undefined);
    const bandId = normalizeStudentBandFilter(request.nextUrl.searchParams.get("bandId") || undefined);

    const storage = createStorageAdapter();
    await prepareStorage(storage);

    const rows = await buildStudentDirectoryRows(storage, {
      search,
      grade,
      sourceType,
      bandId
    });

    return NextResponse.json({ students: rows });
  } catch (error) {
    return handleRouteError("GET /api/students", error, "Failed to load students.");
  }
}
