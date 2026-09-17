import { forwardRef } from 'react'
import type { Annotation, ConflictRule } from '../types'
import { REASON_LABEL } from '../lib/relocation'
import { badgeColor } from '../lib/segments'
import type { ConflictItem } from '../lib/conflicts'

interface Props {
  text: string
  annotations: Annotation[]
  activeId: string | null
  conflictRules: ConflictRule[]
  conflicts: ConflictItem[]
  onFocus: (a: Annotation) => void
  onEdit: (a: Annotation) => void
  onRebindStart: (a: Annotation) => void
  onDelete: (a: Annotation) => void
  onFocusOverlap: (c: ConflictItem) => void
  onIgnore: (c: ConflictItem) => void
  onUnignore: (c: ConflictItem) => void
  onConfigureRules: () => void
  onRenameTags: () => void
  tagCount: number
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function overlapQuote(text: string, c: ConflictItem): string {
  return text.slice(c.overlapStart, c.overlapEnd)
}

function AnnotationItem({
  a,
  active,
  onFocus,
  onEdit,
  onRebindStart,
  onDelete,
}: {
  a: Annotation
  active: boolean
} & Pick<Props, 'onFocus' | 'onEdit' | 'onRebindStart' | 'onDelete'>) {
  return (
    <div className={`ann-item ${active ? 'ann-active' : ''} ${a.status === 'pending' ? 'ann-pending' : ''}`}>
      <button
        type="button"
        className="ann-main"
        title="在原文中定位"
        onClick={() => (a.status === 'bound' ? onFocus(a) : onRebindStart(a))}
      >
        <span className="ann-badge" style={{ backgroundColor: badgeColor(a.id) }} />
        <span className="ann-quote">
          {a.status === 'pending' && <em className="ann-pending-flag">[待绑定] </em>}
          {a.quote || <span className="ann-empty-quote">（空引文）</span>}
        </span>
      </button>
      {a.tags.length > 0 && (
        <div className="ann-tags">
          {a.tags.map((t) => (
            <span className="ann-tag" key={t}>
              #{t}
            </span>
          ))}
        </div>
      )}
      {a.note && <p className="ann-note">{a.note}</p>}
      {a.status === 'pending' && a.pendingReason && (
        <p className="ann-pending-reason">{a.pendingReason}</p>
      )}
      {a.status === 'bound' && a.lastRelocation && (
        <p className="ann-meta">
          {REASON_LABEL[a.lastRelocation.reason]}
          {a.lastRelocation.reason === 'context-score' && `（${a.lastRelocation.score} 字）`}
          {' · '}
          {formatTime(a.lastRelocation.timestamp)}
        </p>
      )}
      <div className="ann-actions">
        {a.status === 'pending' ? (
          <button className="btn btn-small btn-warn" onClick={() => onRebindStart(a)}>
            重新选择片段
          </button>
        ) : (
          <button className="btn btn-small btn-ghost" onClick={() => onFocus(a)}>
            定位
          </button>
        )}
        <button className="btn btn-small btn-ghost" onClick={() => onEdit(a)}>
          编辑
        </button>
        <button
          className="btn btn-small btn-ghost btn-danger-text"
          onClick={() => {
            if (confirm('确定删除这条标注吗？')) onDelete(a)
          }}
        >
          删除
        </button>
      </div>
    </div>
  )
}

/** 冲突一方：引文、标签，定位 / 编辑按钮 */
function ConflictSide({
  a,
  active,
  onFocus,
  onEdit,
}: {
  a: Annotation
  active: boolean
  onFocus: (a: Annotation) => void
  onEdit: (a: Annotation) => void
}) {
  return (
    <div className={`conflict-side ${active ? 'conflict-side-active' : ''}`}>
      <div className="conflict-side-head">
        <span className="ann-badge" style={{ backgroundColor: badgeColor(a.id) }} />
        <span className="conflict-side-quote" title={a.quote}>
          {a.quote || <span className="ann-empty-quote">（空引文）</span>}
        </span>
      </div>
      {a.tags.length > 0 && (
        <div className="ann-tags">
          {a.tags.map((t) => (
            <span className="ann-tag" key={t}>
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="conflict-side-actions">
        <button className="btn btn-small btn-ghost" onClick={() => onFocus(a)}>
          定位
        </button>
        <button className="btn btn-small btn-ghost" onClick={() => onEdit(a)}>
          编辑
        </button>
      </div>
    </div>
  )
}

function ConflictCard({
  text,
  item,
  annById,
  activeId,
  onFocus,
  onEdit,
  onFocusOverlap,
  onIgnore,
  onUnignore,
}: {
  text: string
  item: ConflictItem
  annById: Map<string, Annotation>
  activeId: string | null
} & Pick<
  Props,
  'onFocus' | 'onEdit' | 'onFocusOverlap' | 'onIgnore' | 'onUnignore'
>) {
  const a = annById.get(item.annotationIds[0])
  const b = annById.get(item.annotationIds[1])
  if (!a || !b) return null
  const quote = overlapQuote(text, item)

  return (
    <div className={`conflict-item ${item.ignored ? 'conflict-ignored' : ''}`}>
      <div className="conflict-rules">
        {item.rules.map((r) => (
          <span className="conflict-rule-pill" key={r.id}>
            {r.tagA} ⇄ {r.tagB}
          </span>
        ))}
        {item.rules.length > 1 && <span className="conflict-rule-count">命中 {item.rules.length} 条规则</span>}
      </div>

      <div className="conflict-sides">
        <ConflictSide a={a} active={activeId === a.id} onFocus={onFocus} onEdit={onEdit} />
        <div className="conflict-vs">⇄</div>
        <ConflictSide a={b} active={activeId === b.id} onFocus={onFocus} onEdit={onEdit} />
      </div>

      <div className="conflict-overlap">
        <span className="conflict-overlap-label">交叠原文</span>
        <button type="button" className="conflict-overlap-quote" title="定位到交叠处" onClick={() => onFocusOverlap(item)}>
          「{quote}」
        </button>
      </div>

      <div className="conflict-item-actions">
        <span className="form-spacer" />
        {item.ignored ? (
          <button className="btn btn-small btn-ghost" onClick={() => onUnignore(item)}>
            取消忽略
          </button>
        ) : (
          <button className="btn btn-small btn-ghost" onClick={() => onIgnore(item)}>
            忽略此冲突
          </button>
        )}
      </div>
    </div>
  )
}

export const Sidebar = forwardRef<HTMLElement, Props>(function Sidebar(props, sectionRef) {
  const pending = props.annotations
    .filter((a) => a.status === 'pending')
    .sort((x, y) => y.updatedAt - x.updatedAt)
  const bound = props.annotations
    .filter((a) => a.status === 'bound')
    .sort((x, y) => x.start - y.start)

  const activeConflicts = props.conflicts.filter((c) => !c.ignored)
  const ignoredConflicts = props.conflicts.filter((c) => c.ignored)
  const annById = new Map(props.annotations.map((a) => [a.id, a]))

  return (
    <aside className="sidebar">
      {pending.length > 0 && (
        <section className="side-section">
          <h2 className="side-heading side-heading-pending">
            待处理（{pending.length}）
          </h2>
          <p className="side-hint">这些标注无法安全地自动重定位，请在原文中重新选择片段完成绑定。</p>
          {pending.map((a) => (
            <AnnotationItem
              key={a.id}
              a={a}
              active={props.activeId === a.id}
              onFocus={props.onFocus}
              onEdit={props.onEdit}
              onRebindStart={props.onRebindStart}
              onDelete={props.onDelete}
            />
          ))}
        </section>
      )}

      <section className="side-section" ref={sectionRef as React.Ref<HTMLElement>}>
        <div className="side-heading-row">
          <h2 className={`side-heading ${activeConflicts.length > 0 ? 'side-heading-conflict' : ''}`}>
            冲突审阅
            {activeConflicts.length > 0 && <span className="conflict-count-badge">{activeConflicts.length}</span>}
          </h2>
          <button className="btn btn-small btn-ghost" onClick={props.onConfigureRules}>
            {props.conflictRules.length > 0 ? '配置规则' : '配置互斥对'}
          </button>
        </div>

        {props.conflictRules.length === 0 ? (
          <p className="side-hint">
            尚未配置互斥标签对。点击「配置互斥对」添加规则（如 正面 ⇄ 反面），
            之后区间交叠且标签命中同一互斥对的两条已绑定标注会列在这里。
          </p>
        ) : activeConflicts.length === 0 ? (
          <p className="side-hint">
            {props.conflicts.length === 0
              ? '当前没有冲突。只检测已绑定标注之间、区间至少 1 个字符交集且标签命中互斥对的情况。'
              : `全部 ${ignoredConflicts.length} 条冲突均已忽略；标签或规则变化后会自动重新出现。`}
          </p>
        ) : (
          <>
            <p className="side-hint">按交叠起点排序。可定位双方、直接编辑任一标注，或忽略该冲突。</p>
            {activeConflicts.map((c) => (
              <ConflictCard
                key={`${c.annotationIds[0]}/${c.annotationIds[1]}`}
                text={props.text}
                item={c}
                annById={annById}
                activeId={props.activeId}
                onFocus={props.onFocus}
                onEdit={props.onEdit}
                onFocusOverlap={props.onFocusOverlap}
                onIgnore={props.onIgnore}
                onUnignore={props.onUnignore}
              />
            ))}
          </>
        )}

        {ignoredConflicts.length > 0 && (
          <details className="conflict-ignored-fold">
            <summary>已忽略（{ignoredConflicts.length}）</summary>
            {ignoredConflicts.map((c) => (
              <ConflictCard
                key={`${c.annotationIds[0]}/${c.annotationIds[1]}`}
                text={props.text}
                item={c}
                annById={annById}
                activeId={props.activeId}
                onFocus={props.onFocus}
                onEdit={props.onEdit}
                onFocusOverlap={props.onFocusOverlap}
                onIgnore={props.onIgnore}
                onUnignore={props.onUnignore}
              />
            ))}
          </details>
        )}
      </section>

      <section className="side-section">
        <div className="side-heading-row">
          <h2 className="side-heading">标签管理（{props.tagCount}）</h2>
          <button
            className="btn btn-small btn-ghost"
            onClick={props.onRenameTags}
            disabled={props.tagCount === 0}
            title="批量重命名一个标签：同步更新标注、互斥规则与忽略记录"
          >
            标签重命名
          </button>
        </div>
        <p className="side-hint">
          重命名会精确替换所有标注与互斥规则中的标签；同一标注内的重名标签去重保序，
          重复互斥规则按创建时间合并，失效的忽略记录自动清理。
        </p>
      </section>

      <section className="side-section">
        <h2 className="side-heading">
          标注列表（{bound.length}
          {pending.length > 0 ? ` / 共 ${props.annotations.length}` : ''}）
        </h2>
        {bound.length === 0 && pending.length === 0 && (
          <p className="side-hint">在左侧原文中拖选一段文字即可添加标注。同一区间可以保留任意多条标注。</p>
        )}
        {bound.map((a) => (
          <AnnotationItem
            key={a.id}
            a={a}
            active={props.activeId === a.id}
            onFocus={props.onFocus}
            onEdit={props.onEdit}
            onRebindStart={props.onRebindStart}
            onDelete={props.onDelete}
          />
        ))}
      </section>
    </aside>
  )
})
