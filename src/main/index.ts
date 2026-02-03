import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } from 'electron'
import { systemPreferences } from 'electron'

// Dockにアイコンを表示しない（macOS）
if (process.platform === 'darwin') {
  app.dock?.hide()
}
import * as path from 'path'
import * as fs from 'fs'
import { Recorder } from './recorder'
import { Uploader } from './uploader'
import { loadConfig, saveConfig, fetchConfigFromApi, Config } from './config'

// === 画面収録権限チェック ===
async function checkScreenRecordingPermission(): Promise<boolean> {
  // Windowsでは権限不要
  if (process.platform !== 'darwin') {
    return true
  }

  // macOSの画面収録権限をチェック
  const hasPermission = systemPreferences.getMediaAccessStatus('screen') === 'granted'

  if (hasPermission) {
    // 権限あり → テスト撮影で実際に動作確認
    try {
      const screenshotModule = await import('screenshot-desktop')
      const screenshotFn = screenshotModule.default || screenshotModule
      const testImage = await screenshotFn({ format: 'jpg' })

      // 画像サイズで判定（権限がないと極端に小さい or デスクトップのみになる）
      // 通常のスクリーンショットは100KB以上
      if (testImage.length < 50000) {
        console.log('テスト撮影: 画像サイズが小さすぎます。権限が正しく設定されていない可能性があります。')
      } else {
        console.log('テスト撮影: 成功')
        return true
      }
    } catch (error) {
      console.error('テスト撮影エラー:', error)
    }
  }

  // 権限がない場合 → ダイアログを表示
  // Dockを一時的に表示（ダイアログを見やすくするため）
  app.dock?.show()

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: '画面収録の権限が必要です',
    message: '業務記録のために画面収録の権限が必要です',
    detail: `このアプリは1分ごとに画面のスクリーンショットを撮影します。

【設定手順】
1. 「システム設定を開く」をクリック
2. 「AI Check Recorder」を探してONにする
3. アプリを再起動する

※ 権限を付与しないと、ウィンドウの中身が記録されません。`,
    buttons: ['システム設定を開く', 'キャンセル'],
    defaultId: 0,
  })

  if (result.response === 0) {
    // システム設定を開く
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')

    // 再度ダイアログ
    await dialog.showMessageBox({
      type: 'info',
      title: '設定完了後に再起動してください',
      message: '権限を設定したら、このアプリを再起動してください',
      detail: `【手順】
1. システム設定で「AI Check Recorder」をONにする
2. このダイアログを閉じる
3. アプリを再度起動する`,
      buttons: ['OK'],
    })
  }

  app.dock?.hide()
  return false
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let recorder: Recorder | null = null
let config: Config | null = null

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    show: false,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer-dist/index.html'))
  }

  mainWindow.on('close', (event) => {
    // 閉じるボタンでは隠すだけ（完全終了はトレイから）
    event.preventDefault()
    mainWindow?.hide()
  })
}

function createTray() {
  // トレイアイコン（16x16のシンプルなアイコン）
  const iconPath = isDev
    ? path.join(__dirname, '../../assets/tray-icon.png')
    : path.join(process.resourcesPath, 'assets/tray-icon.png')

  // アイコンがない場合はデフォルトの空アイコンを作成
  let icon
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    // 16x16の赤い丸（録画中を示す）
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('AI Check Recorder - 記録中')

  updateTrayMenu()

  tray.on('click', () => {
    mainWindow?.show()
  })
}

function updateTrayMenu() {
  const isRecording = recorder?.isRecording() ?? false

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? '⏺ 記録中...' : '⏸ 一時停止中',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: isRecording ? '一時停止' : '記録を再開',
      click: () => {
        if (isRecording) {
          recorder?.pause()
        } else {
          recorder?.resume()
        }
        updateTrayMenu()
        mainWindow?.webContents.send('recording-status', recorder?.isRecording())
      },
    },
    { type: 'separator' },
    {
      label: '記録を終了して送信',
      click: async () => {
        mainWindow?.show()
        mainWindow?.webContents.send('show-upload-screen')
      },
    },
    { type: 'separator' },
    {
      label: 'アプリを終了',
      click: async () => {
        const result = await dialog.showMessageBox({
          type: 'warning',
          buttons: ['キャンセル', '終了'],
          defaultId: 0,
          title: '確認',
          message: 'アプリを終了しますか？',
          detail: '記録中のデータは保存されます。',
        })
        if (result.response === 1) {
          recorder?.stop()
          app.exit(0)
        }
      },
    },
  ])

  tray?.setContextMenu(contextMenu)
}

async function initializeApp() {
  // 設定ファイルを読み込み
  config = loadConfig()

  if (!config) {
    // config.jsonがない場合、トークン入力を求める
    app.dock?.show() // ダイアログを見やすくするため

    const result = await dialog.showMessageBox({
      type: 'question',
      title: '初期設定',
      message: '招待トークンを入力してください',
      detail: `招待ページで表示されたトークン（URLの末尾の文字列）を入力してください。

例: abc123-yamada-taro

トークンがない場合は、担当者から招待リンクを受け取ってください。`,
      buttons: ['トークンを入力', 'キャンセル'],
      defaultId: 0,
    })

    if (result.response === 1) {
      app.exit(0)
      return
    }

    // トークン入力ダイアログ（prompt機能がないので、シンプルなinput）
    // 実際の実装ではBrowserWindowでHTMLフォームを表示するのがベター
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'info',
      title: 'トークン入力',
      message: 'クリップボードからトークンを貼り付けてください',
      detail: `以下の手順で設定してください：

1. 招待ページのトークンをコピー
2. このダイアログの「OK」をクリック
3. 自動的にクリップボードからトークンを読み取ります`,
      buttons: ['OK（クリップボードから読み取り）', 'キャンセル'],
      defaultId: 0,
    })

    if (response === 1) {
      app.exit(0)
      return
    }

    // クリップボードからトークンを読み取り
    const { clipboard } = await import('electron')
    const token = clipboard.readText().trim()

    if (!token) {
      dialog.showErrorBox('エラー', 'トークンがクリップボードにありません。\n招待ページからトークンをコピーしてください。')
      app.exit(1)
      return
    }

    // APIから設定を取得
    const API_URL = 'https://ai-check-platform.vercel.app' // 本番URL
    
    dialog.showMessageBox({
      type: 'info',
      title: '設定取得中',
      message: '設定を取得しています...',
      buttons: [],
    })

    config = await fetchConfigFromApi(API_URL, token)

    if (!config) {
      dialog.showErrorBox('エラー', 'トークンが無効です。\n正しいトークンを入力してください。')
      app.exit(1)
      return
    }

    // 設定を保存
    saveConfig(config)
    
    await dialog.showMessageBox({
      type: 'info',
      title: '設定完了',
      message: `${config.subject_name} 様の設定が完了しました`,
      detail: `プロジェクト: ${config.project_name}\n\n記録を開始します。`,
      buttons: ['OK'],
    })

    app.dock?.hide()
  }

  // === 権限チェック＆テスト撮影 ===
  const permissionOk = await checkScreenRecordingPermission()
  if (!permissionOk) {
    // 権限がない場合、記録を開始せずに終了
    app.exit(0)
    return
  }

  // レコーダーを初期化
  recorder = new Recorder({
    intervalMs: 60000, // 60秒間隔
    dataDir: path.join(app.getPath('userData'), 'recordings'),
  })

  // 記録開始
  await recorder.start()

  createWindow()
  createTray()
  updateTrayMenu()

  // 初期状態を送信
  mainWindow?.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('config-loaded', {
      subjectName: config?.subject_name,
      projectName: config?.project_name,
    })
    mainWindow?.webContents.send('recording-status', true)
  })

  // 自動アップロードを設定（30分ごとにチェック、50枚以上で自動アップロード）
  setInterval(async () => {
    if (!recorder || !config) return

    const stats = recorder.getStats()
    const AUTO_UPLOAD_THRESHOLD = 50 // 50枚以上で自動アップロード

    if (stats.totalScreenshots >= AUTO_UPLOAD_THRESHOLD) {
      console.log(`自動アップロード開始: ${stats.totalScreenshots}枚`)

      try {
        const uploader = new Uploader(config)
        const data = recorder.exportData()
        const result = await uploader.upload(data)

        if (result.success) {
          console.log('自動アップロード成功')
          // アップロード成功後、古いデータをクリア（新しいセッション開始）
          recorder.stop()
          recorder = new Recorder({
            intervalMs: 60000,
            dataDir: path.join(app.getPath('userData'), 'recordings'),
          })
          await recorder.start()
        }
      } catch (error) {
        console.error('自動アップロード失敗:', error)
      }
    }
  }, 30 * 60 * 1000) // 30分ごとにチェック

  // リモート停止チェック（5分ごと）
  setInterval(async () => {
    if (!config) return

    try {
      const fetch = (await import('node-fetch')).default
      const response = await fetch(`${config.api_url}/api/recorder/status?token=${config.token}`)

      if (response.ok) {
        const data = await response.json() as { should_stop?: boolean; message?: string }

        if (data.should_stop) {
          console.log('リモート停止命令を受信:', data.message)

          // 最終アップロードを実行
          if (recorder) {
            const uploader = new Uploader(config)
            const exportData = recorder.exportData()
            await uploader.upload(exportData)
          }

          // 完了メッセージを表示
          await dialog.showMessageBox({
            type: 'info',
            title: '調査完了',
            message: '業務改善チェックが完了しました',
            detail: data.message || 'ご協力ありがとうございました。このアプリを終了します。',
          })

          // アプリを終了
          recorder?.stop()
          app.exit(0)
        }
      }
    } catch (error) {
      // ネットワークエラーは無視（オフライン時も動作継続）
      console.log('リモートステータスチェック失敗（ネットワーク）')
    }
  }, 5 * 60 * 1000) // 5分ごとにチェック

  // 調査期間終了チェック
  if (config.recording_end_date) {
    const checkEndDate = () => {
      const endDate = new Date(config!.recording_end_date!)
      const now = new Date()

      if (now >= endDate) {
        console.log('調査期間終了')
        // 最終アップロードを実行してから終了
        ;(async () => {
          if (recorder && config) {
            const uploader = new Uploader(config)
            const exportData = recorder.exportData()
            await uploader.upload(exportData)
          }

          await dialog.showMessageBox({
            type: 'info',
            title: '調査期間終了',
            message: '業務改善チェックの調査期間が終了しました',
            detail: 'ご協力ありがとうございました。このアプリを終了します。',
          })

          recorder?.stop()
          app.exit(0)
        })()
      }
    }

    // 1時間ごとにチェック
    setInterval(checkEndDate, 60 * 60 * 1000)
    // 起動時にもチェック
    checkEndDate()
  }
}

// IPC ハンドラー
ipcMain.handle('get-config', () => {
  return config
})

ipcMain.handle('get-recording-status', () => {
  return recorder?.isRecording() ?? false
})

ipcMain.handle('get-recording-stats', () => {
  return recorder?.getStats()
})

ipcMain.handle('stop-recording', async () => {
  recorder?.stop()
  updateTrayMenu()
  return recorder?.getStats()
})

ipcMain.handle('get-screenshots', async () => {
  return recorder?.getScreenshots() ?? []
})

ipcMain.handle('delete-screenshot', async (_, id: string) => {
  return recorder?.deleteScreenshot(id)
})

ipcMain.handle('upload-data', async () => {
  if (!config || !recorder) {
    return { success: false, error: '設定が読み込まれていません' }
  }

  const uploader = new Uploader(config)
  const data = recorder.exportData()

  try {
    const result = await uploader.upload(data)
    return { success: true, result }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.on('pause-recording', () => {
  recorder?.pause()
  updateTrayMenu()
})

ipcMain.on('resume-recording', () => {
  recorder?.resume()
  updateTrayMenu()
})

// アプリ起動
app.whenReady().then(initializeApp)

app.on('window-all-closed', () => {
  // トレイに常駐するため、ウィンドウが閉じてもアプリは終了しない
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  } else {
    mainWindow.show()
  }
})
