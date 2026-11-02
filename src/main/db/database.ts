import { DatabaseSync } from 'node:sqlite'

export type SqlParams = unknown[]

type Row = Record<string, unknown>

/**
 * 内置 node:sqlite 封装（Node >= 22.13 / Electron >= 36 自带）。
 *
 * 选择理由：
 *  - 使用真实 SQLite，支持 WAL 模式（Qoder / Trae 等 Agent 的会话库是 WAL 模式，
 *    纯 WASM 的 sqlite 驱动无法打开）；
 *  - 支持 readOnly 打开外部库，保证只读读取 Agent 原始记录；
 *  - 无需原生编译，便于 Electron 打包。
 */
export class Db {
  private readonly raw: DatabaseSync
  private closed = false

  constructor(file: string, options: { readOnly?: boolean } = {}) {
    this.raw = new DatabaseSync(file, { readOnly: options.readOnly === true })
  }

  run(sql: string, params: SqlParams = []): void {
    this.raw.prepare(sql).run(...normalizeParams(params))
  }

  all<T = Row>(sql: string, params: SqlParams = []): T[] {
    return this.raw.prepare(sql).all(...normalizeParams(params)) as T[]
  }

  get<T = Row>(sql: string, params: SqlParams = []): T | undefined {
    const row = this.raw.prepare(sql).get(...normalizeParams(params))
    return (row ?? undefined) as T | undefined
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN')
    try {
      const result = fn()
      this.exec('COMMIT')
      return result
    } catch (err) {
      try {
        this.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.raw.close()
  }
}

/** node:sqlite 只接受 null / number / bigint / string / Uint8Array */
function normalizeParams(params: SqlParams): Array<null | number | bigint | string | Uint8Array> {
  return params.map((value) => {
    if (value === undefined || value === null) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') return value
    if (value instanceof Uint8Array) return value
    return String(value)
  })
}
