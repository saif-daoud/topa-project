export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://127.0.0.1:8789/api";
export const BASE_URL = import.meta.env.BASE_URL;

export const STORAGE_KEYS = {
  token: "topa_ontology_review_token",
  participantId: "topa_ontology_review_pid",
  reviewData: "topa_ontology_review_data",
  changes: "topa_ontology_review_changes",
  feedback: "topa_ontology_review_feedback",
};

const REVIEW_RESET_MARKER = "topa_ontology_review_reset_2026_06_05_v2";

if (typeof window !== "undefined" && localStorage.getItem(REVIEW_RESET_MARKER) !== "done") {
  localStorage.removeItem(STORAGE_KEYS.reviewData);
  localStorage.removeItem(STORAGE_KEYS.changes);
  localStorage.removeItem(STORAGE_KEYS.feedback);
  localStorage.setItem(REVIEW_RESET_MARKER, "done");
  window.location.reload();
}

export const BASELINE_VERSION = "topa_late_fusion_2026_06";
