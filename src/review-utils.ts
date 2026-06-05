import { isRecord, normKey, prettify } from "./viewer-utils";

export type JsonPath = Array<string | number>;
export type ChangeOperation = "add" | "replace" | "remove" | "restore" | "revoke";

export type ReviewChange = {
  id: string;
  component: string;
  path: JsonPath;
  path_key: string;
  target_id?: string | null;
  operation: ChangeOperation;
  old_value: any;
  new_value: any;
  comment?: string | null;
  revoked_change_id?: string | null;
  revoked_by_change_id?: string | null;
  timestamp_utc: string;
  synced?: boolean;
  sync_error?: string | null;
};

export type ReviewFeedback = {
  id: string;
  component: string;
  path: JsonPath;
  feedback: string;
  timestamp_utc: string;
  synced?: boolean;
};

export const REVIEW_ID_KEY = "_reviewId";
export const REVIEW_DELETED_KEY = "_reviewDeleted";

export function nowUtc() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function pathKey(path: JsonPath) {
  return JSON.stringify(path);
}

export function parentPath(path: JsonPath) {
  return path.slice(0, -1);
}

export function stablePathId(path: JsonPath) {
  return `base_${path.map((part) => String(part).replace(/[^a-zA-Z0-9]+/g, "_")).join("_") || "root"}`;
}

export function annotateReviewIds(value: any, path: JsonPath = []): any {
  if (Array.isArray(value)) return value.map((item, index) => annotateReviewIds(item, [...path, index]));
  if (!isRecord(value)) return value;

  const existingId = typeof value[REVIEW_ID_KEY] === "string" ? value[REVIEW_ID_KEY] : stablePathId(path);
  const out: Record<string, any> = { ...value, [REVIEW_ID_KEY]: existingId };
  for (const [key, nested] of Object.entries(value)) {
    if (key === REVIEW_ID_KEY || key === REVIEW_DELETED_KEY) continue;
    out[key] = annotateReviewIds(nested, [...path, key]);
  }
  return out;
}

export function stripReviewMetadata(value: any): any {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(isRecord(item) && item[REVIEW_DELETED_KEY] === true))
      .map((item) => stripReviewMetadata(item));
  }

  if (!isRecord(value)) return value;
  if (value[REVIEW_DELETED_KEY] === true) return undefined;

  const out: Record<string, any> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === REVIEW_ID_KEY || key === REVIEW_DELETED_KEY) continue;
    const cleaned = stripReviewMetadata(nested);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

export function getReviewId(value: any) {
  return isRecord(value) && typeof value[REVIEW_ID_KEY] === "string" ? value[REVIEW_ID_KEY] : null;
}

export function isReviewDeleted(value: any) {
  return isRecord(value) && value[REVIEW_DELETED_KEY] === true;
}

export function getAtPath(root: any, path: JsonPath): any {
  return path.reduce((current, part) => (current == null ? undefined : current[part as any]), root);
}

export function updateAtPath(root: any, path: JsonPath, updater: (current: any) => any): any {
  if (path.length === 0) return updater(root);
  const [head, ...tail] = path;

  if (Array.isArray(root)) {
    const copy = [...root];
    copy[Number(head)] = updateAtPath(copy[Number(head)], tail, updater);
    return copy;
  }

  if (isRecord(root)) {
    return {
      ...root,
      [String(head)]: updateAtPath(root[String(head)], tail, updater),
    };
  }

  return root;
}

export function setAtPath(root: any, path: JsonPath, nextValue: any): any {
  return updateAtPath(root, path, () => nextValue);
}

export function insertArrayItem(root: any, arrayPath: JsonPath, item: any): any {
  return updateAtPath(root, arrayPath, (current) => (Array.isArray(current) ? [...current, item] : current));
}

export function insertArrayItemAtIndex(root: any, arrayPath: JsonPath, index: number, item: any): any {
  return updateAtPath(root, arrayPath, (current) => {
    if (!Array.isArray(current)) return current;
    const copy = [...current];
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, item);
    return copy;
  });
}

export function removeAtPath(root: any, path: JsonPath): any {
  const ownerPath = parentPath(path);
  const last = path[path.length - 1];
  return updateAtPath(root, ownerPath, (owner) => {
    if (Array.isArray(owner)) return owner.filter((_, index) => index !== Number(last));
    if (isRecord(owner)) {
      const copy = { ...owner };
      delete copy[String(last)];
      return copy;
    }
    return owner;
  });
}

export function findPathByReviewId(root: any, reviewId: string, path: JsonPath = []): JsonPath | null {
  if (!reviewId) return null;

  if (isRecord(root) && root[REVIEW_ID_KEY] === reviewId) return path;

  if (Array.isArray(root)) {
    for (let index = 0; index < root.length; index++) {
      const found = findPathByReviewId(root[index], reviewId, [...path, index]);
      if (found) return found;
    }
    return null;
  }

  if (isRecord(root)) {
    for (const [key, value] of Object.entries(root)) {
      if (key === REVIEW_ID_KEY) continue;
      const found = findPathByReviewId(value, reviewId, [...path, key]);
      if (found) return found;
    }
  }

  return null;
}

export function markDeletedAtPath(root: any, path: JsonPath, deleted: boolean): any {
  return updateAtPath(root, path, (current) => {
    if (!isRecord(current)) return current;
    return { ...current, [REVIEW_DELETED_KEY]: deleted };
  });
}

export function addObjectField(root: any, objectPath: JsonPath, key: string): any {
  return updateAtPath(root, objectPath, (current) => {
    if (!isRecord(current) || Object.prototype.hasOwnProperty.call(current, key)) return current;
    return { ...current, [key]: "" };
  });
}

function makeReviewObject(value: Record<string, any>, path: JsonPath) {
  return annotateReviewIds({ ...value, [REVIEW_ID_KEY]: makeId("item") }, path);
}

export function makeArrayItemTemplate(arrayPath: JsonPath, currentArray: any[]): any {
  const lastKey = String(arrayPath[arrayPath.length - 1] ?? "");
  const normalized = normKey(lastKey);
  const nextPath = [...arrayPath, currentArray.length];

  if (normalized.includes("microaction")) {
    return makeReviewObject({ name: "New micro action", description: "", states: [] }, nextPath);
  }

  if (normalized.includes("actionspace") || normalized.includes("macroaction")) {
    return makeReviewObject({ name: "New macro action", description: "", goal: { objective: "" }, states: [], micro_actions: [] }, nextPath);
  }

  if (normalized.includes("state") || normalized.includes("option")) return "";

  const firstRecord = currentArray.find((item) => isRecord(item));
  if (firstRecord) {
    const keys = Object.keys(firstRecord).filter((key) => key !== REVIEW_ID_KEY && key !== REVIEW_DELETED_KEY);
    const template: Record<string, any> = {};
    for (const key of keys.slice(0, 4)) {
      const sample = firstRecord[key];
      template[key] = typeof sample === "number" ? 0 : typeof sample === "boolean" ? false : Array.isArray(sample) ? [] : isRecord(sample) ? {} : "";
    }
    return makeReviewObject(template, nextPath);
  }

  return "";
}

export function displayTitle(value: any, fallback: string) {
  if (!isRecord(value)) return fallback;
  const candidate =
    value.name ??
    value.macro_action ??
    value.micro_action ??
    value.dimension_name ??
    value.negative_action ??
    value.source ??
    value.target ??
    value.id;
  return candidate ? String(candidate) : fallback;
}

export function describePath(path: JsonPath) {
  return path
    .map((part) => (typeof part === "number" || /^\d+$/.test(String(part)) ? `#${Number(part) + 1}` : prettify(String(part))))
    .join(" / ");
}

export function summarizeValue(value: any, max = 120) {
  if (value == null) return "empty";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max - 3)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (isRecord(value)) return displayTitle(value, "Object");
  return String(value);
}

export function loadJsonArray<T>(raw: string | null, fallback: T[] = []) {
  try {
    const parsed = raw ? JSON.parse(raw) : fallback;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function loadJsonObject<T extends Record<string, any>>(raw: string | null, fallback: T): T {
  try {
    const parsed = raw ? JSON.parse(raw) : fallback;
    return isRecord(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}
