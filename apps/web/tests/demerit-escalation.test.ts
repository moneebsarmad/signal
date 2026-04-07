import assert from "node:assert/strict";
import test from "node:test";

import {
  editableCommunicationBandsFromPolicy,
  escalationBandOptions,
  getDemeritEscalationBand
} from "../lib/demerit-escalation";

test("30-point totals now stay in the 20-39 escalation tier", () => {
  const band = getDemeritEscalationBand(30);

  assert.equal(band.id, "points_20_39");
  assert.equal(band.label, "20 to 39 points");
  assert.equal(band.shortLabel, "20-39");
  assert.equal(band.parentCommunication, "Parents should meet with BHA administration.");
  assert.doesNotMatch(band.adminAction, /certified letter/i);
});

test("single-digit totals stay in the 0-9 band", () => {
  const band = getDemeritEscalationBand(9);

  assert.equal(band.id, "below_10");
  assert.equal(band.label, "0 to 9 points");
  assert.equal(band.shortLabel, "0-9");
});

test("escalation options expose the merged 20-39 band and no separate 35-39 band", () => {
  const options = escalationBandOptions();

  assert.equal(options.some((option) => option.id === "points_30_34"), false);
  assert.equal(options.some((option) => option.label === "20 to 34 points"), false);
  assert.equal(options.some((option) => option.label === "35 to 39 points"), false);
  assert.equal(options.some((option) => option.label === "0 to 9 points"), true);
  assert.equal(options.some((option) => option.label === "20 to 39 points"), true);
  assert.equal(options.some((option) => option.label === "40+ points"), true);
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

  assert.equal(bands[0]?.id, "points_10_19");
  assert.equal(bands[0]?.parentCommunication, "Call and email the family within 24 hours.");
  assert.equal(bands[1]?.id, "points_20_39");
  assert.equal(bands[1]?.parentCommunication, "Parents should meet with BHA administration.");
});
