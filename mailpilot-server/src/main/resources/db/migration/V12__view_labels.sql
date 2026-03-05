CREATE TABLE IF NOT EXISTS view_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id UUID NOT NULL,
  name TEXT NOT NULL,
  color_token TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_view_labels_view
    FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE,
  CONSTRAINT chk_view_labels_color_token
    CHECK (color_token IN ('gold', 'purple', 'blue', 'green', 'red', 'orange', 'pink', 'teal', 'gray'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_view_labels_view_name_lower
  ON view_labels (view_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_vl_view
  ON view_labels(view_id, sort_order, name);

CREATE TABLE IF NOT EXISTS message_view_labels (
  view_id UUID NOT NULL,
  message_id UUID NOT NULL,
  label_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (view_id, message_id, label_id),
  CONSTRAINT fk_mvl_view
    FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE,
  CONSTRAINT fk_mvl_message
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_mvl_label
    FOREIGN KEY (label_id) REFERENCES view_labels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mvl_view_message
  ON message_view_labels(view_id, message_id);
