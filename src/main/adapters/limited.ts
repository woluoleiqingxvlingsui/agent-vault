import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentAdapter, ParsedSession, SourceRef } from './types'

/**
 * Qoder CLI 适配器。
 *
 * 真实探测结果（本机）：
 *   - %USERPROFILE%\.qoder-cli\ 存在，但内容只有 ai-stats\（AI 代码变更统计 JSON），
 *     未发现任何对话正文文件（无 .jsonl 会话、无 SQLite 库）。
 *   - PATH 与常见安装目录中未找到 qoder CLI 可执行文件。
 * 因此：保留启动能力（可在设置中配置可执行文件路径），
 *      记录能力标记为 unsupported，并提供通用 JSON/Markdown 导入。
 */
export function createQoderCliAdapter(options: {
  launch: AgentAdapter['launch']
  defaultSourcePath: string
  sourceHint: string
}): AgentAdapter {
  return {
    id: 'qoder-cli',
    name: 'Qoder CLI',
    vendor: 'Qoder',
    surface: 'cli',
    launch: options.launch,
    defaultSourcePath: options.defaultSourcePath,
    sourceHint: options.sourceHint,
    recordSupport: 'none',
    limitReason:
      '已探测：%USERPROFILE%\\.qoder-cli 下只有 ai-stats（AI 代码变更统计），未发现对话正文文件；本机也未在 PATH 中找到 qoder CLI 可执行文件。',
    supportsWatch: false,
    async discover(): Promise<SourceRef[]> {
      return []
    },
    async parse(): Promise<ParsedSession[]> {
      return []
    }
  }
}

/**
 * Trae 桌面端适配器。
 *
 * 真实探测结果（本机）：
 *   - 启动入口：%LOCALAPPDATA%\Programs\Trae CN\Trae CN.exe（已安装，3.4.4）
 *   - 会话候选：%APPDATA%\Trae CN\ModularData\ai-agent\database.db（69MB）
 *     文件头为 FB 13 12 CE ...，不是 SQLite 魔数 "SQLite format 3"，
 *     sqlite3 打开直接报 "file is not a database"，属私有/加密格式。
 *   - ~/.trae-cn 下有 work / memory / attachments，但未发现可解析的对话正文文件。
 * 因此：保留启动能力，记录能力标记为 unsupported（格式无法验证），
 *      并提供通用 JSON/Markdown 导入通道。
 */
export function createTraeDesktopAdapter(options: {
  launch: AgentAdapter['launch']
  defaultSourcePath: string
  sourceHint: string
}): AgentAdapter {
  return {
    id: 'trae-desktop',
    name: 'Trae 桌面端',
    vendor: 'Trae',
    surface: 'desktop',
    launch: options.launch,
    defaultSourcePath: options.defaultSourcePath,
    sourceHint: options.sourceHint,
    recordSupport: 'none',
    limitReason:
      '已探测：%APPDATA%\\Trae CN\\ModularData\\ai-agent\\database.db 文件头非 SQLite（FB 13 12 CE），sqlite3 报 "file is not a database"，属私有格式，无法在不做逆向的前提下解析。',
    supportsWatch: false,
    async discover(): Promise<SourceRef[]> {
      return []
    },
    async parse(): Promise<ParsedSession[]> {
      return []
    }
  }
}

/** 供设置页展示：某个来源目录里到底有什么 */
export async function describeSourceDir(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).slice(0, 40)
  } catch {
    return []
  }
}

export function sourceDisplayName(p: string): string {
  return path.basename(p)
}
