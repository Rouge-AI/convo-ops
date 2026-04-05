import { useState } from "react";
import ApprovalView from "./components/ApprovalView";
import ResultsView from "./components/ResultsView";
import UploadView from "./components/UploadView";
import type { PlannedAction, Run } from "./types";

type Step = "upload" | "approval" | "results";

function App() {
  const [step, setStep] = useState<Step>("upload");
  const [run, setRun] = useState<Run | null>(null);
  const [rejectedActions, setRejectedActions] = useState<PlannedAction[]>([]);

  const handleRunStarted = (newRun: Run) => {
    setRun(newRun);
    setStep(newRun.status === "pending_approval" ? "approval" : "results");
  };

  const handleCompleted = (completedRun: Run, rejected: PlannedAction[]) => {
    setRun(completedRun);
    setRejectedActions(rejected);
    setStep("results");
  };

  const handleReset = () => {
    setRun(null);
    setRejectedActions([]);
    setStep("upload");
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0f1117] text-[#e8eaf0] font-sans">
      <header className="bg-[#1a1d27] border-b border-[#2a2d3a] px-8 pt-6 pb-4 text-center">
        <div className="text-2xl font-bold text-[#6c63ff] tracking-tight">ConvoOps</div>
        <p className="text-[#8b8fa8] text-sm mt-1">
          Turn every meeting into a traceable, automated workflow
        </p>
        <div className="flex items-center justify-center gap-0 mt-5">
          <StepIndicator label="Upload"  active={step === "upload"}   done={step !== "upload"} />
          <div className="w-12 h-0.5 bg-[#2a2d3a]" />
          <StepIndicator label="Approve" active={step === "approval"} done={step === "results"} />
          <div className="w-12 h-0.5 bg-[#2a2d3a]" />
          <StepIndicator label="Results" active={step === "results"}  done={false} />
        </div>
      </header>

      <main className="flex-1 flex justify-center items-start p-10">
        {step === "upload" && <UploadView onRunStarted={handleRunStarted} />}
        {step === "approval" && run?.pending_approval && (
          <ApprovalView
            runId={run.run_id}
            pending={run.pending_approval}
            onCompleted={handleCompleted}
          />
        )}
        {step === "results" && run && (
          <ResultsView run={run} rejectedActions={rejectedActions} onReset={handleReset} />
        )}
      </main>
    </div>
  );
}

function StepIndicator({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const dotBase = "w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs";
  const dotClass = done
    ? `${dotBase} border-green-500 bg-green-500 text-white`
    : active
    ? `${dotBase} border-[#6c63ff] bg-[#6c63ff] text-white`
    : `${dotBase} border-[#2a2d3a] bg-[#0f1117] text-[#8b8fa8]`;

  const labelClass = done
    ? "text-xs text-green-500"
    : active
    ? "text-xs text-[#e8eaf0] font-semibold"
    : "text-xs text-[#8b8fa8]";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={dotClass}>{done ? "✓" : ""}</div>
      <span className={labelClass}>{label}</span>
    </div>
  );
}

export default App;
