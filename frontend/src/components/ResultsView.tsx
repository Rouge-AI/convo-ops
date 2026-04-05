import type { Run } from "../types";

interface Props {
  run: Run;
  onReset: () => void;
}

export default function ResultsView({ run, onReset }: Props) {
  const results = run.execution_results ?? [];
  const audit = run.audit_trail ?? [];

  return (
    <div className="w-full max-w-3xl bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-8">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-semibold">Run Complete</h2>
          <p className="text-[#8b8fa8] text-sm mt-1">
            Run ID: <code className="font-mono text-xs bg-[#0f1117] px-1.5 py-0.5 rounded">{run.run_id}</code>
          </p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 whitespace-nowrap">
          {results.length} action{results.length !== 1 ? "s" : ""} executed
        </span>
      </div>

      {/* Execution results */}
      {results.length > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b8fa8] mb-3">Execution Results</h3>
          <div className="flex flex-col gap-3 mb-6">
            {results.map((r) => (
              <div key={r.action_id} className="bg-[#0f1117] border border-[#2a2d3a] rounded-lg p-4">
                <div className="text-sm font-semibold mb-2">🐙 {r.action_title}</div>
                <pre className="text-xs text-[#8b8fa8] whitespace-pre-wrap break-words bg-[#0a0c12] rounded p-2">{r.result}</pre>
                <div className="text-[11px] text-[#8b8fa8] mt-2 text-right">
                  {new Date(r.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {results.length === 0 && (
        <p className="text-[#8b8fa8] text-sm py-6">All actions were rejected — nothing was executed.</p>
      )}

      {/* Audit trail */}
      {audit.length > 0 && (
        <>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b8fa8] mb-3">Audit Trail</h3>
          <div className="flex flex-col gap-2 mb-6">
            {audit.map((entry, i) => (
              <div key={i} className="bg-[#0f1117] border border-[#2a2d3a] rounded-lg p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[#6c63ff] mb-1">{entry.step}</div>
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
        </>
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
