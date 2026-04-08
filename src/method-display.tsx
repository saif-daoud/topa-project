import type { CSSProperties } from "react";
import type { MethodSpec } from "./viewer-utils";

export type ViewerMethod = MethodSpec & {
  displayName: string;
  badgeLabel: string;
  badgeStyle: CSSProperties;
  feedbackAliases: string[];
};

const METHOD_META: Record<
  string,
  {
    displayName: string;
    badgeLabel: string;
    accent: string;
    background: string;
    border: string;
    feedbackAliases?: string[];
  }
> = {
  A: {
    displayName: "ChatGPT-5",
    badgeLabel: "A",
    accent: "#1d4ed8",
    background: "#dbeafe",
    border: "#93c5fd",
    feedbackAliases: ["ChatGPT-5", "ChatGPT 5", "ChatGPT"],
  },
  B: {
    displayName: "DeepSeek",
    badgeLabel: "B",
    accent: "#0369a1",
    background: "#e0f2fe",
    border: "#7dd3fc",
    feedbackAliases: ["DeepSeek"],
  },
  C: {
    displayName: "Chap-Seq",
    badgeLabel: "C",
    accent: "#7c3aed",
    background: "#ede9fe",
    border: "#c4b5fd",
    feedbackAliases: ["Chap-Seq", "Chapter Sequence", "Chap_Seq"],
  },
  D: {
    displayName: "LC-Full",
    badgeLabel: "D",
    accent: "#4338ca",
    background: "#e0e7ff",
    border: "#a5b4fc",
    feedbackAliases: ["LC-Full", "Long Context Full", "LC_Full"],
  },
  E: {
    displayName: "Chunk-RAG",
    badgeLabel: "E",
    accent: "#b45309",
    background: "#ffedd5",
    border: "#fdba74",
    feedbackAliases: ["Chunk-RAG", "Chunk RAG", "Chunk_RAG"],
  },
  F: {
    displayName: "Policies",
    badgeLabel: "F",
    accent: "#b91c1c",
    background: "#fee2e2",
    border: "#fca5a5",
    feedbackAliases: ["Policies", "Rules"],
  },
  G: {
    displayName: "TOPA Per Book",
    badgeLabel: "G",
    accent: "#047857",
    background: "#d1fae5",
    border: "#6ee7b7",
    feedbackAliases: ["TOPA-Per-Book", "TOPA Per Book"],
  },
  H: {
    displayName: "TOPA (Late Fusion)",
    badgeLabel: "H",
    accent: "#0f766e",
    background: "#ccfbf1",
    border: "#5eead4",
    feedbackAliases: ["TOPA (Late Fusion)", "TOPA Late Fusion", "TOPAOurExtractor_LateFusion"],
  },
  I: {
    displayName: "TOPA (Early Fusion)",
    badgeLabel: "I",
    accent: "#15803d",
    background: "#dcfce7",
    border: "#86efac",
    feedbackAliases: ["TOPA (Early Fusion)", "TOPA Early Fusion", "TOPAOurExtractor_EarlyFusion"],
  },
  J: {
    displayName: "Mamba",
    badgeLabel: "J",
    accent: "#a21caf",
    background: "#fae8ff",
    border: "#f0abfc",
    feedbackAliases: ["Mamba"],
  },
  K: {
    displayName: "Merge-RAG",
    badgeLabel: "K",
    accent: "#c2410c",
    background: "#ffedd5",
    border: "#fdba74",
    feedbackAliases: ["Merge-RAG", "Merge RAG", "Merge_RAG"],
  },
};

const DEFAULT_META = {
  displayName: "Unknown Method",
  badgeLabel: "?",
  accent: "#475569",
  background: "#e2e8f0",
  border: "#cbd5e1",
  feedbackAliases: [] as string[],
};

export function decorateMethod(method: MethodSpec): ViewerMethod {
  const meta = METHOD_META[method.id] ?? {
    ...DEFAULT_META,
    displayName: method.name,
    badgeLabel: method.id || DEFAULT_META.badgeLabel,
  };

  return {
    ...method,
    name: meta.displayName,
    displayName: meta.displayName,
    badgeLabel: meta.badgeLabel,
    badgeStyle: {
      color: meta.accent,
      backgroundColor: meta.background,
      borderColor: meta.border,
    },
    feedbackAliases: Array.from(new Set([meta.displayName, method.name, method.id, ...(meta.feedbackAliases ?? [])])),
  };
}

export function MethodBadge({ method }: { method: ViewerMethod }) {
  return (
    <span className="methodBadge" style={method.badgeStyle} aria-label={`Legacy survey code ${method.badgeLabel}`}>
      {method.badgeLabel}
    </span>
  );
}

export function MethodIdentity({
  method,
  compact = false,
}: {
  method: ViewerMethod;
  compact?: boolean;
}) {
  return (
    <span className={`methodIdentity${compact ? " methodIdentity--compact" : ""}`}>
      <MethodBadge method={method} />
      <span className="methodIdentityMain">
        <span className="methodIdentityText">{method.displayName}</span>
      </span>
    </span>
  );
}
