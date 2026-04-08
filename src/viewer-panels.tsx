import {
  bestMatchingKey,
  clipText,
  isEmptyValue,
  isPrimitive,
  isRecord,
  normKey,
  parseListString,
  prettify,
  removeConfidence,
  renderMiniMarkdown,
} from "./viewer-utils";
import { MethodIdentity, type ViewerMethod } from "./method-display";

function NestedBullets({ value, depth = 0 }: { value: any; depth?: number }) {
  const maxDepth = 7;
  const maxItems = 120;

  if (depth > maxDepth) return <span className="muted">...</span>;

  if (isPrimitive(value)) {
    const text = value == null ? "" : String(value);
    const parsed = typeof value === "string" ? parseListString(value) : null;

    if (parsed) {
      return (
        <ul className="bullets">
          {parsed.slice(0, maxItems).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    }

    return <span className="textInline" dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(String(clipText(text, 4000))) }} />;
  }

  if (Array.isArray(value)) {
    return (
      <ul className="bullets">
        {value.slice(0, maxItems).map((item, index) => (
          <li key={index}>
            <NestedBullets value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value)) {
    return (
      <ul className="bullets">
        {Object.entries(value)
          .slice(0, maxItems)
          .map(([key, nestedValue]) => (
            <li key={key}>
              <span className="bulletKey">{prettify(key)}:</span> <NestedBullets value={nestedValue} depth={depth + 1} />
            </li>
          ))}
      </ul>
    );
  }

  return <pre className="pre">{JSON.stringify(value, null, 2)}</pre>;
}

function ValueView({ value }: { value: any }) {
  if (isPrimitive(value)) {
    const text = value == null ? "" : String(value);
    const parsed = typeof value === "string" ? parseListString(value) : null;

    if (parsed) {
      return (
        <ul className="bullets">
          {parsed.slice(0, 200).map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    }

    return <div className="textBlock" dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(String(clipText(text, 7000))) }} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <div className="muted">Empty list.</div>;
    if (value.every(isPrimitive)) return <NestedBullets value={value} />;
    if (value.every(isRecord)) return <TableView data={value} />;

    if (value.length <= 12) {
      return (
        <ul className="bullets">
          {value.map((item, index) => (
            <li key={index}>{isRecord(item) ? <KeyValueView data={item} /> : <NestedBullets value={item} />}</li>
          ))}
        </ul>
      );
    }

    return <TableView data={value} />;
  }

  if (isRecord(value)) return <KeyValueView data={value} />;
  return <pre className="pre">{JSON.stringify(value, null, 2)}</pre>;
}

function TableView({ data }: { data: any }) {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return <div className="muted">No rows.</div>;
  if (rows.every(isPrimitive)) return <NestedBullets value={rows} />;

  const maxRows = 220;
  const shown = rows.slice(0, maxRows);
  const columns: string[] = [];

  for (const row of shown.slice(0, 80)) {
    if (!isRecord(row)) continue;
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  const finalColumns = columns.length ? columns : ["value"];

  return (
    <div className="tableWrap">
      {rows.length > maxRows && (
        <div className="muted">
          Showing first <strong>{maxRows}</strong> rows out of <strong>{rows.length}</strong>.
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            {finalColumns.map((column) => (
              <th key={column}>{prettify(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row: any, rowIndex: number) => (
            <tr key={rowIndex}>
              {finalColumns.map((column) => {
                const cellValue = isRecord(row) ? row[column] : column === "value" ? row : undefined;
                const rendered =
                  typeof cellValue === "string" || typeof cellValue === "number" || typeof cellValue === "boolean" || cellValue == null
                    ? String(clipText(cellValue ?? "", 600))
                    : JSON.stringify(cellValue);
                return <td key={column}>{rendered}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueView({ data }: { data: any }) {
  if (!isRecord(data)) return <div className="muted">Unexpected format.</div>;

  return (
    <div className="kv">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="kvRow">
          <div className="kvKey">{prettify(key)}</div>
          <div className="kvVal">
            <ValueView value={value} />
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeForTableRow(value: any): Record<string, any> {
  if (!isRecord(value)) return { value: String(clipText(value ?? "", 1200)) };

  const out: Record<string, any> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (Array.isArray(nestedValue)) out[key] = nestedValue.map((item) => String(item)).join(", ");
    else if (isRecord(nestedValue)) out[key] = JSON.stringify(nestedValue);
    else out[key] = nestedValue;
  }
  return out;
}

function ConversationStateView({ data }: { data: any }) {
  let rows: any[] | null = null;

  if (Array.isArray(data)) rows = data;
  else if (isRecord(data)) {
    const candidates = ["states", "variables", "dimensions", "items", "conversation_states", "conversation_state"];
    for (const candidate of candidates) {
      const key = bestMatchingKey(data, candidate);
      if (key && Array.isArray(data[key])) {
        rows = data[key];
        break;
      }
    }

    if (!rows) {
      const arrayKeys = Object.keys(data).filter((key) => Array.isArray(data[key]));
      if (arrayKeys.length === 1) rows = data[arrayKeys[0]];
    }
  }

  if (!rows) return <ValueView value={data} />;
  return <TableView data={rows.map(normalizeForTableRow)} />;
}

function CautionsView({ data }: { data: any }) {
  return <ValueView value={removeConfidence(data)} />;
}

function ActionSpaceView({ data }: { data: any }) {
  const macros = Array.isArray(data) ? data : [];
  const maxItems = 80;

  return (
    <div className="stack">
      {macros.length > maxItems && (
        <div className="muted">
          Showing first <strong>{maxItems}</strong> macro actions out of <strong>{macros.length}</strong>.
        </div>
      )}

      {macros.slice(0, maxItems).map((macro: any, index: number) => {
        const name = macro?.name ?? macro?.macro_action ?? `Macro ${index + 1}`;
        const goal = macro?.goal ?? macro?.objective ?? macro?.intent ?? null;
        const description = macro?.description ?? macro?.definition ?? null;
        const microActions = Array.isArray(macro?.micro_actions)
          ? macro.micro_actions
          : Array.isArray(macro?.microActions)
          ? macro.microActions
          : [];
        const states =
          macro?.states ?? macro?.state ?? macro?.conversation_states ?? macro?.conversation_state ?? macro?.conversationStates ?? null;

        const extra: Record<string, any> = {};
        if (isRecord(macro)) {
          for (const [key, nestedValue] of Object.entries(macro)) {
            if (normKey(key).includes("confidence")) continue;
            if (
              [
                "name",
                "macro_action",
                "goal",
                "objective",
                "intent",
                "description",
                "definition",
                "micro_actions",
                "microActions",
                "states",
                "state",
                "conversation_states",
                "conversation_state",
                "conversationStates",
              ].includes(key)
            ) {
              continue;
            }
            if (isEmptyValue(nestedValue)) continue;
            extra[key] = nestedValue;
          }
        }

        const goalSummary =
          goal == null
            ? ""
            : typeof goal === "string"
            ? goal
            : String(goal?.objective ?? goal?.goal ?? goal?.name ?? JSON.stringify(goal));

        return (
          <details key={index} className="accordion">
            <summary className="accordionSummary">
              <div className="accTitle">{clipText(name, 220)}</div>
              <div className="accMeta">{clipText(goalSummary || String(description || "Expand to inspect micro actions."), 220)}</div>
            </summary>

            <div className="accordionBody">
              {(goal || description || states || Object.keys(extra).length > 0) && (
                <div className="stack">
                  {goal && (
                    <div>
                      <div className="sectionLabel">Goal</div>
                      {typeof goal === "string" ? (
                        <div className="textBlock" dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(String(clipText(goal, 8000))) }} />
                      ) : (
                        <NestedBullets value={goal} />
                      )}
                    </div>
                  )}

                  {description && (
                    <div>
                      <div className="sectionLabel">Description</div>
                      <div
                        className="textBlock"
                        dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(String(clipText(description, 8000))) }}
                      />
                    </div>
                  )}

                  {!isEmptyValue(states) && (
                    <div>
                      <div className="sectionLabel">States</div>
                      <ValueView value={states} />
                    </div>
                  )}

                  {Object.keys(extra).length > 0 && (
                    <div>
                      <div className="sectionLabel">Other fields</div>
                      <KeyValueView data={extra} />
                    </div>
                  )}
                </div>
              )}

              <div className="sectionLabel">Micro actions ({microActions.length})</div>
              {microActions.length === 0 ? (
                <div className="muted">No micro actions.</div>
              ) : (
                <ul className="bullets">
                  {microActions.slice(0, 220).map((micro: any, microIndex: number) => {
                    const microName = micro?.name ?? micro?.micro_action ?? `Micro ${microIndex + 1}`;
                    const microDescription = micro?.description ?? micro?.definition;
                    const extraFields: Record<string, any> = {};

                    if (isRecord(micro)) {
                      for (const [key, nestedValue] of Object.entries(micro)) {
                        if (normKey(key).includes("confidence")) continue;
                        if (["name", "micro_action", "description", "definition"].includes(key)) continue;
                        if (isEmptyValue(nestedValue)) continue;
                        extraFields[key] = nestedValue;
                      }
                    }

                    return (
                      <li key={microIndex}>
                        <div className="microName">{clipText(microName, 220)}</div>
                        {microDescription && <div className="microDesc">{clipText(String(microDescription), 1200)}</div>}
                        {Object.keys(extraFields).length > 0 && <KeyValueView data={extraFields} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ComponentViewer({ component, value }: { component: string; value: any }) {
  const normalized = normKey(component);
  const cleaned = removeConfidence(value);

  if (normalized === "actionspace") return <ActionSpaceView data={cleaned} />;
  if (normalized === "conversationstate" || normalized === "conversationstates") return <ConversationStateView data={cleaned} />;
  if (normalized.includes("caution")) return <CautionsView data={cleaned} />;
  return <ValueView value={cleaned} />;
}

export function MethodPanel({
  role,
  tone,
  method,
  component,
  value,
  note,
}: {
  role: string;
  tone: "primary" | "compare";
  method: ViewerMethod;
  component: string;
  value: any;
  note?: string;
}) {
  return (
    <article className={`panelCard panelCard--${tone}`}>
      <div className="panelHeader">
        <div>
          <div className={`panelPill panelPill--${tone}`}>{role}</div>
          <div className="panelTitleWrap">
            <MethodIdentity method={method} />
          </div>
          <div className="panelSub">
            {prettify(component)}
          </div>
        </div>
        {note && <div className="panelNote">{note}</div>}
      </div>

      <div className="panelBody">
        <ComponentViewer component={component} value={value} />
      </div>
    </article>
  );
}
