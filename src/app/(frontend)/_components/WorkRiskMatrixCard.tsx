import type { DetailItem } from '../_lib/detail-index'

/**
 * The standalone matrix has been retired from the public detail page.
 * Existing fields remain in the data model for compatibility and rollback,
 * while formal grades, matched rules, tags, warnings and evidence carry the
 * public explanation instead.
 */
export default function WorkRiskMatrixCard({ item: _item }: { item: DetailItem }) {
  return null
}
