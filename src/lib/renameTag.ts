// 标签重命名：预览并执行「源标签 → 目标标签」的全局精确替换
//
// 语义（确认后在一次状态更新中应用）：
// - 标注：精确匹配源标签并替换；每条标注内去除重名标签，保留原有先后顺序；
// - 互斥规则：两端同步替换；替换后两侧相同（自互斥）的规则删除；
//   替换后出现无序重复（同一标签对、方向不限）时按 createdAt、再按 id 保留最早一条，
//   其余被合并，被合并规则的 ID 映射到保留规则；
// - 忽略记录：记录中的被合并规则 ID 映射到保留规则，已不存在规则的 ID 剔除；
//   规则集合为空的记录（不再可能对应当前冲突签名）清理，签名相同的记录去重（保留最早）。

import type {
  Annotation,
  ConflictRule,
  DocumentData,
  IgnoredConflict,
} from '../types'
import { ignoredKey, normalizeTag, rulePairKey } from './conflicts'

/** 一条标注在重命名中的标签变化 */
export interface RenameAnnotationChange {
  id: string
  quote: string
  status: Annotation['status']
  before: string[]
  after: string[]
}

/** 一条互斥规则在重命名中的去向 */
export interface RenameRuleChange {
  id: string
  before: { tagA: string; tagB: string }
  /** 替换后的标签对；自互斥规则为 null（将被删除） */
  after: { tagA: string; tagB: string } | null
  /** kept：保留；merged：因无序重复被合并；deleted：自互斥删除 */
  fate: 'kept' | 'merged' | 'deleted'
  /** fate 为 merged 时指向保留规则的 ID */
  mergedInto?: string
}

/** 重命名计划：既用于提交前预览，也承载确认后一次写入的结果 */
export interface RenamePlan {
  source: string
  target: string
  /** 标签将被改动的标注 */
  annotationChanges: RenameAnnotationChange[]
  /** 受影响的互斥规则（含源标签，或因重复被合并 / 自互斥被删） */
  ruleChanges: RenameRuleChange[]
  /** 因无序重复被合并的规则数量 */
  mergedRuleCount: number
  /** 因自互斥被删除的规则数量 */
  deletedRuleCount: number
  /** 规则 ID 被迁移 / 剔除的忽略记录数量 */
  ignoredRemappedCount: number
  /** 不再可能对应任何冲突签名而被清理的忽略记录数量 */
  ignoredDroppedCount: number
  /** 应用后的完整状态（确认时一次写入） */
  nextAnnotations: Annotation[]
  nextRules: ConflictRule[]
  nextIgnored: IgnoredConflict[]
}

/** 在一条标签数组中精确替换源标签，去除重名并保持原顺序 */
export function renameInTags(
  tags: string[],
  source: string,
  target: string,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const next = t === source ? target : t
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }
  return out
}

/** 规则排序：createdAt 升序，并列按 id 字典序（重复组合并时取最早一条） */
function byEarliest(a: ConflictRule, b: ConflictRule): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * 计算重命名计划（纯函数，不修改传入数据）。
 * 源 / 目标标签归一化后为空或相同（无实际变化）时返回 null。
 */
export function planTagRename(
  doc: Pick<DocumentData, 'annotations' | 'conflictRules' | 'ignoredConflicts'>,
  sourceRaw: string,
  targetRaw: string,
  now: number = Date.now(),
): RenamePlan | null {
  const source = normalizeTag(sourceRaw)
  const target = normalizeTag(targetRaw)
  if (!source || !target || source === target) return null

  // ---- 标注：精确替换 + 标注内去重保序 ----
  const annotationChanges: RenameAnnotationChange[] = []
  const nextAnnotations = doc.annotations.map((a) => {
    if (!a.tags.includes(source)) return a
    const tags = renameInTags(a.tags, source, target)
    annotationChanges.push({
      id: a.id,
      quote: a.quote,
      status: a.status,
      before: a.tags,
      after: tags,
    })
    return { ...a, tags, updatedAt: now }
  })

  // ---- 规则：两端同步替换 ----
  const replaced = doc.conflictRules.map((r) =>
    r.tagA === source || r.tagB === source
      ? {
          ...r,
          tagA: r.tagA === source ? target : r.tagA,
          tagB: r.tagB === source ? target : r.tagB,
        }
      : r,
  )

  // 自互斥（替换后两侧相同）删除
  const deletedIds = new Set<string>()
  const survivors: ConflictRule[] = []
  for (const r of replaced) {
    if (r.tagA === r.tagB) deletedIds.add(r.id)
    else survivors.push(r)
  }

  // 无序重复：按 createdAt、id 保留最早一条，其余并入保留规则
  const mergedInto = new Map<string, string>()
  const groups = new Map<string, ConflictRule[]>()
  for (const r of survivors) {
    const key = rulePairKey(r)
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  const keptIds = new Set<string>()
  for (const g of groups.values()) {
    const sorted = [...g].sort(byEarliest)
    keptIds.add(sorted[0].id)
    for (let i = 1; i < sorted.length; i++) {
      mergedInto.set(sorted[i].id, sorted[0].id)
    }
  }
  const nextRules = survivors.filter((r) => keptIds.has(r.id))

  // 受影响规则：含源标签，或因重复被合并 / 自互斥被删
  const ruleChanges: RenameRuleChange[] = []
  for (let i = 0; i < doc.conflictRules.length; i++) {
    const before = doc.conflictRules[i]
    const after = replaced[i]
    const fate: RenameRuleChange['fate'] = deletedIds.has(before.id)
      ? 'deleted'
      : mergedInto.has(before.id)
        ? 'merged'
        : 'kept'
    const touched =
      before.tagA === source || before.tagB === source || fate !== 'kept'
    if (!touched) continue
    ruleChanges.push({
      id: before.id,
      before: { tagA: before.tagA, tagB: before.tagB },
      after: fate === 'deleted' ? null : { tagA: after.tagA, tagB: after.tagB },
      fate,
      mergedInto: mergedInto.get(before.id),
    })
  }

  // ---- 忽略记录：映射被合并 ID、剔除已不存在规则、清理空签名并去重 ----
  const finalRuleIds = new Set(nextRules.map((r) => r.id))
  const annotationIds = new Set(nextAnnotations.map((a) => a.id))
  let ignoredRemappedCount = 0
  let ignoredDroppedCount = 0
  const seenKeys = new Set<string>()
  const nextIgnored: IgnoredConflict[] = []
  // 按创建时间升序处理：签名坍缩相同时保留最早一条
  const ordered = [...doc.ignoredConflicts].sort(
    (x, y) => x.createdAt - y.createdAt,
  )
  for (const rec of ordered) {
    const [a1, a2] = rec.annotationIds
    if (!annotationIds.has(a1) || !annotationIds.has(a2)) {
      ignoredDroppedCount++
      continue
    }
    const mapped = [
      ...new Set(
        rec.ruleIds
          .map((id) => mergedInto.get(id) ?? id)
          .filter((id) => finalRuleIds.has(id)),
      ),
    ].sort()
    if (mapped.length === 0) {
      // 引用的规则全部失效 → 不再可能对应当前冲突签名
      ignoredDroppedCount++
      continue
    }
    const key = ignoredKey(rec.annotationIds, mapped)
    if (seenKeys.has(key)) {
      ignoredDroppedCount++
      continue
    }
    seenKeys.add(key)
    const sortedBefore = [...rec.ruleIds].sort()
    const changed =
      mapped.length !== sortedBefore.length ||
      mapped.some((id, i) => id !== sortedBefore[i])
    if (changed) ignoredRemappedCount++
    nextIgnored.push({
      annotationIds: rec.annotationIds,
      ruleIds: mapped,
      createdAt: rec.createdAt,
    })
  }

  return {
    source,
    target,
    annotationChanges,
    ruleChanges,
    mergedRuleCount: mergedInto.size,
    deletedRuleCount: deletedIds.size,
    ignoredRemappedCount,
    ignoredDroppedCount,
    nextAnnotations,
    nextRules,
    nextIgnored,
  }
}
