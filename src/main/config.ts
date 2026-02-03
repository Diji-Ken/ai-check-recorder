import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface Config {
  token: string
  api_url: string
  subject_name: string
  project_name: string
  // 調査期間設定
  recording_start_date?: string // 調査開始日 (ISO8601)
  recording_end_date?: string // 調査終了日 (ISO8601) - この日時を過ぎると自動終了
  // Google Drive設定（OAuth方式）
  google_drive?: {
    client_id: string
    client_secret: string
    refresh_token: string
    folder_id: string // アップロード先フォルダID
  }
}

// 設定ファイルのパスを取得
function getConfigPaths(): string[] {
  return [
    // ユーザーデータフォルダ（初回設定後に保存）
    path.join(app.getPath('userData'), 'config.json'),
    // パッケージ済みアプリの場合（同梱されたconfig.json）
    path.join(process.resourcesPath || '', 'config.json'),
    // 開発モードの場合（プロジェクトルート）
    path.join(__dirname, '..', '..', '..', 'config.json'),
    path.join(__dirname, '..', '..', 'config.json'),
    path.join(process.cwd(), 'config.json'),
  ]
}

// 設定ファイルを読み込み（見つからない場合はnull）
export function loadConfig(): Config | null {
  const configPaths = getConfigPaths()

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      console.log('Loading config from:', configPath)
      try {
        const content = fs.readFileSync(configPath, 'utf8')
        return JSON.parse(content) as Config
      } catch (error) {
        console.error('Config parse error:', error)
      }
    }
  }

  return null
}

// 設定をユーザーデータフォルダに保存
export function saveConfig(config: Config): void {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  console.log('Config saved to:', configPath)
}

// APIから設定を取得（トークンベース）
export async function fetchConfigFromApi(apiUrl: string, token: string): Promise<Config | null> {
  try {
    const fetch = (await import('node-fetch')).default
    const response = await fetch(`${apiUrl}/api/invite/${token}/config`)

    if (!response.ok) {
      console.error('API error:', response.status)
      return null
    }

    const data = (await response.json()) as Config
    return data
  } catch (error) {
    console.error('Fetch config error:', error)
    return null
  }
}
