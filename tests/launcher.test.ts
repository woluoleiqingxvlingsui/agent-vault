import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, resolveExecutable } from '../src/main/launch/launcher'

describe('启动器：可执行文件解析', () => {
  it('空命令给出明确错误', () => {
    const result = resolveExecutable('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('为空')
  })

  it('绝对路径不存在时给出明确错误', () => {
    const result = resolveExecutable('C:\\definitely\\not\\exists.exe')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('找不到程序')
  })

  it('PATH 中不存在的命令给出明确错误', () => {
    const result = resolveExecutable('definitely-not-a-real-command-xyz')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('PATH')
  })

  it('能够解析 PATH 中的系统命令', () => {
    const result = resolveExecutable('cmd')
    expect(result.ok).toBe(true)
  })
})

// 回归：.cmd/.bat 必须由 cmd.exe 执行，早先因为 Node 把引号转义成 \" 导致必然失败
describe('启动器：.cmd/.bat 入口', () => {
  it('能够真正启动 .cmd 文件', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-cmd-'))
    const file = path.join(dir, 'probe.cmd')
    await fs.writeFile(file, '@echo off\r\nexit /b 0\r\n', 'utf8')
    try {
      const result = await launch({
        protocol: 'exec',
        command: file,
        args: [],
        cwd: dir
      })
      expect(result.ok, result.message).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }, 15_000)
})
