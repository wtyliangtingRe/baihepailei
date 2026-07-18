'use client'

import { useMemo, useState } from 'react'

import {
  radarClassDefinitions,
  type RadarGrade,
  type RadarRatingClass,
} from '@/lib/radar/ratingPolicy'

import styles from './RadarRuleSelector.module.css'

type RuleOption = {
  code: RadarRatingClass
  grade: RadarGrade
  label: string
}

type RadarRuleSelectorProps = {
  initialDecisiveRuleCode?: string
  initialMatchedRuleCodes?: string[]
  decisiveName?: string
  matchedName?: string
  title?: string
  description?: string
}

const gradeOrder: RadarGrade[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X']

const options: RuleOption[] = Object.entries(radarClassDefinitions)
  .map(([code, definition]) => ({
    code: code as RadarRatingClass,
    grade: definition.grade,
    label: definition.label,
  }))
  .sort((left, right) => (
    gradeOrder.indexOf(left.grade) - gradeOrder.indexOf(right.grade)
    || left.code.localeCompare(right.code)
  ))

const validCodes = new Set(options.map((option) => option.code))

function validCode(value?: string) {
  return value && validCodes.has(value as RadarRatingClass) ? value as RadarRatingClass : ''
}

export default function RadarRuleSelector({
  initialDecisiveRuleCode = '',
  initialMatchedRuleCodes = [],
  decisiveName = 'decisiveRuleCode',
  matchedName = 'matchedRuleCodes',
  title = '规则建议',
  description = '主规则决定建议等级；全部命中规则用于保留其他同时成立的注意点。',
}: RadarRuleSelectorProps) {
  const initialDecisive = validCode(initialDecisiveRuleCode)
  const initialMatched = initialMatchedRuleCodes.map(validCode).filter(Boolean) as RadarRatingClass[]
  const [decisive, setDecisive] = useState<RadarRatingClass | ''>(initialDecisive || initialMatched[0] || '')
  const [selected, setSelected] = useState<Set<RadarRatingClass>>(() => {
    const next = new Set<RadarRatingClass>(initialMatched)
    const first = initialDecisive || initialMatched[0]
    if (first) next.add(first)
    return next
  })

  const selectedOptions = useMemo(
    () => options.filter((option) => selected.has(option.code)),
    [selected],
  )

  function changeDecisive(value: string) {
    const normalized = validCode(value)
    setDecisive(normalized)
    if (!normalized) return
    setSelected((previous) => new Set(previous).add(normalized))
  }

  function toggle(code: RadarRatingClass, checked: boolean) {
    if (checked && !decisive) setDecisive(code)
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(code)
      else if (code !== decisive) next.delete(code)
      return next
    })
  }

  function clear() {
    setDecisive('')
    setSelected(new Set())
  }

  return (
    <div className={styles.selector}>
      <div className={styles.heading}>
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        {decisive || selected.size ? <button onClick={clear} type="button">清空规则</button> : null}
      </div>

      <label className={styles.decisive}>
        <span>主规则（决定性规则）</span>
        <select name={decisiveName} onChange={(event) => changeDecisive(event.currentTarget.value)} value={decisive}>
          <option value="">暂不指定</option>
          {gradeOrder.map((grade) => (
            <optgroup key={grade} label={`${grade} 级`}>
              {options.filter((option) => option.grade === grade).map((option) => (
                <option key={option.code} value={option.code}>{option.code} · {option.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {selectedOptions.length ? (
        <div className={styles.selected} aria-label="当前已选规则">
          {selectedOptions.map((option) => (
            <span data-decisive={option.code === decisive ? 'true' : 'false'} key={option.code}>
              {option.code === decisive ? '主规则 · ' : ''}{option.code}
            </span>
          ))}
        </div>
      ) : null}

      {selectedOptions.map((option) => (
        <input key={option.code} name={matchedName} type="hidden" value={option.code} />
      ))}

      <details className={styles.details}>
        <summary>
          <span>全部命中规则</span>
          <strong>{selected.size} 条已选</strong>
        </summary>
        <div className={styles.groups}>
          {gradeOrder.map((grade) => (
            <section key={grade}>
              <h3>{grade} 级</h3>
              <div className={styles.list}>
                {options.filter((option) => option.grade === grade).map((option) => {
                  const checked = selected.has(option.code)
                  return (
                    <label data-selected={checked ? 'true' : 'false'} key={option.code}>
                      <input
                        checked={checked}
                        onChange={(event) => toggle(option.code, event.currentTarget.checked)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{option.code}</strong>
                        <small>{option.label}</small>
                      </span>
                      {option.code === decisive ? <em>主规则</em> : null}
                    </label>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </details>
    </div>
  )
}
