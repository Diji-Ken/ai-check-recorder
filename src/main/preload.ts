import { contextBridge, ipcRenderer } from 'electron'

// レンダラープロセスに公開するAPI
contextBridge.exposeInMainWorld('electronAPI', {
  // 設定取得
  getConfig: () => ipcRenderer.invoke('get-config'),

  // 記録状態
  getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),
  getRecordingStats: () => ipcRenderer.invoke('get-recording-stats'),
  pauseRecording: () => ipcRenderer.send('pause-recording'),
  resumeRecording: () => ipcRenderer.send('resume-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),

  // スクリーンショット
  getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
  deleteScreenshot: (id: string) => ipcRenderer.invoke('delete-screenshot', id),

  // アップロード
  uploadData: () => ipcRenderer.invoke('upload-data'),

  // イベントリスナー
  onConfigLoaded: (callback: (data: { subjectName: string; projectName: string }) => void) => {
    ipcRenderer.on('config-loaded', (_, data) => callback(data))
  },
  onRecordingStatus: (callback: (isRecording: boolean) => void) => {
    ipcRenderer.on('recording-status', (_, status) => callback(status))
  },
  onShowUploadScreen: (callback: () => void) => {
    ipcRenderer.on('show-upload-screen', () => callback())
  },
})
