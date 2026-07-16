import type { DetailItem, WorkRiskMatrix } from '../_lib/detail-index'

type RiskDimension = {
  key: keyof WorkRiskMatrix
  label: string
  description: string
  values: Record<string, string>
}

const dimensions: RiskDimension[] = [
  {
    key: 'maleImpact',
    label: '男性角色影响',
    description: '男性角色是否影响主要女性关系与观感。',
    values: {
      unassessed: '未评估',
      none: '无',
      minor: '轻微',
      noticeable: '明显',
      severe: '严重',
    },
  },
  {
    key: 'relationshipClarity',
    label: '恋爱关系明确度',
    description: '女性角色之间的恋爱关系是否明确。',
    values: {
      unassessed: '未评估',
      confirmed: '明确恋爱',
      developing: '发展中',
      subtext: '暧昧 / 亚文本',
      friendship: '友情向',
      unclear: '不明确',
    },
  },
  {
    key: 'endingSafety',
    label: '结局安全性',
    description: '结局是否稳定支持当前排雷判断。',
    values: {
      unassessed: '未评估',
      safe: '安全',
      open: '开放式',
      unfinished: '未完结',
      risky: '有风险',
      bad: '明确雷',
    },
  },
  {
    key: 'creatorSpeechRisk',
    label: '创作者言论风险',
    description: '创作者公开言论是否影响判断。',
    values: {
      unassessed: '未评估',
      none: '无记录',
      minor: '轻微',
      disputed: '有争议',
      severe: '严重',
    },
  },
]

function valueLabel(dimension: RiskDimension, matrix?: WorkRiskMatrix) {
  const value = matrix?.[dimension.key]
  if (!value || typeof value !== 'string') return '未填写'
  return dimension.values[value] || value
}

function hasMatrixValue(matrix?: WorkRiskMatrix) {
  if (!matrix) return false
  return dimensions.some((dimension) => {
    const value = matrix[dimension.key]
    return Boolean(value && value !== 'unassessed')
  }) || Boolean(matrix.note)
}

export default function WorkRiskMatrixCard({ item }: { item: DetailItem }) {
  if (item.collection !== 'works') return null

  const matrix = item.riskMatrix
  const hasValue = hasMatrixValue(matrix)

  return (
    <section className="detail-card work-risk-matrix-card" aria-label="雷点与注意点矩阵">
      <div className="work-risk-matrix-head">
        <p className="eyebrow">快速判断</p>
        <h2>雷点 / 注意点矩阵</h2>
        <p className="muted">
          {hasValue ? '用于快速理解这个作品的主要排雷维度。' : '暂未填写矩阵。后续可在后台补充各维度判断。'}
        </p>
      </div>

      <div className="work-risk-matrix-grid">
        {dimensions.map((dimension) => (
          <div className="work-risk-matrix-item" data-value={matrix?.[dimension.key] || 'missing'} key={dimension.key}>
            <span>{dimension.label}</span>
            <strong>{valueLabel(dimension, matrix)}</strong>
            <p>{dimension.description}</p>
          </div>
        ))}
      </div>

      {matrix?.note ? (
        <div className="work-risk-matrix-note">
          <span>矩阵备注</span>
          <p>{matrix.note}</p>
        </div>
      ) : null}
    </section>
  )
}
