#!/usr/bin/env node
/**
 * Rebuilds the Broadcast Planner's embedded song library (planner.html) and
 * the derived planner-songs.json export from fresh station CSV exports.
 *
 * Usage:
 *   node scripts/update-song-library.js "<path to WCYT Library List.csv>" "<path to 2 Library List.csv>"
 *
 * Expected CSV columns (order doesn't matter, matched by header name):
 *   Source, CategoryID, Title, Artists, Album (WCYT only), Intro, Length, EndType, Tempo, Year
 *
 * Album art and (for 2.0, which has no Album column) album title aren't in
 * these exports, so they're carried over from the existing embedded library
 * by matching Source first, then Title+Artist. New songs simply come in
 * without art until enriched separately.
 */

const fs = require('fs');
const path = require('path');

const PLANNER_HTML = path.join(__dirname, '..', 'planner.html');
const SONGS_JSON    = path.join(__dirname, '..', 'planner-songs.json');

function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

const [, , wcytPath, pt20Path] = process.argv;
if (!wcytPath || !pt20Path) {
  fail('usage: node update-song-library.js <WCYT csv> <2.0 csv>');
}

// ── RFC4180-ish CSV parser (quoted fields, embedded commas/newlines, "" escapes) ──
function parseCSV(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''));
}

function loadRecords(csvPath) {
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf-8'));
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = (r[i] || '').trim(); });
    return rec;
  }).filter(rec => rec.Title && rec.Artists);
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// "00:03:25.147" or "09:02.95" -> {secs, dur}
function parseLength(len) {
  const parts = (len || '').trim().split(':');
  if (!parts.length || !parts[0]) return { secs: 0, dur: '0:00' };
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) { h = +parts[0]; m = +parts[1]; s = parseFloat(parts[2]); }
  else if (parts.length === 2) { m = +parts[0]; s = parseFloat(parts[1]); }
  else return { secs: 0, dur: '0:00' };
  const total = Math.round(h * 3600 + m * 60 + s);
  const dur = Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  return { secs: total, dur };
}

// ── Load existing embedded library (for album/art carry-over) ──
const html = fs.readFileSync(PLANNER_HTML, 'utf-8');
const songsMatch = html.match(/const SONGS = \{\r?\n(.*)\r?\n(.*)\r?\n\};/);
if (!songsMatch) fail('could not locate "const SONGS = {...};" block in planner.html');
const existing = {
  wcyt: JSON.parse('[' + songsMatch[1].replace(/^\s*wcyt:\s*\[/, '').replace(/\],?\s*$/, '') + ']'),
  pt20: JSON.parse('[' + songsMatch[2].replace(/^\s*pt20:\s*\[/, '').replace(/\],?\s*$/, '') + ']'),
};

const metaMatch = html.match(/const META\s*=\s*(\{.*?\});\r?\n/s);
if (!metaMatch) fail('could not locate "const META = {...};" block in planner.html');
const META = JSON.parse(metaMatch[1]);

function buildLookups(list) {
  const bySrc = new Map(), byTA = new Map();
  for (const s of list) {
    if (s.src) bySrc.set(s.src, s);
    const k = (s.title || '').toLowerCase() + '|' + (s.artist || '').toLowerCase();
    if (!byTA.has(k)) byTA.set(k, s);
  }
  return { bySrc, byTA };
}

function convertStation(csvPath, stationKey, hasAlbumCol) {
  const records = loadRecords(csvPath);
  const { bySrc, byTA } = buildLookups(existing[stationKey]);
  // Only playable-music categories make it into the library — unknown codes
  // (typos, one-off flags like "XXX") and non-music branding categories
  // (liners, sponsor spots, legal IDs, specialty-show-only pools like "BHM")
  // are excluded rather than carried in as orphaned/broken entries.
  const musicCats = new Set(Object.entries(META[stationKey].cats).filter(([, c]) => c.music).map(([code]) => code));
  const excludedCats = new Map();
  const seenSrc = new Set();
  let artHits = 0, albumHits = 0, dupes = 0;

  const songs = [];
  for (const rec of records) {
    const src = cleanText(rec.Source);
    if (!src) continue;
    if (seenSrc.has(src)) { dupes++; continue; }
    seenSrc.add(src);

    const cat = cleanText(rec.CategoryID);
    if (!musicCats.has(cat)) {
      excludedCats.set(cat, (excludedCats.get(cat) || 0) + 1);
      continue;
    }

    const title = cleanText(rec.Title);
    const artist = cleanText(rec.Artists);
    const { secs, dur } = parseLength(rec.Length);
    const year = cleanText(rec.Year);

    const prev = bySrc.get(src) || byTA.get(title.toLowerCase() + '|' + artist.toLowerCase());
    const art = (prev && prev.art) || '';
    if (art) artHits++;

    let album = hasAlbumCol ? cleanText(rec.Album) : '';
    if (!album && prev && prev.album) album = prev.album;
    if (album) albumHits++;

    songs.push({ src, cat, title, artist, album, secs, dur, year, art });
  }

  return { songs, excludedCats, artHits, albumHits, dupes, total: songs.length };
}

const wcyt = convertStation(wcytPath, 'wcyt', true);
const pt20 = convertStation(pt20Path, 'pt20', false);

// ── Write back into planner.html ──
const newSongs = {
  wcyt: '  wcyt: ' + JSON.stringify(wcyt.songs) + ',',
  pt20: '  pt20: ' + JSON.stringify(pt20.songs),
};
const newBlock = 'const SONGS = {\r\n' + newSongs.wcyt + '\r\n' + newSongs.pt20 + '\r\n};';
const newHtml = html.replace(/const SONGS = \{\r?\n(.*)\r?\n(.*)\r?\n\};/, () => newBlock);
fs.writeFileSync(PLANNER_HTML, newHtml);

// ── Regenerate planner-songs.json (slim fields; songs are already music-only) ──
function slimStation(stationKey, songs) {
  const cats = {};
  for (const [code, c] of Object.entries(META[stationKey].cats)) {
    cats[code] = { label: c.label, color: c.color };
  }
  const slim = songs.map(s => ({
    t: s.title, a: s.artist, c: s.cat, d: s.album || undefined, y: s.year || undefined,
  }));
  return { label: META[stationKey].label, cats, songs: slim };
}

const songLib = {
  updated: new Date().toISOString().slice(0, 10),
  stations: {
    wcyt: slimStation('wcyt', wcyt.songs),
    pt20: slimStation('pt20', pt20.songs),
  },
};
fs.writeFileSync(SONGS_JSON, JSON.stringify(songLib));

// ── Report ──
function report(label, r) {
  console.log(`\n${label}: ${r.total} songs`);
  console.log(`  album carried over: ${r.albumHits}   art carried over: ${r.artHits}   duplicate Source skipped: ${r.dupes}`);
  if (r.excludedCats.size) {
    console.log('  excluded (unmapped or non-music category):');
    for (const [code, n] of r.excludedCats) console.log(`    "${code}" — ${n} songs`);
  }
}
report('WCYT', wcyt);
report('2.0', pt20);
console.log('\nWrote planner.html and planner-songs.json.');
