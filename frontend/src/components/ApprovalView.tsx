import { useState } from "react";
import { approveRun } from "../api";
import type { PendingApproval, PlannedAction, Run } from "../types";

interface Props {
  runId: string;
  pending: PendingApproval;
  onCompleted: (run: Run) => void;
}

const PRIORITY_BG: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-green-500",
};

const AGENT_ICON: Record<string, string> = {
  github_issue: "🐙",
  email: "📧",
  slack: "💬",
};

export default function ApprovalView({ runId, pending, onCompleted }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(pending.action_plan.map((a) => a.id))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    const approved: PlannedAction[] = pending.action_plan.filter((a) => selected.has(a.id));
    try {
      const run = await approveRun(runId, approved);
      onCompleted(run);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setLoading(false);
    }
  };

  const intel = pending.extracted_intelligence;

  return (
    <div className="w-full max-w-3xl bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-8">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-semibold">Review Action Plan</h2>
          <p className="text-[#8b8fa8] text-sm mt-1">
            <span className="font-medium text-[#e8eaf0]">{pending.conversation_type}</span>
            {" · "}{(pending.confidence * 100).toFixed(0)}% confidence
            {" · "}{pending.participants.join(", ")}
          </p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#6c63ff]/15 text-[#6c63ff] border border-[#6c63ff]/30 whitespace-nowrap">
          {pending.execution_profile}
        </span>
      </div>

      {/* Intelligence grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {intel.decisions.length > 0 && (
          <IntelSection title="Decisions" items={intel.decisions} />
        )}
        {intel.blockers.length > 0 && (
          <IntelSection title="Blockers" items={intel.blockers} accent />
        )}
        {intel.open_questions.length > 0 && (
          <IntelSection title="Open Questions" items={intel.open_questions} />
        )}
      </div>

      {/* Action plan */}
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b8fa8] mb-3">
        Agent Actions — select which to execute
      </h3>
      <div className="flex flex-col gap-2 mb-6">
        {pending.action_plan.map((action) => (
          <label
            key={action.id}
            className={`flex items-start gap-3 bg-[#0f1117] border rounded-lg p-4 cursor-pointer transition-colors
              ${selected.has(action.id) ? "border-[#6c63ff]" : "border-[#2a2d3a] hover:border-[#8b8fa8]"}`}
          >
            <input
              type="checkbox"
              checked={selected.has(action.id)}
              onChange={() => toggle(action.id)}
              className="mt-0.5 accent-[#6c63ff] shrink-0"
            />
            <span className="text-lg shrink-0">{AGENT_ICON[action.agent] ?? "🤖"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{action.title}</div>
              <div className="text-xs text-[#8b8fa8] mt-0.5">{action.description}</div>
            </div>
            <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${PRIORITY_BG[action.priority] ?? "bg-gray-500"}`}>
              {action.priority}
            </span>
          </label>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {/* Footer */}
      <div className="flex gap-3">
        <button
          disabled={loading}
          onClick={() => approveRun(runId, [])}
          className="px-5 py-3 rounded-lg border border-[#2a2d3a] text-[#8b8fa8] text-sm font-medium hover:border-[#8b8fa8] hover:text-[#e8eaf0] disabled:opacity-50 transition-colors"
        >
          Reject All
        </button>
        <button
          disabled={selected.size === 0 || loading}
          onClick={handleApprove}
          className="flex-1 py-3 px-5 bg-[#6c63ff] hover:bg-[#574fd6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
        >
          {loading ? "Executing…" : `Approve & Execute (${selected.size})`}
        </button>
      </div>
    </div>
  );
}

function IntelSection({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div className={`bg-[#0f1117] border rounded-lg p-3.5 ${accent ? "border-red-500/40" : "border-[#2a2d3a]"}`}>
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#8b8fa8] mb-2">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-[#8b8fa8] border-t border-[#2a2d3a] pt-1 first:border-t-0 first:pt-0">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
