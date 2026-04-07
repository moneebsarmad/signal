import type { Policy } from "@syc/domain";

export type DemeritEscalationBandId =
  | "below_10"
  | "points_10_19"
  | "points_20_39"
  | "points_40_plus";

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
  id: Exclude<DemeritEscalationBandId, "below_10">;
  label: string;
  shortLabel: string;
  parentCommunication: string;
  adminAction: string;
  adminMessage: string;
  policyImpact: string;
}

export const demeritEscalationBands: DemeritEscalationBand[] = [
  {
    id: "below_10",
    label: "0 to 9 points",
    shortLabel: "0-9",
    minPoints: 0,
    maxPoints: 9,
    tone: "neutral",
    priority: 0,
    parentCommunication: "No handbook-triggered parent communication yet.",
    adminAction: "Monitor and intervene early if patterns intensify.",
    adminMessage: "Keep the student below the communication ladder and watch for repeat behavior.",
    policyImpact: "No handbook escalation is triggered before 10 points."
  },
  {
    id: "points_10_19",
    label: "10 to 19 points",
    shortLabel: "10-19",
    minPoints: 10,
    maxPoints: 19,
    tone: "info",
    priority: 1,
    parentCommunication: "Parents should receive a phone call and an email.",
    adminAction: "Notify the family and flag program eligibility risk.",
    adminMessage:
      "Inform parents that the student has reached 10 demerit points and document the contact promptly.",
    policyImpact:
      "Student may be at risk for programs tied to demerit points, including Dual Credit, club roles, participation, and athletics scholarship eligibility."
  },
  {
    id: "points_20_39",
    label: "20 to 39 points",
    shortLabel: "20-39",
    minPoints: 20,
    maxPoints: 39,
    tone: "warning",
    priority: 2,
    parentCommunication: "Parents should meet with BHA administration.",
    adminAction: "Schedule the meeting and advise counseling support.",
    adminMessage:
      "Review the infractions with the family and communicate that the student is approaching the non-enrollment threshold.",
    policyImpact:
      "Student should be advised to attend counseling with Behavior and/or Academic Counselors."
  },
  {
    id: "points_40_plus",
    label: "40+ points",
    shortLabel: "40+",
    minPoints: 40,
    maxPoints: null,
    tone: "danger",
    priority: 4,
    parentCommunication: "Parents should be informed of unenrollment or expulsion review.",
    adminAction: "Escalate to formal unenrollment or expulsion recommendation workflow.",
    adminMessage:
      "Move the case into the school's highest-severity discipline review and document the recommendation path immediately.",
    policyImpact:
      "The handbook states that parents may be asked to un-enroll the student or expulsion proceedings may be recommended."
  }
];

const editableBandIds = new Set<EditableCommunicationBand["id"]>([
  "points_10_19",
  "points_20_39",
  "points_40_plus"
]);

export function editableCommunicationBandsFromBands(
  bands: DemeritEscalationBand[] = demeritEscalationBands
): EditableCommunicationBand[] {
  return bands
    .filter((band): band is DemeritEscalationBand & { id: EditableCommunicationBand["id"] } => band.id !== "below_10")
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
    if (band.id === "below_10") {
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
