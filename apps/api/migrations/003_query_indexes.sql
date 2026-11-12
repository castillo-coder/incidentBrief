-- Q1: GET /api/incidents, owner_id equality + newest (created_at, id) order.
-- A 100,000-row profile otherwise scanned incidents and sorted matches for LIMIT 21.
-- The leading owner_id also supports the users -> incidents FK deletion lookup.
CREATE INDEX incidents_owner_created_idx
  ON incidents (owner_id, created_at DESC, id DESC);

-- Q2: GET /api/incidents?status=resolved, owner_id/status equality + same order.
-- Keep status before the ordering columns so sparse/older resolved records do not
-- require walking newer open records in the owner-only index.
CREATE INDEX incidents_owner_status_created_idx
  ON incidents (owner_id, status, created_at DESC, id DESC);

-- Q3: paginated notes and latest 30 summary notes use incident_id + newest order.
-- A 300,000-row profile otherwise scanned notes; this also supports incident ->
-- notes FK cascade lookup. Ownership remains checked through incidents_pkey.
-- Cursor pages use (created_at, id) < ($timestamp, $uuid) for one index range.
CREATE INDEX notes_incident_created_idx
  ON notes (incident_id, created_at DESC, id DESC);

-- Q4/Q5 already use users_email_key and sessions_pkey/users_pkey (migration 001).
-- Primary-key detail/update/delete lookups inspect at most one candidate row.
-- Do not index ciphertext or duplicate the FK-prefix indexes above.
