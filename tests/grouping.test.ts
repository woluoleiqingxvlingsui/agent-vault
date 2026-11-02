import { describe, expect, it } from 'vitest'
import { effectiveProjectId, resolveAutoProjectId } from '../src/main/domain/grouping'

const projects = [
  { id: 'p-root', rootPath: 'C:\\Users\\tester' },
  { id: 'p-deep', rootPath: 'C:\\Users\\tester\\code\\demo' },
  { id: 'p-other', rootPath: 'D:\\other' }
]

describe('自动归组：路径最长匹配', () => {
  it('命中唯一的项目根目录', () => {
    expect(resolveAutoProjectId(['C:\\Users\\tester\\other'], projects)).toBe('p-root')
  })

  it('候选路径恰好等于项目根目录时命中该项目', () => {
    expect(resolveAutoProjectId(['C:\\Users\\tester\\code\\demo'], projects)).toBe('p-deep')
  })

  it('多个项目匹配时取路径最长的项目', () => {
    expect(resolveAutoProjectId(['C:\\Users\\tester\\code\\demo\\src'], projects)).toBe('p-deep')
  })

  it('仅前缀相同但不是子路径时不匹配', () => {
    expect(resolveAutoProjectId(['C:\\Users\\testerX\\code'], projects)).toBeNull()
  })

  it('无法匹配时返回 null（进入未分组）', () => {
    expect(resolveAutoProjectId(['E:\\elsewhere'], projects)).toBeNull()
  })

  it('多个候选路径时取其中匹配最深的', () => {
    expect(resolveAutoProjectId(['C:\\Users\\tester\\other', 'C:\\Users\\tester\\code\\demo\\x'], projects)).toBe(
      'p-deep'
    )
  })

  it('大小写不敏感', () => {
    expect(resolveAutoProjectId(['c:\\users\\TESTER\\code\\demo'], projects)).toBe('p-deep')
  })
})

describe('手动覆盖优先于自动归组', () => {
  it('手动指定时使用手动项目', () => {
    expect(effectiveProjectId('p-root', 'p-other')).toBe('p-other')
  })

  it('无手动覆盖时使用自动归组', () => {
    expect(effectiveProjectId('p-root', null)).toBe('p-root')
  })

  it('强制未分组时覆盖自动归组（空串表示强制未分组，结果为 null）', () => {
    expect(effectiveProjectId('p-root', '')).toBeNull()
  })
})
