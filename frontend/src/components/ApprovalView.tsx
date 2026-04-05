import { useMemo, useState, type ReactNode } from "react";
import { approveRun } from "../api";
import type { PendingApproval, PlannedAction, Run } from "../types";

interface Props {
  runId: string;
  pending: PendingApproval;
  onCompleted: (run: Run, rejected: PlannedAction[]) => void;
}

interface ActionFormState {
  decision: "pending" | "create" | "reject";
  title: string;
  description: string;
  labels: string;
  assignees: string;
}

function initFormState(action: PlannedAction): ActionFormState {
  const data = action.data as Record<string, unknown>;
  return {
    decision: "pending",
    title: (data.title as string) ?? action.title,
    description: (data.body as string) ?? action.description,
    labels: ((data.labels as string[]) ?? []).join(", "),
    assignees: ((data.assignees as string[]) ?? []).join(", "),
  };
}

export default function ApprovalView({ runId, pending, onCompleted }: Props) {
  const actions = pending.action_plan;

  const [forms, setForms] = useState<Record<string, ActionFormState>>(
    () => Object.fromEntries(actions.map((a) => [a.id, initFormState(a)]))
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    github_issue: true,
    email: true,
    jira: true,
    slack: true,
  });
  const [loading, setLoading] = useState(false);
  const [creatingActionId, setCreatingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actionsByAgent = useMemo(() => {
    const grouped: Record<string, PlannedAction[]> = {};
    for (const action of actions) {
      if (!grouped[action.agent]) grouped[action.agent] = [];
      grouped[action.agent].push(action);
    }
    return grouped;
  }, [actions]);

  const createdCount = actions.filter((a) => forms[a.id].decision === "create").length;
  const rejectedCount = actions.filter((a) => forms[a.id].decision === "reject").length;
  const pendingCount = actions.length - createdCount - rejectedCount;

  const update = (id: string, patch: Partial<ActionFormState>) => {
    setForms((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  const toggleGroup = (agent: string) => {
    setExpandedGroups((prev) => ({ ...prev, [agent]: !prev[agent] }));
  };

  const submitDecisions = async (
    snapshot: Record<string, ActionFormState>,
    triggeredActionId?: string
  ) => {
    setLoading(true);
    setCreatingActionId(triggeredActionId ?? null);
    setError(null);

    const approvedActions: PlannedAction[] = actions
      .filter((a) => snapshot[a.id].decision === "create")
      .map((a) => {
        const f = snapshot[a.id];

        if (a.agent !== "github_issue") {
          return {
            ...a,
            title: f.title.trim(),
            description: f.description.trim(),
          };
        }

        return {
          ...a,
          title: f.title.trim(),
          description: f.description.trim(),
          data: {
            title: f.title.trim(),
            body: f.description.trim(),
            labels: f.labels.split(",").map((s) => s.trim()).filter(Boolean),
            assignees: f.assignees.split(",").map((s) => s.trim()).filter(Boolean),
          },
        };
      });

    const rejectedActions = actions.filter((a) => snapshot[a.id].decision === "reject");

    try {
      const run = await approveRun(runId, approvedActions);
      onCompleted(run, rejectedActions);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Execution failed.");
      setLoading(false);
      setCreatingActionId(null);
    }
  };

  const decideAction = (id: string, decision: "create" | "reject") => {
    if (loading) return;

    const currentDecision = forms[id].decision;
    const nextDecision: ActionFormState["decision"] =
      decision === "reject" && currentDecision === "reject" ? "pending" : decision;

    const next = {
      ...forms,
      [id]: {
        ...forms[id],
        decision: nextDecision,
      },
    };

    setForms(next);

    if (nextDecision === "create") {
      // Creation starts immediately on Create click.
      // Any still-pending actions are treated as rejected for this run.
      const finalSnapshot: Record<string, ActionFormState> = { ...next };
      for (const action of actions) {
        if (finalSnapshot[action.id].decision === "pending") {
          finalSnapshot[action.id] = {
            ...finalSnapshot[action.id],
            decision: "reject",
          };
        }
      }

      setForms(finalSnapshot);
      void submitDecisions(finalSnapshot, id);
    }
  };

  const agentLabel = (agent: string) => {
    if (agent === "github_issue") return "GitHub Issues";
    if (agent === "email") return "Emails";
    if (agent === "jira") return "Jira Tickets";
    if (agent === "slack") return "Slack Messages";
    return `${agent} Actions`;
  };

  const agentIcon = (agent: string) => {
    if (agent === "github_issue") return "GH";
    if (agent === "email") return "EM";
    if (agent === "jira") return "JR";
    if (agent === "slack") return "SL";
    return "AC";
  };

  return (
    <div className="w-full max-w-4xl rounded-2xl border border-[#313754] bg-gradient-to-b from-[#1c2234] to-[#141a2a] p-6 md:p-8 shadow-[0_35px_100px_-45px_rgba(79,125,255,0.45)]">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#f1f4ff]">Review Action Plan</h2>
          <p className="mt-1 text-sm text-[#97a1c5]">
            <span className="font-medium text-[#e8eaf0]">{pending.conversation_type}</span>
            {" • "}{(pending.confidence * 100).toFixed(0)}% confidence
            {pending.participants.length > 0 && ` • ${pending.participants.join(", ")}`}
          </p>
        </div>
        <div className="rounded-full border border-[#3e476a] bg-[#12192a] px-3 py-1 text-xs text-[#a8b3d9]">
          {createdCount} create • {rejectedCount} reject • {pendingCount} pending
        </div>
      </div>

      <div className="space-y-3 mb-5">
        {Object.entries(actionsByAgent).map(([agent, groupActions]) => {
          const expanded = !!expandedGroups[agent];
          const groupCreated = groupActions.filter((a) => forms[a.id].decision === "create").length;
          const groupRejected = groupActions.filter((a) => forms[a.id].decision === "reject").length;
          const groupPending = groupActions.length - groupCreated - groupRejected;

          return (
            <div key={agent} className="overflow-hidden rounded-xl border border-[#323955] bg-[#11182a]">
              <button
                type="button"
                onClick={() => toggleGroup(agent)}
                className="w-full px-4 py-3 flex items-center justify-between transition-colors hover:bg-[#1a2238]"
              >
                <div className="flex items-center gap-2.5 text-left">
                  <span className="rounded-md border border-[#3a4568] bg-[#0f1628] px-1.5 py-0.5 text-[10px] font-bold text-[#9fb0e4]">
                    {agentIcon(agent)}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-[#e8eaf0]">{agentLabel(agent)}</div>
                    <div className="text-xs text-[#8b97ba]">
                      {groupActions.length} items • {groupCreated} create • {groupRejected} reject • {groupPending} pending
                    </div>
                  </div>
                </div>
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#44507a] bg-[#17213a] text-[#c1ccf2] shadow-[0_6px_18px_-10px_rgba(79,125,255,0.85)] transition-transform duration-200 ${expanded ? "rotate-180" : "rotate-0"}`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current">
                    <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.16l3.71-3.93a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z" />
                  </svg>
                </span>
              </button>

              {expanded && (
                <div className="space-y-3 border-t border-[#1e2434] px-3 pb-3">
                  {groupActions.map((action, index) => {
                    const f = forms[action.id];
                    const isGithub = action.agent === "github_issue";
                    const isCreate = f.decision === "create";
                    const isReject = f.decision === "reject";

                    const cardTone = isCreate
                      ? "border-emerald-500/45 bg-[#13211d]"
                      : isReject
                      ? "border-red-500/45 bg-[#22171f]"
                      : "border-[#3a3f57] bg-[#141a2a]";

                    return (
                      <div
                        key={action.id}
                        className={`mt-3 rounded-xl border p-0 overflow-hidden shadow-[0_10px_30px_-20px_rgba(0,0,0,0.7)] ${cardTone} ${isGithub ? "ring-1 ring-[#4f7dff]/30" : ""}`}
                      >
                        <div className={`px-4 py-2.5 border-b ${isGithub ? "border-[#3a4b78] bg-gradient-to-r from-[#18233f] to-[#141c30]" : "border-[#2a324b] bg-[#17203a]"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${isGithub ? "border-[#4a62a5] bg-[#152346] text-[#b9cfff]" : "border-[#46517a] bg-[#1a2440] text-[#b3bfdc]"}`}>
                                {isGithub ? "GitHub" : action.agent}
                              </span>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca7cb]">
                                Action {index + 1}
                              </div>
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${action.priority === "high" ? "border-red-400/45 text-red-300" : action.priority === "medium" ? "border-amber-400/45 text-amber-300" : "border-emerald-400/45 text-emerald-300"}`}>
                              {action.priority}
                            </span>
                          </div>
                        </div>

                        <div className="p-3.5">
                          <div className="flex items-center gap-2">
                            {isGithub && isCreate && !loading && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                <span>✓</span>
                                <span>Ready</span>
                              </span>
                            )}
                            {isGithub && creatingActionId === action.id && loading && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#4f7dff]/40 bg-[#4f7dff]/15 px-2 py-0.5 text-[10px] font-semibold text-[#b8ccff]">
                                <span className="h-3 w-3 animate-spin rounded-full border border-current border-r-transparent" />
                                <span>Creating...</span>
                              </span>
                            )}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => decideAction(action.id, "create")}
                                className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                                  isCreate
                                    ? "border-emerald-400/70 bg-emerald-500 text-white shadow-[0_6px_20px_-12px_rgba(16,185,129,0.9)]"
                                    : "border-[#3d476c] bg-[#121a2b] text-[#aab5db] hover:border-emerald-400/50 hover:text-white"
                                }`}
                              >
                                Create
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => decideAction(action.id, "reject")}
                                className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-all ${
                                  isReject
                                    ? "border-red-400/70 bg-red-500/90 text-white shadow-[0_6px_20px_-12px_rgba(239,68,68,0.9)]"
                                    : "border-[#3d476c] bg-[#121a2b] text-[#aab5db] hover:border-red-400/50 hover:text-white"
                                }`}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className={isReject ? "space-y-2.5 opacity-45 pointer-events-none p-3.5 pt-0" : "space-y-2.5 p-3.5 pt-0"}>
                          <Field label="Title">
                            <input
                              type="text"
                              value={f.title}
                              onChange={(e) => update(action.id, { title: e.target.value })}
                              className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                            />
                          </Field>

                          <Field label="Description">
                            <textarea
                              value={f.description}
                              onChange={(e) => update(action.id, { description: e.target.value })}
                              rows={2}
                              className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff] resize-none"
                            />
                          </Field>

                          {isGithub && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              <Field label="Labels (comma-separated)">
                                <input
                                  type="text"
                                  value={f.labels}
                                  onChange={(e) => update(action.id, { labels: e.target.value })}
                                  placeholder="bug, backend"
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              </Field>
                              <Field label="Assignees (comma-separated)">
                                <input
                                  type="text"
                                  value={f.assignees}
                                  onChange={(e) => update(action.id, { assignees: e.target.value })}
                                  placeholder="github-username"
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              </Field>
                            </div>
                          )}
                        </div>

                        <div className="px-3.5 pb-3.5 pt-0">
                          {isCreate && <p className="text-[11px] font-medium text-emerald-300">Marked for creation.</p>}
                          {isReject && <p className="text-[11px] font-medium text-red-400">Marked for rejection.</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9ea9cf]">{label}</label>
      {children}
    </div>
  );
}
