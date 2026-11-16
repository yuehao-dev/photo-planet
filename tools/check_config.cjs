#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(process.argv[2] || path.join(__dirname, '../config/site.js'));
const issues = [];
try {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { timeout: 1000 });
  const c = context.window.SITE_CONFIG;
  if (!c || typeof c !== 'object') throw Error('Missing window.SITE_CONFIG');
  const text = (value, label, max, empty = false) => { if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) issues.push(label); };
  const numeric = (value, label, min, max) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) issues.push(label); };
  text(c.people?.her, 'people.her (1–12 characters)', 12); text(c.people?.me, 'people.me (1–12 characters)', 12);
  text(c.people?.system, 'people.system', 100); text(c.site?.title, 'site.title (1–20 characters)', 20);
  text(c.site?.note, 'site.note (0–100 characters)', 100, true);
  const choices = { theme: ['cream','rose','sage','night'], columns: ['auto','1','2','3','4'], spacing: ['compact','cozy','airy'], width: ['narrow','cozy','wide'], fit: ['cover','contain'], hero: ['favorites','latest','shuffle'], motion: ['light','off'], chatSpacing: ['compact','cozy','airy'], chatAlign: ['bubbles','left'], chatMedia: ['auto','tap'] };
  for (const [key, options] of Object.entries(choices)) if (!options.includes(c.preferences?.[key])) issues.push('preferences.' + key);
  if (!/^#[a-f0-9]{6}$/i.test(c.preferences?.accent || '')) issues.push('preferences.accent');
  if (![1,2,3].includes(c.preferences?.preload)) issues.push('preferences.preload');
  if (![16,48,96].includes(c.preferences?.cacheMB)) issues.push('preferences.cacheMB');
  numeric(c.preferences?.chatFont, 'preferences.chatFont', 13, 22);
  if (c.together?.enabled && (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.together.since || '') || !Number.isFinite(Date.parse(c.together.since)))) issues.push('together.since (ISO timestamp with timezone)');
  numeric(c.music?.volume, 'music.volume', 0, 1); numeric(c.music?.fadeSeconds, 'music.fadeSeconds', 1, 20);
  numeric(c.music?.chatDuckVolume, 'music.chatDuckVolume', 0, 1);
  const seasons = ['spring','summer','autumn','winter'];
  const months = seasons.flatMap(s => c.seasons?.months?.[s] || []);
  if (months.length !== 12 || new Set(months).size !== 12 || months.some(n => !Number.isInteger(n) || n < 1 || n > 12)) issues.push('seasons.months (cover months 1–12 exactly once)');
  if (!seasons.includes(c.seasons?.initial)) issues.push('seasons.initial');
  if (c.music?.enabled && (!Array.isArray(c.music.sets) || !c.music.sets.length)) issues.push('music.sets');
  for (const set of c.music?.sets || []) {
    if (!set.id || !['tracks','stems'].includes(set.format)) issues.push('music.sets format/id');
    if (set.format === 'tracks' && seasons.some(s => !(typeof set.tracks?.[s] === 'string' && set.tracks[s] || Array.isArray(set.tracks?.[s]) && set.tracks[s].length && set.tracks[s].every(t => typeof t === 'string' && t)))) issues.push('music.sets tracks (all four seasons required)');
  }
  for (const [key, min, max] of [['previewLines',1,12],['maxVisibleChunks',1,5],['searchLimit',10,500],['preloadPx',200,2400],['requestTimeoutMs',3000,60000],['indexRefreshMs',5000,300000],['dayCacheEntries',1,64],['chunkCacheEntries',2,128]]) numeric(c.chat?.[key], 'chat.' + key, min, max);
  for (const [id, date] of Object.entries(c.chat?.photoDateOverrides || {})) {
    const parsed = new Date(date + 'T12:00:00Z');
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) issues.push('chat.photoDateOverrides');
  }
  for (const pair of c.chat?.textReplacements || []) if (!pair || typeof pair.from !== 'string' || !pair.from.length || pair.from.length > 80 || typeof pair.to !== 'string' || pair.to.length > 160) issues.push('chat.textReplacements');
  if (c.media?.signedUrls && !/^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(c.media.signedHost || '')) issues.push('media.signedHost');
  function secrets(value) { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (/^(accessKeyId|accessKeySecret|password|sessionSecret|secretAccessKey)$/i.test(key)) issues.push('Server-only credential field found in public config'); secrets(child); } }
  secrets(c);
} catch (error) { issues.push(error instanceof SyntaxError ? 'JavaScript syntax error' : error.message); }
console.log(JSON.stringify({ passed: !issues.length, issues }, null, 2));
process.exitCode = issues.length ? 1 : 0;
