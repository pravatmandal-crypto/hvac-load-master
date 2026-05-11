/**
 * Sets CORS on Firebase Storage bucket after it has been created in the Firebase Console.
 * Run: node set-cors.mjs
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import https from 'https';
import path from 'path';

const bucket = 'gen-lang-client-0856391333.firebasestorage.app';
const corsConfig = JSON.parse(readFileSync('./cors.json', 'utf8'));

const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const configPath = path.join(homedir(), '.config', 'configstore', 'firebase-tools.json');
let refreshToken;
try {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  refreshToken = config?.tokens?.refresh_token;
  if (!refreshToken) throw new Error('no refresh_token');
} catch (e) {
  console.error('Could not read Firebase CLI token:', e.message);
  process.exit(1);
}

function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Refresh token
const tokenBody = new URLSearchParams({
  grant_type: 'refresh_token',
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
  refresh_token: refreshToken,
}).toString();

const tokenRes = await httpsReq({
  hostname: 'oauth2.googleapis.com',
  path: '/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
}, tokenBody);

if (tokenRes.status !== 200) { console.error('Token refresh failed:', tokenRes.body); process.exit(1); }
const { access_token } = JSON.parse(tokenRes.body);
console.log('✓ Got access token');

// Patch CORS on the bucket
const corsBody = JSON.stringify({ cors: corsConfig });
const corsRes = await httpsReq({
  hostname: 'storage.googleapis.com',
  path: `/storage/v1/b/${encodeURIComponent(bucket)}`,
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${access_token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(corsBody),
  },
}, corsBody);

if (corsRes.status === 200) {
  console.log('✓ CORS configured successfully on:', bucket);
} else if (corsRes.status === 404) {
  console.error('✗ Bucket not found. Have you activated Firebase Storage in the Firebase Console?');
  console.error('  → https://console.firebase.google.com/project/gen-lang-client-0856391333/storage');
} else {
  console.error(`✗ Failed (${corsRes.status}):`, corsRes.body.slice(0, 300));
}
