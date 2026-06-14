import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { MethodSpec } from "./viewer-utils";
import { bestMatchingKey, getDescription, isRecord, normKey, prettify, renderMiniMarkdown } from "./viewer-utils";
import { ApiError, postJSON, postJSONWithRetry } from "./review-api";
import { API_BASE, BASE_URL, BASELINE_VERSION, STORAGE_KEYS } from "./review-config";
import {
  REVIEW_DELETED_KEY,
  annotateReviewIds,
  describePath,
  findPathByReviewId,
  getAtPath,
  getReviewId,
  insertArrayItem,
  insertArrayItemAtIndex,
  isReviewDeleted,
  loadJsonArray,
  loadJsonObject,
  makeArrayItemTemplate,
  makeId,
  nowUtc,
  parentPath,
  pathKey,
  removeAtPath,
  setAtPath,
  stripReviewMetadata,
  summarizeValue,
  type JsonPath,
  type ReviewChange,
  type ReviewFeedback,
} from "./review-utils";

type Manifest = {
  components: string[];
  methods: MethodSpec[];
};

type Descriptions = Record<string, string>;
type FeedbackMap = Record<string, ReviewFeedback>;

type EditorActions = {
  editValue: (path: JsonPath, value: any) => void;
  addArrayItem: (path: JsonPath) => void;
  removeValue: (path: JsonPath) => void;
  restoreValue: (path: JsonPath) => void;
};

type EditorStatus = {
  changedPathKeys: Set<string>;
  addedIds: Set<string>;
  removedIds: Set<string>;
  removedChanges: ReviewChange[];
  revokedIds: Set<string>;
  hasDescendantChange: (path: JsonPath) => boolean;
};

function friendlyError(error: any) {
  const message = String(error?.message || "").trim();
  if (!message || message.toLowerCase() === "failed to fetch" || message === "The operation was aborted.") {
    return "Could not reach the review server. Your work remains saved in this browser and will retry.";
  }
  return message;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEYS.token) || "");
  const [participantId, setParticipantId] = useState(() => localStorage.getItem(STORAGE_KEYS.participantId) || "");
  const [gateNotice, setGateNotice] = useState("");

  useEffect(() => {
    document.title = "TOPA Expert Refinement";
  }, []);

  const clearSession = useCallback((notice = "") => {
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.participantId);
    setToken("");
    setParticipantId("");
    setGateNotice(notice);
  }, []);

  if (!token || !participantId) {
    return (
      <GatePage
        notice={gateNotice}
        onReady={(nextToken, nextParticipantId) => {
          localStorage.setItem(STORAGE_KEYS.token, nextToken);
          localStorage.setItem(STORAGE_KEYS.participantId, nextParticipantId);
          setToken(nextToken);
          setParticipantId(nextParticipantId);
          setGateNotice("");
        }}
      />
    );
  }

  return (
    <ReviewPage
      token={token}
      participantId={participantId}
      onTokenRefresh={(nextToken) => {
        localStorage.setItem(STORAGE_KEYS.token, nextToken);
        setToken(nextToken);
      }}
      onLogout={clearSession}
    />
  );
}

function GatePage({ notice = "", onReady }: { notice?: string; onReady: (token: string, participantId: string) => void }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(notice);
  const [submitting, setSubmitting] = useState(false);

  async function startReview() {
    try {
      setSubmitting(true);
      setStatus("Checking access...");
      const result = await postJSONWithRetry<{ token: string; participant_id: string }>(
        `${API_BASE}/start`,
        { code, baseline_version: BASELINE_VERSION },
        { maxAttempts: 5, timeoutMs: 5000 }
      );

      onReady(String(result.token), String(result.participant_id));
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app">
      <main className="gateShell">
        <section className="gatePanel">
          <div className="eyebrow">Expert Access</div>
          <h1 className="heroTitle">TOPA Expert Refinement</h1>
          <p className="heroText">Review, refine, and annotate the TOPA Late Fusion CBT ontology.</p>

          <form
            className="formStack"
            onSubmit={(event) => {
              event.preventDefault();
              void startReview();
            }}
          >
            <label className="fieldLabel" htmlFor="access-code">Access code</label>
            <input id="access-code" className="input" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" />

            <button className="btn btnPrimary" type="submit" disabled={!code.trim() || submitting}>
              {submitting ? "Opening..." : "Enter review"}
            </button>
          </form>

          {status && <div className="statusBanner statusBanner--warn">{status}</div>}
        </section>
      </main>
    </div>
  );
}

function ReviewPage({
  token,
  participantId,
  onTokenRefresh,
  onLogout,
}: {
  token: string;
  participantId: string;
  onTokenRefresh: (token: string) => void;
  onLogout: (notice?: string) => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [descriptions, setDescriptions] = useState<Descriptions>({});
  const [reviewData, setReviewData] = useState<any>(() => loadJsonObject(localStorage.getItem(STORAGE_KEYS.reviewData), null as any));
  const [activeComponent, setActiveComponent] = useState("");
  const [changes, setChanges] = useState<ReviewChange[]>(() => loadJsonArray<ReviewChange>(localStorage.getItem(STORAGE_KEYS.changes)));
  const [feedbackMap, setFeedbackMap] = useState<FeedbackMap>(() => loadJsonObject<FeedbackMap>(localStorage.getItem(STORAGE_KEYS.feedback), {}));
  const [snapshotDirty, setSnapshotDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("Loading review data...");
  const [syncing, setSyncing] = useState(false);
  const tokenRef = useRef(token);
  const reviewDataRef = useRef(reviewData);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    reviewDataRef.current = reviewData;
  }, [reviewData]);

  useEffect(() => {
    if (reviewData) localStorage.setItem(STORAGE_KEYS.reviewData, JSON.stringify(reviewData));
  }, [reviewData]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.changes, JSON.stringify(changes));
  }, [changes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.feedback, JSON.stringify(feedbackMap));
  }, [feedbackMap]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const manifestResponse = await fetch(`${BASE_URL}data/manifest.json`);
        if (!manifestResponse.ok) throw new Error("Could not load manifest.json");
        const manifestData: Manifest = await manifestResponse.json();

        const descriptionsResponse = await fetch(`${BASE_URL}data/component_descriptions.json`);
        const descriptionData: Descriptions = descriptionsResponse.ok ? await descriptionsResponse.json() : {};
        const method = manifestData.methods[0];
        if (!method) throw new Error("No TOPA Late Fusion method found in the manifest.");

        const methodResponse = await fetch(`${BASE_URL}data/${method.file}`);
        if (!methodResponse.ok) throw new Error(`Could not load ${method.file}`);
        const sourceData = annotateReviewIds(await methodResponse.json());

        let remoteSnapshot: any = null;
        let remoteChanges: ReviewChange[] = [];
        let remoteFeedback: FeedbackMap = {};

        try {
          const remote = await postJSON<any>(`${API_BASE}/review/state`, { token: tokenRef.current, baseline_version: BASELINE_VERSION }, { timeoutMs: 8000 });
          remoteSnapshot = remote?.snapshot ? annotateReviewIds(remote.snapshot) : null;
          remoteChanges = Array.isArray(remote?.changes)
            ? remote.changes.map((row: any) => ({
                ...row,
                path: Array.isArray(row.path) ? row.path : [],
                path_key: pathKey(Array.isArray(row.path) ? row.path : []),
                revoked_change_id: row.revoked_change_id || null,
                revoked_by_change_id: row.revoked_by_change_id || null,
                synced: true,
              }))
            : [];
          remoteFeedback = Array.isArray(remote?.feedback)
            ? Object.fromEntries(
                remote.feedback.map((row: any) => [
                  String(row.component || "global"),
                  {
                    id: String(row.id || makeId("feedback")),
                    component: String(row.component || "global"),
                    path: Array.isArray(row.path) ? row.path : [String(row.component || "global")],
                    feedback: String(row.feedback || ""),
                    timestamp_utc: String(row.timestamp_utc || nowUtc()),
                    synced: true,
                  } satisfies ReviewFeedback,
                ])
              )
            : {};
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error;
          setStatus(friendlyError(error));
        }

        if (cancelled) return;
        const localSnapshot = loadJsonObject(localStorage.getItem(STORAGE_KEYS.reviewData), null as any);
        const localChanges = loadJsonArray<ReviewChange>(localStorage.getItem(STORAGE_KEYS.changes));
        const hasUnsyncedLocalWork = localChanges.some((change) => change.synced !== true);
        const startingData = hasUnsyncedLocalWork && localSnapshot ? localSnapshot : remoteSnapshot || localSnapshot || sourceData;

        setManifest(manifestData);
        setDescriptions(descriptionData || {});
        setReviewData(annotateReviewIds(startingData));
        setChanges((current) => mergeChanges(remoteChanges, current));
        setFeedbackMap((current) => ({ ...remoteFeedback, ...current }));
        setActiveComponent(manifestData.components[0] ?? "");
        setLoaded(true);
        setStatus(hasUnsyncedLocalWork ? "Local unsaved edits restored. They will autosave." : remoteSnapshot ? "" : "Review data loaded. New edits will be autosaved.");
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) {
            onLogout("Session expired. Enter the access code again.");
            return;
          }
          setStatus(friendlyError(error));
        }
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [onLogout]);

  const refreshToken = useCallback(async () => {
    const result = await postJSON<{ token: string }>(`${API_BASE}/refresh`, { token: tokenRef.current });
    tokenRef.current = String(result.token);
    onTokenRefresh(String(result.token));
    return String(result.token);
  }, [onTokenRefresh]);

  const syncNow = useCallback(async () => {
    if (!reviewData || syncing) return;

    const pendingChanges = changes.filter((change) => change.synced !== true);
    const pendingFeedback = Object.values(feedbackMap).filter((feedback) => feedback.synced !== true);
    if (pendingChanges.length === 0 && pendingFeedback.length === 0 && !snapshotDirty) return;

    setSyncing(true);
    try {
      let result: any;
      try {
        result = await postJSON(`${API_BASE}/review/sync`, {
          token: tokenRef.current,
          baseline_version: BASELINE_VERSION,
          changes: pendingChanges,
          feedback: Object.values(feedbackMap),
          snapshot: reviewData,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await refreshToken();
          result = await postJSON(`${API_BASE}/review/sync`, {
            token: tokenRef.current,
            baseline_version: BASELINE_VERSION,
            changes: pendingChanges,
            feedback: Object.values(feedbackMap),
            snapshot: reviewData,
          });
        } else {
          throw error;
        }
      }

      const savedChangeIds = new Set<string>((Array.isArray(result?.saved_change_ids) ? result.saved_change_ids : []).map(String));
      const savedFeedbackIds = new Set<string>((Array.isArray(result?.saved_feedback_ids) ? result.saved_feedback_ids : []).map(String));

      setChanges((current) =>
        current.map((change) => (savedChangeIds.has(change.id) ? { ...change, synced: true, sync_error: null } : change))
      );
      setFeedbackMap((current) =>
        Object.fromEntries(
          Object.entries(current).map(([key, feedback]) => [key, savedFeedbackIds.has(feedback.id) ? { ...feedback, synced: true } : feedback])
        )
      );
      setSnapshotDirty(false);
      setStatus("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onLogout("Session expired. Enter the access code again.");
        return;
      }
      setStatus(friendlyError(error));
    } finally {
      setSyncing(false);
    }
  }, [changes, feedbackMap, onLogout, refreshToken, reviewData, snapshotDirty, syncing]);

  useEffect(() => {
    if (!loaded) return;
    const timeoutId = window.setTimeout(() => {
      void syncNow();
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [changes, feedbackMap, loaded, snapshotDirty, syncNow]);

  const activeComponentKey = useMemo(() => {
    if (!reviewData || !activeComponent) return activeComponent;
    return bestMatchingKey(reviewData, activeComponent) || activeComponent;
  }, [activeComponent, reviewData]);

  const activeValue = reviewData && activeComponentKey ? reviewData[activeComponentKey] : null;
  const activeDescription = getDescription(descriptions, activeComponent);

  const statusModel = useMemo<EditorStatus>(() => {
    const revokedIds = new Set(
      changes
        .filter((change) => change.operation === "revoke" && change.revoked_change_id)
        .map((change) => String(change.revoked_change_id))
    );
    const activeChanges = changes.filter((change) => change.operation !== "revoke" && !revokedIds.has(change.id));
    const changedPathKeys = new Set(activeChanges.filter((change) => change.operation === "replace").map((change) => change.path_key || pathKey(change.path)));
    const addedIds = new Set(activeChanges.filter((change) => change.operation === "add" && change.target_id).map((change) => String(change.target_id)));
    const removedIds = new Set(activeChanges.filter((change) => change.operation === "remove" && change.target_id).map((change) => String(change.target_id)));
    const removedChanges = activeChanges.filter((change) => change.operation === "remove");

    return {
      changedPathKeys,
      addedIds,
      removedIds,
      removedChanges,
      revokedIds,
      hasDescendantChange: (path: JsonPath) =>
        activeChanges.some((change) => change.path.length > path.length && path.every((part, index) => change.path[index] === part)),
    };
  }, [changes]);

  const componentFeedback = feedbackMap[activeComponent]?.feedback || "";
  const pendingCount = changes.filter((change) => change.synced !== true).length + Object.values(feedbackMap).filter((feedback) => feedback.synced !== true).length;
  const cleanExport = useMemo(() => (reviewData ? stripReviewMetadata(reviewData) : null), [reviewData]);

  const recordChange = useCallback((
    operation: ReviewChange["operation"],
    path: JsonPath,
    oldValue: any,
    newValue: any,
    targetId?: string | null,
    options?: { comment?: string | null; revokedChangeId?: string | null }
  ) => {
    const component = String(path[0] || activeComponent);
    const key = pathKey(path);
    const newChangeId = makeId("change");
    setChanges((current) => {
      if (operation === "replace") {
        const existingIndex = current.findIndex((change) => change.synced !== true && change.operation === "replace" && change.path_key === key);
        if (existingIndex >= 0) {
          const copy = [...current];
          copy[existingIndex] = { ...copy[existingIndex], new_value: newValue, timestamp_utc: nowUtc() };
          return copy;
        }
      }

      return [
        ...current,
        {
          id: newChangeId,
          component,
          path,
          path_key: key,
          target_id: targetId || null,
          operation,
          old_value: oldValue,
          new_value: newValue,
          comment: options?.comment || null,
          revoked_change_id: options?.revokedChangeId || null,
          timestamp_utc: nowUtc(),
          synced: false,
        },
      ];
    });
    setSnapshotDirty(true);
  }, [activeComponent]);

  function revokeChange(change: ReviewChange) {
    if (change.operation === "revoke" || statusModel.revokedIds.has(change.id)) return;

    const current = reviewDataRef.current;
    let next = current;
    let undoPath = change.path;
    let oldValueForRevoke = getAtPath(current, undoPath);
    let newValueForRevoke: any = null;

    if (change.operation === "replace") {
      newValueForRevoke = change.old_value;
      next = setAtPath(current, undoPath, newValueForRevoke);
    } else if (change.operation === "add") {
      undoPath = change.target_id ? findPathByReviewId(current, change.target_id) || change.path : change.path;
      oldValueForRevoke = getAtPath(current, undoPath);
      next = removeAtPath(current, undoPath);
      newValueForRevoke = null;
    } else if (change.operation === "remove") {
      const resolvedPath = change.target_id ? findPathByReviewId(current, change.target_id) || change.path : change.path;
      const ownerPath = parentPath(resolvedPath);
      const owner = getAtPath(current, ownerPath);
      oldValueForRevoke = getAtPath(current, resolvedPath);
      newValueForRevoke = isRecord(change.old_value) ? { ...change.old_value, [REVIEW_DELETED_KEY]: false } : change.old_value;

      if (isRecord(oldValueForRevoke) && getReviewId(oldValueForRevoke)) {
        next = setAtPath(current, resolvedPath, newValueForRevoke);
        undoPath = resolvedPath;
      } else if (Array.isArray(owner)) {
        next = insertArrayItemAtIndex(current, ownerPath, Number(resolvedPath[resolvedPath.length - 1] || 0), newValueForRevoke);
        undoPath = resolvedPath;
      } else {
        next = setAtPath(current, resolvedPath, newValueForRevoke);
        undoPath = resolvedPath;
      }
    } else if (change.operation === "restore") {
      newValueForRevoke = change.old_value;
      next = setAtPath(current, undoPath, newValueForRevoke);
    }

    reviewDataRef.current = next;
    setReviewData(next);
    recordChange("revoke", undoPath, oldValueForRevoke, newValueForRevoke, change.target_id || getReviewId(newValueForRevoke) || getReviewId(oldValueForRevoke), {
      comment: `Revoked change ${change.id}`,
      revokedChangeId: change.id,
    });
  }

  async function removeRevokedHistory(change: ReviewChange) {
    const originalChangeId = change.operation === "revoke" ? change.revoked_change_id : change.id;
    if (!originalChangeId || (change.operation !== "revoke" && !statusModel.revokedIds.has(change.id))) return;
    if (!window.confirm("Permanently remove this revoked change and its revoke record from the history?")) return;

    setStatus("Removing revoked history...");
    try {
      await syncNow();
      let result: any;
      try {
        result = await postJSON(`${API_BASE}/review/change/delete`, {
          token: tokenRef.current,
          baseline_version: BASELINE_VERSION,
          change_id: originalChangeId,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await refreshToken();
          result = await postJSON(`${API_BASE}/review/change/delete`, {
            token: tokenRef.current,
            baseline_version: BASELINE_VERSION,
            change_id: originalChangeId,
          });
        } else {
          throw error;
        }
      }

      const deletedIds = new Set<string>((Array.isArray(result?.deleted_change_ids) ? result.deleted_change_ids : []).map(String));
      setChanges((current) => current.filter((entry) => !deletedIds.has(entry.id)));
      setStatus("");
    } catch (error) {
      setStatus(friendlyError(error));
    }
  }

  const actions = useMemo<EditorActions>(
    () => ({
      editValue: (path, value) => {
        const current = reviewDataRef.current;
        const oldValue = getAtPath(current, path);
        const next = setAtPath(current, path, value);
        reviewDataRef.current = next;
        recordChange("replace", path, oldValue, value, getReviewId(oldValue));
        setReviewData(next);
      },
      addArrayItem: (path) => {
        const current = reviewDataRef.current;
        const currentArray = getAtPath(current, path);
        if (!Array.isArray(currentArray)) return;
        const item = makeArrayItemTemplate(path, currentArray);
        const targetId = getReviewId(item);
        const next = insertArrayItem(current, path, item);
        reviewDataRef.current = next;
        recordChange("add", [...path, currentArray.length], null, item, targetId);
        setReviewData(next);
      },
      removeValue: (path) => {
        const current = reviewDataRef.current;
        const oldValue = getAtPath(current, path);
        const targetId = getReviewId(oldValue);
        const next = isRecord(oldValue) && targetId ? setAtPath(current, path, { ...oldValue, [REVIEW_DELETED_KEY]: true }) : removeAtPath(current, path);
        reviewDataRef.current = next;
        recordChange("remove", path, oldValue, null, targetId);
        setReviewData(next);
      },
      restoreValue: (path) => {
        const current = reviewDataRef.current;
        const oldValue = getAtPath(current, path);
        if (!isRecord(oldValue)) return;
        const restored = { ...oldValue, [REVIEW_DELETED_KEY]: false };
        const next = setAtPath(current, path, restored);
        reviewDataRef.current = next;
        recordChange("restore", path, oldValue, restored, getReviewId(oldValue));
        setReviewData(next);
      },
    }),
    [recordChange]
  );

  function updateFeedback(value: string) {
    setFeedbackMap((current) => ({
      ...current,
      [activeComponent]: {
        id: current[activeComponent]?.id || `feedback_${participantId}_${activeComponent}`,
        component: activeComponent,
        path: [activeComponent],
        feedback: value,
        timestamp_utc: nowUtc(),
        synced: false,
      },
    }));
    setSnapshotDirty(true);
  }

  function downloadFile(filename: string, payload: unknown) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!loaded || !manifest || !reviewData) {
    return (
      <div className="app">
        <main className="appShell">
          <section className="card loadingCard">
            <div className="eyebrow">Loading</div>
            <h1 className="heroTitle">TOPA Expert Refinement</h1>
            {status && <div className="statusBanner">{status}</div>}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <main className="reviewShell">
        <header className="topbar">
          <div>
            <div className="eyebrow">Ontology Review</div>
            <h1 className="appTitle">TOPA Late Fusion Refinement</h1>
          </div>
          <div className="topbarActions">
            <span className={`syncBadge ${pendingCount === 0 ? "syncBadge--ok" : "syncBadge--warn"}`}>
              {syncing ? "Syncing..." : pendingCount === 0 ? "Synced" : `${pendingCount} pending`}
            </span>
            <button className="btn" type="button" onClick={() => void syncNow()} disabled={syncing}>
              Save now
            </button>
            <button
              className="btn"
              type="button"
              onClick={() =>
                downloadFile("topa_late_fusion_review_package.json", {
                  baseline_version: BASELINE_VERSION,
                  participant_id: participantId,
                  exported_at: nowUtc(),
                  final_data: cleanExport,
                  changes,
                  feedback: Object.values(feedbackMap),
                })
              }
            >
              Export review
            </button>
            <button className="btn btnGhost" type="button" onClick={() => onLogout()}>
              Logout
            </button>
          </div>
        </header>

        {status && <div className="statusBanner statusBanner--warn">{status}</div>}

        <section className="reviewLayout">
          <aside className="sidebar">
            <div className="sideSection">
              <div className="sectionLabel">Components</div>
              <div className="componentList">
                {manifest.components.map((component) => {
                  const componentChanges = changes.filter((change) => change.component === component);
                  const hasFeedback = Boolean(feedbackMap[component]?.feedback.trim());
                  return (
                    <button
                      key={component}
                      className={`componentButton${activeComponent === component ? " componentButton--active" : ""}`}
                      type="button"
                      onClick={() => setActiveComponent(component)}
                    >
                      <span>{prettify(component)}</span>
                      {(componentChanges.length > 0 || hasFeedback) && <span className="changeDot">{componentChanges.length + (hasFeedback ? 1 : 0)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <ChangeLog
              changes={changes}
              onRevoke={revokeChange}
              onRemoveRevoked={removeRevokedHistory}
              revokedIds={statusModel.revokedIds}
            />
          </aside>

          <section className="workspace">
            <div className="workspaceHeader">
              <div>
                <div className="sectionLabel">Editing</div>
                <h2 className="componentTitle">{prettify(activeComponent)}</h2>
              </div>
              <div className="metricRow">
                <div className="metric">
                  <span>{changes.filter((change) => change.component === activeComponent).length}</span>
                  <small>changes</small>
                </div>
                <div className="metric">
                  <span>{Object.values(feedbackMap).filter((feedback) => feedback.feedback.trim()).length}</span>
                  <small>notes</small>
                </div>
              </div>
            </div>

            <div
              className="descriptionCard"
              dangerouslySetInnerHTML={{
                __html: activeDescription
                  ? renderMiniMarkdown(activeDescription)
                  : "<span class='muted'>No description found for this component.</span>",
              }}
            />

            <div className={`feedbackBox${componentFeedback.trim() ? " feedbackBox--changed" : ""}`}>
              <label className="fieldLabel" htmlFor="component-feedback">Component feedback</label>
              <textarea
                id="component-feedback"
                className="textarea"
                rows={3}
                value={componentFeedback}
                onChange={(event) => updateFeedback(event.target.value)}
              />
            </div>

            <EditableValue
              value={activeValue}
              path={[activeComponentKey]}
              label={prettify(activeComponent)}
              depth={0}
              actions={actions}
              status={statusModel}
              removable={false}
            />
          </section>
        </section>
      </main>
    </div>
  );
}

function mergeChanges(remote: ReviewChange[], local: ReviewChange[]) {
  const byId = new Map<string, ReviewChange>();
  for (const change of remote) byId.set(change.id, { ...change, synced: true });
  for (const change of local.filter((entry) => entry.synced !== true)) byId.set(change.id, change);
  return [...byId.values()].sort((left, right) => left.timestamp_utc.localeCompare(right.timestamp_utc));
}

function recordName(item: Record<string, any>) {
  const source = item.source ? String(item.source) : "";
  const target = item.target ? String(item.target) : "";
  const relation = item.relation ? String(item.relation) : "";
  const candidate =
    item.name ??
    item.macro_action_name ??
    item.macro_action ??
    item.micro_action_name ??
    item.micro_action ??
    item["Variable Name"] ??
    item.variable_name ??
    item.dimension_name ??
    item.type;

  if (candidate) return String(candidate);
  if (source && target) return relation ? `${source} -${relation}-> ${target}` : `${source} -> ${target}`;
  return "";
}

function arrayItemLabel(path: JsonPath, item: Record<string, any>, index: number, fallbackLabel: string) {
  const collection = normKey(String(path[path.length - 1] || fallbackLabel));
  const title = recordName(item);

  if (collection === "actionspace" || collection === "macroactions") return `Macro action ${index + 1}: ${title || "Unnamed macro action"}`;
  if (collection === "microactions") return `Micro action ${index + 1}: ${title || "Unnamed micro action"}`;
  if (collection === "conversationstates") return `Dimension ${index + 1}${title ? `: ${title}` : ""}`;
  if (collection === "categoricaldimensions" || collection === "freeformdimensions") return `Dimension ${index + 1}${title ? `: ${title}` : ""}`;
  if (collection === "nodes") return `Node ${index + 1}${title ? `: ${title}` : ""}`;
  if (collection === "edges") return `Edge ${index + 1}${title ? `: ${title}` : ""}`;
  return title || `${prettify(fallbackLabel)} ${index + 1}`;
}

function isPrimitiveList(value: any[]) {
  return value.every((item) => !Array.isArray(item) && !isRecord(item));
}

function isInlinePrimitiveList(path: JsonPath) {
  const root = normKey(String(path[0] || ""));
  const collection = normKey(String(path[path.length - 1] || ""));
  return (root === "conversationstates" && collection === "categoricalvalues") || (root === "userprofile" && collection === "options");
}

function hideObjectField(path: JsonPath, key: string) {
  return normKey(String(path[0] || "")) === "conversationstates" && normKey(key) === "numericalvalues";
}

function EditableValue({
  value,
  path,
  label,
  depth,
  actions,
  status,
  removable,
}: {
  value: any;
  path: JsonPath;
  label: string;
  depth: number;
  actions: EditorActions;
  status: EditorStatus;
  removable: boolean;
}) {
  if (Array.isArray(value)) {
    return <EditableArray value={value} path={path} label={label} depth={depth} actions={actions} status={status} removable={removable} />;
  }

  if (isRecord(value)) {
    return <EditableObject value={value} path={path} label={label} depth={depth} actions={actions} status={status} removable={removable} />;
  }

  return <PrimitiveEditor value={value} path={path} label={label} actions={actions} status={status} removable={removable} />;
}

function EditableArray({
  value,
  path,
  label,
  depth,
  actions,
  status,
  removable,
}: {
  value: any[];
  path: JsonPath;
  label: string;
  depth: number;
  actions: EditorActions;
  status: EditorStatus;
  removable: boolean;
}) {
  const removedPrimitiveChanges = status.removedChanges.filter(
    (change) => !change.target_id && pathKey(parentPath(change.path)) === pathKey(path)
  );
  const primitiveList = isPrimitiveList(value);
  const inlinePrimitiveList = primitiveList && isInlinePrimitiveList(path);

  return (
    <section className={`editorBlock editorBlock--array${depth > 0 ? " editorBlock--nested" : ""} depth-${Math.min(depth, 4)}`}>
      <div className="editorBlockHeader">
        <div>
          <div className="fieldLabel">{label}</div>
          <div className="arrayMeta">{value.filter((item) => !isReviewDeleted(item)).length} active items</div>
        </div>
        <div className="inlineActions">
          {removable && (
            <button className="iconBtn iconBtn--danger" type="button" onClick={() => actions.removeValue(path)} title="Remove this list">
              Remove
            </button>
          )}
          <button className="iconBtn iconBtn--add" type="button" onClick={() => actions.addArrayItem(path)} title="Add item">
            Add item
          </button>
        </div>
      </div>

      <div className="arrayStack">
        {primitiveList && (
          <div className={`compactPrimitiveList${inlinePrimitiveList ? " compactPrimitiveList--inline" : ""}`}>
            {value.map((item, index) => {
              const itemPath = [...path, index];
              const changed = status.changedPathKeys.has(pathKey(itemPath));
              const stringValue = item == null ? "" : String(item);
              return (
                <div key={index} className={`compactPrimitiveItem${changed ? " compactPrimitiveItem--changed" : ""}`}>
                  <span className="itemNumber">{index + 1}.</span>
                  <input
                    className="compactPrimitiveInput"
                    style={inlinePrimitiveList ? { width: `${Math.min(Math.max(stringValue.length + 2, 8), 34)}ch` } : undefined}
                    type={typeof item === "number" ? "number" : "text"}
                    value={stringValue}
                    onChange={(event) =>
                      actions.editValue(itemPath, typeof item === "number" ? Number(event.target.value) || 0 : event.target.value)
                    }
                  />
                  <button
                    className="compactRemoveBtn"
                    type="button"
                    onClick={() => actions.removeValue(itemPath)}
                    aria-label={`Remove item ${index + 1}`}
                    title={`Remove item ${index + 1}`}
                  >
                    X
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {!primitiveList &&
          value.map((item, index) => {
            const itemPath = [...path, index];
            const itemId = getReviewId(item);
            const deleted = isReviewDeleted(item);
            const itemChanged = status.hasDescendantChange(itemPath);
            const added = itemId ? status.addedIds.has(itemId) : false;
            const classes = [
              "arrayItem",
              deleted ? "arrayItem--deleted" : "",
              added ? "arrayItem--added" : "",
              itemChanged ? "arrayItem--edited" : "",
            ]
              .filter(Boolean)
              .join(" ");

            if (isRecord(item)) {
              return (
                <div key={itemId || index} className={classes}>
                  <EditableValue
                    value={item}
                    path={itemPath}
                    label={arrayItemLabel(path, item, index, label)}
                    depth={depth + 1}
                    actions={actions}
                    status={status}
                    removable
                  />
                </div>
              );
            }

            return (
              <div key={index} className={classes}>
                <PrimitiveEditor value={item} path={itemPath} label={`Item ${index + 1}`} actions={actions} status={status} removable />
              </div>
            );
          })}

        {removedPrimitiveChanges.map((change) => (
          <div key={change.id} className="removedTombstone">
            <span>Removed</span>
            <strong>{summarizeValue(change.old_value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function EditableObject({
  value,
  path,
  label,
  depth,
  actions,
  status,
  removable,
}: {
  value: Record<string, any>;
  path: JsonPath;
  label: string;
  depth: number;
  actions: EditorActions;
  status: EditorStatus;
  removable: boolean;
}) {
  const deleted = isReviewDeleted(value);
  const objectId = getReviewId(value);
  const added = objectId ? status.addedIds.has(objectId) : false;
  const edited = status.hasDescendantChange(path);
  const fieldEntries = Object.entries(value).filter(
    ([key]) => key !== "_reviewId" && key !== REVIEW_DELETED_KEY && !hideObjectField(path, key)
  );
  const removedFieldChanges = status.removedChanges.filter(
    (change) => !change.target_id && pathKey(parentPath(change.path)) === pathKey(path)
  );

  if (deleted) {
    return (
      <section className="objectCard objectCard--deleted">
        <div className="objectHeader">
          <div className="objectHeading">
            <span className="statusPill statusPill--deleted">Deleted</span>
            <h3 className="objectTitle">{label}</h3>
          </div>
          <button className="btn btnSmall" type="button" onClick={() => actions.restoreValue(path)}>
            Restore
          </button>
        </div>
        <div className="deletedPreview">{summarizeValue(value, 220)}</div>
      </section>
    );
  }

  return (
    <section className={`objectCard${depth > 1 ? " objectCard--nested" : ""}${added ? " objectCard--added" : ""}${edited ? " objectCard--edited" : ""}`}>
      <div className="objectHeader">
        <div className="objectHeading">
          {added && <span className="statusPill statusPill--added">Added</span>}
          {!added && edited && <span className="statusPill statusPill--edited">Edited</span>}
          <h3 className="objectTitle">{label}</h3>
        </div>
        {removable && (
          <button className="iconBtn iconBtn--danger" type="button" onClick={() => actions.removeValue(path)}>
            Remove
          </button>
        )}
      </div>

      <div className="fieldStack">
        {fieldEntries.map(([key, nested]) => {
          const fieldPath = [...path, key];
          const fieldChanged = status.changedPathKeys.has(pathKey(fieldPath)) || status.hasDescendantChange(fieldPath);
          return (
            <div key={key} className={`fieldCard${fieldChanged ? " fieldCard--changed" : ""}`}>
              <EditableValue value={nested} path={fieldPath} label={prettify(key)} depth={depth + 1} actions={actions} status={status} removable={false} />
            </div>
          );
        })}

        {removedFieldChanges.map((change) => (
          <div key={change.id} className="removedTombstone">
            <span>Removed field</span>
            <strong>{String(change.path[change.path.length - 1] || "field")}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function PrimitiveEditor({
  value,
  path,
  label,
  actions,
  status,
  removable,
}: {
  value: any;
  path: JsonPath;
  label: string;
  actions: EditorActions;
  status: EditorStatus;
  removable: boolean;
}) {
  const changed = status.changedPathKeys.has(pathKey(path));
  const stringValue = value == null ? "" : String(value);
  const rows = Math.min(7, Math.max(1, stringValue.split(/\r?\n/).length, Math.ceil(stringValue.length / 120)));

  function update(raw: string) {
    if (typeof value === "number") {
      const numeric = Number(raw);
      actions.editValue(path, Number.isFinite(numeric) ? numeric : 0);
      return;
    }
    if (typeof value === "boolean") {
      actions.editValue(path, raw === "true");
      return;
    }
    actions.editValue(path, raw);
  }

  return (
    <div className={`primitiveEditor${changed ? " primitiveEditor--changed" : ""}`}>
      <div className="primitiveHeader">
        <label className="fieldLabel">{label}</label>
        {removable && (
          <button className="subtleBtn subtleBtn--danger" type="button" onClick={() => actions.removeValue(path)}>
            Remove
          </button>
        )}
      </div>
      {typeof value === "boolean" ? (
        <select className="input" value={String(Boolean(value))} onChange={(event) => update(event.target.value)}>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      ) : typeof value === "number" ? (
        <input className="input" type="number" value={String(value)} onChange={(event) => update(event.target.value)} />
      ) : (
        <textarea className="textarea" rows={rows} value={stringValue} onChange={(event) => update(event.target.value)} />
      )}
      {changed && <span className="changeGlow">Edited</span>}
    </div>
  );
}

function ChangeLog({
  changes,
  onRevoke,
  onRemoveRevoked,
  revokedIds,
}: {
  changes: ReviewChange[];
  onRevoke: (change: ReviewChange) => void;
  onRemoveRevoked: (change: ReviewChange) => void;
  revokedIds: Set<string>;
}) {
  const newest = changes
    .filter((change) => change.operation !== "revoke")
    .sort((left, right) => right.timestamp_utc.localeCompare(left.timestamp_utc));
  return (
    <div className="sideSection changeLog">
      <div className="sectionLabel">Change log</div>
      {newest.length === 0 ? (
        <div className="mutedText">No edits yet.</div>
      ) : (
        <div className="changeList">
          {newest.map((change) => (
            <div key={change.id} className={`changeItem changeItem--${change.operation}${revokedIds.has(change.id) ? " changeItem--revoked" : ""}`}>
              <div className="changeItemTop">
                <span className="changeType">{change.operation}</span>
                <span className={change.synced ? "changeSync changeSync--ok" : "changeSync"}>{change.synced ? "saved" : "pending"}</span>
              </div>
              <div className="changePath">{describePath(change.path)}</div>
              <div className="changeSummary">
                {change.operation === "replace" ? summarizeValue(change.new_value) : summarizeValue(change.old_value ?? change.new_value)}
              </div>
              {revokedIds.has(change.id) && <div className="revokedNote">Revoked</div>}
              {!revokedIds.has(change.id) && (
                <button className="revokeBtn" type="button" onClick={() => onRevoke(change)}>
                  Revoke
                </button>
              )}
              {revokedIds.has(change.id) && (
                <button className="removeHistoryBtn" type="button" onClick={() => void onRemoveRevoked(change)}>
                  Remove history
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
