import { existsSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Db } from '../db/database'
import { LATEST_SCHEMA_VERSION, runMigrations } from '../db/migrations'

/** SQLite 在同一读事务中生成独立快照，包含尚未 checkpoint 的 WAL 数据。 */
export function snapshot(db: Db, destination: string): void {
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    db.run('VACUUM INTO ?', [temporary])
    renameSync(temporary, destination)
  } finally { rmSync(temporary, { force: true }) }
}

export function validateBackup(file: string): void {
  const db = new Db(file, { readOnly: true })
  try {
    if (db.get<{ quick_check: string }>('PRAGMA quick_check')?.quick_check !== 'ok') {
      throw new Error('数据库完整性检查未通过')
    }
    const versions = db.all<{ version: number }>('SELECT version FROM schema_migrations')
    if (!versions.length || versions.some((v) => v.version > LATEST_SCHEMA_VERSION)) {
      throw new Error('备份版本不受当前应用支持')
    }
    for (const table of ['launchers', 'projects', 'sessions', 'messages', 'settings', 'scan_state']) {
      if (!db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table])) {
        throw new Error(`不是完整的 Agent Vault 备份：缺少 ${table}`)
      }
    }
  } finally { db.close() }
}

export function stageRestore(source: string, dbFile: string): void {
  if (path.resolve(source).toLowerCase() === path.resolve(dbFile).toLowerCase()) {
    throw new Error('请选择备份文件，不能恢复正在使用的数据库')
  }
  validateBackup(source)
  const input = new Db(source, { readOnly: true })
  const pending = `${dbFile}.restore-pending`
  try { snapshot(input, pending) } finally { input.close() }
  // 在副本上完成迁移和字段校验，拒绝格式不兼容的数据库。
  const staged = new Db(pending)
  try {
    runMigrations(staged)
    staged.all('SELECT command, args, protocol FROM launchers LIMIT 0')
    staged.all('SELECT content_hash, manual_project_id, source_path, source_cwd FROM sessions LIMIT 0')
    staged.all('SELECT id, name, root_path, launcher_id FROM projects LIMIT 0')
    staged.all('SELECT id, session_id, seq, role, content, created_at FROM messages LIMIT 0')
    staged.all('SELECT key, value FROM settings LIMIT 0')
    staged.all('SELECT agent_id, source_path, mtime FROM source_state LIMIT 0')
  } catch (err) {
    staged.close()
    rmSync(pending, { force: true })
    throw err
  } finally { staged.close() }
}

/** 只在主库尚未打开时替换；原库留作回滚，完整安全备份由恢复入口提前生成。 */
export function applyPendingRestore(dbFile: string): void {
  const pending = `${dbFile}.restore-pending`
  const rollback = `${dbFile}.restore-previous`
  const restorePrevious = (): void => {
    renameSync(rollback, dbFile)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${rollback}${suffix}`)) renameSync(`${rollback}${suffix}`, `${dbFile}${suffix}`)
    }
  }
  if (!existsSync(dbFile) && existsSync(rollback)) restorePrevious()
  if (!existsSync(pending)) return
  validateBackup(pending)
  if (existsSync(dbFile)) renameSync(dbFile, rollback)
  try {
    // 先移走旧库的 WAL，再安装新主库。中断后也不会把旧 WAL 应用到新库。
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${dbFile}${suffix}`)) renameSync(`${dbFile}${suffix}`, `${rollback}${suffix}`)
    }
    renameSync(pending, dbFile)
  }
  catch (err) {
    if (existsSync(rollback)) restorePrevious()
    throw err
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${rollback}${suffix}`, { force: true })
}
