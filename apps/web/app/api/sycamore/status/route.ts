import { NextResponse } from "next/server";

import { handleRouteError } from "@/app/api/_lib/route-errors";
import { getCurrentSession } from "@/lib/session";
import { buildSycamoreDashboardSummary } from "@/lib/sycamore-direct-sync";

export async function GET() {
  try {
    const session = getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await buildSycamoreDashboardSummary();
    return NextResponse.json(
      {
        configured: summary.configured,
        error: summary.error,
        lastSync: summary.lastSync
      },
      {
        status: 200
      }
    );
  } catch (error) {
    return handleRouteError("GET /api/sycamore/status", error, "Failed to load Sycamore status.");
  }
}
