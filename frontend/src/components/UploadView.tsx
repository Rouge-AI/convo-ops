import { useRef, useState } from "react";
import { startRun } from "../api";
import type { Run } from "../types";

interface TranscriptFile {
  name: string;
  size: number;
}

interface Props {
  onRunStarted: (run: Run, transcriptFile: TranscriptFile) => void;
}

export default function UploadView({ onRunStarted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearFile = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const run = await startRun(file);
      onRunStarted(run, { name: file.name, size: file.size });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error — check the backend.");
    } finally {
      setLoading(false);
    }
  };

  const accept = (f: File) => {
    if (f.type === "application/pdf") setFile(f);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-[#313754] bg-gradient-to-b from-[#1c2234] to-[#141a2a] p-6 md:p-8 shadow-[0_35px_100px_-45px_rgba(79,125,255,0.45)]">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#f1f4ff]">Upload Meeting Transcript</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#97a1c5]">
            Drop your transcript PDF to generate a clean, reviewable action plan before any execution happens.
          </p>
        </div>
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) accept(f);
        }}
        className={`group relative mb-4 cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
          dragging
            ? "border-[#6c63ff] bg-[#6c63ff]/10"
            : file
            ? "border-emerald-500/45 bg-emerald-500/5"
            : "border-[#384164] bg-[#11182a] hover:border-[#6c63ff]/80 hover:bg-[#6c63ff]/8"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_top,rgba(108,99,255,0.15),transparent_55%)]" />

        {!file && (
          <div className="relative">
            <div className="mb-2 text-2xl">📤</div>
            <p className="text-sm font-medium text-[#dce3ff]">Click or drag a PDF here</p>
          </div>
        )}

        {file && (
          <div className="relative mx-auto max-w-xl rounded-lg border border-emerald-400/30 bg-[#0f1b1a] px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-emerald-200">📄 {file.name}</p>
                <p className="mt-0.5 text-xs text-emerald-300/80">{formatBytes(file.size)}</p>
              </div>
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                Ready
              </span>
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) accept(f); }}
      />

      {file && (
        <div className="mb-4 flex items-center justify-end">
          <button
            type="button"
            onClick={clearFile}
            disabled={loading}
            className="rounded-md border border-[#3a4367] bg-[#11182a] px-3 py-1.5 text-xs font-semibold text-[#adb7df] transition-colors hover:border-red-400/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove PDF
          </button>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <button
        disabled={!file || loading}
        onClick={handleSubmit}
        className="w-full rounded-lg bg-gradient-to-r from-[#6c63ff] to-[#4f7dff] px-5 py-3 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {loading ? "Analysing transcript…" : "Start ConvoOps Run"}
      </button>
    </div>
  );
}
