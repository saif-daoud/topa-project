export type MethodSpec = {
  id: string;
  name: string;
  file: string;
};

export function prettify(value: string) {
  return (value || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

export function normKey(value: string) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripPlural(value: string) {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

export function bestMatchingKey(obj: any, desired: string): string | null {
  if (!obj || typeof obj !== "object") return null;

  const target = normKey(desired);
  const targetSingular = stripPlural(target);
  let best: { key: string; score: number } | null = null;

  for (const key of Object.keys(obj)) {
    const normalizedKey = normKey(key);
    const normalizedSingular = stripPlural(normalizedKey);

    let score = 0;
    if (normalizedKey === target) score = 100;
    else if (normalizedSingular === targetSingular) score = 95;
    else if (normalizedKey.includes(target) || target.includes(normalizedKey)) score = 70;
    else if (normalizedSingular.includes(targetSingular) || targetSingular.includes(normalizedSingular)) score = 60;

    if (score > 0 && (!best || score > best.score)) best = { key, score };
  }

  return best?.key ?? null;
}

export function getComponentValue(methodData: any, component: string) {
  const key = bestMatchingKey(methodData, component);
  return key ? methodData[key] : null;
}

export function getDescription(descriptions: Record<string, string>, component: string) {
  if (!descriptions) return "";
  if (descriptions[component]) return descriptions[component];
  const key = bestMatchingKey(descriptions, component);
  return key ? descriptions[key] : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMiniMarkdown(markdown: string) {
  const safe = escapeHtml(markdown || "");
  const withBold = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return withBold.replace(/\n/g, "<br/>");
}

export function isRecord(value: any): value is Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function isPrimitive(value: any) {
  return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function clipText(value: any, max = 500) {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export function isEmptyValue(value: any): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);

  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length === 0 || keys.every((key) => isEmptyValue(value[key]));
  }

  return false;
}

export function parseListString(value: string): string[] | null {
  if (typeof value !== "string") return null;

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const isBullet = (line: string) => /^(-|\*)\s+/.test(line);
  const isNumbered = (line: string) => /^\d+[\).]\s+/.test(line);
  const looksList = (line: string) => isBullet(line) || isNumbered(line);

  if (lines.filter(looksList).length / lines.length < 0.6) return null;
  return lines.map((line) => line.replace(/^(-|\*)\s+/, "").replace(/^\d+[\).]\s+/, ""));
}

export function removeConfidence(value: any): any {
  if (Array.isArray(value)) return value.map(removeConfidence);
  if (!isRecord(value)) return value;

  const out: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (normKey(key).includes("confidence")) continue;
    out[key] = removeConfidence(nestedValue);
  }

  return out;
}
