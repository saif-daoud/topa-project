import { startTransition, useEffect, useMemo, useState } from "react";
import "./App.css";
import type { MethodSpec } from "./viewer-utils";
import { getComponentValue, getDescription, isEmptyValue, prettify, renderMiniMarkdown } from "./viewer-utils";
import { decorateMethod, MethodIdentity, type ViewerMethod } from "./method-display";
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
  const [activeComponent, setActiveComponent] = useState("");
  const [status, setStatus] = useState("Loading component data...");

  useEffect(() => {
    document.title = "TOPA Late Fusion Viewer";
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

  useEffect(() => {
    if (!manifest?.components.length) return;
    if (!activeComponent || !manifest.components.includes(activeComponent)) {
      setActiveComponent(manifest.components[0]);
    }
  }, [activeComponent, manifest]);

  const activeMethod = availableMethods[0] ?? null;
  const activeValue = activeMethod ? getComponentValue(methods[activeMethod.id], activeComponent) : null;
  const activeDescription = getDescription(descriptions, activeComponent);

  return (
    <div className="app">
      <div className="appShell">
        <header className="hero card">
          <div className="heroCopy">
            <div className="eyebrow">Component Explorer</div>
            <h1 className="heroTitle">TOPA Late Fusion Viewer</h1>
            <p className="heroText">
              Explore the TOPA Late Fusion output across the core CBT ontology components in a focused single-method demo.
            </p>
          </div>

          <div className="heroStats">
            <div className="statCard">
              <div className="statLabel">Components</div>
              <div className="statValue">{manifest?.components.length ?? "--"}</div>
            </div>
            <div className="statCard">
              <div className="statLabel">Extraction method</div>
              <div className="statValue statValueSm">{activeMethod?.displayName ?? "TOPA Late Fusion"}</div>
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

              <div className="control controlMethod">
                <div className="controlLabel">Loaded method</div>
                <div className="methodStatic">
                  {activeMethod ? <MethodIdentity method={activeMethod} /> : <span className="muted">No output loaded.</span>}
                </div>
              </div>

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
                <div className="emptyEyebrow">No output available</div>
                <h2 className="emptyTitle">{prettify(activeComponent)}</h2>
                <p className="emptyText">
                  The loaded TOPA Late Fusion data does not currently expose a non-empty output for this component. Try another
                  component from the dropdown above.
                </p>
              </section>
            ) : (
              <>
                {activeMethod && (
                  <section className="summaryStrip">
                    <div className="summaryChip summaryChip--accent">
                      <MethodIdentity method={activeMethod} compact />
                    </div>
                  </section>
                )}

                <section className="panelGrid">
                  {activeMethod && (
                    <MethodPanel
                      role="TOPA Late Fusion"
                      tone="primary"
                      method={activeMethod}
                      component={activeComponent}
                      value={activeValue}
                      note={undefined}
                    />
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
