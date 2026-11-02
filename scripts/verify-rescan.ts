/**
 * 真实数据上的「强制重新扫描」验证：
 *  - 打开本机应用数据库，按真实适配器重新解析全部来源；
 *  - 期望 imported = 0（已有会话不产生副本）、updated = N（内容变化时更新同一条会话）；
 *  - 打印每个 Agent 的结果。
 *
 * 用法：npx vite-node scripts/verify-rescan.ts
 */
import path from 'node:path'
import { Db } from '../src/main/db/database'
import { runMigrations } from '../src/main/db/migrations'
import { Repo } from '../src/main/db/repo'
import { buildAdapters } from '../src/main/adapters/registry'
import { Scanner } from '../src/main/scan/scanner'

const appDb = path.join(
  process.env.APPDATA ?? '',
  'project-launcher-agent-vault',
  'agent-vault.db'
)

async function main(): Promise<void> {
  const db = new Db(appDb)
  runMigrations(db)
  const repo = new Repo(db)
  const adapters = buildAdapters()
  const scanner = new Scanner(repo, adapters)

  const before = repo.countSessions()
  console.log(`扫描前会话数：${before}`)

  const results = await scanner.scanAll({ force: true })
  for (const r of results) {
    console.log(
      `  ${r.agentId.padEnd(18)} 发现 ${String(r.discovered).padStart(4)} | 新增 ${String(
        r.imported
      ).padStart(4)} | 更新 ${String(r.updated).padStart(4)} | 跳过 ${String(r.skipped).padStart(
        4
      )} | 失败 ${r.failed} | ${r.durationMs}ms ${r.error ? `| ${r.error}` : ''}`
    )
  }

  const after = repo.countSessions()
  console.log(`扫描后会话数：${after}（应与扫描前一致：${before === after ? '是' : '否'}`)

  const sample = repo.listSessions({ limit: 3, sortBy: 'updatedAt', sortDir: 'desc' })
  for (const s of sample.items) {
    console.log(`  示例标题：${s.title}`)
  }
  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
