-- Cache for Spotify audio-analysis results. A track's analysis never changes,
-- so the Worker serves it from here and only asks Spotify on a miss.
CREATE TABLE IF NOT EXISTS analysis_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  cached_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS analysis_cache_cached_at_idx ON analysis_cache(cached_at);
