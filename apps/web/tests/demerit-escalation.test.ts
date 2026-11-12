import assert from "node:assert/strict";
import test from "node:test";

import {
  editableCommunicationBandsFromPolicy,
  escalationBandOptions,
  getDemeritEscalationBand,
  isLevelIvIncident,
  normalizeBandId
} from "../lib/demerit-escalation";

// Code of Conduct (2026-27) thresholds: 5, 10, 20, 30, 40. Level IV = 50 points.
const BOUNDARIES: Array<[number, string]> = [
  [0, "below_5"],
  [4, "below_5"],
  [5, "points_5_9"],
  [9, "points_5_9"],
  [10, "points_10_19"],
  [19, "points_10_19"],
  [20, "points_20_29"],
  [29, "points_20_29"],
  [30, "points_30_39"],
  [39, "points_30_39"],
  [40, "points_40_plus"],
  [50, "points_40_plus"]
];

test("every Code of Conduct threshold lands in the right band", () => {
  for (const [points, expected] of BOUNDARIES) {
    assert.equal(getDemeritEscalationBand(points).id, expected, `${points} points`);
  }
});

test("totals below 5 stay in the 0-4 band", () => {
  const band = getDemeritEscalationBand(4);

  assert.equal(band.id, "below_5");
  assert.equal(band.label, "0 to 4 points");
  assert.equal(band.shortLabel, "0-4");
});

test("30-point totals reach the probationary band with Admissions notice", () => {
  const band = getDemeritEscalationBand(30);

  assert.equal(band.label, "30 to 39 points");
  assert.match(band.parentCommunication, /permanent file with Admissions/i);
  assert.match(band.policyImpact, /probationary/i);
});

test("escalation options expose all six ladder bands", () => {
  const options = escalationBandOptions();

  assert.deepEqual(
    options.map((option) => option.label),
    ["0 to 4 points", "5 to 9 points", "10 to 19 points", "20 to 29 points", "30 to 39 points", "40+ points"]
  );
});

test("legacy band ids from the old 0-9 / 20-39 ladder map onto the new bands", () => {
  assert.equal(normalizeBandId("below_10"), "below_5");
  assert.equal(normalizeBandId("points_20_39"), "points_20_29");
  assert.equal(normalizeBandId("points_35_39"), "points_30_39");
  assert.equal(normalizeBandId("points_10_19"), "points_10_19");
  assert.equal(normalizeBandId("nonsense"), null);
});

test("Level IV incidents are identified by level or by 50 points", () => {
  assert.equal(isLevelIvIncident({ level: 4, points: 50 }), true);
  assert.equal(isLevelIvIncident({ level: null, points: 50 }), true);
  assert.equal(isLevelIvIncident({ level: 3, points: 10 }), false);
  assert.equal(isLevelIvIncident({ level: null, points: 7 }), false);
});

test("editable communication bands merge saved policy copy onto the default ladder", () => {
  const bands = editableCommunicationBandsFromPolicy({
    communicationBands: JSON.stringify([
      {
        id: "points_10_19",
        label: "10-19 handbook points",
        shortLabel: "10-19",
        parentCommunication: "Call and email the family within 24 hours.",
        adminAction: "Log the contact and note eligibility risk.",
        adminMessage: "Use the first handbook escalation script.",
        policyImpact: "Student enters the first communication ladder band."
      }
    ])
  });

  assert.deepEqual(
    bands.map((band) => band.id),
    ["points_5_9", "points_10_19", "points_20_29", "points_30_39", "points_40_plus"]
  );
  assert.equal(bands[1]?.parentCommunication, "Call and email the family within 24 hours.");
  assert.match(bands[2]?.parentCommunication ?? "", /Formal meeting with administration/);
});

test("policies saved under the old ladder are discarded so the new defaults apply", () => {
  const bands = editableCommunicationBandsFromPolicy({
    communicationBands: JSON.stringify([
      {
        id: "points_10_19",
        label: "10 to 19 points",
        shortLabel: "10-19",
        parentCommunication: "Parents should receive a phone call and an email.",
        adminAction: "Notify the family and flag program eligibility risk.",
        adminMessage: "Old copy.",
        policyImpact: "Old copy."
      },
      {
        id: "points_20_39",
        label: "20 to 39 points",
        shortLabel: "20-39",
        parentCommunication: "Parents should meet with BHA administration.",
        adminAction: "Old copy.",
        adminMessage: "Old copy.",
        policyImpact: "Old copy."
      }
    ])
  });

  assert.equal(bands.length, 5);
  assert.match(bands[1]?.parentCommunication ?? "", /Administrator conference/);
});
