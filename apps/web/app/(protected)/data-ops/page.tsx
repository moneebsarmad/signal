import { requireRole } from "@/lib/session";

import { DataOpsClient } from "./DataOpsClient";

export default function DataOpsPage() {
  const session = requireRole(["admin"]);

  return <DataOpsClient canManageSycamore={session.role === "admin"} />;
}
