ALTER TABLE messages
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', COALESCE(subject, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(sender_name, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(sender_email, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(sender_domain, '')), 'C') ||
  setweight(to_tsvector('simple', COALESCE(snippet, '')), 'D')
) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON messages USING GIN (search_vector);
