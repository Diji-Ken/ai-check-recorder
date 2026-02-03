import * as fs from 'fs'
import * as path from 'path'

interface OAuthConfig {
  client_id: string
  client_secret: string
  refresh_token: string
}

interface UploadResult {
  success: boolean
  fileId?: string
  webViewLink?: string
  error?: string
}

/**
 * OAuth認証を使用したGoogle Driveアップローダー
 */
export class GoogleDriveUploader {
  private config: OAuthConfig
  private folderId: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(config: OAuthConfig, folderId: string) {
    this.config = config
    this.folderId = folderId
  }

  /**
   * リフレッシュトークンからアクセストークンを取得
   */
  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)

    // トークンがまだ有効なら再利用
    if (this.accessToken && now < this.tokenExpiry - 60) {
      return this.accessToken
    }

    const fetch = (await import('node-fetch')).default

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.client_id,
        client_secret: this.config.client_secret,
        refresh_token: this.config.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to get access token: ${error}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiry = now + data.expires_in
    return this.accessToken
  }

  /**
   * ZIPファイルをGoogle Driveにアップロード
   */
  async uploadZip(
    zipFilePath: string,
    fileName: string,
    projectName: string,
    subjectName?: string
  ): Promise<UploadResult> {
    try {
      const accessToken = await this.getAccessToken()
      const fetch = (await import('node-fetch')).default

      // プロジェクトフォルダを取得または作成
      const projectFolderId = await this.getOrCreateFolder(projectName, this.folderId, accessToken)

      // 対象者フォルダを取得または作成（指定がある場合）
      let targetFolderId = projectFolderId
      if (subjectName) {
        targetFolderId = await this.getOrCreateFolder(subjectName, projectFolderId, accessToken)
      }

      // ファイルをアップロード
      const fileSize = fs.statSync(zipFilePath).size
      const fileBuffer = fs.readFileSync(zipFilePath)

      const metadata = {
        name: fileName,
        parents: [targetFolderId],
      }

      if (fileSize < 5 * 1024 * 1024) {
        // シンプルアップロード（5MB以下）
        const boundary = '-------314159265358979323846'
        const delimiter = `\r\n--${boundary}\r\n`
        const closeDelimiter = `\r\n--${boundary}--`

        const multipartBody = Buffer.concat([
          Buffer.from(delimiter),
          Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
          Buffer.from(JSON.stringify(metadata)),
          Buffer.from(delimiter),
          Buffer.from('Content-Type: application/zip\r\n\r\n'),
          fileBuffer,
          Buffer.from(closeDelimiter),
        ])

        const response = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
          }
        )

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Upload failed: ${error}`)
        }

        const result = (await response.json()) as { id: string; webViewLink: string }
        return {
          success: true,
          fileId: result.id,
          webViewLink: result.webViewLink,
        }
      } else {
        // Resumable upload for large files
        const initResponse = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Type': 'application/zip',
              'X-Upload-Content-Length': String(fileSize),
            },
            body: JSON.stringify(metadata),
          }
        )

        if (!initResponse.ok) {
          const error = await initResponse.text()
          throw new Error(`Upload initiation failed: ${error}`)
        }

        const uploadUrl = initResponse.headers.get('location')
        if (!uploadUrl) {
          throw new Error('No upload URL received')
        }

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(fileSize),
            'Content-Type': 'application/zip',
          },
          body: fileBuffer,
        })

        if (!uploadResponse.ok) {
          const error = await uploadResponse.text()
          throw new Error(`File upload failed: ${error}`)
        }

        const result = (await uploadResponse.json()) as { id: string; webViewLink?: string }
        return {
          success: true,
          fileId: result.id,
          webViewLink: result.webViewLink,
        }
      }
    } catch (error) {
      console.error('Google Drive upload error:', error)
      return {
        success: false,
        error: String(error),
      }
    }
  }

  /**
   * フォルダを取得、なければ作成
   */
  private async getOrCreateFolder(
    folderName: string,
    parentId: string,
    accessToken: string
  ): Promise<string> {
    const fetch = (await import('node-fetch')).default

    const query = encodeURIComponent(
      `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )

    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!searchResponse.ok) {
      throw new Error(`Folder search failed: ${await searchResponse.text()}`)
    }

    const searchResult = (await searchResponse.json()) as { files: Array<{ id: string }> }

    if (searchResult.files && searchResult.files.length > 0) {
      return searchResult.files[0].id
    }

    // フォルダを作成
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    })

    if (!createResponse.ok) {
      throw new Error(`Folder creation failed: ${await createResponse.text()}`)
    }

    const createResult = (await createResponse.json()) as { id: string }
    console.log('Created folder:', folderName, createResult.id)
    return createResult.id
  }
}

/**
 * ZIPファイルを作成
 */
export async function createZipArchive(
  sourceDir: string,
  outputPath: string,
  metadataJson: object
): Promise<void> {
  const archiver = await import('archiver')

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver.default('zip', { zlib: { level: 9 } })

    output.on('close', () => {
      console.log(`ZIP created: ${archive.pointer()} bytes`)
      resolve()
    })

    archive.on('error', (err: Error) => {
      reject(err)
    })

    archive.pipe(output)

    // スクリーンショットフォルダを追加
    const screenshotsDir = path.join(sourceDir, 'screenshots')
    if (fs.existsSync(screenshotsDir)) {
      archive.directory(screenshotsDir, 'screenshots')
    }

    // サムネイルフォルダを追加
    const thumbnailsDir = path.join(sourceDir, 'thumbnails')
    if (fs.existsSync(thumbnailsDir)) {
      archive.directory(thumbnailsDir, 'thumbnails')
    }

    // メタデータJSONを追加
    archive.append(JSON.stringify(metadataJson, null, 2), {
      name: 'metadata.json',
    })

    archive.finalize()
  })
}
