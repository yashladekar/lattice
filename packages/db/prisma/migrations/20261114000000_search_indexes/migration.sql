-- Postgres owns search matching and ranking. These expression indexes keep the
-- per-entity queries index-backed without maintaining a second copy of the text.
CREATE INDEX "page_title_search_idx" ON "page" USING GIN (
  to_tsvector('english', coalesce("title", ''))
);

CREATE INDEX "page_document_body_search_idx" ON "page_document" USING GIN (
  to_tsvector('english', coalesce("plainText", ''))
);

CREATE INDEX "canvas_search_idx" ON "canvas" USING GIN (
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("data"::text, ''))
);

CREATE INDEX "capture_search_idx" ON "capture" USING GIN (
  to_tsvector(
    'english',
    coalesce("title", '') || ' ' || coalesce("content", '') || ' ' || coalesce("url", '')
  )
);

CREATE INDEX "flashcard_search_idx" ON "flashcard" USING GIN (
  to_tsvector('english', coalesce("front", '') || ' ' || coalesce("back", ''))
);

CREATE INDEX "tag_search_idx" ON "tag" USING GIN (
  to_tsvector('english', coalesce("name", ''))
);
