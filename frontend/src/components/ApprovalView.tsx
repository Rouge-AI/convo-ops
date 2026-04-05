import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { approveRun } from "../api";
import type { PendingApproval, PlannedAction, Run } from "../types";

interface Props {
  runId: string;
  pending: PendingApproval;
  transcriptFile: {
    name: string;
    size: number;
  } | null;
  hasResultsReady: boolean;
  onShowResults: () => void;
  onCompleted: (run: Run, rejected: PlannedAction[], navigateToResults?: boolean) => void;
}

interface ActionFormState {
  decision: "pending" | "create" | "reject";
  title: string;
  description: string;
  labels: string;
  assignees: string;
  to: string;
  cc: string;
  folderId: string;
  shareWith: string;
}

function initFormState(action: PlannedAction): ActionFormState {
  const data = action.data as Record<string, unknown>;
  const to = (data.to as string) ?? "";
  const cc = (data.cc as string) ?? "";
  const folderId = (data.folder_id as string) ?? "";
  const shareWith = ((data.share_with as string[]) ?? []).join(", ");
  return {
    decision: "pending",
    title:
      (action.agent === "email" ? (data.subject as string) : undefined) ??
      (action.agent === "term_sheet" ? (data.document_title as string) : undefined) ??
      (data.title as string) ??
      action.title,
    description:
      (action.agent === "email" ? (data.body as string) : undefined) ??
      (action.agent === "term_sheet" ? (data.content as string) : undefined) ??
      (data.body as string) ??
      action.description,
    labels: ((data.labels as string[]) ?? []).join(", "),
    assignees: ((data.assignees as string[]) ?? []).join(", "),
    to,
    cc,
    folderId,
    shareWith,
  };
}

export default function ApprovalView({
  runId,
  pending,
  transcriptFile,
  hasResultsReady,
  onShowResults,
  onCompleted,
}: Props) {
  const actions = pending.action_plan;
  const termSheetActions = actions.filter((action) => action.agent === "term_sheet");

  const [forms, setForms] = useState<Record<string, ActionFormState>>(
    () => Object.fromEntries(actions.map((a) => [a.id, initFormState(a)]))
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    github_issue: true,
    email: true,
    term_sheet: true,
    slack: true,
  });
  const [loading, setLoading] = useState(false);
  const [creatingActionId, setCreatingActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successByAction, setSuccessByAction] = useState<Record<string, string>>({});
  const [termSheetViewMode, setTermSheetViewMode] = useState<Record<string, "write" | "preview">>(
    () => Object.fromEntries(termSheetActions.map((action) => [action.id, "write"]))
  );

  const actionsByAgent = useMemo(() => {
    const grouped: Record<string, PlannedAction[]> = {};
    for (const action of actions) {
      if (!grouped[action.agent]) grouped[action.agent] = [];
      grouped[action.agent].push(action);
    }
    return grouped;
  }, [actions]);

  const orderedAgentEntries = useMemo(() => {
    const preferredOrder = ["github_issue", "email", "term_sheet", "slack"];
    const present = new Set(Object.keys(actionsByAgent));
    const ordered = preferredOrder.filter((agent) => present.has(agent));
    const remaining = Object.keys(actionsByAgent).filter((agent) => !preferredOrder.includes(agent));
    return [...ordered, ...remaining].map((agent) => [agent, actionsByAgent[agent]] as const);
  }, [actionsByAgent]);

  const selectedCount = actions.filter((a) => forms[a.id].decision === "create").length;
  const skippedCount = actions.filter((a) => forms[a.id].decision === "reject").length;
  const undecidedCount = actions.length - selectedCount - skippedCount;

  const update = (id: string, patch: Partial<ActionFormState>) => {
    setForms((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  const toggleGroup = (agent: string) => {
    setExpandedGroups((prev) => ({ ...prev, [agent]: !prev[agent] }));
  };

  const setTermSheetMode = (id: string, mode: "write" | "preview") => {
    setTermSheetViewMode((prev) => ({
      ...prev,
      [id]: mode,
    }));
  };

  const submitDecisions = async (
    snapshot: Record<string, ActionFormState>,
    triggeredActionId?: string,
    navigateToResults = true
  ) => {
    setLoading(true);
    setCreatingActionId(triggeredActionId ?? null);
    setError(null);

    const approvedActions: PlannedAction[] = actions
      .filter((a) => snapshot[a.id].decision === "create")
      .map((a) => {
        const f = snapshot[a.id];

        if (a.agent === "email") {
          return {
            ...a,
            title: f.title.trim(),
            description: f.description.trim(),
            data: {
              to: f.to.trim(),
              cc: f.cc.trim(),
              subject: f.title.trim(),
              body: f.description.trim(),
            },
          };
        }

        if (a.agent === "term_sheet") {
          const folderId = f.folderId.trim();
          return {
            ...a,
            title: f.title.trim(),
            description: f.description.trim(),
            data: {
              document_title: f.title.trim(),
              content: f.description.trim(),
              ...(folderId ? { folder_id: folderId } : {}),
              share_with: f.shareWith.split(",").map((s) => s.trim()).filter(Boolean),
            },
          };
        }

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

    const missingRecipient = approvedActions.find(
      (a) => a.agent === "email" && !String((a.data as Record<string, unknown>).to ?? "").trim()
    );
    if (missingRecipient) {
      setError("Email action requires a recipient in 'To'.");
      setLoading(false);
      setCreatingActionId(null);
      return;
    }

    const invalidTermSheetFolder = approvedActions.find((a) => {
      if (a.agent !== "term_sheet") return false;
      const folderId = String((a.data as Record<string, unknown>).folder_id ?? "").trim();
      return folderId.length > 0 && folderId.length < 25;
    });
    if (invalidTermSheetFolder) {
      setError("Drive Folder ID looks invalid. Use a real Google Drive folder ID (typically 25+ characters), or leave it blank.");
      setLoading(false);
      setCreatingActionId(null);
      return;
    }

    const rejectedActions = actions.filter((a) => snapshot[a.id].decision === "reject");

    try {
      const run = await approveRun(runId, approvedActions);
      if (triggeredActionId) {
        const action = actions.find((item) => item.id === triggeredActionId);
        const successText = action?.agent === "email" ? "Sent successfully." : "Created successfully.";
        setSuccessByAction((prev) => ({
          ...prev,
          [triggeredActionId]: successText,
        }));
      }
      onCompleted(run, rejectedActions, navigateToResults);
      setLoading(false);
      setCreatingActionId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Execution failed.");
      setLoading(false);
      setCreatingActionId(null);
    }
  };

  const executeAndViewResults = () => {
    if (loading) return;
    void submitDecisions(forms);
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

    const selectedAction = actions.find((action) => action.id === id);
    const shouldExecuteNow =
      nextDecision === "create" &&
      (selectedAction?.agent === "email" ||
        selectedAction?.agent === "github_issue" ||
        selectedAction?.agent === "term_sheet");

    if (shouldExecuteNow) {
      void submitDecisions(next, id, false);
    }
  };

  const agentLabel = (agent: string) => {
    if (agent === "github_issue") return "GitHub Issues";
    if (agent === "email") return "Follow-up Emails";
    if (agent === "term_sheet") return "Term Sheets";
    if (agent === "slack") return "Slack Messages";
    return `${agent} Actions`;
  };

  const agentIcon = (agent: string) => {
    if (agent === "github_issue") return "GH";
    if (agent === "email") return "EM";
    if (agent === "term_sheet") return "TS";
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
          {transcriptFile && (
            <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#3e476a] bg-[#12192a] px-3 py-1.5 text-xs text-[#cdd6f7]">
              <span className="shrink-0 rounded-full border border-[#4f7dff]/40 bg-[#4f7dff]/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-[#b8ccff]">
                Transcript
              </span>
              <span className="truncate">{transcriptFile.name}</span>
            </div>
          )}
        </div>
        <div className="rounded-full border border-[#3e476a] bg-[#12192a] px-3 py-1 text-xs text-[#a8b3d9]">
          {selectedCount} selected • {skippedCount} skipped • {undecidedCount} undecided • {actions.length} total
        </div>
      </div>

      <div className="space-y-3 mb-5">
        {orderedAgentEntries.map(([agent, groupActions]) => {
          const expanded = !!expandedGroups[agent];
          const groupSelected = groupActions.filter((a) => forms[a.id].decision === "create").length;
          const groupSkipped = groupActions.filter((a) => forms[a.id].decision === "reject").length;
          const groupUndecided = groupActions.length - groupSelected - groupSkipped;

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
                      {groupActions.length} actions • {groupSelected} selected • {groupSkipped} skipped • {groupUndecided} undecided
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
                    const isEmail = action.agent === "email";
                    const isTermSheet = action.agent === "term_sheet";
                    const isActionExecution = isGithub || isEmail || isTermSheet;
                    const isCreate = f.decision === "create";
                    const isReject = f.decision === "reject";
                    const createLabel = isEmail ? "Send" : "Create";
                    const rejectLabel = isEmail ? "Discard" : "Reject";
                    const loadingCreateLabel = isEmail ? "Sending..." : "Creating...";
                    const termSheetMode = termSheetViewMode[action.id] ?? "write";
                    const isCreatingThisAction = loading && creatingActionId === action.id;

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
                            {isActionExecution && isCreate && !loading && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                <span>✓</span>
                                <span>Ready</span>
                              </span>
                            )}
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

                          {!isTermSheet && (
                            <Field label="Description">
                              <textarea
                                value={f.description}
                                onChange={(e) => update(action.id, { description: e.target.value })}
                                rows={2}
                                className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff] resize-none"
                              />
                            </Field>
                          )}

                          {isTermSheet && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9ea9cf]">
                                  Description (Markdown)
                                </label>
                                <div className="inline-flex rounded-md border border-[#3a4568] bg-[#0f1628] p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setTermSheetMode(action.id, "write")}
                                    className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                      termSheetMode === "write"
                                        ? "bg-[#4f7dff] text-white"
                                        : "text-[#9fb0e4] hover:text-white"
                                    }`}
                                  >
                                    Write
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setTermSheetMode(action.id, "preview")}
                                    className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                      termSheetMode === "preview"
                                        ? "bg-[#4f7dff] text-white"
                                        : "text-[#9fb0e4] hover:text-white"
                                    }`}
                                  >
                                    Preview
                                  </button>
                                </div>
                              </div>

                              {termSheetMode === "write" ? (
                                <textarea
                                  value={f.description}
                                  onChange={(e) => update(action.id, { description: e.target.value })}
                                  rows={8}
                                  placeholder="# Term Sheet\n\n## Investment\n- Amount: $500,000\n- Valuation cap: $8,000,000"
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              ) : (
                                <div className="min-h-[170px] w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0]">
                                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:my-2 prose-li:my-1 prose-strong:text-white prose-a:text-[#8db2ff]">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {f.description.trim() || "_Nothing to preview yet._"}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              )}

                              <p className="text-[11px] text-[#8b97ba]">
                                Markdown supported: headings, lists, checklists, links, and tables.
                              </p>
                            </div>
                          )}

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

                          {isEmail && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              <Field label="To (required)">
                                <input
                                  type="text"
                                  value={f.to}
                                  onChange={(e) => update(action.id, { to: e.target.value })}
                                  placeholder="founder@example.com"
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              </Field>
                              <Field label="Cc (optional)">
                                <input
                                  type="text"
                                  value={f.cc}
                                  onChange={(e) => update(action.id, { cc: e.target.value })}
                                  placeholder="investor@example.com"
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              </Field>
                            </div>
                          )}

                          {isTermSheet && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              <Field label="Drive Folder ID (optional)">
                                <input
                                  type="text"
                                  value={f.folderId}
                                  onChange={(e) => update(action.id, { folderId: e.target.value })}
                                  placeholder="1AbCdEf..."
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              </Field>
                              <Field label="Share With (comma-separated)">
                                <input
                                  type="text"
                                  value={f.shareWith}
                                  onChange={(e) => update(action.id, { shareWith: e.target.value })}
                                  placeholder="founder@example.com, legal@example.com"
                                  className="w-full rounded-lg border border-[#344062] bg-[#0b1323] px-3 py-2.5 text-sm text-[#e8eaf0] placeholder:text-[#6f7a9f] focus:outline-none focus:border-[#6c63ff]"
                                />
                              </Field>
                            </div>
                          )}

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => decideAction(action.id, "create")}
                              className={`rounded-md border px-4 py-2 text-sm font-semibold transition-all ${
                                isCreate
                                  ? "border-emerald-400/70 bg-emerald-500 text-white shadow-[0_10px_26px_-14px_rgba(16,185,129,0.9)]"
                                  : "border-[#3d476c] bg-[#121a2b] text-[#aab5db] hover:border-emerald-400/50 hover:text-white"
                              }`}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                {isCreatingThisAction && (
                                  <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-r-transparent" />
                                )}
                                <span>{isCreatingThisAction ? loadingCreateLabel : createLabel}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => decideAction(action.id, "reject")}
                              className={`rounded-md border px-4 py-2 text-sm font-semibold transition-all ${
                                isReject
                                  ? "border-red-400/70 bg-red-500/90 text-white shadow-[0_10px_26px_-14px_rgba(239,68,68,0.9)]"
                                  : "border-[#3d476c] bg-[#121a2b] text-[#aab5db] hover:border-red-400/50 hover:text-white"
                              }`}
                            >
                              {rejectLabel}
                            </button>
                          </div>
                        </div>

                        <div className="px-3.5 pb-3.5 pt-0">
                          {successByAction[action.id] && (
                            <p className="text-[11px] font-medium text-emerald-300">{successByAction[action.id]}</p>
                          )}
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

      <div className="flex justify-end">
        <button
          type="button"
          disabled={loading || (!hasResultsReady && selectedCount === 0)}
          onClick={hasResultsReady ? onShowResults : executeAndViewResults}
          className="rounded-lg border border-[#5d6db3] bg-gradient-to-r from-[#6c63ff] to-[#4f7dff] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Preparing Results..." : "Show Results"}
        </button>
      </div>

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
