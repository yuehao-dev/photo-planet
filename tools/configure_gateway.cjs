#!/usr/bin/env node
'use strict';
// Reads credentials from process environment. Never prints their values.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateConfig } = require('../deploy/oss-gateway/server.cjs');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output) { console.error('Usage: node --env-file=/outside/.env tools/configure_gateway.cjs /outside/gateway.json'); process.exit(1); }
const destination = path.resolve(output);
if (destination === root || destination.startsWith(root + path.sep)) { console.error('Keep server credentials outside the repository and web root.'); process.exit(1); }
function required(name) { const value = process.env[name]; if (!value) throw Error('Missing ' + name); return value; }
try {
  const password = required('ALBUM_PASSWORD');
  if (password.length < 12 || password.length > 256 || /[\x00-\x1f\x7f]/.test(password)) throw Error('Choose a password of 12–256 characters without control characters.');
  const salt = crypto.randomBytes(32).toString('hex');
  const auth = { username: required('ALBUM_USERNAME'), usernameOnly: false, caseInsensitive: true,
    passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 24 * 1024 * 1024 }).toString('hex'),
    sessionSecret: crypto.randomBytes(32).toString('hex'), publicOrigin: required('ALBUM_PUBLIC_ORIGIN'),
    basePath: process.env.ALBUM_BASE_PATH || '/album/',
    loginTitle: process.env.ALBUM_LOGIN_TITLE || '来照片星球坐坐。', loginNote: process.env.ALBUM_LOGIN_NOTE || '那些小小的开心，都收在这里。',
    maxFailures: Number(process.env.ALBUM_MAX_FAILURES || 5), windowSeconds: Number(process.env.ALBUM_FAILURE_WINDOW || 900), lockSeconds: Number(process.env.ALBUM_LOCK_SECONDS || 900) };
  const config = { endpoint: required('ALBUM_OSS_ENDPOINT'), bucket: required('ALBUM_OSS_BUCKET'),
    accessKeyId: required('ALBUM_ACCESS_KEY_ID'), accessKeySecret: required('ALBUM_ACCESS_KEY_SECRET'),
    resources: {}, chatPrefix: required('ALBUM_CHAT_PREFIX'), chatPaths: [], auth };
  validateConfig(config);
  // Uploading and selecting a snapshot is explicit; credentials alone expose no files.
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(destination, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(config, null, 2) + '\n'); } finally { fs.closeSync(fd); }
  console.log('Created private gateway configuration. Resource allowlists are empty until you explicitly add them.');
} catch (e) { console.error(e.code === 'EEXIST' ? 'Output already exists; no credentials overwritten.' : e.message?.startsWith('Missing ') ? e.message : 'Configuration was not created. Check inputs and output permissions.'); process.exitCode = 1; }
