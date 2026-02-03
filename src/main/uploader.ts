import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Config } from './config'
import { GoogleDriveUploader, createZipArchive } from './google-drive-uploader'

interface UploadData {
  stats: {
    startTime: string
    endTime: string | null
    totalScreenshots: number
    totalActiveSeconds: number
    appSummary: Record<string, number>
  }
  screenshots: Array<{
    id: string
    timestamp: string
    appName: string
    windowTitle: string
    filePath: string
    thumbnailPath: string
    durationSeconds: number
  }>
  dataDir: string
}

export class Uploader {
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  async upload(data: UploadData): Promise<{ success: boolean; message: string }> {
    const { stats, screenshots, dataDir } = data

    // メタデータを作成
    const metadata = {
      export_version: '1.0',
      exported_at: new Date().toISOString(),
      token: this.config.token,
      subject_name: this.config.subject_name,
      project_name: this.config.project_name,
      device: {
        os: process.platform === 'darwin' ? 'macOS' : 'Windows',
        hostname: os.hostname(),
      },
      period: {
        start: stats.startTime,
        end: stats.endTime || new Date().toISOString(),
      },
      total_active_seconds: stats.totalActiveSeconds,
      app_summary: stats.appSummary,
      screenshots_count: screenshots.length,
      events: screenshots.map((s) => ({
        timestamp: s.timestamp,
        app: s.appName,
        title: s.windowTitle,
        duration_seconds: s.durationSeconds,
        screenshot: path.basename(s.filePath),
      })),
    }

    // Google Drive設定がある場合はGoogle Driveにアップロード
    if (this.config.google_drive) {
      return await this.uploadToGoogleDrive(metadata, dataDir)
    }

    // Google Drive設定がない場合はAPIにアップロード
    return await this.uploadToApi(metadata, screenshots, dataDir)
  }

  /**
   * Google Driveにアップロード
   */
  private async uploadToGoogleDrive(
    metadata: object & { google_drive_file_id?: string; google_drive_link?: string },
    dataDir: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const gdrive = new GoogleDriveUploader(
        {
          client_id: this.config.google_drive!.client_id,
          client_secret: this.config.google_drive!.client_secret,
          refresh_token: this.config.google_drive!.refresh_token,
        },
        this.config.google_drive!.folder_id
      )

      // ZIPファイルを一時フォルダに作成（ファイル名は日時のみ、対象者名はフォルダで管理）
      const now = new Date()
      const dateStr = now.toISOString().split('T')[0] // 2026-02-02
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-') // 19-30-00
      const zipFileName = `${dateStr}_${timeStr}.zip`
      const zipFilePath = path.join(os.tmpdir(), zipFileName)

      console.log('Creating ZIP archive...')
      await createZipArchive(dataDir, zipFilePath, metadata)

      console.log('Uploading to Google Drive...')
      const result = await gdrive.uploadZip(
        zipFilePath,
        zipFileName,
        this.config.project_name,
        this.config.subject_name // 対象者名でサブフォルダを作成
      )

      // 一時ファイルを削除
      if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath)
      }

      if (result.success) {
        // メタデータのみをAPIに送信（ファイルパスを含む）
        await this.sendMetadataToApi({
          ...metadata,
          google_drive_file_id: result.fileId,
          google_drive_link: result.webViewLink,
        })

        return {
          success: true,
          message: 'Google Driveにアップロードしました',
        }
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      console.error('Google Drive upload error:', error)
      return {
        success: false,
        message: `アップロード失敗: ${error}`,
      }
    }
  }

  /**
   * メタデータのみをAPIに送信
   */
  private async sendMetadataToApi(metadata: object): Promise<void> {
    try {
      const fetch = (await import('node-fetch')).default
      await fetch(`${this.config.api_url}/api/recorder/metadata`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Subject-Token': this.config.token,
        },
        body: JSON.stringify(metadata),
      })
    } catch (error) {
      console.error('Failed to send metadata to API:', error)
      // メタデータ送信失敗は致命的ではないので続行
    }
  }

  /**
   * APIに直接アップロード（Google Drive設定がない場合のフォールバック）
   */
  private async uploadToApi(
    metadata: object,
    screenshots: UploadData['screenshots'],
    dataDir: string
  ): Promise<{ success: boolean; message: string }> {
    const FormData = (await import('form-data')).default
    const formData = new FormData()

    formData.append('metadata', JSON.stringify(metadata), {
      contentType: 'application/json',
      filename: 'metadata.json',
    })

    for (const screenshot of screenshots) {
      const fullPath = path.join(dataDir, 'screenshots', path.basename(screenshot.filePath))
      if (fs.existsSync(fullPath)) {
        formData.append('screenshots', fs.createReadStream(fullPath), {
          filename: path.basename(screenshot.filePath),
        })
      }
    }

    const fetch = (await import('node-fetch')).default
    const response = await fetch(`${this.config.api_url}/api/recorder/upload`, {
      method: 'POST',
      headers: {
        'X-Subject-Token': this.config.token,
        ...formData.getHeaders(),
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Upload failed: ${response.status} - ${errorText}`)
    }

    const result = (await response.json()) as { success: boolean; message: string }
    return result
  }
}
