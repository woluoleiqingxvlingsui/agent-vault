/**
 * 真实启动路径验证：成功启动、非零退出码、程序不存在、工作目录不存在。
 *
 * 用法：npx vite-node scripts/verify-launch.ts
 */
import path from 'node:path'
import { launch } from '../src/main/launch/launcher'

async function main(): Promise<void> {
  const comspec = process.env.ComSpec ?? 'cmd.exe'

  console.log('--- 1. 成功启动并正常退出（cmd /c exit 0）---')
  const ok = await launch({
    protocol: 'exec',
    command: comspec,
    args: ['/d', '/c', 'exit', '0'],
    cwd: process.cwd()
  })
  console.log(`   ok=${ok.ok} message=${ok.message}`)

  console.log('--- 2. 非零退出码应给出明确错误 ---')
  const bad = await launch({
    protocol: 'exec',
    command: comspec,
    args: ['/d', '/c', 'echo', 'boom', '1>&2', '&&', 'exit', '3'],
    cwd: process.cwd()
  })
  console.log(`   ok=${bad.ok} message=${bad.message}`)

  console.log('--- 3. 程序不存在应给出明确错误 ---')
  const missing = await launch({
    protocol: 'exec',
    command: 'C:\\definitely\\not\\exists.exe',
    args: [],
    cwd: process.cwd()
  })
  console.log(`   ok=${missing.ok} message=${missing.message}`)

  console.log('--- 4. 工作目录不存在应给出明确错误 ---')
  const badCwd = await launch({
    protocol: 'exec',
    command: comspec,
    args: ['/d', '/c', 'exit', '0'],
    cwd: path.join(process.cwd(), 'no-such-dir-xyz')
  })
  console.log(`   ok=${badCwd.ok} message=${badCwd.message}`)

  console.log('--- 5. 项目目录类型：目录不存在应给出明确错误 ---')
  const badDir = await launch({
    protocol: 'exec',
    command: path.join(process.cwd(), 'no-such-project-dir'),
    args: [],
    cwd: process.cwd(),
    asDirectory: true
  })
  console.log(`   ok=${badDir.ok} message=${badDir.message}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
