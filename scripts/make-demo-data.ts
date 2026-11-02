/**
 * 生成一套**完全虚构**的演示数据，用于：
 *  1. 在不接触真实会话记录的前提下体验本应用；
 *  2. 生成 README 里的示例截图（截图里不会出现任何真实路径或真实对话）。
 *
 * 用法（PowerShell）：
 *   $env:VAULT_DEMO_ROOT = 'C:\agent-vault-demo'
 *   npx vite-node scripts/make-demo-data.ts
 *   # 然后用假的环境变量启动应用即可看到演示数据
 *   $env:USERPROFILE = $env:VAULT_DEMO_ROOT
 *   $env:APPDATA = "$env:VAULT_DEMO_ROOT\AppData\Roaming"
 *   $env:LOCALAPPDATA = "$env:VAULT_DEMO_ROOT\AppData\Local"
 *   $env:VAULT_SCREENSHOT = '.\docs\screenshots\launch.png'
 *   npx electron .
 *
 * 演示根目录默认放在 C:\agent-vault-demo：
 * 刻意避开用户目录，截图里出现的路径不含任何真实用户名。
 */
import { promises as fs, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { Db } from '../src/main/db/database'
import { runMigrations } from '../src/main/db/migrations'
import { Repo } from '../src/main/db/repo'

const ROOT = (process.env.VAULT_DEMO_ROOT ?? 'C:\\agent-vault-demo').trim()
const APP_NAME = 'project-launcher-agent-vault'

const home = ROOT
const appdata = path.join(ROOT, 'AppData', 'Roaming')
const local = path.join(ROOT, 'AppData', 'Local')
const workspace = path.join(ROOT, 'workspace')
const projectShop = path.join(workspace, 'demo-shop')
const projectBilling = path.join(workspace, 'billing-service')

const T0 = Date.parse('2026-10-20T09:00:00.000Z')

async function write(file: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content as never)
}

/* ------------------------------------------------------------------ 演示对话 */

interface DemoMessage {
  role: 'user' | 'assistant'
  text: string
  at: number
}

interface DemoSession {
  id: string
  title: string
  cwd: string | null
  messages: DemoMessage[]
}

const demoSessions: Record<string, DemoSession[]> = {
  'qoder-cn': [
    {
      id: 'demo-qoder-cn-1',
      title: '给购物车模块补单元测试',
      cwd: projectShop,
      messages: [
        { role: 'user', text: '给购物车模块补一组单元测试，覆盖加购、移除和数量变更。', at: T0 },
        {
          role: 'assistant',
          text: '已补齐 6 个用例，放在 `cart.test.ts`：\n\n```ts\nit("数量上限为 99", () => {\n  expect(addToCart(store, item, 99).quantity).toBe(99)\n})\n```\n\n运行 `npm test` 全部通过。',
          at: T0 + 60_000
        }
      ]
    },
    {
      id: 'demo-qoder-cn-2',
      title: '修复下单接口的超时重试',
      cwd: projectBilling,
      messages: [
        { role: 'user', text: '下单接口偶发超时，重试之后会重复扣款，帮我看下。', at: T0 + 3_600_000 },
        {
          role: 'assistant',
          text: '原因是重试没有带幂等键。已在 `createOrder` 里加入 `Idempotency-Key` 请求头，重复提交会命中同一笔订单。',
          at: T0 + 3_660_000
        }
      ]
    }
  ],
  'qoder-desktop': [
    {
      id: 'demo-qoder-desktop-1',
      title: '整理结算页的文案',
      cwd: projectShop,
      messages: [
        { role: 'user', text: '结算页的按钮文案统一一下，现在有的写「提交」有的写「下单」。', at: T0 + 7_200_000 },
        { role: 'assistant', text: '已统一为「提交订单」，涉及 `checkout/confirm.vue` 与 `checkout/summary.vue`。', at: T0 + 7_260_000 }
      ]
    }
  ],
  'codex-desktop': [
    {
      id: 'demo-codex-desktop-1',
      title: '实现列表分页组件',
      cwd: projectShop,
      messages: [
        { role: 'user', text: '商品列表要支持分页，每页 20 条，页码切换时保留筛选条件。', at: T0 + 10_800_000 },
        {
          role: 'assistant',
          text: '新增 `Pagination.vue`，对外暴露 `page` / `pageSize` 两个 v-model，切换页码时只改查询参数、不重置筛选条件。',
          at: T0 + 10_860_000
        }
      ]
    }
  ],
  'codex-cli': [
    {
      id: 'demo-codex-cli-1',
      title: '写一个本地部署脚本',
      cwd: projectBilling,
      messages: [
        { role: 'user', text: '写一个 PowerShell 脚本，一键拉起本地依赖并跑迁移。', at: T0 + 14_400_000 },
        { role: 'assistant', text: '脚本放在 `scripts/dev-up.ps1`：先 `docker compose up -d`，再执行迁移，最后打印本地地址。', at: T0 + 14_460_000 }
      ]
    }
  ],
  'minimax-cli': [
    {
      id: 'demo-minimax-cli-1',
      title: '补充 README 的安装章节',
      cwd: projectShop,
      messages: [
        { role: 'user', text: 'README 缺安装章节，补一下依赖和启动步骤。', at: T0 + 18_000_000 },
        { role: 'assistant', text: '已补充「环境要求 / 安装 / 本地启动 / 打包」四小节，命令均可直接复制执行。', at: T0 + 18_060_000 }
      ]
    }
  ],
  'minimax-desktop': [
    {
      id: 'demo-minimax-desktop-1',
      title: '梳理遗留技术债',
      cwd: null,
      messages: [
        { role: 'user', text: '帮我把仓库里的遗留技术债梳理一下，按影响面排序。', at: T0 + 28_800_000 },
        {
          role: 'assistant',
          text: '<system-reminder>这是 Agent 内部注入的上下文，界面上默认折叠。</system-reminder>\n\n按影响面排序：\n\n1. 结算接口缺少幂等键（可能重复扣款）\n2. 商品列表没有分页，全量拉取\n3. 没有自动化测试\n\n第 1 条建议今天就修。',
          at: T0 + 28_860_000
        }
      ]
    },
    {
      id: 'demo-minimax-desktop-2',
      title: '设计一次促销活动的方案',
      cwd: null,
      messages: [
        { role: 'user', text: '下一次促销活动想做个满减叠加券的活动，帮我出个方案。', at: T0 + 25_200_000 },
        { role: 'assistant', text: '方案要点：门槛价、券面额、叠加顺序、库存分摊四部分，建议先在灰度环境验证叠加规则。', at: T0 + 25_260_000 }
      ]
    }
  ]
}

/* ------------------------------------------------------------- 各 Agent 的来源 */

/** Qoder：SQLite 会话库（chat_sessions / chat_session_messages） */
function writeQoderSqlite(file: string, sessions: DemoSession[]): void {
  fsSyncMkdir(path.dirname(file))
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      session_kind TEXT,
      product_mode TEXT,
      title TEXT,
      cwd TEXT,
      model TEXT,
      permission_mode TEXT,
      extra_json TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      archived INTEGER DEFAULT 0,
      deleted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS chat_session_messages (
      session_id TEXT,
      message_id TEXT,
      payload_json TEXT,
      created_at INTEGER
    );
  `)
  const insertSession = db.prepare(
    `INSERT OR REPLACE INTO chat_sessions
     (session_id, session_kind, product_mode, title, cwd, model, permission_mode, extra_json, created_at, updated_at, archived, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`
  )
  const insertMessage = db.prepare(
    'INSERT INTO chat_session_messages (session_id, message_id, payload_json, created_at) VALUES (?, ?, ?, ?)'
  )
  for (const session of sessions) {
    const created = session.messages[0].at
    const updated = session.messages[session.messages.length - 1].at
    insertSession.run(
      session.id,
      'main',
      'chat',
      session.title,
      session.cwd ?? '',
      'demo-model',
      'default',
      JSON.stringify({ demo: true }),
      created,
      updated
    )
    session.messages.forEach((message, index) => {
      insertMessage.run(
        session.id,
        `${session.id}-m${index}`,
        JSON.stringify({ role: message.role, text: message.text, timestamp: message.at }),
        message.at
      )
    })
  }
  db.close()
}

function fsSyncMkdir(dir: string): void {
  // node:sqlite 需要目录已存在；用同步 API 简化脚本结构
  mkdirSync(dir, { recursive: true })
}

/** Codex：zstd 压缩的 JSONL，会话元信息在首行 */
function writeCodexRollout(file: string, session: DemoSession, originator: string): void {
  const lines: string[] = []
  lines.push(
    JSON.stringify({
      timestamp: new Date(session.messages[0].at).toISOString(),
      ordinal: 1,
      type: 'session_meta',
      payload: {
        creator_user_id: 'demo-user',
        session_id: session.id,
        id: session.id,
        timestamp: new Date(session.messages[0].at).toISOString(),
        cwd: session.cwd ?? '',
        originator,
        cli_version: '0.0.0-demo',
        source: 'demo',
        model_provider: 'demo'
      }
    })
  )
  session.messages.forEach((message, index) => {
    lines.push(
      JSON.stringify({
        timestamp: new Date(message.at).toISOString(),
        ordinal: index + 2,
        type: 'response_item',
        payload: {
          type: 'message',
          role: message.role,
          content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.text }]
        }
      })
    )
  })
  const compressed = zlib.zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8'))
  fsSyncMkdir(path.dirname(file))
  writeFileSync(file, compressed)
}

/** MiniMax CLI（pi）：首行 session 元信息 + message 行 */
function writePiSession(file: string, session: DemoSession, encodedCwd: string): void {
  const lines: string[] = []
  lines.push(
    JSON.stringify({
      type: 'session',
      version: 3,
      id: session.id,
      timestamp: new Date(session.messages[0].at).toISOString(),
      cwd: session.cwd ?? ''
    })
  )
  session.messages.forEach((message) => {
    lines.push(
      JSON.stringify({
        type: 'message',
        id: `${session.id}-${message.at}`,
        parentId: null,
        timestamp: new Date(message.at).toISOString(),
        message: {
          role: message.role,
          content: [{ type: 'text', text: message.text }],
          timestamp: message.at
        }
      })
    )
  })
  fsSyncMkdir(path.dirname(file))
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
  void encodedCwd
}

/** MiniMax 桌面端：会话目录 + messages.jsonl + manifest.json */
async function writeMiniMaxDesktopSession(dir: string, session: DemoSession): Promise<void> {
  const lines = session.messages.map((message) =>
    JSON.stringify({
      message_id: `${session.id}-${message.at}`,
      turn_id: session.id,
      message: {
        role: message.role,
        content: [{ type: 'text', text: message.text }],
        timestamp: message.at
      },
      timestamp: message.at
    })
  )
  await write(path.join(dir, 'messages.jsonl'), lines.join('\n') + '\n')
  await write(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        sessionId: session.id,
        createdAtMs: session.messages[0].at,
        updatedAtMs: session.messages[session.messages.length - 1].at,
        source: 'demo',
        layout: 'v2-final-dated-session',
        paths: { sessionDir: dir, messages: path.join(dir, 'messages.jsonl') }
      },
      null,
      2
    )
  )
}

/** pi 用 "--C--Users--name--" 形式编码 cwd（去掉盘符冒号，Windows 目录名不允许冒号） */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/:/g, '').replace(/[\\/]/g, '--')}--`
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<void> {
  console.log(`[demo] 演示根目录：${ROOT}`)

  // 安全护栏：绝不写到真实用户目录
  const realHome = os.homedir().replace(/[\\/]+$/, '')
  if (ROOT.replace(/[\\/]+$/, '').toLowerCase() === realHome.toLowerCase()) {
    throw new Error('VAULT_DEMO_ROOT 不能指向真实用户目录')
  }
  if (ROOT.replace(/[\\/]+$/, '').length < 3) {
    throw new Error('VAULT_DEMO_ROOT 路径过短，拒绝执行')
  }

  // 幂等：先清掉上次生成的演示数据，避免同名会话残留
  for (const stale of [
    path.join(appdata, APP_NAME),
    path.join(appdata, 'com.qodercn.app.stable'),
    path.join(appdata, 'com.qoder.app.stable'),
    path.join(appdata, 'Trae CN'),
    path.join(home, '.codex'),
    path.join(home, '.minimax'),
    path.join(home, '.pi'),
    path.join(home, '.qoder-cli'),
    workspace
  ]) {
    await fs.rm(stale, { recursive: true, force: true })
  }

  // 1) 目录骨架
  await fs.mkdir(path.join(appdata, 'project-launcher-agent-vault'), { recursive: true })
  await fs.mkdir(local, { recursive: true })
  await fs.mkdir(projectShop, { recursive: true })
  await fs.mkdir(projectBilling, { recursive: true })

  // 2) 各 Agent 的来源文件
  writeQoderSqlite(
    path.join(appdata, 'com.qodercn.app.stable', 'main.sqlite'),
    demoSessions['qoder-cn']
  )
  writeQoderSqlite(
    path.join(appdata, 'com.qoder.app.stable', 'main.sqlite'),
    demoSessions['qoder-desktop']
  )

  const codexDir = path.join(home, '.codex', 'sessions', '2026', '10', '20')
  writeCodexRollout(
    path.join(codexDir, 'rollout-demo-desktop.jsonl.zst'),
    demoSessions['codex-desktop'][0],
    'Codex Desktop'
  )
  writeCodexRollout(
    path.join(codexDir, 'rollout-demo-cli.jsonl.zst'),
    demoSessions['codex-cli'][0],
    'codex-tui'
  )

  const piDir = path.join(home, '.pi', 'agent', 'sessions', encodeCwd(projectShop))
  writePiSession(
    path.join(piDir, '2026-10-20T18-00-00-000_demo-minimax-cli-1.jsonl'),
    demoSessions['minimax-cli'][0],
    encodeCwd(projectShop)
  )

  for (const [index, session] of demoSessions['minimax-desktop'].entries()) {
    const stamp = new Date(session.messages[0].at)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const dir = path.join(
      home,
      '.minimax',
      'v2',
      'sessions',
      String(stamp.getUTCFullYear()),
      pad(stamp.getUTCMonth() + 1),
      pad(stamp.getUTCDate()),
      `${pad(stamp.getUTCHours())}-${pad(stamp.getUTCMinutes())}-${pad(stamp.getUTCSeconds())}-000-session_${session.id}`
    )
    await writeMiniMaxDesktopSession(dir, session)
    void index
  }

  // Trae：私有格式的假文件（与真实环境一样不可解析，用于展示「无法验证」状态）
  await write(
    path.join(appdata, 'Trae CN', 'ModularData', 'ai-agent', 'database.db'),
    Buffer.concat([Buffer.from([0x46, 0x42, 0x13, 0x12, 0x43, 0x45]), Buffer.from('demo-private-format')])
  )

  // Qoder CLI：只有 ai-stats，没有对话正文
  await write(
    path.join(home, '.qoder-cli', 'ai-stats', 'demo.json'),
    JSON.stringify({ files: 3, insertions: 42, deletions: 7 }, null, 2)
  )

  // 3) 应用数据库：建表 + 登记两个演示项目
  const dbFile = path.join(appdata, APP_NAME, 'agent-vault.db')
  await fs.rm(dbFile, { force: true })
  const db = new Db(dbFile)
  runMigrations(db)
  const repo = new Repo(db)
  repo.saveProject({ name: 'demo-shop', rootPath: projectShop })
  repo.saveProject({ name: 'billing-service', rootPath: projectBilling })
  db.close()

  console.log('[demo] 已生成演示数据：')
  console.log(`       应用数据库：${dbFile}`)
  console.log(`       Qoder CN ：${path.join(appdata, 'com.qodercn.app.stable', 'main.sqlite')}`)
  console.log(`       Codex    ：${codexDir}`)
  console.log(`       演示项目 ：${projectShop} / ${projectBilling}`)
  console.log('')
  console.log('[demo] 用下面的环境变量启动应用即可看到演示数据：')
  console.log(`       $env:USERPROFILE = '${home}'`)
  console.log(`       $env:APPDATA = '${appdata}'`)
  console.log(`       $env:LOCALAPPDATA = '${local}'`)
  console.log(`       $env:VAULT_SCREENSHOT = '<项目目录>\\docs\\screenshots\\launch.png'`)
  console.log('       npx electron .')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
