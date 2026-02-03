const fs = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const fetch = (await import('node-fetch')).default;
  const archiver = (await import('archiver')).default;
  
  const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  const dataDir = path.join(os.homedir(), 'Library/Application Support/ai-check-recorder/recordings');
  
  // アクセストークン取得
  console.log('アクセストークン取得中...');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google_drive.client_id,
      client_secret: config.google_drive.client_secret,
      refresh_token: config.google_drive.refresh_token,
      grant_type: 'refresh_token'
    }).toString()
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  console.log('アクセストークン取得成功');
  
  // ZIP作成
  const zipPath = path.join(os.tmpdir(), 'test-upload-oauth.zip');
  console.log('ZIP作成中:', zipPath);
  
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      console.log('ZIP作成完了:', archive.pointer(), 'bytes');
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    
    // スクショを3枚追加
    const screenshotsDir = path.join(dataDir, 'screenshots');
    if (fs.existsSync(screenshotsDir)) {
      const files = fs.readdirSync(screenshotsDir).slice(0, 3);
      for (const file of files) {
        archive.file(path.join(screenshotsDir, file), { name: 'screenshots/' + file });
      }
    }
    
    archive.append(JSON.stringify({ test: true, timestamp: new Date().toISOString() }), { name: 'metadata.json' });
    archive.finalize();
  });
  
  // Google Driveにアップロード
  const fileBuffer = fs.readFileSync(zipPath);
  const boundary = '-------314159265358979323846';
  const fileName = 'test-upload_' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
  
  const metadata = { 
    name: fileName, 
    parents: [config.google_drive.folder_id] 
  };
  
  const multipartBody = Buffer.concat([
    Buffer.from('\r\n--' + boundary + '\r\n'),
    Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from('\r\n--' + boundary + '\r\n'),
    Buffer.from('Content-Type: application/zip\r\n\r\n'),
    fileBuffer,
    Buffer.from('\r\n--' + boundary + '--'),
  ]);
  
  console.log('Google Driveにアップロード中...');
  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'multipart/related; boundary=' + boundary,
    },
    body: multipartBody,
  });
  
  const result = await uploadRes.json();
  console.log('アップロード結果:', JSON.stringify(result, null, 2));
  
  fs.unlinkSync(zipPath);
}

main().catch(console.error);
