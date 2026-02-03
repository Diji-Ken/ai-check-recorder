const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const saPath = '/Users/m/.config/gcloud/legacy_credentials/n8n-access@n8n-gsheets-integration-460814.iam.gserviceaccount.com/adc.json';
const folderId = '1Rc44T2n-EmWONIR2FHl8xgOIYdetwY0T';
const dataDir = path.join(os.homedir(), 'Library/Application Support/ai-check-recorder/recordings');

async function main() {
  const fetch = (await import('node-fetch')).default;
  const archiver = (await import('archiver')).default;
  
  // サービスアカウントを読み込み
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  
  // JWT生成
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(header + '.' + payload);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = header + '.' + payload + '.' + signature;
  
  // アクセストークン取得
  console.log('Getting access token...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  console.log('Got access token');
  
  // ZIPファイル作成
  const zipPath = path.join(os.tmpdir(), 'test-upload.zip');
  console.log('Creating ZIP at:', zipPath);
  
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      console.log('ZIP created:', archive.pointer(), 'bytes');
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    
    // スクショを3枚だけ追加（テスト用）
    const screenshotsDir = path.join(dataDir, 'screenshots');
    const files = fs.readdirSync(screenshotsDir).slice(0, 3);
    for (const file of files) {
      archive.file(path.join(screenshotsDir, file), { name: 'screenshots/' + file });
    }
    
    // メタデータ追加
    archive.append(JSON.stringify({ test: true, timestamp: new Date().toISOString() }), { name: 'metadata.json' });
    archive.finalize();
  });
  
  // Google Driveにアップロード
  const fileBuffer = fs.readFileSync(zipPath);
  const boundary = '-------314159265358979323846';
  const delimiter = '\r\n--' + boundary + '\r\n';
  const closeDelimiter = '\r\n--' + boundary + '--';
  
  const metadata = { name: 'test-upload_' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip', parents: [folderId] };
  
  const multipartBody = Buffer.concat([
    Buffer.from(delimiter),
    Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(delimiter),
    Buffer.from('Content-Type: application/zip\r\n\r\n'),
    fileBuffer,
    Buffer.from(closeDelimiter),
  ]);
  
  console.log('Uploading to Google Drive...');
  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'multipart/related; boundary=' + boundary,
    },
    body: multipartBody,
  });
  
  const result = await uploadRes.json();
  console.log('Upload result:', JSON.stringify(result, null, 2));
  
  // 一時ファイル削除
  fs.unlinkSync(zipPath);
}

main().catch(console.error);
