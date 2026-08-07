import * as migration_20260718_072813_existing_schema_baseline_v01 from './20260718_072813_existing_schema_baseline_v01';
import * as migration_20260718_072843_stewardship_notices_v01 from './20260718_072843_stewardship_notices_v01';
import * as migration_20260723_141905_current_schema_baseline_before_radar_public_v01 from './20260723_141905_current_schema_baseline_before_radar_public_v01';
import * as migration_20260723_141908_radar_public_conclusions_v01 from './20260723_141908_radar_public_conclusions_v01';
import * as migration_20260801_101546_current_schema_baseline_before_radar_public_records_v01 from './20260801_101546_current_schema_baseline_before_radar_public_records_v01';
import * as migration_20260801_101551_radar_public_records_v01 from './20260801_101551_radar_public_records_v01';
import * as migration_20260802_030535_radar_public_ratings_v01 from './20260802_030535_radar_public_ratings_v01';
import * as migration_20260802_045057_radar_public_record_fact_value_text_v01 from './20260802_045057_radar_public_record_fact_value_text_v01';
import * as migration_20260802_062015_radar_public_record_evidence_role_v01 from './20260802_062015_radar_public_record_evidence_role_v01';
import * as migration_20260803_102741_radar_public_metrics_v01 from './20260803_102741_radar_public_metrics_v01';
import * as migration_20260807_223902_radar_v05_persistence_standardization_v01 from './20260807_223902_radar_v05_persistence_standardization_v01';

export const migrations = [
  {
    up: migration_20260718_072813_existing_schema_baseline_v01.up,
    down: migration_20260718_072813_existing_schema_baseline_v01.down,
    name: '20260718_072813_existing_schema_baseline_v01',
  },
  {
    up: migration_20260718_072843_stewardship_notices_v01.up,
    down: migration_20260718_072843_stewardship_notices_v01.down,
    name: '20260718_072843_stewardship_notices_v01',
  },
  {
    up: migration_20260723_141905_current_schema_baseline_before_radar_public_v01.up,
    down: migration_20260723_141905_current_schema_baseline_before_radar_public_v01.down,
    name: '20260723_141905_current_schema_baseline_before_radar_public_v01',
  },
  {
    up: migration_20260723_141908_radar_public_conclusions_v01.up,
    down: migration_20260723_141908_radar_public_conclusions_v01.down,
    name: '20260723_141908_radar_public_conclusions_v01',
  },
  {
    up: migration_20260801_101546_current_schema_baseline_before_radar_public_records_v01.up,
    down: migration_20260801_101546_current_schema_baseline_before_radar_public_records_v01.down,
    name: '20260801_101546_current_schema_baseline_before_radar_public_records_v01',
  },
  {
    up: migration_20260801_101551_radar_public_records_v01.up,
    down: migration_20260801_101551_radar_public_records_v01.down,
    name: '20260801_101551_radar_public_records_v01',
  },
  {
    up: migration_20260802_030535_radar_public_ratings_v01.up,
    down: migration_20260802_030535_radar_public_ratings_v01.down,
    name: '20260802_030535_radar_public_ratings_v01',
  },
  {
    up: migration_20260802_045057_radar_public_record_fact_value_text_v01.up,
    down: migration_20260802_045057_radar_public_record_fact_value_text_v01.down,
    name: '20260802_045057_radar_public_record_fact_value_text_v01',
  },
  {
    up: migration_20260802_062015_radar_public_record_evidence_role_v01.up,
    down: migration_20260802_062015_radar_public_record_evidence_role_v01.down,
    name: '20260802_062015_radar_public_record_evidence_role_v01',
  },
  {
    up: migration_20260803_102741_radar_public_metrics_v01.up,
    down: migration_20260803_102741_radar_public_metrics_v01.down,
    name: '20260803_102741_radar_public_metrics_v01',
  },
  {
    up: migration_20260807_223902_radar_v05_persistence_standardization_v01.up,
    down: migration_20260807_223902_radar_v05_persistence_standardization_v01.down,
    name: '20260807_223902_radar_v05_persistence_standardization_v01'
  },
];
