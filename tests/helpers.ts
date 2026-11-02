import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Db } from '../src/main/db/database'
import { runMigrations } from '../src/main/db/migrations'
import { Repo } from '../src/main/db/repo'

export interface TestDb {
  db: Db
  repo: Repo
  dir: string
  cleanup: () => void
}

export function createTestDb(options: { memory?: boolean } = {}): TestDb {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qlv-test-'))
  const db = new Db(options.memory ? ':memory:' : path.join(dir, 'test.db'))
  runMigrations(db)
  const repo = new Repo(db)
  return {
    db,
    repo,
    dir,
    cleanup: () => {
      try {
        db.close()
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

export const fixture = (name: string): string =>
  path.join(__dirname, 'fixtures', ...name.split('/').map((s) => path.join(s)))
