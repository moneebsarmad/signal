"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCcw, Sparkles, Trash2 } from "lucide-react";

import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Panel,
  SoftPanel,
  StatusBadge,
  Textarea,
  tableCellClassName,
  tableClassName,
  tableHeadCellClassName,
  tableShellClassName
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  editableCommunicationBandsFromPolicy,
  type EditableCommunicationBand
} from "@/lib/demerit-escalation";

interface PolicyTemplate {
  label: string;
  dueDays: number;
  assignedTo: string | null;
  notesTemplate: string;
}

interface PolicyRow {
  version: number;
  baseThreshold: number;
  warningOffsets: number[];
  milestones: number[];
  interventionTemplates: string;
  communicationBands: string;
  createdBy: string;
  createdAt: string;
  parsedTemplates?: PolicyTemplate[];
  parsedCommunicationBands?: EditableCommunicationBand[];
}

interface PolicyResponse {
  latest: PolicyRow | null;
  policies: PolicyRow[];
}

function emptyTemplate(): PolicyTemplate {
  return {
    label: "",
    dueDays: 3,
    assignedTo: "",
    notesTemplate: ""
  };
}

function templatesFromPolicy(policy: PolicyRow | null): PolicyTemplate[] {
  if (!policy) {
    return [emptyTemplate()];
  }
  if (policy.parsedTemplates?.length) {
    return policy.parsedTemplates.map((template) => ({
      ...template,
      assignedTo: template.assignedTo ?? ""
    }));
  }
  try {
    const parsed = JSON.parse(policy.interventionTemplates) as PolicyTemplate[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((template) => ({
        ...template,
        assignedTo: template.assignedTo ?? ""
      }));
    }
  } catch {
    return [emptyTemplate()];
  }
  return [emptyTemplate()];
}

function communicationBandsFromPolicy(policy: PolicyRow | null): EditableCommunicationBand[] {
  if (policy?.parsedCommunicationBands?.length) {
    return policy.parsedCommunicationBands;
  }
  return editableCommunicationBandsFromPolicy(policy ? { communicationBands: policy.communicationBands } : null);
}

export function PoliciesClient() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [latest, setLatest] = useState<PolicyRow | null>(null);
  const [baseThreshold, setBaseThreshold] = useState("");
  const [warningOffsets, setWarningOffsets] = useState<string[]>(["3", "1"]);
  const [milestones, setMilestones] = useState<string[]>(["0", "10", "20", "30"]);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([emptyTemplate()]);
  const [communicationBands, setCommunicationBands] = useState<EditableCommunicationBand[]>(
    communicationBandsFromPolicy(null)
  );
  const [queueNotifications, setQueueNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPolicies() {
    setIsLoading(true);
    const response = await fetch("/api/policies", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as PolicyResponse | { error?: string } | null;
    if (!response.ok) {
      setError((body as { error?: string } | null)?.error || "Could not load policies.");
      setIsLoading(false);
      return;
    }

    const payload = body as PolicyResponse;
    setPolicies(payload.policies || []);
    setLatest(payload.latest || null);
    setError(null);
    setIsLoading(false);
  }

  useEffect(() => {
    void loadPolicies();
  }, []);

  const currentTemplates = useMemo(() => templatesFromPolicy(latest), [latest]);
  const currentCommunicationBands = useMemo(() => communicationBandsFromPolicy(latest), [latest]);

  function loadCurrentIntoForm() {
    if (!latest) {
      return;
    }
    setBaseThreshold(String(latest.baseThreshold));
    setWarningOffsets(latest.warningOffsets.map((value) => String(value)));
    setMilestones(latest.milestones.map((value) => String(value)));
    setTemplates(currentTemplates);
    setCommunicationBands(currentCommunicationBands);
  }

  async function onCreatePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSaving(true);

    const payload = {
      baseThreshold: Number(baseThreshold),
      warningOffsets: warningOffsets.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      milestones: milestones.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      interventionTemplates: templates.map((template) => ({
        label: template.label.trim(),
        dueDays: Number(template.dueDays) || 0,
        assignedTo: template.assignedTo?.trim() ? template.assignedTo.trim() : null,
        notesTemplate: template.notesTemplate
      })),
      communicationBands: communicationBands.map((band) => ({
        id: band.id,
        label: band.label.trim(),
        shortLabel: band.shortLabel.trim(),
        parentCommunication: band.parentCommunication.trim(),
        adminAction: band.adminAction.trim(),
        adminMessage: band.adminMessage.trim(),
        policyImpact: band.policyImpact.trim()
      }))
    };

    const response = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = (await response.json().catch(() => null)) as { error?: string; policy?: PolicyRow } | null;
    if (!response.ok) {
      setError(body?.error || "Failed to create policy.");
      setIsSaving(false);
      return;
    }

    setMessage(`Policy version ${body?.policy?.version ?? ""} created.`);
    await loadPolicies();
    setIsSaving(false);
  }

  async function onEvaluatePolicy() {
    setError(null);
    setMessage(null);
    setIsEvaluating(true);

    const response = await fetch("/api/policies/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        policyVersion: latest?.version,
        queueNotifications
      })
    });
    const body = (await response.json().catch(() => null)) as
      | {
          error?: string;
          evaluation?: {
            triggeredInterventions: number;
            reopenedInterventions: number;
            closedInterventions: number;
            policyVersion: number;
          };
          queueSummary?: { queued: number };
        }
      | null;
    if (!response.ok) {
      setError(body?.error || "Policy evaluation failed.");
      setIsEvaluating(false);
      return;
    }

    setMessage(
      `Policy v${body?.evaluation?.policyVersion ?? ""} evaluated. Created ${body?.evaluation?.triggeredInterventions ?? 0}, reopened ${body?.evaluation?.reopenedInterventions ?? 0}, closed ${body?.evaluation?.closedInterventions ?? 0}. Queued notifications: ${body?.queueSummary?.queued ?? 0}.`
    );
    setIsEvaluating(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin controls"
        title="Version policy thresholds with confidence"
        description="Keep the live policy readable, editable, and auditable without exposing raw JSON as the primary authoring experience."
        actions={
          <Button type="button" variant="secondary" onClick={() => void loadPolicies()} disabled={isLoading}>
            <RefreshCcw className={cn("h-4 w-4", isLoading ? "animate-spin" : "")} />
            {isLoading ? "Refreshing..." : "Refresh policies"}
          </Button>
        }
      />

      {error ? (
        <InlineAlert tone="danger" title="Policy request failed.">
          {error}
        </InlineAlert>
      ) : null}
      <InlineAlert tone="info" title="Policy refresh uses app state.">
        This workspace reloads the latest saved policy versions and evaluations from Signal storage. It does not trigger a
        direct Sycamore pull when the page opens or refreshes.
      </InlineAlert>
      {message ? (
        <InlineAlert tone="success" title="Policy engine updated.">
          {message}
        </InlineAlert>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel className="space-y-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-2xl text-[var(--color-ink)]">Current policy</h2>
            </div>
            {latest ? <StatusBadge tone="info">v{latest.version}</StatusBadge> : null}
          </div>

          {latest ? (
            <>
              <SoftPanel className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Base threshold</p>
                <p className="font-display text-3xl text-[var(--color-ink)]">X = {latest.baseThreshold}</p>
                <p className="text-sm leading-7 text-[var(--color-muted)]">
                  Created by {latest.createdBy} on {new Date(latest.createdAt).toLocaleString()}.
                </p>
              </SoftPanel>

              <div className="grid gap-4 md:grid-cols-2">
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Warnings</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">{latest.warningOffsets.join(", ")}</p>
                </SoftPanel>
                <SoftPanel className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-subtle)]">Milestones</p>
                  <p className="text-sm leading-7 text-[var(--color-muted)]">{latest.milestones.join(", ")}</p>
                </SoftPanel>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[var(--color-ink)]">Communication ladder</p>
                  <Button type="button" variant="ghost" size="sm" onClick={loadCurrentIntoForm}>
                    Load into form
                  </Button>
                </div>
                <div className="grid gap-3">
                  {currentCommunicationBands.map((band) => (
                    <SoftPanel key={band.id} className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--color-ink)]">{band.label}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                            {band.shortLabel}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-[var(--color-muted)]">
                        <span className="font-semibold text-[var(--color-ink)]">Parent:</span> {band.parentCommunication}
                      </p>
                      <p className="text-sm text-[var(--color-muted)]">
                        <span className="font-semibold text-[var(--color-ink)]">Admin:</span> {band.adminAction}
                      </p>
                      <p className="text-sm text-[var(--color-muted)]">{band.adminMessage}</p>
                      <p className="text-sm text-[var(--color-muted)]">{band.policyImpact}</p>
                    </SoftPanel>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[var(--color-ink)]">Intervention templates</p>
                </div>
                <div className="grid gap-3">
                  {currentTemplates.map((template, index) => (
                    <SoftPanel key={`${template.label}-${index}`} className="space-y-2">
                      <p className="font-semibold text-[var(--color-ink)]">{template.label || `Template ${index + 1}`}</p>
                      <p className="text-sm text-[var(--color-muted)]">
                        Due in {template.dueDays} days
                        {template.assignedTo ? ` • Assigned to ${template.assignedTo}` : ""}
                      </p>
                    </SoftPanel>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-[var(--color-line)] bg-[var(--color-soft-surface)] p-4">
                <label className="flex items-center gap-3 text-sm text-[var(--color-ink)]">
                  <Checkbox
                    checked={queueNotifications}
                    onChange={(event) => setQueueNotifications(event.currentTarget.checked)}
                  />
                  Queue notifications after evaluation
                </label>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button type="button" variant="primary" onClick={() => void onEvaluatePolicy()} disabled={isEvaluating}>
                    <Sparkles className="h-4 w-4" />
                    {isEvaluating ? "Evaluating..." : "Evaluate policy"}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="No policy found"
              description="Create the first policy version to unlock intervention evaluation and notification behavior."
            />
          )}
        </Panel>

        <Panel className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-display text-2xl text-[var(--color-ink)]">Create version</h2>
          </div>

          <form onSubmit={onCreatePolicy} className="space-y-5">
            <Field label="Base threshold X">
              <Input value={baseThreshold} onChange={(event) => setBaseThreshold(event.currentTarget.value)} />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[var(--color-ink)]">Warning offsets</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setWarningOffsets((previous) => [...previous, ""])}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {warningOffsets.map((value, index) => (
                  <div key={`warning-${index}`} className="flex gap-3">
                    <Input
                      value={value}
                      onChange={(event) =>
                        setWarningOffsets((previous) =>
                          previous.map((current, currentIndex) =>
                            currentIndex === index ? event.currentTarget.value : current
                          )
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={warningOffsets.length === 1}
                      onClick={() =>
                        setWarningOffsets((previous) => previous.filter((_, currentIndex) => currentIndex !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[var(--color-ink)]">Milestones</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMilestones((previous) => [...previous, ""])}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
                {milestones.map((value, index) => (
                  <div key={`milestone-${index}`} className="flex gap-3">
                    <Input
                      value={value}
                      onChange={(event) =>
                        setMilestones((previous) =>
                          previous.map((current, currentIndex) =>
                            currentIndex === index ? event.currentTarget.value : current
                          )
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={milestones.length === 1}
                      onClick={() =>
                        setMilestones((previous) => previous.filter((_, currentIndex) => currentIndex !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-4">
                <div>
                  <p className="font-semibold text-[var(--color-ink)]">Communication ladder</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    These three handbook bands drive the messaging shown in the dashboard ladder. The point ranges stay
                    fixed; edit the labels and guidance here instead of changing code.
                  </p>
                </div>

                {communicationBands.map((band, index) => (
                  <SoftPanel key={band.id} className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">{band.id.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--color-subtle)]">
                          Dashboard ladder band
                        </p>
                      </div>
                      <StatusBadge tone={index === 0 ? "info" : index === 1 ? "warning" : "danger"}>
                        {band.shortLabel}
                      </StatusBadge>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Band label">
                        <Input
                          value={band.label}
                          onChange={(event) =>
                            setCommunicationBands((previous) =>
                              previous.map((current, currentIndex) =>
                                currentIndex === index ? { ...current, label: event.currentTarget.value } : current
                              )
                            )
                          }
                        />
                      </Field>
                      <Field label="Short label">
                        <Input
                          value={band.shortLabel}
                          onChange={(event) =>
                            setCommunicationBands((previous) =>
                              previous.map((current, currentIndex) =>
                                currentIndex === index ? { ...current, shortLabel: event.currentTarget.value } : current
                              )
                            )
                          }
                        />
                      </Field>
                      <Field label="Parent communication" className="md:col-span-2">
                        <Textarea
                          rows={3}
                          value={band.parentCommunication}
                          onChange={(event) =>
                            setCommunicationBands((previous) =>
                              previous.map((current, currentIndex) =>
                                currentIndex === index
                                  ? { ...current, parentCommunication: event.currentTarget.value }
                                  : current
                              )
                            )
                          }
                        />
                      </Field>
                      <Field label="Admin action" className="md:col-span-2">
                        <Textarea
                          rows={3}
                          value={band.adminAction}
                          onChange={(event) =>
                            setCommunicationBands((previous) =>
                              previous.map((current, currentIndex) =>
                                currentIndex === index ? { ...current, adminAction: event.currentTarget.value } : current
                              )
                            )
                          }
                        />
                      </Field>
                      <Field label="Admin note" className="md:col-span-2">
                        <Textarea
                          rows={3}
                          value={band.adminMessage}
                          onChange={(event) =>
                            setCommunicationBands((previous) =>
                              previous.map((current, currentIndex) =>
                                currentIndex === index ? { ...current, adminMessage: event.currentTarget.value } : current
                              )
                            )
                          }
                        />
                      </Field>
                      <Field label="Policy impact" className="md:col-span-2">
                        <Textarea
                          rows={3}
                          value={band.policyImpact}
                          onChange={(event) =>
                            setCommunicationBands((previous) =>
                              previous.map((current, currentIndex) =>
                                currentIndex === index ? { ...current, policyImpact: event.currentTarget.value } : current
                              )
                            )
                          }
                        />
                      </Field>
                    </div>
                  </SoftPanel>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[var(--color-ink)]">Intervention templates</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setTemplates((previous) => [...previous, emptyTemplate()])}
                >
                  <Plus className="h-4 w-4" />
                  Add template
                </Button>
              </div>

              {templates.map((template, index) => (
                <SoftPanel key={`template-${index}`} className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[var(--color-ink)]">Template {index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={templates.length === 1}
                      onClick={() => setTemplates((previous) => previous.filter((_, currentIndex) => currentIndex !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Label">
                      <Input
                        value={template.label}
                        onChange={(event) =>
                          setTemplates((previous) =>
                            previous.map((current, currentIndex) =>
                              currentIndex === index ? { ...current, label: event.currentTarget.value } : current
                            )
                          )
                        }
                      />
                    </Field>
                    <Field label="Due in days">
                      <Input
                        value={String(template.dueDays)}
                        onChange={(event) =>
                          setTemplates((previous) =>
                            previous.map((current, currentIndex) =>
                              currentIndex === index ? { ...current, dueDays: Number(event.currentTarget.value) || 0 } : current
                            )
                          )
                        }
                      />
                    </Field>
                    <Field label="Assigned to">
                      <Input
                        value={template.assignedTo ?? ""}
                        onChange={(event) =>
                          setTemplates((previous) =>
                            previous.map((current, currentIndex) =>
                              currentIndex === index ? { ...current, assignedTo: event.currentTarget.value } : current
                            )
                          )
                        }
                      />
                    </Field>
                    <Field label="Notes template" className="md:col-span-2">
                      <Textarea
                        rows={4}
                        value={template.notesTemplate}
                        onChange={(event) =>
                          setTemplates((previous) =>
                            previous.map((current, currentIndex) =>
                              currentIndex === index
                                ? { ...current, notesTemplate: event.currentTarget.value }
                                : current
                            )
                          )
                        }
                      />
                    </Field>
                  </div>
                </SoftPanel>
              ))}
            </div>

            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Create policy version"}
            </Button>
          </form>
        </Panel>
      </section>

      <Panel className="space-y-5">
        <h2 className="font-display text-2xl text-[var(--color-ink)]">Policy history</h2>

        {policies.length === 0 ? (
          <EmptyState
            title="No policy versions yet"
            description="Version history will accumulate after the first saved policy."
          />
        ) : (
          <div className={tableShellClassName}>
            <div className="overflow-x-auto">
              <table className={tableClassName}>
                <thead>
                  <tr>
                    <th className={tableHeadCellClassName}>Version</th>
                    <th className={tableHeadCellClassName}>Base X</th>
                    <th className={tableHeadCellClassName}>Warnings</th>
                    <th className={tableHeadCellClassName}>Milestones</th>
                    <th className={tableHeadCellClassName}>Ladder copy</th>
                    <th className={tableHeadCellClassName}>Created</th>
                    <th className={tableHeadCellClassName}>By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {policies.map((policy) => (
                    <tr key={policy.version}>
                      <td className={tableCellClassName}>
                        <StatusBadge tone={latest?.version === policy.version ? "info" : "neutral"}>v{policy.version}</StatusBadge>
                      </td>
                      <td className={tableCellClassName}>{policy.baseThreshold}</td>
                      <td className={tableCellClassName}>{policy.warningOffsets.join(", ")}</td>
                      <td className={tableCellClassName}>{policy.milestones.join(", ")}</td>
                      <td className={tableCellClassName}>
                        {communicationBandsFromPolicy(policy)
                          .map((band) => band.shortLabel)
                          .join(", ")}
                      </td>
                      <td className={tableCellClassName}>{new Date(policy.createdAt).toLocaleString()}</td>
                      <td className={tableCellClassName}>{policy.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
