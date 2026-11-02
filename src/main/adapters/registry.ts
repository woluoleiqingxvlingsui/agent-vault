import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentAdapter, AgentLaunchConfig } from './types'
import { createQoderSqliteAdapter } from './qoder-sqlite'
import { createCodexAdapter } from './codex'
import { createPiCliAdapter } from './minimax-cli'
import { createMiniMaxDesktopAdapter } from './minimax-desktop'
import { createQoderCliAdapter, createTraeDesktopAdapter } from './limited'

export interface PathEnv {
  home: string
  appdata: string
  local: string
  npmGlobal: string
}

export function pathEnv(): PathEnv {
  const home = os.homedir()
  const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  const npmGlobal = path.join(appdata, 'npm')
  return { home, appdata, local, npmGlobal }
}

/** 在 PATH 中查找可执行文件 */
export function resolveFromPath(name: string, env: PathEnv = pathEnv()): string | null {
  if (path.isAbsolute(name)) return existsSync(name) ? name : null
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  for (const dir of pathDirs) {
    for (const ext of path.extname(name) ? [''] : exts) {
      const candidate = path.join(dir, name + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

export function buildAdapters(env: PathEnv = pathEnv()): AgentAdapter[] {
  const { home, appdata, local, npmGlobal } = env

  // ---- 1. Qoder CLI：可执行文件未在本机 PATH 中找到，保留可配置入口
  const qoderCliExe = resolveFromPath('qoder', env)
  const qoderCli: AgentAdapter = createQoderCliAdapter({
    launch: {
      protocol: 'exec',
      command: qoderCliExe ?? 'qoder',
      args: [],
      cwd: home,
      note: qoderCliExe
        ? '已在 PATH 中定位 qoder 可执行文件。'
        : '未在 PATH 中找到 qoder 可执行文件（本机未安装 Qoder CLI）。可在“设置 → Agent 来源路径/启动配置”中改为实际路径。'
    },
    defaultSourcePath: path.join(home, '.qoder-cli'),
    sourceHint:
      'Qoder CLI 记录目录（当前探测到 %USERPROFILE%\\.qoder-cli，仅含 ai-stats 代码变更统计，无对话正文）。若你本机 CLI 使用其它数据目录，可在此手动指定。'
  })

  // ---- 2. Qoder CN
  const qoderCnExe = firstExisting([
    path.join(local, 'Programs', 'Qoder CN', 'Qoder CN.exe'),
    path.join(local, 'Qoder CN', 'Qoder CN Launcher', 'Qoder CN Launcher.exe')
  ])
  const qoderCn: AgentAdapter = createQoderSqliteAdapter({
    id: 'qoder-cn',
    name: 'Qoder CN',
    vendor: 'Qoder',
    surface: 'desktop',
    launch: {
      protocol: 'exec',
      command: qoderCnExe ?? path.join(local, 'Programs', 'Qoder CN', 'Qoder CN.exe'),
      args: [],
      cwd: home,
      note: qoderCnExe ? '已定位 Qoder CN 可执行文件。' : '未找到 Qoder CN 可执行文件，可在设置中修改路径。'
    },
    defaultSourcePath: path.join(appdata, 'com.qodercn.app.stable', 'main.sqlite'),
    sourceHint:
      'Qoder CN 会话库（SQLite）：%APPDATA%\\com.qodercn.app.stable\\main.sqlite。会话在 chat_sessions / chat_session_messages 表，cwd 字段用于项目归组。'
  })

  // ---- 3. Qoder 桌面端（国际版）
  const qoderDesktopExe = firstExisting([
    path.join(local, 'Qoder', 'Qoder Launcher', 'Qoder Launcher.exe'),
    path.join(local, 'Programs', 'Qoder', 'Qoder.exe')
  ])
  const qoderDesktop: AgentAdapter = createQoderSqliteAdapter({
    id: 'qoder-desktop',
    name: 'Qoder 桌面端',
    vendor: 'Qoder',
    surface: 'desktop',
    launch: {
      protocol: 'exec',
      command: qoderDesktopExe ?? path.join(local, 'Qoder', 'Qoder Launcher', 'Qoder Launcher.exe'),
      args: [],
      cwd: home,
      note: qoderDesktopExe ? '已定位 Qoder 桌面端启动器。' : '未找到 Qoder 桌面端启动器，可在设置中修改路径。'
    },
    defaultSourcePath: path.join(appdata, 'com.qoder.app.stable', 'main.sqlite'),
    sourceHint:
      'Qoder 桌面端会话库（SQLite）：%APPDATA%\\com.qoder.app.stable\\main.sqlite，表结构与 Qoder CN 一致。'
  })

  // ---- 4. MiniMax CLI（pi-coding-agent）
  const piCliJs = path.join(
    npmGlobal,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'bundle',
    'cli.js'
  )
  const nodeExe = firstExisting([
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs', 'node.exe')
  ])
  const miniMaxCli: AgentAdapter = createPiCliAdapter({
    id: 'minimax-cli',
    name: 'MiniMax CLI',
    launch: {
      protocol: 'exec',
      command: nodeExe ?? 'node',
      args: existsSync(piCliJs) ? [piCliJs] : [],
      cwd: home,
      note: existsSync(piCliJs)
        ? `以 node ${piCliJs} 启动 pi-coding-agent（避开 .cmd 包装脚本，不经过 shell 解析）。`
        : '未找到 pi-coding-agent 的 cli.js，请在设置中修改启动命令。'
    },
    defaultSourcePath: path.join(home, '.pi', 'agent', 'sessions'),
    sourceHint:
      'MiniMax CLI 会话目录：%USERPROFILE%\\.pi\\agent\\sessions\\<编码后的 cwd>\\<时间戳>_<uuid>.jsonl。'
  })

  // ---- 5. MiniMax 桌面端（MiniMax Code）
  const miniMaxDesktopExe = firstExisting([
    path.join(local, 'Programs', 'MiniMax Code', 'MiniMax Code.exe')
  ])
  const miniMaxDesktop: AgentAdapter = createMiniMaxDesktopAdapter({
    id: 'minimax-desktop',
    name: 'MiniMax 桌面端',
    launch: {
      protocol: 'exec',
      command: miniMaxDesktopExe ?? path.join(local, 'Programs', 'MiniMax Code', 'MiniMax Code.exe'),
      args: [],
      cwd: home,
      note: miniMaxDesktopExe ? '已定位 MiniMax Code 可执行文件。' : '未找到 MiniMax Code，可在设置中修改路径。'
    },
    defaultSourcePath: path.join(home, '.minimax', 'v2', 'sessions'),
    sourceHint:
      'MiniMax Code 会话目录：%USERPROFILE%\\.minimax\\v2\\sessions\\YYYY\\MM\\DD\\<会话目录>\\（含 messages.jsonl 与 manifest.json）。'
  })

  // ---- 6/7. Codex 桌面端 & CLI（共用 ~/.codex/sessions，按 originator 区分）
  const codexSessions = path.join(home, '.codex', 'sessions')
  const codexNativeExe = firstExisting([
    path.join(
      npmGlobal,
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe'
    )
  ])
  const codexDesktopExe = firstExisting([
    path.join(local, 'OpenAI', 'Codex', 'bin', '22cfb1d302613eae', 'codex.exe')
  ])

  const codexDesktop: AgentAdapter = createCodexAdapter({
    id: 'codex-desktop',
    name: 'Codex 桌面端',
    surface: 'desktop',
    launch: {
      protocol: 'appsfolder',
      command: 'OpenAI.Codex_2p2nqsd0c76g0!App',
      args: [],
      cwd: home,
      note:
        'Codex 桌面端以 MSIX 包（OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0）安装，通过 shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App 启动。'
    },
    defaultSourcePath: codexSessions,
    sourceHint:
      'Codex 会话存储：%USERPROFILE%\\.codex\\sessions\\YYYY\\MM\\DD\\rollout-*.jsonl.zst（桌面端与 CLI 共用，按 originator 字段区分）。',
    matchOriginator: (originator) => originator === 'Codex Desktop' || originator === 'codex_work_desktop',
    originatorLabel: 'Codex 桌面端'
  })

  const codexCli: AgentAdapter = createCodexAdapter({
    id: 'codex-cli',
    name: 'Codex CLI',
    surface: 'cli',
    launch: {
      protocol: 'exec',
      command:
        codexNativeExe ?? path.join(npmGlobal, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      args: codexNativeExe ? [] : [],
      cwd: home,
      note: codexNativeExe
        ? '直接使用 npm 全局包内的原生 codex.exe，避免 .cmd 包装脚本。'
        : '未找到原生 codex.exe，请修改启动命令。'
    },
    defaultSourcePath: codexSessions,
    sourceHint:
      'Codex CLI 会话存储：%USERPROFILE%\\.codex\\sessions\\YYYY\\MM\\DD\\rollout-*.jsonl.zst（本机 CLI 记录 originator 为 codex-tui）。',
    matchOriginator: (originator) => originator !== 'Codex Desktop' && originator !== 'codex_work_desktop',
    originatorLabel: 'Codex CLI'
  })

  // ---- 8. Trae 桌面端
  const traeExe = firstExisting([path.join(local, 'Programs', 'Trae CN', 'Trae CN.exe')])
  const trae: AgentAdapter = createTraeDesktopAdapter({
    launch: {
      protocol: 'exec',
      command: traeExe ?? path.join(local, 'Programs', 'Trae CN', 'Trae CN.exe'),
      args: [],
      cwd: home,
      note: traeExe ? '已定位 Trae CN 可执行文件。' : '未找到 Trae 可执行文件，请在设置中修改路径。'
    },
    defaultSourcePath: path.join(appdata, 'Trae CN', 'ModularData', 'ai-agent', 'database.db'),
    sourceHint:
      'Trae 会话候选库：%APPDATA%\\Trae CN\\ModularData\\ai-agent\\database.db（当前为私有格式，无法解析）。可改用通用 JSON/Markdown 导入。'
  })

  return [
    qoderCli,
    qoderCn,
    qoderDesktop,
    miniMaxCli,
    miniMaxDesktop,
    codexDesktop,
    codexCli,
    trae
  ]
}

export function adapterById(adapters: AgentAdapter[], id: string): AgentAdapter | undefined {
  return adapters.find((a) => a.id === id)
}
