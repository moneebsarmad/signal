import { requireRole } from "@/lib/session";
import { NotificationsClient } from "./NotificationsClient";

export default function NotificationsPage() {
  const session = requireRole(["admin"]);

  return <NotificationsClient canManageSycamore={session.role === "admin"} />;
}
