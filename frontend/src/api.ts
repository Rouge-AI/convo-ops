import axios from "axios";
import type { PlannedAction, Run } from "./types";

const client = axios.create({ baseURL: "/api/v1" });

export async function startRun(pdf: File): Promise<Run> {
  const form = new FormData();
  form.append("pdf", pdf);
  const { data } = await client.post<Run>("/runs", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getRun(runId: string): Promise<Run> {
  const { data } = await client.get<Run>(`/runs/${runId}`);
  return data;
}

export async function approveRun(
  runId: string,
  approvedActions: PlannedAction[]
): Promise<Run> {
  const { data } = await client.post<Run>(`/runs/${runId}/approve`, {
    approved_actions: approvedActions,
  });
  return data;
}
