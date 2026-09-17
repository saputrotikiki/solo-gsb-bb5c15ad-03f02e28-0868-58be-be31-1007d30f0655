import { useId, useMemo, useState } from 'react'
import type { Annotation, ConflictRule, IgnoredConflict } from '../types'
import { normalizeTag } from '../lib/conflicts'
import { planTagRename, type RenamePlan } from '../lib/renameTag'

interface Props {
  /** 当前全部标签（标注与互斥规则中出现过的） */
  tags: string[]
  annotations: Annotation[]
  conflictRules: ConflictRule[]
  ignoredConflicts: IgnoredConflict[]
  onCancel: () => void
  onConfirm: (source: string, target: string) => void
}

const PREVIEW_LIMIT = 5

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * 标签重命名面板：选择源标签、填写目标标签，先预览影响再确认执行。
 * 预览与取消都不改动数据；确认时把归一化后的源 / 目标标签交给上层一次写入。
 */
export function TagRenamePanel({
  tags,
  annotations,
  conflictRules,
  ignoredConflicts,
  onCancel,
  onConfirm,
}: Props) {
  const [source, setSource] = useState('')
  const [targetInput, setTargetInput] = useState('')
  const [preview, setPreview] = useState<RenamePlan | null>(null)
  const listId = useId()

  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => a.localeCompare(b, 'zh')),
    [tags],
  )
  const target = normalizeTag(targetInput)
  const sameTag = !!source && !!target && source === target
  const canPreview = !!source && !!target && !sameTag
  const hasChanges =
    !!preview &&
    (preview.annotationChanges.length > 0 || preview.ruleChanges.length > 0)

  const showPreview = () => {
    if (!canPreview) return
    setPreview(
      planTagRename(
        { annotations, conflictRules, ignoredConflicts },
        source,
        targetInput,
      ),
    )
  }

  return (
    <div className="tag-rename-panel">
      <div className="form-title">标签重命名</div>
      <p className="form-hint">
        将源标签在所有标注与互斥规则中精确替换为目标标签。提交前可先预览受影响的
        标注、规则与将被合并 / 删除的规则数量；确认后一次生效，取消不改动任何数据。
      </p>

      {sortedTags.length === 0 ? (
        <p className="side-hint">当前还没有任何标签，请先在标注或互斥规则中使用标签。</p>
      ) : (
        <>
          <label className="form-label">源标签（从当前标签中选择）</label>
          <select
            className="rename-select"
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setPreview(null)
            }}
          >
            <option value="">请选择源标签…</option>
            {sortedTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label className="form-label">目标标签（可输入新标签）</label>
          <input
            className="rename-input"
            value={targetInput}
            list={listId}
            placeholder="替换为…"
            onChange={(e) => {
              setTargetInput(e.target.value)
              setPreview(null)
            }}
          />
          <datalist id={listId}>
            {sortedTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {sameTag && (
            <p className="rename-error">目标标签与源标签相同，无需重命名。</p>
          )}
        </>
      )}

      {preview && (
        <div className="rename-preview">
          <div className="rename-summary">
            {hasChanges ? (
              <>
                将影响 {preview.annotationChanges.length} 条标注、
                {preview.ruleChanges.length} 条互斥规则
                {preview.mergedRuleCount > 0 &&
                  `；合并重复规则 ${preview.mergedRuleCount} 条`}
                {preview.deletedRuleCount > 0 &&
                  `；删除自互斥规则 ${preview.deletedRuleCount} 条`}
              </>
            ) : (
              '没有受影响的内容。'
            )}
          </div>

          {preview.annotationChanges.length > 0 && (
            <div className="rename-group">
              <div className="rename-group-title">
                受影响标注（{preview.annotationChanges.length}）
              </div>
              {preview.annotationChanges.slice(0, PREVIEW_LIMIT).map((c) => (
                <div className="rename-item" key={c.id}>
                  <span className="rename-quote" title={c.quote}>
                    {clip(c.quote, 16) || '（空引文）'}
                  </span>
                  {c.before.map((t, i) => (
                    <span className="ann-tag" key={`${t}_${i}`}>
                      #{t}
                    </span>
                  ))}
                  <span className="rename-arrow">→</span>
                  {c.after.map((t, i) => (
                    <span className="ann-tag" key={`${t}_${i}`}>
                      #{t}
                    </span>
                  ))}
                </div>
              ))}
              {preview.annotationChanges.length > PREVIEW_LIMIT && (
                <div className="rename-more">
                  …等共 {preview.annotationChanges.length} 条
                </div>
              )}
            </div>
          )}

          {preview.ruleChanges.length > 0 && (
            <div className="rename-group">
              <div className="rename-group-title">
                受影响互斥规则（{preview.ruleChanges.length}）
              </div>
              {preview.ruleChanges.slice(0, PREVIEW_LIMIT).map((c) => (
                <div className="rename-item" key={c.id}>
                  <span className="rename-rule-pair">
                    {c.before.tagA} ⇄ {c.before.tagB}
                  </span>
                  <span className="rename-arrow">→</span>
                  {c.after ? (
                    <span className="rename-rule-pair">
                      {c.after.tagA} ⇄ {c.after.tagB}
                    </span>
                  ) : (
                    <span className="rename-rule-pair">（两侧相同）</span>
                  )}
                  {c.fate === 'merged' && (
                    <span className="rename-fate rename-fate-merged">合并</span>
                  )}
                  {c.fate === 'deleted' && (
                    <span className="rename-fate rename-fate-deleted">删除</span>
                  )}
                </div>
              ))}
              {preview.ruleChanges.length > PREVIEW_LIMIT && (
                <div className="rename-more">
                  …等共 {preview.ruleChanges.length} 条
                </div>
              )}
            </div>
          )}

          {(preview.ignoredRemappedCount > 0 ||
            preview.ignoredDroppedCount > 0) && (
            <div className="rename-group">
              <div className="rename-group-title">忽略记录</div>
              <div className="rename-item">
                {preview.ignoredRemappedCount > 0 && (
                  <span>{preview.ignoredRemappedCount} 条将迁移到保留规则</span>
                )}
                {preview.ignoredRemappedCount > 0 &&
                  preview.ignoredDroppedCount > 0 && <span>；</span>}
                {preview.ignoredDroppedCount > 0 && (
                  <span>
                    {preview.ignoredDroppedCount} 条不再可能对应冲突签名，将清理
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <span className="form-spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
        {sortedTags.length > 0 && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={showPreview}
              disabled={!canPreview}
            >
              预览影响
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!preview || !hasChanges}
              onClick={() => preview && onConfirm(preview.source, preview.target)}
            >
              确认重命名
            </button>
          </>
        )}
      </div>
    </div>
  )
}
