-- Payload stores Works version snapshots in _works_v with a separate enum from
-- works.catalog_status. The live lifecycle migration added `temporary` to the
-- main table enum; this repair adds the same value to the version enum so new
-- temporary works can create version rows.
--
-- Idempotent and metadata-only: no work or version rows are changed.

DO $$
DECLARE
  version_type text;
  version_is_enum boolean;
BEGIN
  SELECT c.udt_name, (t.typtype = 'e')
    INTO version_type, version_is_enum
  FROM information_schema.columns c
  JOIN pg_type t ON t.typname = c.udt_name
  WHERE c.table_schema = 'public'
    AND c.table_name = '_works_v'
    AND c.column_name = 'version_catalog_status';

  IF version_is_enum THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', version_type, 'temporary');
  END IF;
END $$;

-- Read-only verification:
-- SELECT t.typname, e.enumlabel
-- FROM pg_type t
-- JOIN pg_enum e ON e.enumtypid = t.oid
-- WHERE t.typname IN ('enum_works_catalog_status', 'enum__works_v_version_catalog_status')
--   AND e.enumlabel = 'temporary'
-- ORDER BY t.typname;
