CREATE SCHEMA global_work_lineage_v01;

CREATE TABLE global_work_lineage_v01.provenance_objects (
  object_ref text PRIMARY KEY,
  object_kind text NOT NULL CHECK (
    object_kind IN (
      'observation',
      'audit_run',
      'output_manifest',
      'provenance_bundle',
      'formal_package_manifest'
    )
  ),
  document_sha256 character(64) NOT NULL UNIQUE CHECK (
    document_sha256 ~ '^[0-9a-f]{64}$'
  ),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object')
);

CREATE TABLE global_work_lineage_v01.work_lineages (
  work_id text PRIMARY KEY,
  document_sha256 character(64) NOT NULL UNIQUE CHECK (
    document_sha256 ~ '^[0-9a-f]{64}$'
  ),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  canonical_title text GENERATED ALWAYS AS (
    document #>> '{canonical,naming,canonicalTitle}'
  ) STORED,
  audit_run_ref text GENERATED ALWAYS AS (
    document #>> '{provenance,auditRunRef}'
  ) STORED,
  CONSTRAINT work_lineage_contract_version CHECK (
    document ->> 'contractVersion' = 'global-work-lineage-v01'
  ),
  CONSTRAINT work_lineage_identity CHECK (
    document ->> 'workId' = work_id
  ),
  CONSTRAINT work_lineage_active_frozen_blocks CHECK (
    document ?& ARRAY[
      'canonical',
      'identities',
      'research',
      'assessment',
      'candidate',
      'published',
      'human',
      'reservations',
      'quarantine',
      'effectiveState',
      'integrity',
      'provenance'
    ]::text[]
  ),
  CONSTRAINT work_lineage_retired_legacy_omitted CHECK (NOT document ? 'legacy'),
  CONSTRAINT work_lineage_canonical_title_present CHECK (
    canonical_title IS NOT NULL AND btrim(canonical_title) <> ''
  ),
  CONSTRAINT work_lineage_audit_run_present CHECK (
    audit_run_ref IS NOT NULL AND btrim(audit_run_ref) <> ''
  ),
  CONSTRAINT work_lineage_audit_run_fk FOREIGN KEY (audit_run_ref)
    REFERENCES global_work_lineage_v01.provenance_objects(object_ref)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX work_lineages_canonical_title_lower_idx
  ON global_work_lineage_v01.work_lineages (lower(canonical_title));

CREATE INDEX work_lineages_identity_bindings_gin_idx
  ON global_work_lineage_v01.work_lineages
  USING gin ((document #> '{identities,bindings}') jsonb_path_ops);

COMMENT ON SCHEMA global_work_lineage_v01 IS
  'Fresh Global Work Lineage v01 data plane. No legacy runtime tables, bridges, aliases, or reference-only data.';

COMMENT ON TABLE global_work_lineage_v01.work_lineages IS
  'Current materialized projections of the immutable Frozen logical 13-block contract; migration-only legacy block retired and omitted.';

COMMENT ON TABLE global_work_lineage_v01.provenance_objects IS
  'Generic physical storage for existing Global ProvenanceSystem supporting objects; not a fourteenth WorkLineage block.';
