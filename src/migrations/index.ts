import * as migration_20260718_072813_existing_schema_baseline_v01 from './20260718_072813_existing_schema_baseline_v01';
import * as migration_20260718_072843_stewardship_notices_v01 from './20260718_072843_stewardship_notices_v01';

export const migrations = [
  {
    up: migration_20260718_072813_existing_schema_baseline_v01.up,
    down: migration_20260718_072813_existing_schema_baseline_v01.down,
    name: '20260718_072813_existing_schema_baseline_v01',
  },
  {
    up: migration_20260718_072843_stewardship_notices_v01.up,
    down: migration_20260718_072843_stewardship_notices_v01.down,
    name: '20260718_072843_stewardship_notices_v01'
  },
];
