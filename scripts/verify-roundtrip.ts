/**
 * 真实数据上的导出 → 空数据目录导入 → 再次导入 的往返验证脚本。
 *
 * 用法：npx vite-node scripts/verify-roundtrip.ts
 *
 * 步骤：
 *  1. 打开本机应用数据库（只读），构造导出包并写入临时 JSON；
 *  2. 在一个全新的空数据库里导入，检查会话数、消息数、项目归属是否恢复；
 *  3. 再次导入同一份文件，确认不会产生副本。
 */
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Db } from '../src/main/db/database'
import { runMigrations } from '../src/main/db/migrations'
import { Repo } from '../src/main/db/repo'
import { buildExportBundle, exportToJson } from '../src/main/io/exporter'
import { importSessions, parseJsonImport } from '../src/main/io/importer'

const appDb = path.join(
  process.env.APPDATA ?? '',
  'project-launcher-agent-vault',
  'agent-vault.db'
)

async function main(): Promise<void> {
  if (!existsSync(appDb)) {
    console.log(`[skip] 未找到应用数据库：${appDb}`)
    return
  }
  const source = new Db(appDb, { readOnly: true })
  const repo = new Repo(source)
  const bundle = buildExportBundle(repo)
  source.close()

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlv-roundtrip-'))
  const exportFile = path.join(dir, 'export.json')
  await fs.writeFile(exportFile, exportToJson(bundle), 'utf8')
  console.log(`导出：${bundle.sessions.length} 条会话，${bundle.projects.length} 个项目 -> ${exportFile}`)

  // 空数据目录
  const fresh = new Db(path.join(dir, 'fresh.db'))
  runMigrations(fresh)
  const freshRepo = new Repo(fresh)
  console.log(`空库初始会话数：${freshRepo.countSessions()}`)

  const parsed = parseJsonImport(await fs.readFile(exportFile, 'utf8'))
  if (parsed.error) throw new Error(parsed.error)
  for (const p of parsed.bundle!.projects) {
    const exists = freshRepo.listProjects().find((x) => x.id === p.id)
    if (!exists) freshRepo.saveProject({ id: p.id, name: p.name, rootPath: p.rootPath })
  }
  const first = importSessions(freshRepo, parsed.bundle!.sessions)
  console.log(`首次导入：新增 ${first.imported}，更新 ${first.updated}，跳过 ${first.skipped}，失败 ${first.failed}`)
  console.log(`导入后会话数：${freshRepo.countSessions()}`)

  const second = importSessions(freshRepo, parsed.bundle!.sessions)
  console.log(`再次导入：新增 ${second.imported}，更新 ${second.updated}，跳过 ${second.skipped}，失败 ${second.failed}`)
  console.log(`再次导入后会话数：${freshRepo.countSessions()}（应与首次相同）`)

  // 归属一致性
  const restored = buildExportBundle(freshRepo)
  const key = (s: { agentId: string; externalId: string | null; title: string }): string =>
    `${s.agentId}|${s.externalId ?? ''}|${s.title}`
  const originalKeys = new Set(bundle.sessions.map(key))
  const restoredKeys = new Set(restored.sessions.map(key))
  const missing = [...originalKeys].filter((k) => !restoredKeys.has(k))
  console.log(`会话集合一致：${missing.length === 0 ? '是' : `否（缺失 ${missing.length} 条）`}`)

  const origProjects = new Map(bundle.sessions.map((s) => [key(s), (s.manualProjectId ?? s.autoProjectId)]))
  let mismatch = 0
  for (const s of restored.sessions) {
    if (origProjects.get(key(s)) !== (s.manualProjectId ?? s.autoProjectId)) mismatch += 1
  }
  console.log(`项目归属一致：${mismatch === 0 ? '是' : `否（${mismatch} 条不一致）`}`)
  console.log(`消息总数：原始 ${countMessages(bundle)} / 恢复后 ${countMessages(restored)}`)

  const failed = missing.length > 0 || originalKeys.size !== restoredKeys.size || mismatch > 0 ||
    countMessages(bundle) !== countMessages(restored) || first.failed > 0 || second.failed > 0 ||
    second.imported > 0 || second.updated > 0
  fresh.close()
  await fs.rm(dir, { recursive: true, force: true })
  if (failed) throw new Error('往返验证未通过')
}

function countMessages(bundle: ReturnType<typeof buildExportBundle>): number {
  return bundle.sessions.reduce((sum, s) => sum + s.messages.length, 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
