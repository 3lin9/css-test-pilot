import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const execFileAsync = promisify(execFile)

export interface PickFolderResult {
  /** 用户选定的绝对路径;取消时为 null */
  path: string | null
  cancelled: boolean
}

/**
 * 弹出操作系统自带的「选择文件夹」对话框。
 * 必须由本机 Control Plane 调用(浏览器拿不到真实路径)。
 * Windows: FolderBrowserDialog; macOS: choose folder; Linux: zenity/kdialog。
 */
export async function pickFolderNative(options: { title?: string } = {}): Promise<PickFolderResult> {
  const title = options.title ?? '选择业务项目根目录'
  try {
    if (process.platform === 'win32') return await pickWindows(title)
    if (process.platform === 'darwin') return await pickMac(title)
    return await pickLinux(title)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw Object.assign(new Error(`无法打开系统文件夹对话框:${message}`), { statusCode: 500 })
  }
}

async function pickWindows(title: string): Promise<PickFolderResult> {
  // FolderBrowserDialog 需 STA;隐藏的 TopMost 宿主窗口保证对话框弹到最前而不是藏在其他窗口后
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.StartPosition = 'CenterScreen'
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = ${psLiteral(title)}
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`
  const args = ['-NoProfile', '-NonInteractive', '-STA', '-Command', script]
  const { stdout } = await execFileAsync('powershell.exe', args, {
    windowsHide: false,
    maxBuffer: 1024 * 1024,
  }).catch(async (err: NodeJS.ErrnoException) => {
    // 没有 Windows PowerShell 时退回 PowerShell 7
    if (err.code === 'ENOENT') {
      return execFileAsync('pwsh.exe', args, { windowsHide: false, maxBuffer: 1024 * 1024 })
    }
    throw err
  })
  const selected = stdout.trim()
  if (!selected) return { path: null, cancelled: true }
  return { path: resolve(selected), cancelled: false }
}

async function pickMac(title: string): Promise<PickFolderResult> {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      `POSIX path of (choose folder with prompt ${appleScriptString(title)})`,
    ])
    const selected = stdout.trim().replace(/\/$/, '')
    if (!selected) return { path: null, cancelled: true }
    return { path: resolve(selected), cancelled: false }
  } catch (err) {
    // 用户点取消时 osascript 退出码非 0
    if (isUserCancel(err)) return { path: null, cancelled: true }
    throw err
  }
}

async function pickLinux(title: string): Promise<PickFolderResult> {
  try {
    const { stdout } = await execFileAsync('zenity', [
      '--file-selection',
      '--directory',
      `--title=${title}`,
    ])
    const selected = stdout.trim()
    if (!selected) return { path: null, cancelled: true }
    return { path: resolve(selected), cancelled: false }
  } catch (err) {
    if (isUserCancel(err)) {
      // zenity 不可用时再试 kdialog
      try {
        const { stdout } = await execFileAsync('kdialog', ['--getexistingdirectory', '.', title])
        const selected = stdout.trim()
        if (!selected) return { path: null, cancelled: true }
        return { path: resolve(selected), cancelled: false }
      } catch (inner) {
        if (isUserCancel(inner)) return { path: null, cancelled: true }
        throw Object.assign(
          new Error('需要安装 zenity 或 kdialog 才能弹出系统选文件夹对话框'),
          { statusCode: 501 },
        )
      }
    }
    throw err
  }
}

function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isUserCancel(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: number | string }).code
  // zenity cancel=1; osascript cancel=-128; kdialog cancel=1
  return code === 1 || code === '1' || code === 128 || code === -128
}
