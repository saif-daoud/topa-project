import type { ViewerMethod } from "./method-display";

type RawFeedbackRow = {
  comparison_id?: string;
  component?: string;
  "Method X"?: string;
  "Method Y"?: string;
  llm_consensus_winner?: string;
  llm_consensus_detail?: string;
  llm_all_runs_agree?: boolean | string;
  llm_supporting_runs?: number | string;
  llm_selected_run?: number | string;
  llm_selected_winner?: string;
  llm_selected_reason?: string;
};

export type LLMFeedbackRecord = {
  comparisonId: string;
  component: string;
  methodX: string;
  methodY: string;
  llmConsensusWinner: string;
  llmConsensusDetail: string;
  llmAllRunsAgree: boolean;
  llmSupportingRuns: number;
  llmTotalRuns: number;
  llmSelectedRun: number;
  llmSelectedWinner: string;
  llmSelectedReason: string;
};

export function normalizeMethodLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toBoolean(value: boolean | string | undefined) {
  if (typeof value === "boolean") return value;
  return String(value || "").trim().toLowerCase() === "true";
}

function toNumber(value: number | string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTotalRuns(detail: string) {
  const match = /\((\d+)\s*\/\s*(\d+)\s*runs?\)/i.exec(detail || "");
  if (!match) return 0;
  return toNumber(match[2]);
}

function methodMatchesLabel(method: ViewerMethod, label: string) {
  const normalized = normalizeMethodLabel(label);
  return method.feedbackAliases.some((alias) => normalizeMethodLabel(alias) === normalized);
}

export function parseLLMFeedbackRows(raw: unknown): LLMFeedbackRecord[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((row): LLMFeedbackRecord | null => {
      const typed = row as RawFeedbackRow;
      const component = String(typed.component || "").trim();
      const methodX = String(typed["Method X"] || "").trim();
      const methodY = String(typed["Method Y"] || "").trim();

      if (!component || !methodX || !methodY) return null;

      return {
        comparisonId: String(typed.comparison_id || "").trim(),
        component,
        methodX,
        methodY,
        llmConsensusWinner: String(typed.llm_consensus_winner || "").trim(),
        llmConsensusDetail: String(typed.llm_consensus_detail || "").trim(),
        llmAllRunsAgree: toBoolean(typed.llm_all_runs_agree),
        llmSupportingRuns: toNumber(typed.llm_supporting_runs),
        llmTotalRuns: extractTotalRuns(String(typed.llm_consensus_detail || "")),
        llmSelectedRun: toNumber(typed.llm_selected_run),
        llmSelectedWinner: String(typed.llm_selected_winner || typed.llm_consensus_winner || "").trim(),
        llmSelectedReason: String(typed.llm_selected_reason || "").trim(),
      };
    })
    .filter((row): row is LLMFeedbackRecord => row !== null);
}

export function findLLMFeedbackForPair(
  rows: LLMFeedbackRecord[],
  component: string,
  primaryMethod: ViewerMethod,
  compareMethod: ViewerMethod
) {
  return (
    rows.find((row) => {
      if (row.component !== component) return false;

      const directMatch = methodMatchesLabel(primaryMethod, row.methodX) && methodMatchesLabel(compareMethod, row.methodY);
      const reverseMatch = methodMatchesLabel(primaryMethod, row.methodY) && methodMatchesLabel(compareMethod, row.methodX);
      return directMatch || reverseMatch;
    }) ?? null
  );
}

export function findViewerMethodByFeedbackLabel(methods: ViewerMethod[], label: string) {
  return methods.find((method) => methodMatchesLabel(method, label)) ?? null;
}
