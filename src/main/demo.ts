import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Db } from './db/database'
import { runMigrations } from './db/migrations'
import { Repo } from './db/repo'
import { computeContentHash, computeFingerprint } from './domain/dedup'
import { saveScanPreferences } from './agents/preferences'

/** 内置演示仅写独立目录，不构造、扫描或启动真实 Agent。 */
export async function prepareDemo(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true })
  const db = new Db(path.join(dataDir, 'agent-vault.db'))
  try {
    runMigrations(db)
    const repo = new Repo(db)
    const project = repo.listProjects()[0] ?? repo.saveProject({ name: 'demo-shop', rootPath: 'C:\\agent-vault-demo\\demo-shop' })
    for (const [index, title] of ['为商品列表增加分页', '补充 README 安装步骤', '分析本周开发任务'].entries()) {
      const messages = [{ role: 'user', content: title, createdAt: 1793520000000 },
        { role: 'assistant', content: '这是虚构的演示会话，不包含真实聊天记录。', createdAt: 1793520001000 }]
      repo.upsertSession({ agentId: 'codex-cli', externalId: `demo-${index}`,
        fingerprint: computeFingerprint({ agentId: 'codex-cli', externalId: `demo-${index}` }),
        title, createdAt: 1793520000000, updatedAt: 1793520001000,
        sourcePath: `C:\\agent-vault-demo\\sessions\\${index}.jsonl`, sourceCwd: project.rootPath,
        rawMeta: { demo: true }, contentHash: computeContentHash(title, messages),
        autoProjectId: project.id, sourceMtime: 0, messages })
    }
    saveScanPreferences(repo, { initialized: true, paused: true, agentIds: [] })
  } finally { db.close() }
}
