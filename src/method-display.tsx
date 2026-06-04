import type { CSSProperties } from "react";
import type { MethodSpec } from "./viewer-utils";

export type ViewerMethod = MethodSpec & {
  displayName: string;
  badgeLabel: string;
  badgeStyle: CSSProperties;
};

const METHOD_META: Record<
  string,
  {
    displayName: string;
    badgeLabel: string;
    accent: string;
    background: string;
    border: string;
  }
> = {
  H: {
    displayName: "TOPA Late Fusion",
    badgeLabel: "TOPA",
    accent: "#0f766e",
    background: "#ccfbf1",
    border: "#5eead4",
  },
};

const DEFAULT_META = {
  displayName: "Unknown Method",
  badgeLabel: "?",
  accent: "#475569",
  background: "#e2e8f0",
  border: "#cbd5e1",
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
  };
}

export function MethodBadge({ method }: { method: ViewerMethod }) {
  return (
    <span className="methodBadge" style={method.badgeStyle} aria-label={method.displayName}>
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
