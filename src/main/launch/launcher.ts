import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { LaunchResult } from '../../shared/types'
import { resolveFromPath } from '../adapters/registry'

export interface LaunchRequest {
  protocol: 'exec' | 'appsfolder'
  command: string
  args: string[]
  cwd: string
  /** project 类型：用资源管理器打开目录 */
  asDirectory?: boolean
  /** cli 类型：尝试用 Windows Terminal 拉起独立控制台 */
  useTerminal?: boolean
}

const EXE_EXT = new Set(['.exe', '.com', '.bat', '.cmd'])

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * 解析要执行的程序：
 * - 绝对路径：必须存在
 * - 相对命令名：在 PATH 中查找
 */
export function resolveExecutable(command: string): { ok: true; file: string } | { ok: false; reason: string } {
  const trimmed = command.trim()
  if (!trimmed) return { ok: false, reason: '启动命令为空' }
  if (path.isAbsolute(trimmed)) {
    if (!existsSync(trimmed)) return { ok: false, reason: `找不到程序：${trimmed}` }
    return { ok: true, file: trimmed }
  }
  const found = resolveFromPath(trimmed)
  if (!found) return { ok: false, reason: `在 PATH 中找不到程序：${trimmed}` }
  return { ok: true, file: found }
}

/** cmd.exe 参数转义：整体加双引号，内部双引号翻倍 */
function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * 启动外部程序。
 *
 * 安全约束：
 *  - 始终使用「程序路径 + 参数数组 + 明确工作目录」；
 *  - 不启用 shell（spawn 的 shell 选项保持 false）；
 *  - .cmd/.bat 交给 cmd.exe 执行前逐项加引号，参数里的 & | > ^ 不会被当操作符；
 *  - .js 脚本通过 node 执行。
 */
export async function launch(req: LaunchRequest): Promise<LaunchResult> {
  if (req.protocol === 'appsfolder') {
    return launchAppFolder(req.command)
  }

  const cwd = req.cwd?.trim()
  if (cwd) {
    if (!existsSync(cwd)) return { ok: false, message: `工作目录不存在：${cwd}` }
    if (!isDirectory(cwd)) return { ok: false, message: `工作目录不是文件夹：${cwd}` }
  }

  if (req.asDirectory) {
    return launchDirectory(req.command, cwd)
  }

  const resolved = resolveExecutable(req.command)
  if (!resolved.ok) return { ok: false, message: resolved.reason }
  const file = resolved.file
  const ext = path.extname(file).toLowerCase()

  let program = file
  let args = [...req.args]
  // .cmd/.bat 需要关掉 Node 的参数转义，原因见下
  let verbatim = false

  if (ext === '.cmd' || ext === '.bat') {
    // cmd.exe 会把 /c 之后的内容当作一条命令重新解析，
    // 因此每个路径和参数都单独加引号：引号内的 & | > ^ 不会被当成操作符。
    program = process.env.ComSpec ?? 'cmd.exe'
    const quoted = [file, ...req.args].map(quoteForCmd).join(' ')
    // 外层再包一层引号，配合 /s 让 cmd 只剥掉最外层这一对。
    args = ['/d', '/s', '/c', `"${quoted}"`]
    // 必须开 windowsVerbatimArguments：否则 Node 会把上面这些引号转义成 \"，
    // cmd 拿到带反斜杠的名字会报「不是内部或外部命令」，.cmd/.bat 就永远启动不了。
    verbatim = true
  } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const nodeExe = resolveFromPath('node')
    if (!nodeExe) return { ok: false, message: '未找到 node.exe，无法执行 JS 脚本入口' }
    program = nodeExe
    args = [file, ...req.args]
  }

  if (req.useTerminal) {
    return launchInTerminal(program, args, cwd, req.command, verbatim)
  }

  return spawnDetached(program, args, cwd, req.command, verbatim)
}

/** 用 Windows Terminal 打开独立控制台窗口（argv 数组，不经过 shell 解析） */
async function launchInTerminal(
  program: string,
  args: string[],
  cwd: string | undefined,
  display: string,
  verbatim: boolean
): Promise<LaunchResult> {
  const wt = resolveFromPath('wt')
  if (!wt) return spawnDetached(program, args, cwd, display, verbatim)
  // wt 把逗号当作目录分隔符，路径含逗号时退回普通启动，避免落到错误目录
  if (cwd && cwd.includes(',')) {
    return spawnDetached(program, args, cwd, display, verbatim)
  }
  // wt 的第一个位置参数是「要运行的命令」，起始目录必须用 -d 指定，
  // 否则工作目录会被当成可执行程序去执行。
  const wtArgs = cwd ? ['-d', cwd, program, ...args] : [program, ...args]
  try {
    const child = spawn(wt, wtArgs, {
      cwd: cwd || undefined,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
      windowsVerbatimArguments: verbatim
    })
    child.unref()
    return { ok: true, message: `已在 Windows Terminal 中启动：${path.basename(display)}`, pid: child.pid }
  } catch (err) {
    return { ok: false, message: `启动失败：${(err as Error).message}` }
  }
}

async function spawnDetached(
  program: string,
  args: string[],
  cwd: string | undefined,
  display: string,
  verbatim = false
): Promise<LaunchResult> {
  return new Promise<LaunchResult>((resolve) => {
    let settled = false
    let stderr = ''
    let stdout = ''
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(program, args, {
        cwd: cwd || undefined,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: verbatim
      })
    } catch (err) {
      resolve({ ok: false, message: `启动失败：${(err as Error).message}` })
      return
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.unref()
      resolve({ ok: true, message: `已启动：${display}`, pid: child.pid })
    }, 1200)

    child.stdout?.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === 'ENOENT') resolve({ ok: false, message: `找不到程序：${display}` })
      else if (err.code === 'EACCES') resolve({ ok: false, message: `没有权限执行：${display}` })
      else resolve({ ok: false, message: `启动失败：${err.message}` })
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({ ok: true, message: `已启动并正常退出：${display}`, pid: child.pid })
      } else {
        const detail = (stderr || stdout).trim().split('\n').slice(0, 3).join(' ')
        resolve({
          ok: false,
          message: `启动失败（退出码 ${code}）${detail ? `：${detail}` : ''}`
        })
      }
    })
  })
}

async function launchDirectory(dir: string, cwd: string | undefined): Promise<LaunchResult> {
  const target = dir.trim()
  if (!target) return { ok: false, message: '目录路径为空' }
  if (!existsSync(target)) return { ok: false, message: `目录不存在：${target}` }
  if (!isDirectory(target)) return { ok: false, message: `不是文件夹：${target}` }
  const explorer = path.join(process.env.WINDIR ?? 'C:\\Windows', 'explorer.exe')
  try {
    const child = spawn(explorer, [target], {
      cwd: cwd || undefined,
      detached: true,
      stdio: 'ignore',
      shell: false
    })
    child.unref()
    return { ok: true, message: `已在资源管理器中打开：${target}`, pid: child.pid }
  } catch (err) {
    return { ok: false, message: `打开目录失败：${(err as Error).message}` }
  }
}

/** 通过 shell:AppsFolder 启动 MSIX 应用 */
async function launchAppFolder(aumid: string): Promise<LaunchResult> {
  const trimmed = aumid.trim()
  if (!trimmed) return { ok: false, message: '应用 ID 为空' }
  if (!trimmed.includes('!')) {
    return { ok: false, message: `应用 ID 格式不正确（应为 包名!应用名）：${trimmed}` }
  }
  try {
    const { shell } = await import('electron')
    await shell.openExternal(`shell:AppsFolder\\${trimmed}`)
    return { ok: true, message: `已请求启动应用：${trimmed}` }
  } catch (err) {
    return { ok: false, message: `启动应用失败：${(err as Error).message}` }
  }
}
