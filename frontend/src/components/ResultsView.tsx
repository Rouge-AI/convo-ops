import type { PlannedAction, Run } from "../types";

interface Props {
  run: Run;
  rejectedActions: PlannedAction[];
  onReset: () => void;
}

export default function ResultsView({ run, rejectedActions, onReset }: Props) {
  const results = run.execution_results ?? [];
  const audit   = run.audit_trail ?? [];

  return (
    <div className="w-full max-w-3xl bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-8">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-semibold">Run Complete</h2>
          <p className="text-[#8b8fa8] text-sm mt-1">
            Run ID:{" "}
            <code className="font-mono text-xs bg-[#0f1117] px-1.5 py-0.5 rounded">
              {run.run_id}
            </code>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {results.length > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 whitespace-nowrap">
              {results.length} issue{results.length !== 1 ? "s" : ""} created
            </span>
          )}
          {rejectedActions.length > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 whitespace-nowrap">
              {rejectedActions.length} rejected
            </span>
          )}
        </div>
      </div>

      {/* Executed results */}
      {results.length > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b8fa8] mb-3">
            Created Issues
          </h3>
          <div className="flex flex-col gap-3 mb-6">
            {results.map((r) => (
              <div key={r.action_id} className="bg-[#0f1117] border border-green-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-green-400 text-xs font-bold uppercase tracking-wide">✓ Created</span>
                  <span className="text-sm font-semibold">🐙 {r.action_title}</span>
                </div>
                <pre className="text-xs text-[#8b8fa8] whitespace-pre-wrap break-words bg-[#0a0c12] rounded p-2">
                  {r.result}
                </pre>
                <div className="text-[11px] text-[#8b8fa8] mt-2 text-right">
                  {new Date(r.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Rejected actions */}
      {rejectedActions.length > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b8fa8] mb-3">
            Rejected
          </h3>
          <div className="flex flex-col gap-3 mb-6">
            {rejectedActions.map((a) => (
              <div key={a.id} className="bg-[#0f1117] border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 uppercase tracking-wide">
                  Rejected
                </span>
                <span className="text-sm text-[#8b8fa8]">🐙 {a.title}</span>
              </div>
            ))}
          </div>
        </>
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
