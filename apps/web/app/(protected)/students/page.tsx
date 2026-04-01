import { requireSession } from "@/lib/session";

import { StudentsClient } from "./StudentsClient";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function StudentsPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = requireSession();
  const mode = readParam(searchParams?.mode);
  const detailTab = readParam(searchParams?.detailTab);
  const sourceType = readParam(searchParams?.sourceType);
  const bandId = readParam(searchParams?.bandId);

  return (
    <StudentsClient
      canManageSycamore={session.role === "admin"}
      initialFilters={{
        search: readParam(searchParams?.search).trim(),
        grade: readParam(searchParams?.grade).trim(),
        sourceType: sourceType === "manual_pdf" || sourceType === "sycamore_api" ? sourceType : "all",
        bandId:
          bandId === "communication_ladder" ||
          bandId === "below_10" ||
          bandId === "points_10_19" ||
          bandId === "points_20_29" ||
          bandId === "points_35_39" ||
          bandId === "points_40_plus"
            ? bandId
            : "all"
      }}
      initialMode={
        mode === "directory" || mode === "interventions" || mode === "case_file" || mode === "risk"
          ? mode
          : undefined
      }
      initialSelectedStudentId={readParam(searchParams?.studentId).trim() || undefined}
      initialDetailTab={
        detailTab === "overview" ||
        detailTab === "incidents" ||
        detailTab === "interventions" ||
        detailTab === "notifications" ||
        detailTab === "audit"
          ? detailTab
          : undefined
      }
    />
  );
}
