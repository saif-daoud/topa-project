INSERT INTO access_codes (code_hash, active, uses_remaining, expires_at)
VALUES ('c97ace4c8fef2cee8fa0f3c9f52aab18dbd4f42438afe362ffb8f75ce4c04b84', 1, NULL, NULL)
ON CONFLICT(code_hash) DO UPDATE SET
  active = 1,
  uses_remaining = NULL,
  expires_at = NULL;
