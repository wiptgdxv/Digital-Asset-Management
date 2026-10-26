ALTER TABLE users ADD COLUMN username VARCHAR(32);

WITH normalized AS (
    SELECT
        id,
        CASE
            WHEN length(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]+', '_', 'g')) >= 3
                THEN left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]+', '_', 'g'), 22)
            ELSE 'user'
        END AS base
    FROM users
), ranked AS (
    SELECT id, base, count(*) OVER (PARTITION BY base) AS duplicate_count
    FROM normalized
)
UPDATE users AS target
SET username = CASE
    WHEN ranked.duplicate_count = 1 THEN ranked.base
    ELSE left(ranked.base, 22) || '_' || ranked.id::text
END
FROM ranked
WHERE target.id = ranked.id;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
