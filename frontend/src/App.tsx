import { useState } from "react";
import ApprovalView from "./components/ApprovalView";
import ResultsView from "./components/ResultsView";
import UploadView from "./components/UploadView";
import type { PendingApproval, PlannedAction, Run } from "./types";

type Step = "upload" | "approval" | "results";
type TranscriptFile = {
  name: string;
  size: number;
};

function App() {
  const [step, setStep] = useState<Step>("upload");
  const [run, setRun] = useState<Run | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [rejectedActions, setRejectedActions] = useState<PlannedAction[]>([]);
  const [transcriptFile, setTranscriptFile] = useState<TranscriptFile | null>(null);

  const canOpenActionPlan = !!pendingApproval;
  const canOpenResults = run?.status === "completed";

  const handleRunStarted = (newRun: Run, file: TranscriptFile) => {
    setRun(newRun);
    setPendingApproval(newRun.pending_approval ?? null);
    setTranscriptFile(file);
    setStep(newRun.status === "pending_approval" ? "approval" : "results");
  };

  const handleCompleted = (
    completedRun: Run,
    rejected: PlannedAction[],
    navigateToResults = true
  ) => {
    setRun(completedRun);
    setRejectedActions(rejected);
    if (navigateToResults) {
      setStep("results");
    }
  };

  const handleShowResults = () => {
    if (run?.status === "completed") {
      setStep("results");
    }
  };

  const handleReset = () => {
    setRun(null);
    setPendingApproval(null);
    setRejectedActions([]);
    setTranscriptFile(null);
    setStep("upload");
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0f1117] text-[#e8eaf0] font-sans">
      <header className="bg-[#1a1d27] border-b border-[#2a2d3a] px-8 pt-6 pb-4 text-center">
        <div className="text-2xl font-bold text-[#6c63ff] tracking-tight">ConvoOps</div>
        <p className="text-[#8b8fa8] text-sm mt-1">
          Turn every meeting into a traceable, automated workflow
        </p>
        <nav className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setStep("upload")}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              step === "upload"
                ? "border-[#6c63ff] bg-[#6c63ff] text-white"
                : "border-[#3b4160] bg-[#12182b] text-[#aab5db] hover:text-white"
            }`}
          >
            Upload Transcript
          </button>
          <button
            type="button"
            onClick={() => setStep("approval")}
            disabled={!canOpenActionPlan}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              step === "approval"
                ? "border-[#6c63ff] bg-[#6c63ff] text-white"
                : "border-[#3b4160] bg-[#12182b] text-[#aab5db] hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Action Plan
          </button>
          <button
            type="button"
            onClick={() => setStep("results")}
            disabled={!canOpenResults}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              step === "results"
                ? "border-[#6c63ff] bg-[#6c63ff] text-white"
                : "border-[#3b4160] bg-[#12182b] text-[#aab5db] hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Results
          </button>
        </nav>
      </header>

      <main className="flex-1 flex justify-center items-start p-10">
        {step === "upload" && <UploadView onRunStarted={handleRunStarted} />}
        {step === "approval" && pendingApproval && run && (
          <ApprovalView
            runId={run.run_id}
            pending={pendingApproval}
            transcriptFile={transcriptFile}
            hasResultsReady={run?.status === "completed"}
            onShowResults={handleShowResults}
            onCompleted={handleCompleted}
          />
        )}
        {step === "results" && run && (
          <ResultsView
            run={run}
            allActions={pendingApproval?.action_plan ?? []}
            rejectedActions={rejectedActions}
            transcriptFile={transcriptFile}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}

export default App;
