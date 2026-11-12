import type { Policy } from "@syc/domain";

/**
 * Demerit ladder from the BHA Student Code of Conduct (2026-27), "Demerit Point System".
 * Thresholds: 5, 10, 20, 30, 40. Level IV infractions carry 50 points and are handled
 * immediately, independent of the accumulated total.
 */
export type DemeritEscalationBandId =
  | "below_5"
  | "points_5_9"
  | "points_10_19"
  | "points_20_29"
  | "points_30_39"
  | "points_40_plus";

/** Band that means "no handbook escalation yet". */
export const BASE_BAND_ID = "below_5" as const;

export const EDITABLE_BAND_IDS = [
  "points_5_9",
  "points_10_19",
  "points_20_29",
  "points_30_39",
  "points_40_plus"
] as const;

/** Band ids written by the pre-2026 ladder (0-9 / 10-19 / 20-39 / 40+). */
const LEGACY_BAND_ID_ALIASES: Record<string, DemeritEscalationBandId> = {
  below_10: "below_5",
  points_20_39: "points_20_29",
  points_35_39: "points_30_39"
};

const KNOWN_BAND_IDS = new Set<string>([BASE_BAND_ID, ...EDITABLE_BAND_IDS]);

/** Maps a band id (current or legacy, e.g. from an old bookmarked URL) to a current band id. */
export function normalizeBandId(value: string | null | undefined): DemeritEscalationBandId | null {
  if (!value) {
    return null;
  }
  if (KNOWN_BAND_IDS.has(value)) {
    return value as DemeritEscalationBandId;
  }
  return LEGACY_BAND_ID_ALIASES[value] ?? null;
}

/** First band where the Code of Conduct has the school email the parent (5 points); keys parent outreach drafts. */
export const PARENT_OUTREACH_BAND_ID: DemeritEscalationBandId = "points_5_9";

/** Points assigned to every Level IV (zero tolerance) infraction. */
export const LEVEL_IV_POINTS = 50;

export const INFRACTION_LEVELS = [
  { level: 1, label: "Level I - Guidance", handledBy: "Classroom teacher" },
  { level: 2, label: "Level II - Character", handledBy: "Tarbiyah Director and administration" },
  { level: 3, label: "Level III - Major Violation", handledBy: "Immediate administrative referral" },
  { level: 4, label: "Level IV - Zero Tolerance", handledBy: "Immediate administrative action" }
] as const;

/** Level IV is a one-time, immediate-action offense regardless of the student's running total. */
export function isLevelIvIncident(incident: { level: number | null; points: number }): boolean {
  return incident.level === 4 || incident.points >= LEVEL_IV_POINTS;
}

export interface DemeritEscalationBand {
  id: DemeritEscalationBandId;
  label: string;
  shortLabel: string;
  minPoints: number;
  maxPoints: number | null;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  priority: number;
  parentCommunication: string;
  adminAction: string;
  adminMessage: string;
  policyImpact: string;
}

export interface EditableCommunicationBand {
  id: (typeof EDITABLE_BAND_IDS)[number];
  label: string;
  shortLabel: string;
  parentCommunication: string;
  adminAction: string;
  adminMessage: string;
  policyImpact: string;
}

export const demeritEscalationBands: DemeritEscalationBand[] = [
  {
    id: "below_5",
    label: "0 to 4 points",
    shortLabel: "0-4",
    minPoints: 0,
    maxPoints: 4,
    tone: "neutral",
    priority: 0,
    parentCommunication: "No handbook-triggered parent communication yet.",
    adminAction: "Monitor and intervene early if patterns intensify.",
    adminMessage: "Keep the student below the communication ladder and watch for repeat behavior.",
    policyImpact: "No handbook escalation is triggered before 5 points."
  },
  {
    id: "points_5_9",
    label: "5 to 9 points",
    shortLabel: "5-9",
    minPoints: 5,
    maxPoints: 9,
    tone: "info",
    priority: 1,
    parentCommunication: "Teacher conferences with the student and the parent is notified by email.",
    adminAction: "Confirm the teacher conference and parent email are documented in Sycamore.",
    adminMessage:
      "Inform parents that the student has reached 5 demerit points and remind them to monitor the Sycamore parent portal.",
    policyImpact: "Early pattern: regular parent monitoring of Sycamore gives families the earliest view."
  },
  {
    id: "points_10_19",
    label: "10 to 19 points",
    shortLabel: "10-19",
    minPoints: 10,
    maxPoints: 19,
    tone: "warning",
    priority: 2,
    parentCommunication: "Administrator conference with the student and parent; written expectations are provided.",
    adminAction: "Schedule the administrator conference and issue written expectations.",
    adminMessage:
      "Meet with the student and parent, set written expectations, and document the conference promptly.",
    policyImpact:
      "Eligibility for leadership positions, athletics, and scholarship programs is under review."
  },
  {
    id: "points_20_29",
    label: "20 to 29 points",
    shortLabel: "20-29",
    minPoints: 20,
    maxPoints: 29,
    tone: "warning",
    priority: 3,
    parentCommunication: "Formal meeting with administration; the family is advised of the re-enrollment threshold.",
    adminAction: "Hold the formal meeting, put a behavior intervention plan in place, and recommend counseling.",
    adminMessage:
      "Review the infractions with the family, build the behavior intervention plan, and advise them of the 40-point re-enrollment threshold.",
    policyImpact: "A behavior intervention plan is required and counseling is recommended."
  },
  {
    id: "points_30_39",
    label: "30 to 39 points",
    shortLabel: "30-39",
    minPoints: 30,
    maxPoints: 39,
    tone: "warning",
    priority: 4,
    parentCommunication: "Written notice is placed in the permanent file with Admissions.",
    adminAction: "Send the written notice to Admissions and record probationary status.",
    adminMessage:
      "Place written notice in the student's permanent file with Admissions and document the probationary status.",
    policyImpact: "Student is on probationary status; the next threshold (40 points) triggers a re-enrollment review."
  },
  {
    id: "points_40_plus",
    label: "40+ points",
    shortLabel: "40+",
    minPoints: 40,
    maxPoints: null,
    tone: "danger",
    priority: 5,
    parentCommunication: "Re-enrollment review; the family is informed that unenrollment may be requested or expulsion proceedings recommended.",
    adminAction: "Open the re-enrollment review and the unenrollment or expulsion recommendation workflow.",
    adminMessage:
      "Move the case into the school's highest-severity discipline review and document the recommendation path immediately.",
    policyImpact:
      "Per the Code of Conduct, unenrollment may be requested or expulsion proceedings recommended."
  }
];

const editableBandIds = new Set<EditableCommunicationBand["id"]>(EDITABLE_BAND_IDS);

export function editableCommunicationBandsFromBands(
  bands: DemeritEscalationBand[] = demeritEscalationBands
): EditableCommunicationBand[] {
  return bands
    .filter((band): band is DemeritEscalationBand & { id: EditableCommunicationBand["id"] } => band.id !== BASE_BAND_ID)
    .map((band) => ({
      id: band.id,
      label: band.label,
      shortLabel: band.shortLabel,
      parentCommunication: band.parentCommunication,
      adminAction: band.adminAction,
      adminMessage: band.adminMessage,
      policyImpact: band.policyImpact
    }));
}

export function editableCommunicationBandsFromPolicy(policy: Pick<Policy, "communicationBands"> | null | undefined) {
  return editableCommunicationBandsFromBands(resolveDemeritEscalationBands(policy));
}

export function normalizeEditableCommunicationBands(
  overrides: EditableCommunicationBand[] | null | undefined
): EditableCommunicationBand[] {
  const defaultsById = new Map(
    editableCommunicationBandsFromBands().map((band) => [band.id, band] as const)
  );
  const overridesById = new Map<EditableCommunicationBand["id"], EditableCommunicationBand>();

  for (const candidate of overrides ?? []) {
    if (!candidate || !editableBandIds.has(candidate.id)) {
      continue;
    }
    const fallback = defaultsById.get(candidate.id);
    if (!fallback) {
      continue;
    }
    overridesById.set(candidate.id, {
      id: candidate.id,
      label: candidate.label.trim() || fallback.label,
      shortLabel: candidate.shortLabel.trim() || fallback.shortLabel,
      parentCommunication: candidate.parentCommunication.trim() || fallback.parentCommunication,
      adminAction: candidate.adminAction.trim() || fallback.adminAction,
      adminMessage: candidate.adminMessage.trim() || fallback.adminMessage,
      policyImpact: candidate.policyImpact.trim() || fallback.policyImpact
    });
  }

  return editableCommunicationBandsFromBands().map((band) => overridesById.get(band.id) ?? band);
}

function parseEditableCommunicationBands(source: string | null | undefined): EditableCommunicationBand[] | null {
  if (!source?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    // Policies saved under the pre-2026 ladder carry old band ids and old default text.
    // Discard them so the Code of Conduct defaults apply until an admin saves a new policy.
    if (
      parsed.some(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as { id?: unknown }).id === "string" &&
          Object.hasOwn(LEGACY_BAND_ID_ALIASES, (item as { id: string }).id)
      )
    ) {
      return null;
    }
    const candidates = parsed
      .filter((item): item is EditableCommunicationBand => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const value = item as Partial<EditableCommunicationBand>;
        return (
          typeof value.id === "string" &&
          editableBandIds.has(value.id as EditableCommunicationBand["id"]) &&
          typeof value.label === "string" &&
          typeof value.shortLabel === "string" &&
          typeof value.parentCommunication === "string" &&
          typeof value.adminAction === "string" &&
          typeof value.adminMessage === "string" &&
          typeof value.policyImpact === "string"
        );
      })
      .map((item) => ({
        id: item.id,
        label: item.label,
        shortLabel: item.shortLabel,
        parentCommunication: item.parentCommunication,
        adminAction: item.adminAction,
        adminMessage: item.adminMessage,
        policyImpact: item.policyImpact
      }));

    return candidates.length > 0 ? normalizeEditableCommunicationBands(candidates) : null;
  } catch {
    return null;
  }
}

export function resolveDemeritEscalationBands(
  policy: Pick<Policy, "communicationBands"> | null | undefined
): DemeritEscalationBand[] {
  const overrides = new Map(
    (parseEditableCommunicationBands(policy?.communicationBands) ?? []).map((band) => [band.id, band] as const)
  );

  return demeritEscalationBands.map((band) => {
    if (band.id === BASE_BAND_ID) {
      return band;
    }
    const override = overrides.get(band.id);
    if (!override) {
      return band;
    }
    return {
      ...band,
      label: override.label,
      shortLabel: override.shortLabel,
      parentCommunication: override.parentCommunication,
      adminAction: override.adminAction,
      adminMessage: override.adminMessage,
      policyImpact: override.policyImpact
    };
  });
}

export function getDemeritEscalationBand(
  totalPoints: number,
  bands: DemeritEscalationBand[] = demeritEscalationBands
): DemeritEscalationBand {
  const normalizedPoints = Number.isFinite(totalPoints) ? Math.max(0, Math.trunc(totalPoints)) : 0;
  return (
    bands.find((band) => {
      if (normalizedPoints < band.minPoints) {
        return false;
      }
      if (band.maxPoints !== null && normalizedPoints > band.maxPoints) {
        return false;
      }
      return true;
    }) ?? bands[0]!
  );
}

export function escalationBandOptions(
  bands: DemeritEscalationBand[] = demeritEscalationBands
): Array<{ id: string; label: string }> {
  return bands.map((band) => ({
    id: band.id,
    label: band.label
  }));
}
