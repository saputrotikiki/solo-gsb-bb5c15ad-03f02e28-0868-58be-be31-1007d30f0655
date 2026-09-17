import assert from 'node:assert'
import { planTagRename, renameInTags } from '../src/lib/renameTag'
import { detectConflicts } from '../src/lib/conflicts'
import type { Annotation, ConflictRule, IgnoredConflict } from '../src/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

let seq = 0
function ann(tags: string[], id?: string): Annotation {
  seq += 1
  return {
    id: id ?? `a${seq}`,
    quote: `引文${seq}`,
    start: 0,
    end: 5,
    note: '',
    tags,
    status: 'bound',
    createdAt: 0,
    updatedAt: 0,
    contextBefore: '',
    contextAfter: '',
  }
}

function rule(id: string, tagA: string, tagB: string, createdAt: number): ConflictRule {
  return { id, tagA, tagB, createdAt }
}

function docOf(parts: {
  annotations?: Annotation[]
  conflictRules?: ConflictRule[]
  ignoredConflicts?: IgnoredConflict[]
}) {
  return {
    annotations: parts.annotations ?? [],
    conflictRules: parts.conflictRules ?? [],
    ignoredConflicts: parts.ignoredConflicts ?? [],
  }
}

// 1. renameInTags：精确替换、去重并保持原顺序
check('renameInTags：精确替换、去重并保持原顺序', () => {
  assert.deepStrictEqual(renameInTags(['a', 'b', 'c'], 'a', 'x'), ['x', 'b', 'c'])
  // 目标标签已存在 → 去重，保留原有先后顺序
  assert.deepStrictEqual(renameInTags(['x', 'a', 'b'], 'a', 'x'), ['x', 'b'])
  // 标注内原有重名标签一并去除
  assert.deepStrictEqual(renameInTags(['a', 'a', 'b'], 'a', 'x'), ['x', 'b'])
  // 不含源标签时不变
  assert.deepStrictEqual(renameInTags(['b', 'c'], 'a', 'x'), ['b', 'c'])
})

// 2. 无效输入返回 null
check('无效输入返回 null（空 / 相同 / 归一化后相同）', () => {
  const d = docOf({})
  assert.strictEqual(planTagRename(d, '', 'x'), null)
  assert.strictEqual(planTagRename(d, 'x', ''), null)
  assert.strictEqual(planTagRename(d, 'x', 'x'), null)
  assert.strictEqual(planTagRename(d, 'x', '#x'), null)
  assert.strictEqual(planTagRename(d, ' x ', 'x'), null)
})

// 3. 标注：精确替换，未受影响标注保持原引用
check('标注：精确替换源标签，未受影响标注保持原引用', () => {
  const a1 = ann(['pos', '中立'], 'a1')
  const a2 = ann(['其他'], 'a2')
  const plan = planTagRename(docOf({ annotations: [a1, a2] }), 'pos', '正面', 1000)!
  assert.deepStrictEqual(plan.nextAnnotations[0].tags, ['正面', '中立'])
  assert.strictEqual(plan.nextAnnotations[0].updatedAt, 1000)
  assert.strictEqual(plan.nextAnnotations[1], a2)
  assert.strictEqual(plan.annotationChanges.length, 1)
  assert.deepStrictEqual(plan.annotationChanges[0].before, ['pos', '中立'])
  assert.deepStrictEqual(plan.annotationChanges[0].after, ['正面', '中立'])
})

// 4. 标注：目标标签已存在于同一标注 → 去重保序
check('标注：目标标签已存在时去重并保持原顺序', () => {
  const a1 = ann(['正面', 'pos', '中立'], 'a1')
  const plan = planTagRename(docOf({ annotations: [a1] }), 'pos', '正面')!
  assert.deepStrictEqual(plan.nextAnnotations[0].tags, ['正面', '中立'])
})

// 5. 规则：两端同步替换
check('规则：两端同步替换', () => {
  const rules = [rule('r1', 'pos', '反面', 1), rule('r2', '褒义', 'pos', 2)]
  const plan = planTagRename(docOf({ conflictRules: rules }), 'pos', '正面')!
  assert.deepStrictEqual(plan.nextRules, [
    { id: 'r1', tagA: '正面', tagB: '反面', createdAt: 1 },
    { id: 'r2', tagA: '褒义', tagB: '正面', createdAt: 2 },
  ])
  assert.strictEqual(plan.mergedRuleCount, 0)
  assert.strictEqual(plan.deletedRuleCount, 0)
  assert.deepStrictEqual(
    plan.ruleChanges.map((c) => c.id),
    ['r1', 'r2'],
  )
})

// 6. 规则：替换后自互斥的规则被删除
check('规则：替换后自互斥的规则被删除', () => {
  const rules = [rule('r1', 'pos', '正面', 1), rule('r2', '褒义', '贬义', 2)]
  const plan = planTagRename(docOf({ conflictRules: rules }), 'pos', '正面')!
  assert.deepStrictEqual(
    plan.nextRules.map((r) => r.id),
    ['r2'],
  )
  assert.strictEqual(plan.deletedRuleCount, 1)
  const change = plan.ruleChanges.find((c) => c.id === 'r1')!
  assert.strictEqual(change.fate, 'deleted')
  assert.strictEqual(change.after, null)
})

// 7. 规则：无序重复按 createdAt 保留最早一条，其余合并（不含源标签的规则也可能被合并）
check('规则：无序重复按 createdAt 保留最早一条，其余合并', () => {
  // r2 重命名后与 r1 同对；r2 创建更早 → 保留 r2，r1 被合并
  const rules = [rule('r1', '正面', '反面', 10), rule('r2', 'pos', '反面', 5)]
  const plan = planTagRename(docOf({ conflictRules: rules }), 'pos', '正面')!
  assert.deepStrictEqual(
    plan.nextRules.map((r) => r.id),
    ['r2'],
  )
  assert.strictEqual(plan.mergedRuleCount, 1)
  const merged = plan.ruleChanges.find((c) => c.id === 'r1')!
  assert.strictEqual(merged.fate, 'merged')
  assert.strictEqual(merged.mergedInto, 'r2')
  // 方向相反也算同一标签对
  const rules2 = [rule('r1', '反面', '正面', 1), rule('r2', 'pos', '反面', 2)]
  const plan2 = planTagRename(docOf({ conflictRules: rules2 }), 'pos', '正面')!
  assert.deepStrictEqual(
    plan2.nextRules.map((r) => r.id),
    ['r1'],
  )
})

// 8. 规则：createdAt 并列时按 id 保留
check('规则：createdAt 并列时按 id 保留最早一条', () => {
  const rules = [rule('rb', 'pos', '反面', 5), rule('ra', '正面', '反面', 5)]
  const plan = planTagRename(docOf({ conflictRules: rules }), 'pos', '正面')!
  assert.deepStrictEqual(
    plan.nextRules.map((r) => r.id),
    ['ra'],
  )
  assert.strictEqual(plan.ruleChanges.find((c) => c.id === 'rb')!.mergedInto, 'ra')
})

// 9. 规则：保留规则维持原有相对顺序
check('规则：保留规则维持原有顺序', () => {
  const rules = [
    rule('r1', '甲', '乙', 1),
    rule('r2', 'pos', '丙', 2),
    rule('r3', '丁', '戊', 3),
  ]
  const plan = planTagRename(docOf({ conflictRules: rules }), 'pos', '正面')!
  assert.deepStrictEqual(
    plan.nextRules.map((r) => r.id),
    ['r1', 'r2', 'r3'],
  )
})

// 10. 忽略记录：被合并规则 ID 映射到保留规则
check('忽略记录：被合并规则 ID 映射到保留规则', () => {
  const rules = [rule('r1', '正面', '反面', 10), rule('r2', 'pos', '反面', 5)]
  const ignored: IgnoredConflict[] = [
    { annotationIds: ['x', 'y'], ruleIds: ['r1'], createdAt: 1 },
  ]
  const anns = [ann(['正面'], 'x'), ann(['反面'], 'y')]
  const plan = planTagRename(
    docOf({ annotations: anns, conflictRules: rules, ignoredConflicts: ignored }),
    'pos',
    '正面',
  )!
  assert.deepStrictEqual(plan.nextIgnored, [
    { annotationIds: ['x', 'y'], ruleIds: ['r2'], createdAt: 1 },
  ])
  assert.strictEqual(plan.ignoredRemappedCount, 1)
  assert.strictEqual(plan.ignoredDroppedCount, 0)
})

// 11. 忽略记录：引用规则全部失效（自互斥删除）→ 记录清理
check('忽略记录：规则集合被清空的记录被清理', () => {
  const rules = [rule('r1', 'pos', '正面', 1)]
  const ignored: IgnoredConflict[] = [
    { annotationIds: ['x', 'y'], ruleIds: ['r1'], createdAt: 1 },
  ]
  const anns = [ann(['pos'], 'x'), ann(['正面'], 'y')]
  const plan = planTagRename(
    docOf({ annotations: anns, conflictRules: rules, ignoredConflicts: ignored }),
    'pos',
    '正面',
  )!
  assert.strictEqual(plan.nextIgnored.length, 0)
  assert.strictEqual(plan.ignoredDroppedCount, 1)
})

// 12. 忽略记录：部分规则被删 → 集合缩减但记录保留
check('忽略记录：部分规则失效时集合缩减但记录保留', () => {
  const rules = [rule('r1', 'pos', '正面', 1), rule('r2', '褒义', '贬义', 2)]
  const ignored: IgnoredConflict[] = [
    { annotationIds: ['x', 'y'], ruleIds: ['r1', 'r2'], createdAt: 1 },
  ]
 // r1 替换后自互斥被删，r2 保留
  const anns = [ann(['pos', '褒义'], 'x'), ann(['正面', '贬义'], 'y')]
  const plan = planTagRename(
    docOf({ annotations: anns, conflictRules: rules, ignoredConflicts: ignored }),
    'pos',
    '正面',
  )!
  assert.deepStrictEqual(plan.nextIgnored[0].ruleIds, ['r2'])
  assert.strictEqual(plan.ignoredRemappedCount, 1)
  assert.strictEqual(plan.ignoredDroppedCount, 0)
})

// 13. 忽略记录：映射后签名相同的记录去重（保留最早一条）
check('忽略记录：映射后签名坍缩的记录去重并保留最早', () => {
  // r1（正面⇄反面）与 r2（pos→正面 ⇄ 反面）重复：保留 r1，r2 并入 r1
  const rules = [rule('r1', '正面', '反面', 1), rule('r2', 'pos', '反面', 2)]
  const ignored: IgnoredConflict[] = [
    { annotationIds: ['x', 'y'], ruleIds: ['r2'], createdAt: 5 },
    { annotationIds: ['x', 'y'], ruleIds: ['r1'], createdAt: 3 },
  ]
  const anns = [ann(['正面'], 'x'), ann(['反面'], 'y')]
  const plan = planTagRename(
    docOf({ annotations: anns, conflictRules: rules, ignoredConflicts: ignored }),
    'pos',
    '正面',
  )!
  assert.strictEqual(plan.nextIgnored.length, 1)
  assert.deepStrictEqual(plan.nextIgnored[0].ruleIds, ['r1'])
  assert.strictEqual(plan.nextIgnored[0].createdAt, 3)
  assert.strictEqual(plan.ignoredDroppedCount, 1)
})

// 14. 端到端：重命名后已忽略冲突（经 ID 映射）仍然生效
check('端到端：重命名后已忽略冲突经映射仍然生效', () => {
  const rules = [rule('r1', '正面', '反面', 10), rule('r2', 'pos', '反面', 5)]
  const x = ann(['正面'], 'x')
  const y = ann(['反面'], 'y')
  const ignored: IgnoredConflict[] = [
    { annotationIds: ['x', 'y'], ruleIds: ['r1'], createdAt: 1 },
  ]
  const plan = planTagRename(
    docOf({ annotations: [x, y], conflictRules: rules, ignoredConflicts: ignored }),
    'pos',
    '正面',
  )!
  const cs = detectConflicts(plan.nextAnnotations, plan.nextRules, plan.nextIgnored)
  assert.strictEqual(cs.length, 1)
  assert.deepStrictEqual(
    cs[0].rules.map((r) => r.id),
    ['r2'],
  )
  assert.strictEqual(cs[0].ignored, true)
})

// 15. 纯函数：不修改传入数据（取消预览等价于无任何改动）
check('planTagRename 不修改传入数据（纯函数）', () => {
  const a1 = ann(['pos', '正面'], 'a1')
  const rules = [rule('r1', 'pos', '反面', 1)]
  const ignored: IgnoredConflict[] = [
    { annotationIds: ['a1', 'a2'], ruleIds: ['r1'], createdAt: 1 },
  ]
  const d = docOf({ annotations: [a1], conflictRules: rules, ignoredConflicts: ignored })
  const snapshot = JSON.stringify(d)
  planTagRename(d, 'pos', '正面')
  assert.strictEqual(JSON.stringify(d), snapshot)
})

console.log(`\n全部 ${passed} 项通过`)
