import { useMemo, useState } from "react";
import type { PlannedAction, Run } from "../types";

interface Props {
  run: Run;
  allActions: PlannedAction[];
  rejectedActions: PlannedAction[];
  transcriptFile: {
    name: string;
    size: number;
  } | null;
  onReset: () => void;
}

export default function ResultsView({ run, allActions, rejectedActions, transcriptFile, onReset }: Props) {
  const results = useMemo(() => run.execution_results ?? [], [run.execution_results]);
  const audit   = run.audit_trail ?? [];
  const executedById = useMemo(
    () => new Map(results.map((result) => [result.action_id, result])),
    [results]
  );
  const rejectedIds = useMemo(
    () => new Set(rejectedActions.map((action) => action.id)),
    [rejectedActions]
  );
  const completedCount = executedById.size;
  const rejectedCount = allActions.length > 0
    ? allActions.filter((action) => rejectedIds.has(action.id)).length
    : rejectedActions.length;
  const notProcessedCount = allActions.length > 0
    ? allActions.filter((action) => !executedById.has(action.id) && !rejectedIds.has(action.id)).length
    : 0;

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    completed: true,
    rejected: false,
    not_processed: true,
  });

  const groupedActions = useMemo(() => {
    const completed: PlannedAction[] = [];
    const rejected: PlannedAction[] = [];
    const notProcessed: PlannedAction[] = [];

    for (const action of allActions) {
      if (executedById.has(action.id)) {
        completed.push(action);
      } else if (rejectedIds.has(action.id)) {
        rejected.push(action);
      } else {
        notProcessed.push(action);
      }
    }

    return { completed, rejected, notProcessed };
  }, [allActions, executedById, rejectedIds]);

  const notProcessedByType = useMemo(() => {
    const buckets: Record<string, PlannedAction[]> = {
      term_sheet: [],
      email: [],
      github_issue: [],
      slack: [],
      other: [],
    };

    for (const action of groupedActions.notProcessed) {
      if (action.agent in buckets) {
        buckets[action.agent].push(action);
      } else {
        buckets.other.push(action);
      }
    }

    return buckets;
  }, [groupedActions.notProcessed]);

  const toggleGroup = (key: "completed" | "rejected" | "not_processed") => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const actionTypeLabel = (agent: PlannedAction["agent"]) => {
    if (agent === "github_issue") return "GitHub Issue";
    if (agent === "email") return "Follow-up Email";
    if (agent === "term_sheet") return "Term Sheet";
    if (agent === "slack") return "Slack Message";
    return "Action";
  };

  return (
    <div className="w-full max-w-3xl bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-8">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-semibold">Run Complete</h2>
          {transcriptFile && (
            <p className="text-[#8b8fa8] text-sm mt-1">Transcript File: {transcriptFile.name}</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {completedCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 whitespace-nowrap">
              {completedCount} action{completedCount !== 1 ? "s" : ""} completed
            </span>
          )}
          {rejectedCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 whitespace-nowrap">
              {rejectedCount} rejected
            </span>
          )}
          {notProcessedCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
              {notProcessedCount} not processed
            </span>
          )}
        </div>
      </div>

      {allActions.length > 0 && (
        <div className="mb-6 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b8fa8]">
            Action Outcomes
          </h3>

          <div className="overflow-hidden rounded-xl border border-[#2f3a58] bg-[#11182a]">
            <button
              type="button"
              onClick={() => toggleGroup("completed")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a2238] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-green-500/30 bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">
                  Completed
                </span>
                <span className="text-sm text-[#cfd8fb]">{groupedActions.completed.length} actions</span>
              </div>
              <span className={`text-[#c1ccf2] transition-transform ${expandedGroups.completed ? "rotate-180" : "rotate-0"}`}>⌄</span>
            </button>
            {expandedGroups.completed && (
              <div className="border-t border-[#1e2434] p-3 space-y-2">
                {groupedActions.completed.length === 0 && (
                  <p className="text-xs text-[#8b8fa8]">No completed actions.</p>
                )}
                {groupedActions.completed.map((action) => {
                  const result = executedById.get(action.id);
                  return (
                    <div key={action.id} className="rounded-lg border border-green-500/25 bg-[#0f1117] p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[#46608f] bg-[#1a2540] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#b9cfff]">
                          {actionTypeLabel(action.agent)}
                        </span>
                        <div className="text-sm font-medium text-[#dbe3ff]">{action.title}</div>
                      </div>
                      {result && (
                        <pre className="mt-2 text-xs text-[#8b8fa8] whitespace-pre-wrap break-words bg-[#0a0c12] rounded p-2">
                          {result.result}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[#2f3a58] bg-[#11182a]">
            <button
              type="button"
              onClick={() => toggleGroup("rejected")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a2238] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                  Rejected
                </span>
                <span className="text-sm text-[#cfd8fb]">{groupedActions.rejected.length} actions</span>
              </div>
              <span className={`text-[#c1ccf2] transition-transform ${expandedGroups.rejected ? "rotate-180" : "rotate-0"}`}>⌄</span>
            </button>
            {expandedGroups.rejected && (
              <div className="border-t border-[#1e2434] p-3 space-y-2">
                {groupedActions.rejected.length === 0 && (
                  <p className="text-xs text-[#8b8fa8]">No rejected actions.</p>
                )}
                {groupedActions.rejected.map((action) => (
                  <div key={action.id} className="rounded-lg border border-red-500/25 bg-[#0f1117] p-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-[#46608f] bg-[#1a2540] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#b9cfff]">
                        {actionTypeLabel(action.agent)}
                      </span>
                      <div className="text-sm text-[#dbe3ff]">{action.title}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-[#2f3a58] bg-[#11182a]">
            <button
              type="button"
              onClick={() => toggleGroup("not_processed")}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a2238] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                  Not Processed
                </span>
                <span className="text-sm text-[#cfd8fb]">{groupedActions.notProcessed.length} actions</span>
              </div>
              <span className={`text-[#c1ccf2] transition-transform ${expandedGroups.not_processed ? "rotate-180" : "rotate-0"}`}>⌄</span>
            </button>
            {expandedGroups.not_processed && (
              <div className="border-t border-[#1e2434] p-3 space-y-2">
                {groupedActions.notProcessed.length === 0 && (
                  <p className="text-xs text-[#8b8fa8]">No unprocessed actions.</p>
                )}
                {[
                  ["term_sheet", "Term Sheets"],
                  ["email", "Follow-up Emails"],
                  ["github_issue", "GitHub Issues"],
                  ["slack", "Slack Messages"],
                  ["other", "Other Actions"],
                ].map(([key, label]) => {
                  const items = notProcessedByType[key] ?? [];
                  if (items.length === 0) return null;

                  return (
                    <div key={key} className="rounded-lg border border-[#2f3a58] bg-[#101628] p-2.5">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                          {label}
                        </span>
                        <span className="text-[11px] text-[#9fb0df]">{items.length}</span>
                      </div>
                      <div className="space-y-2">
                        {items.map((action) => (
                          <div key={action.id} className="rounded-lg border border-amber-500/25 bg-[#0f1117] p-3">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-[#46608f] bg-[#1a2540] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#b9cfff]">
                                {actionTypeLabel(action.agent)}
                              </span>
                              <div className="text-sm text-[#dbe3ff]">{action.title}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {results.length === 0 && rejectedActions.length === 0 && (
        <p className="text-[#8b8fa8] text-sm py-4">No actions were executed.</p>
      )}

      {/* Audit trail (collapsed by default) */}
      {audit.length > 0 && (
        <details className="mb-6">
          <summary className="text-xs font-semibold uppercase tracking-wide text-[#8b8fa8] cursor-pointer select-none mb-2">
            Audit Trail
          </summary>
          <div className="flex flex-col gap-2 mt-3">
            {audit.map((entry, i) => (
              <div key={i} className="bg-[#0f1117] border border-[#2a2d3a] rounded-lg p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#6c63ff] mb-1">
                  {entry.step}
                </div>
                <pre className="text-xs text-[#8b8fa8] whitespace-pre-wrap">
                  {JSON.stringify(
                    Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "step")),
                    null,
                    2
                  )}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}

      <button
        onClick={onReset}
        className="w-full py-3 px-5 bg-[#6c63ff] hover:bg-[#574fd6] text-white font-semibold rounded-lg transition-colors text-sm"
      >
        Start New Run
      </button>
    </div>
  );
}
