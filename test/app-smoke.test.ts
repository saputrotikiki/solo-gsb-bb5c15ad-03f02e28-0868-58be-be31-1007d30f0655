import assert from 'node:assert'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
;(globalThis as unknown as { window: typeof window }).window = window
;(globalThis as unknown as { document: Document }).document = window.document
;(globalThis as unknown as { navigator: Navigator }).navigator = window.navigator
;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
  window.HTMLElement
;(globalThis as unknown as { Element: typeof Element }).Element = window.Element
;(globalThis as unknown as { Node: typeof Node }).Node = window.Node
;(globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter =
  window.NodeFilter
;(globalThis as unknown as { getSelection: typeof window.getSelection }).getSelection =
  window.getSelection.bind(window)
;(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
  ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown) as typeof requestAnimationFrame
;(globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
  ((id: number) => clearTimeout(id) as unknown) as typeof cancelAnimationFrame
;(globalThis as unknown as { localStorage: Storage }).localStorage = window.localStorage

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('../src/App')

const container = document.getElementById('root')!
const root = createRoot(container)

await new Promise<void>((resolve) => {
  root.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html = container.innerHTML
assert.ok(html.includes('原文锚点标注台'), '顶栏标题应渲染')
assert.ok(html.includes('粘贴'), '空文档应显示粘贴入口')
console.log('  ✓ 空文档首次渲染成功（编辑模式）')

// 模拟已保存文档 + 一条 pending 标注的渲染路径
const saved = {
  title: '测试文档',
  text: '这是一段用于渲染冒烟测试的原文，包含【重点片段】和普通文字。'.repeat(3),
  updatedAt: Date.now(),
  annotations: [
    {
      id: 'a_bound',
      quote: '重点片段',
      start: 0,
      end: 4,
      note: '备注一',
      tags: ['重点', '测试'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '】和普通文字。',
    },
    {
      id: 'a_pending',
      quote: '已删除的引文XYZ',
      start: 100,
      end: 110,
      note: '',
      tags: [],
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '前文',
      contextAfter: '后文',
      pendingReason: '原文中已找不到该引文，需要手动重新选择',
    },
  ],
}
// start/end 对齐到真实位置，避免高亮错位
saved.annotations[0].start = saved.text.indexOf('重点片段') - 1
saved.annotations[0].end = saved.annotations[0].start + 6

localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(saved))
// 重新挂载，让 App 从 localStorage 读取初始状态
root.unmount()
const container2 = document.createElement('div')
container2.id = 'root2'
document.body.appendChild(container2)
const root2 = createRoot(container2)

await new Promise<void>((resolve) => {
  root2.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html2 = container2.innerHTML
assert.ok(html2.includes('测试文档'), '应显示文档标题')
assert.ok(html2.includes('待处理'), '应渲染待处理分区')
assert.ok(html2.includes('重新选择片段'), 'pending 标注应有重绑按钮')
assert.ok(html2.includes('备注一'), '应渲染备注')
assert.ok(html2.includes('#重点'), '应渲染标签')
console.log('  ✓ 含 bound/pending 标注的文档渲染成功')

// 第三个场景：互斥规则 + 一对冲突标注 + 一条已忽略冲突
const conflictText = '甲乙丙丁戊己庚辛壬癸'.repeat(6)
const pos1 = conflictText.indexOf('丁戊')
const pos2 = conflictText.indexOf('戊己') // 与上一区间在「戊」上交叠
const savedConflicts = {
  title: '冲突文档',
  text: conflictText,
  updatedAt: Date.now(),
  annotations: [
    {
      id: 'c_pos',
      quote: conflictText.slice(pos1, pos1 + 2),
      start: pos1,
      end: pos1 + 2,
      note: '',
      tags: ['正面'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
    {
      id: 'c_neg',
      quote: conflictText.slice(pos2, pos2 + 2),
      start: pos2,
      end: pos2 + 2,
      note: '',
      tags: ['反面'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
    {
      id: 'c_ig1',
      quote: conflictText.slice(0, 3),
      start: 0,
      end: 3,
      note: '',
      tags: ['褒义'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
    {
      id: 'c_ig2',
      quote: conflictText.slice(1, 4),
      start: 1,
      end: 4,
      note: '',
      tags: ['贬义'],
      status: 'bound',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextBefore: '',
      contextAfter: '',
    },
  ],
  conflictRules: [
    { id: 'rule_pn', tagA: '正面', tagB: '反面', createdAt: Date.now() },
    { id: 'rule_bd', tagA: '褒义', tagB: '贬义', createdAt: Date.now() },
  ],
  ignoredConflicts: [
    { annotationIds: ['c_ig1', 'c_ig2'], ruleIds: ['rule_bd'], createdAt: Date.now() },
  ],
}

localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(savedConflicts))
root2.unmount()
const container3 = document.createElement('div')
container3.id = 'root3'
document.body.appendChild(container3)
const root3 = createRoot(container3)

await new Promise<void>((resolve) => {
  root3.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html3 = container3.innerHTML
assert.ok(html3.includes('冲突审阅'), '应渲染冲突审阅分区')
assert.ok(html3.includes('正面 ⇄ 反面'), '应列出冲突命中的规则')
assert.ok(html3.includes('交叠原文'), '应展示交叠原文')
assert.ok(html3.includes('忽略此冲突'), '应提供忽略操作')
assert.ok(html3.includes('已忽略（1）'), '已忽略冲突折叠区应计数')
assert.ok(html3.includes('hl-conflict'), '未忽略冲突的交叠段应有冲突高亮类')
assert.ok(html3.includes('冲突审阅'), '顶栏应出现冲突审阅入口')
console.log('  ✓ 冲突审阅面板（含忽略折叠与交叠高亮）渲染成功')

// 旧版数据（无 conflictRules / ignoredConflicts 字段）应无损加载
const legacy = {
  title: '旧文档',
  text: '一二三四五六',
  updatedAt: Date.now(),
  annotations: [],
}
localStorage.setItem('anchor-annotation-console:v1', JSON.stringify(legacy))
root3.unmount()
const container4 = document.createElement('div')
container4.id = 'root4'
document.body.appendChild(container4)
const root4 = createRoot(container4)

await new Promise<void>((resolve) => {
  root4.render(
    React.createElement(React.StrictMode, null, React.createElement(App)),
  )
  setTimeout(resolve, 100)
})

const html4 = container4.innerHTML
assert.ok(html4.includes('旧文档'), '旧版数据应正常加载标题')
assert.ok(html4.includes('冲突审阅'), '旧版数据应补出冲突审阅分区')
assert.ok(html4.includes('尚未配置互斥标签对'), '旧版数据应显示未配置规则提示')
// 保存回 localStorage 时应自动补齐新字段且不破坏原有数据
const reparsed = JSON.parse(localStorage.getItem('anchor-annotation-console:v1')!)
assert.ok(Array.isArray(reparsed.conflictRules) && reparsed.conflictRules.length === 0)
assert.ok(Array.isArray(reparsed.ignoredConflicts) && reparsed.ignoredConflicts.length === 0)
assert.strictEqual(reparsed.text, '一二三四五六')
console.log('  ✓ 旧数据无损兼容并自动补齐冲突字段')

root4.unmount()
container4.remove()
container3.remove()
console.log('\n全部渲染冒烟测试通过')
