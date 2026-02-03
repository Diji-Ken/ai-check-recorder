import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// 動的インポート用の型
type ScreenshotFn = (options?: { format?: 'jpg' | 'png' }) => Promise<Buffer>
type ActiveWinFn = () => Promise<{
  owner: { name: string }
  title: string
} | undefined>

let screenshotFn: ScreenshotFn
let activeWinFn: ActiveWinFn

interface RecorderOptions {
  intervalMs: number
  dataDir: string
  excludedApps?: string[]
}

interface ScreenshotRecord {
  id: string
  timestamp: string
  appName: string
  windowTitle: string
  filePath: string
  thumbnailPath: string
  durationSeconds: number
}

interface RecordingStats {
  startTime: string
  endTime: string | null
  totalScreenshots: number
  totalActiveSeconds: number
  appSummary: Record<string, number>
}

export class Recorder {
  private options: RecorderOptions
  private timer: NodeJS.Timeout | null = null
  private recording = false
  private paused = false
  private screenshots: ScreenshotRecord[] = []
  private startTime: Date | null = null
  private lastWindowInfo: { app: string; title: string; since: Date } | null = null
  private appUsage: Record<string, number> = {}

  // デフォルトで除外するアプリ
  private defaultExcludedApps = [
    'LINE',
    'Slack',
    'Discord',
    'メッセージ',
    'Messages',
    'FaceTime',
    'Zoom',
    'Microsoft Teams',
  ]

  constructor(options: RecorderOptions) {
    this.options = {
      ...options,
      excludedApps: options.excludedApps || this.defaultExcludedApps,
    }

    // データディレクトリを作成
    if (!fs.existsSync(this.options.dataDir)) {
      fs.mkdirSync(this.options.dataDir, { recursive: true })
    }
    const screenshotsDir = path.join(this.options.dataDir, 'screenshots')
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true })
    }
    const thumbnailsDir = path.join(this.options.dataDir, 'thumbnails')
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true })
    }
  }

  async start(): Promise<void> {
    // 動的インポート
    const screenshotModule = await import('screenshot-desktop')
    screenshotFn = screenshotModule.default || screenshotModule
    const activeWinModule = await import('active-win')
    activeWinFn = activeWinModule.default

    this.recording = true
    this.paused = false
    this.startTime = new Date()
    this.screenshots = []
    this.appUsage = {}

    console.log('Recording started')
    this.scheduleCapture()
  }

  stop(): void {
    this.recording = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    // 最後のウィンドウの使用時間を記録
    this.updateWindowDuration()

    console.log('Recording stopped')
  }

  pause(): void {
    this.paused = true
    this.updateWindowDuration()
    console.log('Recording paused')
  }

  resume(): void {
    this.paused = false
    this.lastWindowInfo = null
    console.log('Recording resumed')
  }

  isRecording(): boolean {
    return this.recording && !this.paused
  }

  private scheduleCapture(): void {
    if (!this.recording) return

    this.timer = setTimeout(async () => {
      if (!this.paused) {
        await this.capture()
      }
      this.scheduleCapture()
    }, this.options.intervalMs)
  }

  private async capture(): Promise<void> {
    try {
      // アクティブウィンドウを取得（失敗しても続行）
      let appName = 'Unknown'
      let windowTitle = ''

      // active-winは権限ダイアログが頻繁に出るため、一旦無効化
      // 権限が付与されている環境では有効化可能
      const USE_ACTIVE_WIN = false
      
      if (USE_ACTIVE_WIN) {
        try {
          const window = await activeWinFn()
          if (window) {
            appName = window.owner.name
            windowTitle = window.title
          }
        } catch (activeWinError) {
          // active-winの権限エラーは無視して続行
          console.log('Active window info unavailable (permission required)')
        }
      }

      // 除外アプリチェック（アプリ名が取得できた場合のみ）
      if (appName !== 'Unknown' && this.isExcludedApp(appName)) {
        console.log('Excluded app:', appName)
        return
      }

      // ウィンドウ使用時間を更新
      if (appName !== 'Unknown') {
        this.updateWindowDuration()
        this.lastWindowInfo = {
          app: appName,
          title: windowTitle,
          since: new Date(),
        }
      }

      // スクリーンショットを撮影
      const timestamp = new Date()
      const id = crypto.randomUUID()
      const filename = `${timestamp.toISOString().replace(/[:.]/g, '-')}.jpg`
      const filePath = path.join(this.options.dataDir, 'screenshots', filename)
      const thumbnailPath = path.join(this.options.dataDir, 'thumbnails', filename)

      const imgBuffer = await screenshotFn({ format: 'jpg' })

      // フルサイズを保存
      fs.writeFileSync(filePath, imgBuffer)

      // サムネイルは同じファイルをコピー（本来はリサイズすべきだが簡略化）
      fs.writeFileSync(thumbnailPath, imgBuffer)

      // 記録を追加
      const record: ScreenshotRecord = {
        id,
        timestamp: timestamp.toISOString(),
        appName,
        windowTitle,
        filePath,
        thumbnailPath,
        durationSeconds: 0,
      }

      this.screenshots.push(record)
      console.log(`Captured: ${appName} - ${windowTitle}`)
    } catch (error) {
      console.error('Capture error:', error)
    }
  }

  private isExcludedApp(appName: string): boolean {
    return this.options.excludedApps!.some((excluded) =>
      appName.toLowerCase().includes(excluded.toLowerCase())
    )
  }

  private updateWindowDuration(): void {
    if (!this.lastWindowInfo) return

    const now = new Date()
    const durationSeconds = Math.floor(
      (now.getTime() - this.lastWindowInfo.since.getTime()) / 1000
    )

    // アプリ使用時間を加算
    const app = this.lastWindowInfo.app
    this.appUsage[app] = (this.appUsage[app] || 0) + durationSeconds
  }

  getStats(): RecordingStats {
    this.updateWindowDuration()

    const totalActiveSeconds = Object.values(this.appUsage).reduce((a, b) => a + b, 0)

    return {
      startTime: this.startTime?.toISOString() || '',
      endTime: this.recording ? null : new Date().toISOString(),
      totalScreenshots: this.screenshots.length,
      totalActiveSeconds,
      appSummary: { ...this.appUsage },
    }
  }

  getScreenshots(): ScreenshotRecord[] {
    return this.screenshots.map((s) => ({
      ...s,
      // パスはファイル名のみ返す（セキュリティ）
      filePath: path.basename(s.filePath),
      thumbnailPath: path.basename(s.thumbnailPath),
    }))
  }

  deleteScreenshot(id: string): boolean {
    const index = this.screenshots.findIndex((s) => s.id === id)
    if (index === -1) return false

    const record = this.screenshots[index]

    // ファイルを削除
    try {
      if (fs.existsSync(record.filePath)) {
        fs.unlinkSync(record.filePath)
      }
      if (fs.existsSync(record.thumbnailPath)) {
        fs.unlinkSync(record.thumbnailPath)
      }
    } catch (error) {
      console.error('Failed to delete screenshot files:', error)
    }

    this.screenshots.splice(index, 1)
    return true
  }

  exportData(): {
    stats: RecordingStats
    screenshots: ScreenshotRecord[]
    dataDir: string
  } {
    return {
      stats: this.getStats(),
      screenshots: this.screenshots,
      dataDir: this.options.dataDir,
    }
  }
}
