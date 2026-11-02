import type { Db } from './database'

export interface Migration {
  version: number
  name: string
  up(db: Db): void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS launchers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          command TEXT NOT NULL,
          args TEXT NOT NULL DEFAULT '[]',
          cwd TEXT NOT NULL DEFAULT '',
          project_id TEXT,
          icon TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          last_launched_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          launcher_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          external_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          created_at INTEGER,
          updated_at INTEGER,
          message_count INTEGER NOT NULL DEFAULT 0,
          source_path TEXT NOT NULL DEFAULT '',
          source_cwd TEXT,
          raw_meta TEXT NOT NULL DEFAULT '{}',
          fingerprint TEXT NOT NULL,
          auto_project_id TEXT,
          manual_project_id TEXT
        );

        CREATE UNIQUE INDEX IF NOT EXISTS ux_sessions_fingerprint ON sessions(fingerprint);
        CREATE INDEX IF NOT EXISTS ix_sessions_agent ON sessions(agent_id);

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS ix_messages_session ON messages(session_id);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_state (
          agent_id TEXT PRIMARY KEY,
          last_scan_at INTEGER,
          last_error TEXT,
          scanned_count INTEGER NOT NULL DEFAULT 0
        );
      `)
    }
  },
  {
    version: 2,
    name: 'incremental_scan_columns',
    up(db) {
      const columns = new Set(
        db.all<{ name: string }>('PRAGMA table_info(sessions)').map((r) => r.name)
      )
      if (!columns.has('content_hash')) {
        db.run("ALTER TABLE sessions ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
      }
      if (!columns.has('source_mtime')) {
        db.run('ALTER TABLE sessions ADD COLUMN source_mtime INTEGER NOT NULL DEFAULT 0')
      }
      if (!columns.has('search_blob')) {
        db.run("ALTER TABLE sessions ADD COLUMN search_blob TEXT NOT NULL DEFAULT ''")
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS ix_sessions_auto_project ON sessions(auto_project_id);
        CREATE INDEX IF NOT EXISTS ix_sessions_manual_project ON sessions(manual_project_id);
        CREATE INDEX IF NOT EXISTS ix_sessions_updated ON sessions(updated_at);
      `)
    }
  },
  {
    version: 3,
    name: 'launcher_protocol',
    up(db) {
      const columns = new Set(
        db.all<{ name: string }>('PRAGMA table_info(launchers)').map((r) => r.name)
      )
      if (!columns.has('protocol')) {
        db.run("ALTER TABLE launchers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'exec'")
      }
    }
  },
  {
    version: 4,
    name: 'source_scan_state',
    up(db) {
      // 每个来源文件上次扫描到的 mtime：增量判断的依据。
      // 之前靠 sessions.source_mtime 判断，会被「手工导入的同路径会话」干扰。
      // 注意：按 agent_id + source_path 联合主键 —— 多个适配器可能共用同一个来源
      // （Codex 桌面端与 CLI 共用 ~/.codex/sessions），不能互相把对方的来源标记成已扫。
      db.exec(`
        CREATE TABLE IF NOT EXISTS source_state (
          agent_id TEXT NOT NULL,
          source_path TEXT NOT NULL,
          mtime INTEGER NOT NULL DEFAULT 0,
          scanned_at INTEGER,
          PRIMARY KEY (agent_id, source_path)
        );
      `)
    }
  }
]

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version

/** 执行未应用的迁移，返回已应用版本列表 */
export function runMigrations(db: Db): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)
  const applied = new Set(
    db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version)
  )
  const done: number[] = []
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    db.transaction(() => {
      migration.up(db)
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        Date.now()
      ])
    })
    done.push(migration.version)
  }
  return done
}
