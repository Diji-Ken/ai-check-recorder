// 型定義
interface ElectronAPI {
  getConfig: () => Promise<{
    token: string
    api_url: string
    subject_name: string
    project_name: string
    support_contact?: string
  } | null>
  getRecordingStatus: () => Promise<boolean>
  getRecordingStats: () => Promise<{
    startTime: string
    endTime: string | null
    totalScreenshots: number
    totalActiveSeconds: number
    appSummary: Record<string, number>
  }>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: () => Promise<{
    startTime: string
    endTime: string | null
    totalScreenshots: number
    totalActiveSeconds: number
    appSummary: Record<string, number>
  }>
  getScreenshots: () => Promise<Array<{
    id: string
    timestamp: string
    appName: string
    windowTitle: string
    filePath: string
    thumbnailPath: string
  }>>
  deleteScreenshot: (id: string) => Promise<boolean>
  uploadData: () => Promise<{ success: boolean; error?: string }>
  onConfigLoaded: (callback: (data: { subjectName: string; projectName: string }) => void) => void
  onRecordingStatus: (callback: (isRecording: boolean) => void) => void
  onShowUploadScreen: (callback: () => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

// 画面要素
const screens = {
  main: document.getElementById('main-screen')!,
  upload: document.getElementById('upload-screen')!,
  complete: document.getElementById('complete-screen')!,
  error: document.getElementById('error-screen')!,
}

// 状態
let isRecording = true
let stats: {
  startTime: string
  endTime: string | null
  totalScreenshots: number
  totalActiveSeconds: number
  appSummary: Record<string, number>
} | null = null
let supportContact: string | null = null

// 画面切り替え
function showScreen(screenId: keyof typeof screens) {
  Object.values(screens).forEach((screen) => screen.classList.remove('active'))
  screens[screenId].classList.add('active')
}

// 時間フォーマット
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}時間${minutes}分`
  }
  return `${minutes}分`
}

// 日時フォーマット
function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

// 統計情報を更新
async function updateStats() {
  try {
    stats = await window.electronAPI.getRecordingStats()

    document.getElementById('stat-screenshots')!.textContent = String(stats.totalScreenshots)
    document.getElementById('stat-time')!.textContent = formatDuration(stats.totalActiveSeconds)

    // アプリ使用状況を更新
    const usageList = document.getElementById('usage-list')!
    usageList.innerHTML = ''

    const sortedApps = Object.entries(stats.appSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    for (const [app, seconds] of sortedApps) {
      const item = document.createElement('div')
      item.className = 'usage-item'
      item.innerHTML = `
        <span class="usage-app">${app}</span>
        <span class="usage-time">${formatDuration(seconds)}</span>
      `
      usageList.appendChild(item)
    }
  } catch (error) {
    console.error('Failed to update stats:', error)
  }
}

// 記録状態を更新
function updateRecordingStatus(recording: boolean) {
  isRecording = recording
  const indicator = document.getElementById('status-indicator')!
  const text = document.getElementById('status-text')!
  const pauseBtn = document.getElementById('btn-pause')!

  if (recording) {
    indicator.classList.remove('paused')
    text.textContent = '記録中'
    pauseBtn.textContent = '一時停止'
  } else {
    indicator.classList.add('paused')
    text.textContent = '一時停止中'
    pauseBtn.textContent = '記録を再開'
  }
}

// アップロード画面を表示
async function showUploadScreen() {
  // 記録を停止
  stats = await window.electronAPI.stopRecording()

  // サマリーを表示
  document.getElementById('summary-period')!.textContent =
    `${formatDateTime(stats.startTime)} 〜 ${formatDateTime(stats.endTime || new Date().toISOString())}`
  document.getElementById('summary-screenshots')!.textContent = `${stats.totalScreenshots}枚`
  document.getElementById('summary-time')!.textContent = formatDuration(stats.totalActiveSeconds)

  // スクリーンショットプレビューを表示
  const screenshots = await window.electronAPI.getScreenshots()
  const previewGrid = document.getElementById('preview-grid')!
  previewGrid.innerHTML = ''

  for (const screenshot of screenshots.slice(0, 30)) {
    const item = document.createElement('div')
    item.className = 'preview-item'
    item.dataset.id = screenshot.id
    item.innerHTML = `
      <img src="file://${screenshot.thumbnailPath}" alt="${screenshot.appName}" />
      <div class="delete-overlay">
        <span>削除</span>
      </div>
    `
    item.addEventListener('click', async () => {
      if (confirm('このスクリーンショットを削除しますか？')) {
        await window.electronAPI.deleteScreenshot(screenshot.id)
        item.remove()
        const countEl = document.getElementById('summary-screenshots')!
        const currentCount = parseInt(countEl.textContent || '0')
        countEl.textContent = `${currentCount - 1}枚`
      }
    })
    previewGrid.appendChild(item)
  }

  showScreen('upload')
}

// アップロード実行
async function uploadData() {
  const uploadBtn = document.getElementById('btn-upload') as HTMLButtonElement
  const progressDiv = document.getElementById('upload-progress')!
  const progressFill = document.getElementById('progress-fill')!
  const progressText = document.getElementById('progress-text')!

  uploadBtn.disabled = true
  progressDiv.style.display = 'block'
  progressFill.style.width = '30%'
  progressText.textContent = 'データを準備中...'

  try {
    progressFill.style.width = '60%'
    progressText.textContent = '送信中...'

    const result = await window.electronAPI.uploadData()

    if (result.success) {
      progressFill.style.width = '100%'
      progressText.textContent = '完了'
      setTimeout(() => {
        showScreen('complete')
      }, 500)
    } else {
      throw new Error(result.error || '送信に失敗しました')
    }
  } catch (error) {
    const contactMessage = supportContact
      ? `\n\n担当者: ${supportContact}`
      : '\n\n担当者にご連絡ください。'
    document.getElementById('error-message')!.textContent = `${String(error)}${contactMessage}`
    showScreen('error')
  }
}

// 初期化
async function init() {
  const currentConfig = await window.electronAPI.getConfig()
  supportContact = currentConfig?.support_contact?.trim() || null

  // イベントリスナーを設定
  window.electronAPI.onConfigLoaded((data) => {
    document.getElementById('project-name')!.textContent = data.projectName
    document.getElementById('subject-name')!.textContent = `${data.subjectName} 様`
  })

  window.electronAPI.onRecordingStatus((status) => {
    updateRecordingStatus(status)
  })

  window.electronAPI.onShowUploadScreen(() => {
    showUploadScreen()
  })

  // ボタンイベント
  document.getElementById('btn-pause')!.addEventListener('click', () => {
    if (isRecording) {
      window.electronAPI.pauseRecording()
      updateRecordingStatus(false)
    } else {
      window.electronAPI.resumeRecording()
      updateRecordingStatus(true)
    }
  })

  document.getElementById('btn-finish')!.addEventListener('click', () => {
    showUploadScreen()
  })

  document.getElementById('btn-upload')!.addEventListener('click', () => {
    uploadData()
  })

  document.getElementById('btn-close')!.addEventListener('click', () => {
    window.close()
  })

  document.getElementById('btn-retry')!.addEventListener('click', () => {
    showScreen('upload')
    const uploadBtn = document.getElementById('btn-upload') as HTMLButtonElement
    uploadBtn.disabled = false
    document.getElementById('upload-progress')!.style.display = 'none'
  })

  // 初期データを読み込み
  const config = await window.electronAPI.getConfig()
  if (config) {
    document.getElementById('project-name')!.textContent = config.project_name
    document.getElementById('subject-name')!.textContent = `${config.subject_name} 様`
  }

  // 統計情報を定期更新
  updateStats()
  setInterval(updateStats, 10000) // 10秒ごと
}

// DOM読み込み完了後に初期化
document.addEventListener('DOMContentLoaded', init)
