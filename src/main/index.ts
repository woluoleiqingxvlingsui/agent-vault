import { app, BrowserWindow, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Db } from './db/database'
import { runMigrations } from './db/migrations'
import { Repo } from './db/repo'
import { buildAdapters } from './adapters/registry'
import { Scanner } from './scan/scanner'
import { SourceWatcher } from './scan/watcher'
import { defaultDbFile, registerIpc } from './ipc'

let db: Db | null = null
let watcher: SourceWatcher | null = null
let mainWindow: BrowserWindow | null = null

function seedAgentLaunchers(repo: Repo, adapters: ReturnType<typeof buildAdapters>): void {
  for (const adapter of adapters) {
    const id = `agent-${adapter.id}`
    const existing = repo.getLauncher(id)
    if (!existing) {
      repo.saveLauncher({
        id,
        name: adapter.name,
        kind: adapter.surface === 'cli' ? 'cli' : 'app',
        command: adapter.launch.command,
        protocol: adapter.launch.protocol,
        args: adapter.launch.args,
        cwd: adapter.launch.cwd,
        enabled: true,
        icon: adapter.vendor
      })
    } else if (existing.command !== adapter.launch.command) {
      // 探测到的路径变化时同步启动命令（保留用户的其它自定义）
      repo.saveLauncher({ ...existing, command: adapter.launch.command })
    }
  }
}

async function notifyDataChanged(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data:changed')
  }
}

/**
 * 截图诊断目标：仅认显式给定的环境变量 VAULT_SCREENSHOT。
 *
 * 不再读取工作目录下的 screenshot-request.txt —— 正式版不该在用户目录里
 * 凭空读一个文件、再往任意路径写 PNG。
 */
async function resolveScreenshotTarget(): Promise<string | null> {
  const fromEnv = process.env.VAULT_SCREENSHOT
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : null
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0f1117',
    title: '项目启动器 · Agent 对话记录管理器',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 只放行 http/https，避免渲染层里的链接直接打开本地文件或自定义协议
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 禁止把渲染层导航到其它来源：preload 暴露的 window.vault 不会跟着跑到远端页面
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (!current || url === current) return
    try {
      const from = new URL(current)
      const to = new URL(url)
      if (from.protocol === 'file:' || to.protocol === 'file:') {
        event.preventDefault()
        return
      }
      if (from.origin !== to.origin) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    await mainWindow.loadURL(devServer)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData')
  await fs.mkdir(dataDir, { recursive: true })
  const dbFile = defaultDbFile(dataDir)

  db = new Db(dbFile)
  const applied = runMigrations(db)
  if (applied.length) console.log(`[db] 已应用迁移：${applied.join(', ')}`)

  const repo = new Repo(db)
  const adapters = buildAdapters()
  seedAgentLaunchers(repo, adapters)

  const scanner = new Scanner(repo, adapters)
  registerIpc({ repo, scanner, adapters, dataDir, dbFile })

  watcher = new SourceWatcher(scanner, adapters, {
    intervalMs: 60_000,
    debounceMs: 1500,
    onScan: notifyDataChanged
  })
  watcher.start()

  await createWindow()

  // 启动后异步做一次全量扫描，不阻塞窗口显示
  void scanner
    .scanAll()
    .then((results) => {
      const imported = results.reduce((sum, r) => sum + r.imported, 0)
      console.log(`[scan] 首次扫描完成：新增 ${imported} 条会话`)
      notifyDataChanged()
    })
    .catch((err) => {
      console.log(`[scan] 首次扫描失败：${(err as Error).message}`)
    })

  // 诊断用：设置 VAULT_SCREENSHOT=<文件路径>（或在工作目录放置 screenshot-request.txt）时保存各页面截图
  const screenshotTarget = await resolveScreenshotTarget()
  console.log(
    `[diag] cwd=${process.cwd()} env=${process.env.VAULT_SCREENSHOT ?? '<none>'} file=${
      screenshotTarget ?? '<none>'
    }`
  )
  if (screenshotTarget && mainWindow) {
    const win = mainWindow
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const capture = async (target: string): Promise<void> => {
      try {
        // 被遮挡 / 非活动窗口上 capturePage 可能返回同一帧，改用 CDP 从合成层抓取
        const dbg = win.webContents.debugger
        if (!dbg.isAttached()) dbg.attach('1.3')
        const result = (await dbg.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true
        })) as { data: string }
        await fs.writeFile(target, Buffer.from(result.data, 'base64'))
        console.log(`[screenshot] 已保存到 ${target}`)
      } catch (err) {
        console.log(`[screenshot] CDP 抓取失败，回退 capturePage：${(err as Error).message}`)
        try {
          const image = await win.webContents.capturePage()
          await fs.writeFile(target, image.toPNG())
          console.log(`[screenshot] 已保存到 ${target}`)
        } catch (inner) {
          console.log(`[screenshot] 失败：${(inner as Error).message}`)
        }
      }
    }
    const PAGE_HASH: Record<string, string> = {
      启动: 'launch',
      项目: 'projects',
      对话记录: 'conversations',
      设置: 'settings'
    }
    const clickNav = async (label: string): Promise<void> => {
      await win.webContents.executeJavaScript(`(() => {
        const items = Array.from(document.querySelectorAll('.nav-item'));
        const target = items.find((el) => el.textContent && el.textContent.includes(${JSON.stringify(label)}));
        if (target) target.click();
        return items.length;
      })()`)
      await sleep(400)
      await win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(
        PAGE_HASH[label] ?? 'launch'
      )}`)
      await sleep(2500)
      const title = await win.webContents.executeJavaScript(
        `document.querySelector('.page-head h1') ? document.querySelector('.page-head h1').textContent : 'none'`
      )
      console.log(`[screenshot] 页面 ${label} 当前标题：${title}`)
    }
    const clickSelector = async (selector: string): Promise<boolean> => {
      const script =
        "(() => { const el = document.querySelector(" +
        JSON.stringify(selector) +
        "); if (!el) return false; el.click(); return true; })()"
      const clicked = await win.webContents.executeJavaScript(script)
      await sleep(1200)
      return Boolean(clicked)
    }

    await sleep(6000)
    await capture(screenshotTarget)

    await clickNav('对话记录')
    // 选中第一条会话，用于验证详情视图
    await clickSelector('.session-item')
    await sleep(1500)
    await capture(screenshotTarget.replace(/(\.png)?$/, '-conversations.png'))

    await clickNav('设置')
    await sleep(2000)
    await capture(screenshotTarget.replace(/(\.png)?$/, '-settings.png'))

    await clickNav('项目')
    await sleep(1500)
    await capture(screenshotTarget.replace(/(\.png)?$/, '-projects.png'))

    // 切到浅色主题，验证双主题渲染
    if (await clickSelector('.theme-toggle')) {
      await sleep(800)
      await clickNav('启动')
      await sleep(1200)
      await capture(screenshotTarget.replace(/(\.png)?$/, '-light.png'))

      await clickSelector('.theme-toggle')
    }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('will-quit', () => {
  watcher?.stop()
  db?.close()
})
