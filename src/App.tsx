import { startTransition, useEffect, useMemo, useState } from "react";
import "./App.css";
import type { MethodSpec } from "./viewer-utils";
import { getComponentValue, getDescription, isEmptyValue, prettify, renderMiniMarkdown } from "./viewer-utils";
import { decorateMethod, MethodIdentity, type ViewerMethod } from "./method-display";
import { findLLMFeedbackForPair, findViewerMethodByFeedbackLabel, parseLLMFeedbackRows, type LLMFeedbackRecord } from "./llm-feedback";
import { MethodPanel } from "./viewer-panels";

type Manifest = {
  components: string[];
  methods: MethodSpec[];
};

type Descriptions = Record<string, string>;

const BASE_URL = import.meta.env.BASE_URL;

function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [methods, setMethods] = useState<Record<string, any>>({});
  const [descriptions, setDescriptions] = useState<Descriptions>({});
  const [llmFeedbackRows, setLlmFeedbackRows] = useState<LLMFeedbackRecord[]>([]);
  const [activeComponent, setActiveComponent] = useState("");
  const [primaryMethodId, setPrimaryMethodId] = useState("");
  const [compareMethodId, setCompareMethodId] = useState("");
  const [pendingCompareMethodId, setPendingCompareMethodId] = useState("");
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [isComparePickerOpen, setIsComparePickerOpen] = useState(false);
  const [isLLMFeedbackOpen, setIsLLMFeedbackOpen] = useState(false);
  const [status, setStatus] = useState("Loading component data...");

  useEffect(() => {
    document.title = "TOPA Project";
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const manifestResponse = await fetch(`${BASE_URL}data/manifest.json`);
        if (!manifestResponse.ok) throw new Error("Could not load manifest.json");
        const manifestData: Manifest = await manifestResponse.json();

        const descriptionsResponse = await fetch(`${BASE_URL}data/component_descriptions.json`);
        const descriptionData: Descriptions = descriptionsResponse.ok ? await descriptionsResponse.json() : {};

        const llmFeedbackResponse = await fetch(`${BASE_URL}data/llm_feedback.json`).catch(() => null);
        const llmFeedbackData =
          llmFeedbackResponse && llmFeedbackResponse.ok ? parseLLMFeedbackRows(await llmFeedbackResponse.json()) : [];

        const methodEntries = await Promise.all(
          manifestData.methods.map(async (method) => {
            const response = await fetch(`${BASE_URL}data/${method.file}`);
            if (!response.ok) throw new Error(`Could not load ${method.file}`);
            return [method.id, await response.json()] as const;
          })
        );

        if (cancelled) return;

        setManifest(manifestData);
        setDescriptions(descriptionData);
        setLlmFeedbackRows(llmFeedbackData);
        setMethods(Object.fromEntries(methodEntries));
        setActiveComponent(manifestData.components[0] ?? "");
        setStatus("");
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unexpected loading error";
        setStatus(`Could not load viewer data: ${message}`);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleMethods = useMemo<ViewerMethod[]>(() => {
    if (!manifest) return [];
    return manifest.methods.map((method) => decorateMethod(method));
  }, [manifest]);

  const availableMethods = useMemo(() => {
    if (!manifest || !activeComponent) return [];
    return visibleMethods.filter((method) => !isEmptyValue(getComponentValue(methods[method.id], activeComponent)));
  }, [activeComponent, manifest, methods, visibleMethods]);

  const compareCandidates = useMemo(
    () => availableMethods.filter((method) => method.id !== primaryMethodId),
    [availableMethods, primaryMethodId]
  );

  useEffect(() => {
    if (!manifest?.components.length) return;
    if (!activeComponent || !manifest.components.includes(activeComponent)) {
      setActiveComponent(manifest.components[0]);
    }
  }, [activeComponent, manifest]);

  useEffect(() => {
    if (availableMethods.length === 0) {
      setPrimaryMethodId("");
      setCompareMethodId("");
      setPendingCompareMethodId("");
      setIsCompareMode(false);
      setIsComparePickerOpen(false);
      return;
    }

    if (!availableMethods.some((method) => method.id === primaryMethodId)) {
      setPrimaryMethodId(availableMethods[0].id);
    }
  }, [availableMethods, primaryMethodId]);

  useEffect(() => {
    if (compareCandidates.length === 0) {
      setCompareMethodId("");
      setPendingCompareMethodId("");
      setIsCompareMode(false);
      setIsComparePickerOpen(false);
      return;
    }

    if (isCompareMode && !compareCandidates.some((method) => method.id === compareMethodId)) {
      setCompareMethodId(compareCandidates[0].id);
    }

    if (!compareCandidates.some((method) => method.id === pendingCompareMethodId)) {
      setPendingCompareMethodId(compareCandidates[0].id);
    }
  }, [compareCandidates, compareMethodId, isCompareMode, pendingCompareMethodId]);

  useEffect(() => {
    if (!isComparePickerOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsComparePickerOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isComparePickerOpen]);

  useEffect(() => {
    setIsLLMFeedbackOpen(false);
  }, [activeComponent, compareMethodId, isCompareMode, primaryMethodId]);

  const primaryMethod = availableMethods.find((method) => method.id === primaryMethodId) ?? null;
  const compareMethod =
    isCompareMode && compareMethodId ? availableMethods.find((method) => method.id === compareMethodId) ?? null : null;

  const primaryValue = primaryMethod ? getComponentValue(methods[primaryMethod.id], activeComponent) : null;
  const compareValue = compareMethod ? getComponentValue(methods[compareMethod.id], activeComponent) : null;
  const activeDescription = getDescription(descriptions, activeComponent);
  const activeLLMFeedback = useMemo(() => {
    if (!isCompareMode || !primaryMethod || !compareMethod) return null;
    return findLLMFeedbackForPair(llmFeedbackRows, activeComponent, primaryMethod, compareMethod);
  }, [activeComponent, compareMethod, isCompareMode, llmFeedbackRows, primaryMethod]);
  const llmWinnerMethod = useMemo(() => {
    if (!activeLLMFeedback || !primaryMethod || !compareMethod) return null;
    return findViewerMethodByFeedbackLabel([primaryMethod, compareMethod], activeLLMFeedback.llmSelectedWinner);
  }, [activeLLMFeedback, compareMethod, primaryMethod]);

  function openComparePicker() {
    if (compareCandidates.length === 0) return;
    setPendingCompareMethodId(compareMethodId && compareMethodId !== primaryMethodId ? compareMethodId : compareCandidates[0].id);
    setIsComparePickerOpen(true);
  }

  function startCompareMode() {
    if (!pendingCompareMethodId) return;
    setCompareMethodId(pendingCompareMethodId);
    setIsCompareMode(true);
    setIsComparePickerOpen(false);
  }

  function stopCompareMode() {
    setIsCompareMode(false);
    setIsComparePickerOpen(false);
  }

  return (
    <div className="app">
      <div className="appShell">
        <header className="hero card">
          <div className="heroCopy">
            <div className="eyebrow">Component Explorer</div>
            <h1 className="heroTitle">TOPA Project</h1>
            <p className="heroText">
              Browse one method output at a time, or open a side-by-side comparison for the same component and reveal the
              LLM's preferred option with a short explanation.
            </p>
          </div>

          <div className="heroStats">
            <div className="statCard">
              <div className="statLabel">Components</div>
              <div className="statValue">{manifest?.components.length ?? "--"}</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Extraction methods</div>
              <div className="statValue">{manifest ? availableMethods.length : "--"}</div>
            </div>
          </div>
        </header>

        {status && <div className={`statusBanner${manifest ? " statusBanner--warn" : ""}`}>{status}</div>}

        {manifest && (
          <>
            <section className="controls card">
              <div className="control">
                <label className="controlLabel" htmlFor="component-select">
                  Component
                </label>
                <select
                  id="component-select"
                  className="select"
                  value={activeComponent}
                  onChange={(event) => startTransition(() => setActiveComponent(event.target.value))}
                >
                  {manifest.components.map((component) => (
                    <option key={component} value={component}>
                      {prettify(component)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control">
                <label className="controlLabel" htmlFor="primary-method-select">
                  Primary method
                </label>
                <select
                  id="primary-method-select"
                  className="select"
                  value={primaryMethodId}
                  onChange={(event) => startTransition(() => setPrimaryMethodId(event.target.value))}
                  disabled={availableMethods.length === 0}
                >
                  {availableMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.badgeLabel} - {method.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="control controlActions">
                <div className="controlLabel">Viewer actions</div>
                <div className="buttonRow">
                  <button className="btn btnAccent" type="button" onClick={openComparePicker} disabled={compareCandidates.length === 0}>
                    Compare
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setIsLLMFeedbackOpen((current) => !current)}
                    disabled={!isCompareMode || !activeLLMFeedback}
                  >
                    {isLLMFeedbackOpen ? "Hide LLM feedback" : "View LLM feedback"}
                  </button>
                  <button className="btn btnGhost" type="button" onClick={stopCompareMode} disabled={!isCompareMode}>
                    Single view
                  </button>
                </div>
                {isCompareMode && !activeLLMFeedback && (
                  <div className="actionHint">No LLM feedback was found for the currently selected pair.</div>
                )}
              </div>

              {isCompareMode && compareMethod && (
                <div className="control">
                  <label className="controlLabel" htmlFor="compare-method-select">
                    Compared against
                  </label>
                  <select
                    id="compare-method-select"
                    className="select"
                    value={compareMethodId}
                    onChange={(event) => startTransition(() => setCompareMethodId(event.target.value))}
                  >
                    {compareCandidates.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.badgeLabel} - {method.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="control controlDescription">
                <div className="controlLabel">Component description</div>
                <div
                  className="descriptionCard"
                  dangerouslySetInnerHTML={{
                    __html: activeDescription
                      ? renderMiniMarkdown(activeDescription)
                      : "<span class='muted'>No description found for this component.</span>",
                  }}
                />
              </div>
            </section>

            {availableMethods.length === 0 ? (
              <section className="emptyState card">
                <div className="emptyEyebrow">No outputs available</div>
                <h2 className="emptyTitle">{prettify(activeComponent)}</h2>
                <p className="emptyText">
                  None of the loaded methods currently expose a non-empty output for this component. Try another component
                  from the dropdown above.
                </p>
              </section>
            ) : (
              <>
                {(primaryMethod || (isCompareMode && compareMethod)) && (
                  <section className="summaryStrip">
                    <div className="summaryChip summaryChip--accent">
                      {primaryMethod && (
                        <>
                          <MethodIdentity method={primaryMethod} compact />
                          {isCompareMode && compareMethod && (
                            <>
                              <span className="summaryDivider">vs</span>
                              <MethodIdentity method={compareMethod} compact />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                )}

                {isCompareMode && isLLMFeedbackOpen && activeLLMFeedback && (
                  <section className="llmFeedbackCard card">
                    <div className="llmFeedbackHeader">
                      <div>
                        <div className="eyebrow">LLM Feedback</div>
                        <h2 className="llmFeedbackTitle">Preferred output for this pair</h2>
                      </div>
                    </div>

                    <div className="llmFeedbackGrid">
                      <div className="llmFeedbackPane">
                        <div className="controlLabel">Preferred method</div>
                        {llmWinnerMethod ? (
                          <MethodIdentity method={llmWinnerMethod} />
                        ) : (
                          <div className="llmWinnerFallback">{activeLLMFeedback.llmSelectedWinner}</div>
                        )}
                      </div>
                    </div>

                    <div className="llmReasonBlock">
                      <div className="controlLabel">Reason</div>
                      <div
                        className="llmReasonText"
                        dangerouslySetInnerHTML={{
                          __html: renderMiniMarkdown(activeLLMFeedback.llmSelectedReason || "No reason was provided."),
                        }}
                      />
                    </div>
                  </section>
                )}

                <section className={`panelGrid${isCompareMode && compareMethod ? " panelGrid--compare" : ""}`}>
                  {primaryMethod && (
                    <MethodPanel
                      role={isCompareMode ? "Primary" : "Active view"}
                      tone="primary"
                      method={primaryMethod}
                      component={activeComponent}
                      value={primaryValue}
                      note={undefined}
                    />
                  )}

                  {isCompareMode && compareMethod && (
                    <MethodPanel
                      role="Comparison"
                      tone="compare"
                      method={compareMethod}
                      component={activeComponent}
                      value={compareValue}
                      note={undefined}
                    />
                  )}
                </section>
              </>
            )}
          </>
        )}

        {isComparePickerOpen && (
          <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => setIsComparePickerOpen(false)}>
            <div className="modalCard" onClick={(event) => event.stopPropagation()}>
              <div className="eyebrow">Compare Setup</div>
              <h2 className="modalTitle">Select a second method</h2>
              <p className="modalText">
                Choose the method you want to compare against <strong>{primaryMethod?.displayName ?? primaryMethodId}</strong> for{" "}
                <strong>{prettify(activeComponent)}</strong>. The color badge keeps the legacy survey code visible.
              </p>

              <div className="candidateGrid">
                {compareCandidates.map((method) => (
                  <button
                    key={method.id}
                    type="button"
                    className={`candidateCard${pendingCompareMethodId === method.id ? " candidateCard--selected" : ""}`}
                    onClick={() => setPendingCompareMethodId(method.id)}
                    aria-pressed={pendingCompareMethodId === method.id}
                  >
                    <div className="candidateTitle">
                      <MethodIdentity method={method} compact />
                    </div>
                  </button>
                ))}
              </div>

              <div className="modalActions">
                <button className="btn btnGhost" type="button" onClick={() => setIsComparePickerOpen(false)}>
                  Cancel
                </button>
                <button className="btn btnAccent" type="button" onClick={startCompareMode} disabled={!pendingCompareMethodId}>
                  Start comparison
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
