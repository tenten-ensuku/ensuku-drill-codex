CREATE TABLE rankings (
  id TEXT PRIMARY KEY NOT NULL,
  player_name TEXT NOT NULL CHECK(length(player_name) BETWEEN 1 AND 24),
  mode_id TEXT NOT NULL CHECK(mode_id IN ('6', '7', '10_20', '10_all')),
  mode_label TEXT NOT NULL,
  variant TEXT NOT NULL CHECK(variant IN ('normal', 'ura')),
  score INTEGER NOT NULL CHECK(score >= 0),
  rank TEXT NOT NULL CHECK(rank IN ('E', 'D', 'C', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S', 'SS', '神')),
  correct_count INTEGER NOT NULL CHECK(correct_count >= 0),
  mistake_count INTEGER NOT NULL CHECK(mistake_count >= 0),
  elapsed_seconds REAL NOT NULL CHECK(elapsed_seconds >= 0),
  average_seconds REAL NOT NULL CHECK(average_seconds >= 0),
  question_count INTEGER NOT NULL CHECK(question_count > 0),
  client_version TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  device_id TEXT,
  name_key TEXT NOT NULL,
  is_hidden INTEGER NOT NULL CHECK(is_hidden IN (0, 1)),
  submitted_at_ms INTEGER NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0, 1)),
  request_key TEXT UNIQUE,
  request_hash TEXT
) STRICT;

CREATE INDEX rankings_mode_order_idx
  ON rankings(is_test, is_hidden, mode_id, score DESC, elapsed_seconds, submitted_at_ms, id);
CREATE INDEX rankings_mode_date_idx
  ON rankings(is_test, is_hidden, mode_id, submitted_at_ms, score DESC, elapsed_seconds);
CREATE INDEX rankings_device_created_idx ON rankings(device_id, submitted_at_ms DESC);

CREATE TABLE blocked_devices (device_hash TEXT PRIMARY KEY NOT NULL) STRICT;
