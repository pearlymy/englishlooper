/**
 * Set CORS on Firebase Storage bucket using Firebase CLI credentials.
 * Run: node set-cors.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const BUCKET = 'englishlooper.firebasestorage.app';

const CORS_CONFIG = [
  {
    origin: [
      'https://englishlooper.web.app',
      'https://englishlooper.firebaseapp.com',
      'http://localhost:8081',
      'http://localhost:19006'
    ],
    method: ['GET', 'HEAD'],
    maxAgeSeconds: 3600,
    responseHeader: ['Content-Type', 'Content-Length', 'Content-Range']
  }
];

async function getAccessToken() {
  const configPath = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const refreshToken = config.tokens.refresh_token;

  // Exchange refresh token for access token
  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi'
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.access_token) resolve(json.access_token);
        else reject(new Error('Failed to get access token: ' + data));
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function setCors(accessToken) {
  const body = JSON.stringify({ cors: CORS_CONFIG });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'storage.googleapis.com',
      path: `/storage/v1/b/${BUCKET}?fields=cors`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ CORS successfully set on', BUCKET);
          console.log(data);
          resolve();
        } else {
          console.error('❌ Failed:', res.statusCode, data);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    console.log('Getting access token from Firebase CLI credentials...');
    const token = await getAccessToken();
    console.log('Got access token. Setting CORS on bucket:', BUCKET);
    await setCors(token);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
