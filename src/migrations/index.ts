import * as migration_20260718_072813_existing_schema_baseline_v01 from './20260718_072813_existing_schema_baseline_v01';
import * as migration_20260718_072843_stewardship_notices_v01 from './20260718_072843_stewardship_notices_v01';
import * as migration_20260723_141905_current_schema_baseline_before_radar_public_v01 from './20260723_141905_current_schema_baseline_before_radar_public_v01';
import * as migration_20260723_141908_radar_public_conclusions_v01 from './20260723_141908_radar_public_conclusions_v01';

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
    name: '20260723_141908_radar_public_conclusions_v01'
  },
];
