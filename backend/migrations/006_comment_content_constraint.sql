ALTER TABLE comments
ADD CONSTRAINT comments_content_length
CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000);
