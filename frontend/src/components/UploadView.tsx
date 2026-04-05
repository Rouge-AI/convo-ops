import { useRef, useState } from "react";
import { startRun } from "../api";
import type { Run } from "../types";

interface Props {
  onRunStarted: (run: Run) => void;
}

export default function UploadView({ onRunStarted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const run = await startRun(file);
      onRunStarted(run);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error — check the backend.");
    } finally {
      setLoading(false);
    }
  };

  const accept = (f: File) => {
    if (f.type === "application/pdf") setFile(f);
  };

  return (
    <div className="w-full max-w-lg bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-8">
      <h2 className="text-xl font-semibold mb-1">Upload Meeting Transcript</h2>
      <p className="text-[#8b8fa8] text-sm mb-6 leading-relaxed">
        Drop a PDF of your meeting transcript and ConvoOps will extract intelligence,
        generate an action plan, and wait for your approval before executing any agents.
      </p>

      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) accept(f); }}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors mb-4
          ${dragging ? "border-[#6c63ff] bg-[#6c63ff]/5" : "border-[#2a2d3a] hover:border-[#6c63ff] hover:bg-[#6c63ff]/5"}
        `}
      >
        {file ? (
          <span className="text-[#e8eaf0] font-medium">📄 {file.name}</span>
        ) : (
          <span className="text-[#8b8fa8]">Click or drag a PDF here</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) accept(f); }}
      />

      {error && <p className="text-red-400 text-sm mt-1 mb-2">{error}</p>}

      <button
        disabled={!file || loading}
        onClick={handleSubmit}
        className="w-full mt-2 py-3 px-5 bg-[#6c63ff] hover:bg-[#574fd6] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm"
      >
        {loading ? "Analysing transcript…" : "Start ConvoOps Run"}
      </button>
    </div>
  );
}
