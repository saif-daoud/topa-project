export type Env = {
  DB: D1Database;
  TOKEN_SECRET: string;
  ALLOWED_ORIGINS: string;
};

type AccessCodeRow = {
  code_hash: string;
  active: number;
  uses_remaining: number | null;
  expires_at: string | null;
};

type ParticipantLookupRow = {
  id: number;
  name: string | null;
  email: string | null;
  job_title: string | null;
  institution: string | null;
  latest_degree: string | null;
  years_experience: number | null;
};

type ReviewSessionRow = {
  id: string;
  participant_id: string;
  baseline_version: string;
};

type ReviewChangeRow = {
  id: string;
  component: string;
  path_json: string;
  target_id: string | null;
  operation: string;
  old_value_json: string | null;
  new_value_json: string | null;
  comment: string | null;
  revoked_change_id: string | null;
  timestamp_utc: string;
  received_at: string;
};

type ReviewFeedbackRow = {
  id: string;
  component: string;
  path_json: string;
  feedback: string;
  timestamp_utc: string;
  received_at: string;
};

type ReviewSnapshotRow = {
  data_json: string;
  created_at: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHANGES_PER_SYNC = 1000;
const MAX_FEEDBACK_PER_SYNC = 200;
const MAX_TEXT = 10000;
const DEFAULT_BASELINE_VERSION = "topa_late_fusion_2026_06";

function cors(origin: string) {
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function originAllowed(env: Env, origin: string) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

function sanitizeText(value: unknown, maxLen = MAX_TEXT) {
  const text = String(value ?? "").trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function jsonParseSafe(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function jsonString(value: unknown, maxLen = 2_000_000) {
  const text = JSON.stringify(value ?? null);
  if (text.length > maxLen) throw new Error("Payload is too large");
  return text;
}

function base64UrlEncode(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64Json(obj: unknown) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

function fromB64Json(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

async function makeToken(env: Env, payload: unknown) {
  const body = b64Json(payload);
  const signature = await hmacSign(env.TOKEN_SECRET, body);
  return `${body}.${signature}`;
}

async function verifyToken(env: Env, token: string, opts?: { ignoreExp?: boolean }) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw new Error("Bad token format");
  const expected = await hmacSign(env.TOKEN_SECRET, body);
  if (signature !== expected) throw new Error("Bad token signature");
  const payload = fromB64Json(body);
  if (!opts?.ignoreExp && payload.exp && Date.now() > Number(payload.exp)) throw new Error("Token expired");
  return payload as { codeHash: string; participant_id: string; exp: number };
}

async function dbGetAccessCode(env: Env, codeHash: string) {
  return (
    (await env.DB.prepare("SELECT code_hash, active, uses_remaining, expires_at FROM access_codes WHERE code_hash = ?")
      .bind(codeHash)
      .first<AccessCodeRow>()) ?? null
  );
}

async function dbDecrementUsesRemaining(env: Env, codeHash: string) {
  await env.DB.prepare("UPDATE access_codes SET uses_remaining = uses_remaining - 1 WHERE code_hash = ? AND uses_remaining IS NOT NULL AND uses_remaining > 0")
    .bind(codeHash)
    .run();
}

function parseParticipantId(participantId: string) {
  const match = /^P(\d+)$/.exec(String(participantId || ""));
  if (!match) throw new Error("Invalid participant_id");
  return parseInt(match[1], 10);
}

function isProfileComplete(row: ParticipantLookupRow | null) {
  if (!row) return false;
  return Boolean(
    String(row.name || "").trim() &&
      String(row.email || "").trim() &&
      String(row.job_title || "").trim() &&
      String(row.institution || "").trim() &&
      String(row.latest_degree || "").trim() &&
      row.years_experience != null
  );
}

async function dbFindParticipantByEmail(env: Env, email: string) {
  const normalized = sanitizeText(email, 320);
  if (!normalized) return null;

  const row = await env.DB.prepare(
    `SELECT id, name, email, job_title, institution, latest_degree, years_experience
     FROM participants
     WHERE email IS NOT NULL AND TRIM(email) != '' AND lower(email) = lower(?)
     ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
     LIMIT 1`
  )
    .bind(normalized)
    .first<ParticipantLookupRow>();

  const id = Number(row?.id || 0);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    participant_id: `P${String(id).padStart(5, "0")}`,
    profile_complete: isProfileComplete(row),
  };
}

async function allocateParticipantId(env: Env, email?: string | null) {
  const createdAt = new Date().toISOString();
  const result = email
    ? await env.DB.prepare("INSERT INTO participants (created_at, updated_at, email) VALUES (?, ?, ?)")
        .bind(createdAt, createdAt, sanitizeText(email, 320))
        .run()
    : await env.DB.prepare("INSERT INTO participants (created_at) VALUES (?)").bind(createdAt).run();
  const id = Number(result?.meta?.last_row_id || 0);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Failed to allocate participant id");
  return `P${String(id).padStart(5, "0")}`;
}

async function dbUpdateParticipantProfile(env: Env, participantId: string, profile: any) {
  const id = parseParticipantId(participantId);
  const years = Number(profile?.years_experience);
  if (!Number.isFinite(years) || years < 0 || years > 80) throw new Error("Invalid years_experience");

  await env.DB.prepare(
    `UPDATE participants
     SET name=?, email=?, job_title=?, institution=?, latest_degree=?, years_experience=?, updated_at=?
     WHERE id=?`
  )
    .bind(
      sanitizeText(profile?.name, 200),
      sanitizeText(profile?.email, 320),
      sanitizeText(profile?.job_title, 200),
      sanitizeText(profile?.institution, 250),
      sanitizeText(profile?.latest_degree, 200),
      years,
      new Date().toISOString(),
      id
    )
    .run();
}

async function ensureReviewSession(env: Env, participantId: string, baselineVersion: string) {
  const existing = await env.DB.prepare("SELECT id, participant_id, baseline_version FROM review_sessions WHERE participant_id = ? AND baseline_version = ? LIMIT 1")
    .bind(participantId, baselineVersion)
    .first<ReviewSessionRow>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO review_sessions (id, participant_id, baseline_version, status, created_at, updated_at) VALUES (?, ?, ?, 'in_progress', ?, ?)"
  )
    .bind(id, participantId, baselineVersion, now, now)
    .run();
  return { id, participant_id: participantId, baseline_version: baselineVersion };
}

async function getSharedReviewSession(env: Env, baselineVersion: string) {
  return (
    (await env.DB.prepare(
      `WITH activity AS (
         SELECT session_id, received_at AS activity_at FROM review_changes
         UNION ALL
         SELECT session_id, created_at AS activity_at FROM review_snapshots
       )
       SELECT rs.id, rs.participant_id, rs.baseline_version
       FROM review_sessions rs
       LEFT JOIN activity ON activity.session_id = rs.id
       WHERE rs.baseline_version = ?
       GROUP BY rs.id, rs.participant_id, rs.baseline_version
       ORDER BY
         CASE WHEN MAX(activity.activity_at) IS NULL THEN 0 ELSE 1 END DESC,
         MAX(activity.activity_at) DESC,
         rs.updated_at DESC,
         rs.created_at DESC
       LIMIT 1`
    )
      .bind(baselineVersion)
      .first<ReviewSessionRow>()) ?? null
  );
}

async function getLatestSnapshot(env: Env, sessionId: string) {
  return (
    (await env.DB.prepare("SELECT data_json, created_at FROM review_snapshots WHERE session_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(sessionId)
      .first<ReviewSnapshotRow>()) ?? null
  );
}

async function listChanges(env: Env, sessionId: string) {
  const rows = await env.DB.prepare("SELECT * FROM review_changes WHERE session_id = ? ORDER BY timestamp_utc ASC, received_at ASC")
    .bind(sessionId)
    .all<ReviewChangeRow>();
  return (rows?.results || []).map((row) => ({
    id: row.id,
    component: row.component,
    path: jsonParseSafe(row.path_json) || [],
    path_key: row.path_json,
    target_id: row.target_id,
    operation: row.operation,
    old_value: jsonParseSafe(row.old_value_json),
    new_value: jsonParseSafe(row.new_value_json),
    comment: row.comment,
    revoked_change_id: row.revoked_change_id,
    timestamp_utc: row.timestamp_utc,
    received_at: row.received_at,
  }));
}

async function listFeedback(env: Env, sessionId: string) {
  const rows = await env.DB.prepare("SELECT * FROM review_feedback WHERE session_id = ? ORDER BY timestamp_utc ASC, received_at ASC")
    .bind(sessionId)
    .all<ReviewFeedbackRow>();
  return (rows?.results || []).map((row) => ({
    id: row.id,
    component: row.component,
    path: jsonParseSafe(row.path_json) || [row.component],
    feedback: row.feedback,
    timestamp_utc: row.timestamp_utc,
    received_at: row.received_at,
  }));
}

async function upsertChange(env: Env, sessionId: string, participantId: string, raw: any) {
  const id = sanitizeText(raw?.id, 160) || crypto.randomUUID();
  const component = sanitizeText(raw?.component, 120);
  const path = Array.isArray(raw?.path) ? raw.path : [];
  const operation = sanitizeText(raw?.operation, 20);
  if (!component) throw new Error("Change component is required");
  if (!["add", "replace", "remove", "restore", "revoke"].includes(operation)) throw new Error("Invalid change operation");

  await env.DB.prepare(
    `INSERT INTO review_changes (
       id, session_id, participant_id, component, path_json, target_id, operation,
       old_value_json, new_value_json, comment, revoked_change_id, timestamp_utc, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       component=excluded.component,
       path_json=excluded.path_json,
       target_id=excluded.target_id,
       operation=excluded.operation,
       old_value_json=excluded.old_value_json,
       new_value_json=excluded.new_value_json,
       comment=excluded.comment,
       revoked_change_id=excluded.revoked_change_id,
       timestamp_utc=excluded.timestamp_utc,
       received_at=excluded.received_at`
  )
    .bind(
      id,
      sessionId,
      participantId,
      component,
      jsonString(path, 30000),
      sanitizeText(raw?.target_id, 240) || null,
      operation,
      jsonString(raw?.old_value),
      jsonString(raw?.new_value),
      sanitizeText(raw?.comment, 2000) || null,
      sanitizeText(raw?.revoked_change_id, 200) || null,
      sanitizeText(raw?.timestamp_utc, 80) || new Date().toISOString(),
      new Date().toISOString()
    )
    .run();

  return id;
}

async function upsertFeedback(env: Env, sessionId: string, participantId: string, raw: any) {
  const feedback = sanitizeText(raw?.feedback, MAX_TEXT);
  const component = sanitizeText(raw?.component, 120);
  if (!component) throw new Error("Feedback component is required");
  const id = sanitizeText(raw?.id, 200) || `${sessionId}_${component}`;
  const path = Array.isArray(raw?.path) ? raw.path : [component];

  await env.DB.prepare(
    `INSERT INTO review_feedback (
       id, session_id, participant_id, component, path_json, feedback, timestamp_utc, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       component=excluded.component,
       path_json=excluded.path_json,
       feedback=excluded.feedback,
       timestamp_utc=excluded.timestamp_utc,
       received_at=excluded.received_at`
  )
    .bind(
      id,
      sessionId,
      participantId,
      component,
      jsonString(path, 30000),
      feedback,
      sanitizeText(raw?.timestamp_utc, 80) || new Date().toISOString(),
      new Date().toISOString()
    )
    .run();

  return id;
}

async function saveSnapshot(env: Env, session: ReviewSessionRow, participantId: string, snapshot: unknown, changeCount: number) {
  if (snapshot == null) return null;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO review_snapshots (id, session_id, participant_id, baseline_version, data_json, change_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, session.id, participantId, session.baseline_version, jsonString(snapshot), changeCount, new Date().toISOString())
    .run();
  await env.DB.prepare("UPDATE review_sessions SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), session.id).run();
  return id;
}

async function deleteRevokedHistory(env: Env, sessionId: string, requestedChangeId: string) {
  const requested = await env.DB.prepare(
    "SELECT id, operation, revoked_change_id FROM review_changes WHERE session_id = ? AND id = ? LIMIT 1"
  )
    .bind(sessionId, requestedChangeId)
    .first<{ id: string; operation: string; revoked_change_id: string | null }>();

  if (!requested) throw new Error("Change history entry not found");

  const originalChangeId = requested.operation === "revoke" ? requested.revoked_change_id : requested.id;
  if (!originalChangeId) throw new Error("Only revoked changes can be removed from history");

  const revocations = await env.DB.prepare(
    "SELECT id FROM review_changes WHERE session_id = ? AND operation = 'revoke' AND revoked_change_id = ?"
  )
    .bind(sessionId, originalChangeId)
    .all<{ id: string }>();

  const revokeIds = (revocations.results || []).map((row) => row.id);
  if (revokeIds.length === 0) throw new Error("Only revoked changes can be removed from history");

  await env.DB.prepare(
    "DELETE FROM review_changes WHERE session_id = ? AND (id = ? OR (operation = 'revoke' AND revoked_change_id = ?))"
  )
    .bind(sessionId, originalChangeId, originalChangeId)
    .run();

  return [originalChangeId, ...revokeIds];
}

async function getSessionFromToken(env: Env, token: string, baselineVersion: string) {
  const payload = await verifyToken(env, token);
  const sharedSession = await getSharedReviewSession(env, baselineVersion);
  if (sharedSession) return { participantId: sharedSession.participant_id, session: sharedSession };

  const participantId = String(payload.participant_id || "");
  if (!participantId) throw new Error("Missing participant_id");
  const session = await ensureReviewSession(env, participantId, baselineVersion);
  return { participantId, session };
}

function errorResponse(message: string, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") || "";
    const allowed = originAllowed(env, origin);
    const headers = cors(origin);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: allowed ? headers : {} });
    if (!allowed) return errorResponse("Origin not allowed", 403, JSON_HEADERS);
    if (req.method !== "POST") return errorResponse("Method not allowed", 405, headers);

    const path = new URL(req.url).pathname;

    try {
      if (path.endsWith("/api/start")) {
        const body: any = await req.json().catch(() => ({}));
        const code = sanitizeText(body?.code, 200);
        const email = sanitizeText(body?.email, 320);
        const baselineVersion = sanitizeText(body?.baseline_version, 120) || DEFAULT_BASELINE_VERSION;
        if (!code) return errorResponse("Missing code", 400, headers);

        const codeHash = await sha256Hex(code);
        const accessCode = await dbGetAccessCode(env, codeHash);
        if (!accessCode) return errorResponse("Invalid code", 403, headers);
        if (accessCode.active !== 1) return errorResponse("Code inactive", 403, headers);
        if (accessCode.expires_at && Date.now() > Date.parse(accessCode.expires_at)) return errorResponse("Code expired", 403, headers);

        const savedReviewSession = email ? null : await getSharedReviewSession(env, baselineVersion);
        const existingParticipant = email
          ? await dbFindParticipantByEmail(env, email)
          : savedReviewSession
            ? { participant_id: savedReviewSession.participant_id, profile_complete: true }
            : null;
        if (existingParticipant) {
          const token = await makeToken(env, { codeHash, participant_id: existingParticipant.participant_id, exp: Date.now() + TOKEN_TTL_MS });
          return new Response(
            JSON.stringify({
              ok: true,
              token,
              participant_id: existingParticipant.participant_id,
              resumed: existingParticipant.profile_complete,
              prefill_email: email,
            }),
            { headers }
          );
        }

        if (accessCode.uses_remaining !== null && accessCode.uses_remaining <= 0) return errorResponse("Code has no remaining uses", 403, headers);
        if (accessCode.uses_remaining !== null) await dbDecrementUsesRemaining(env, codeHash);

        const participantId = await allocateParticipantId(env, email || null);
        await ensureReviewSession(env, participantId, baselineVersion);
        const token = await makeToken(env, { codeHash, participant_id: participantId, exp: Date.now() + TOKEN_TTL_MS });
        return new Response(JSON.stringify({ ok: true, token, participant_id: participantId, resumed: false, prefill_email: email || null }), { headers });
      }

      if (path.endsWith("/api/profile")) {
        const body: any = await req.json().catch(() => ({}));
        if (!body?.token || !body?.profile) return errorResponse("Missing token or profile", 400, headers);
        const payload = await verifyToken(env, String(body.token));
        await dbUpdateParticipantProfile(env, String(payload.participant_id || ""), body.profile);
        return new Response(JSON.stringify({ ok: true, token: body.token, participant_id: payload.participant_id }), { headers });
      }

      if (path.endsWith("/api/refresh")) {
        const body: any = await req.json().catch(() => ({}));
        if (!body?.token) return errorResponse("Missing token", 400, headers);
        const payload = await verifyToken(env, String(body.token), { ignoreExp: true });
        const token = await makeToken(env, { codeHash: payload.codeHash, participant_id: payload.participant_id, exp: Date.now() + TOKEN_TTL_MS });
        return new Response(JSON.stringify({ ok: true, token, participant_id: payload.participant_id }), { headers });
      }

      if (path.endsWith("/api/review/state")) {
        const body: any = await req.json().catch(() => ({}));
        if (!body?.token) return errorResponse("Missing token", 400, headers);
        const baselineVersion = sanitizeText(body?.baseline_version, 120) || DEFAULT_BASELINE_VERSION;
        const { session } = await getSessionFromToken(env, String(body.token), baselineVersion);
        const [snapshot, changes, feedback] = await Promise.all([getLatestSnapshot(env, session.id), listChanges(env, session.id), listFeedback(env, session.id)]);
        return new Response(
          JSON.stringify({
            ok: true,
            session,
            snapshot: snapshot ? jsonParseSafe(snapshot.data_json) : null,
            snapshot_created_at: snapshot?.created_at || null,
            changes,
            feedback,
          }),
          { headers }
        );
      }

      if (path.endsWith("/api/review/sync")) {
        const body: any = await req.json().catch(() => ({}));
        if (!body?.token) return errorResponse("Missing token", 400, headers);
        const baselineVersion = sanitizeText(body?.baseline_version, 120) || DEFAULT_BASELINE_VERSION;
        const { participantId, session } = await getSessionFromToken(env, String(body.token), baselineVersion);

        const changes = Array.isArray(body?.changes) ? body.changes.slice(0, MAX_CHANGES_PER_SYNC) : [];
        const feedback = Array.isArray(body?.feedback) ? body.feedback.slice(0, MAX_FEEDBACK_PER_SYNC) : [];
        const savedChangeIds: string[] = [];
        const savedFeedbackIds: string[] = [];

        for (const change of changes) savedChangeIds.push(await upsertChange(env, session.id, participantId, change));
        for (const feedbackRow of feedback) savedFeedbackIds.push(await upsertFeedback(env, session.id, participantId, feedbackRow));
        const snapshotId = await saveSnapshot(env, session, participantId, body?.snapshot, changes.length);

        return new Response(JSON.stringify({ ok: true, saved_change_ids: savedChangeIds, saved_feedback_ids: savedFeedbackIds, snapshot_id: snapshotId }), { headers });
      }

      if (path.endsWith("/api/review/change/delete")) {
        const body: any = await req.json().catch(() => ({}));
        if (!body?.token || !body?.change_id) return errorResponse("Missing token or change_id", 400, headers);
        const baselineVersion = sanitizeText(body?.baseline_version, 120) || DEFAULT_BASELINE_VERSION;
        const { session } = await getSessionFromToken(env, String(body.token), baselineVersion);
        const deletedChangeIds = await deleteRevokedHistory(env, session.id, sanitizeText(body.change_id, 160));

        return new Response(JSON.stringify({ ok: true, deleted_change_ids: deletedChangeIds }), { headers });
      }

      if (path.endsWith("/api/review/export")) {
        const body: any = await req.json().catch(() => ({}));
        if (!body?.token) return errorResponse("Missing token", 400, headers);
        const baselineVersion = sanitizeText(body?.baseline_version, 120) || DEFAULT_BASELINE_VERSION;
        const { session } = await getSessionFromToken(env, String(body.token), baselineVersion);
        const [snapshot, changes, feedback] = await Promise.all([getLatestSnapshot(env, session.id), listChanges(env, session.id), listFeedback(env, session.id)]);
        return new Response(
          JSON.stringify({
            ok: true,
            baseline_version: session.baseline_version,
            exported_at: new Date().toISOString(),
            snapshot: snapshot ? jsonParseSafe(snapshot.data_json) : null,
            changes,
            feedback,
          }),
          { headers }
        );
      }

      return errorResponse("Not found", 404, headers);
    } catch (error: any) {
      const message = error?.message || "Unexpected server error";
      const status = /token|signature|expired|participant_id/i.test(message) ? 401 : 400;
      return errorResponse(message, status, headers);
    }
  },
};
