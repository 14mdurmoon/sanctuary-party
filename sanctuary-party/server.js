'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const PARTY_SIZE = 10;

// ---------- storage ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'sanctuary.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id         TEXT PRIMARY KEY,
    playerName TEXT NOT NULL,
    charName   TEXT NOT NULL,
    cp         INTEGER NOT NULL DEFAULT 0,
    className  TEXT NOT NULL DEFAULT '',
    partyId    TEXT,
    slotOrder  INTEGER NOT NULL DEFAULT 0,
    editToken  TEXT NOT NULL,
    createdAt  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS parties (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    startTime  INTEGER,
    sortOrder  INTEGER NOT NULL DEFAULT 0,
    createdAt  INTEGER NOT NULL
  );
`);

// ---------- helpers ----------
const rid = () => crypto.randomBytes(9).toString('hex');
const now = () => Date.now();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[warn] ADMIN_PASSWORD not set — using default "admin1234". Set it in Railway variables!');
}
const adminTokens = new Set();
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const isAdmin = (req) => adminTokens.has(bearer(req));
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

function getState() {
  const chars = db.prepare(
    'SELECT id, playerName, charName, cp, className AS class, partyId, slotOrder FROM characters ORDER BY slotOrder, createdAt'
  ).all();
  const parties = db.prepare(
    'SELECT id, name, startTime, sortOrder FROM parties ORDER BY sortOrder, createdAt'
  ).all();
  const byParty = {};
  const pool = [];
  for (const c of chars) {
    const { partyId, slotOrder, ...pub } = c;
    if (partyId) (byParty[partyId] || (byParty[partyId] = [])).push(pub);
    else pool.push(pub);
  }
  return {
    partySize: PARTY_SIZE,
    pool,
    parties: parties.map((p) => ({ ...p, members: byParty[p.id] || [] })),
  };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.disable('x-powered-by');

// ---------- live stream (SSE) ----------
const clients = new Set();
function broadcast() {
  const payload = `data: ${JSON.stringify(getState())}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { /* dropped */ }
  }
}
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(`retry: 3000\n\n`);
  res.write(`data: ${JSON.stringify(getState())}\n\n`);
  clients.add(res);
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(keepAlive); clients.delete(res); });
});

app.get('/api/state', (_req, res) => res.json(getState()));

// ---------- admin auth ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    const token = rid() + rid();
    adminTokens.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
});
app.get('/api/admin/check', requireAdmin, (_req, res) => res.json({ ok: true }));

// ---------- characters ----------
app.post('/api/characters', (req, res) => {
  let { playerName, charName, cp, class: cls } = req.body || {};
  playerName = String(playerName || '').trim().slice(0, 40);
  charName = String(charName || '').trim().slice(0, 40);
  cls = String(cls || '').trim().slice(0, 40);
  cp = Math.max(0, parseInt(cp, 10) || 0);
  if (!playerName || !charName) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อคนเล่นและชื่อตัวละคร' });
  }
  const id = rid();
  const editToken = rid() + rid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(slotOrder),0) m FROM characters').get().m;
  db.prepare(
    `INSERT INTO characters (id, playerName, charName, cp, className, partyId, slotOrder, editToken, createdAt)
     VALUES (?,?,?,?,?,NULL,?,?,?)`
  ).run(id, playerName, charName, cp, cls, maxOrder + 1, editToken, now());
  broadcast();
  res.json({ id, editToken });
});

app.put('/api/characters/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  const token = req.headers['x-edit-token'] || '';
  if (token !== c.editToken && !isAdmin(req)) {
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะตัวละครของคุณ' });
  }
  let { playerName, charName, cp, class: cls } = req.body || {};
  playerName = playerName !== undefined ? String(playerName).trim().slice(0, 40) : c.playerName;
  charName = charName !== undefined ? String(charName).trim().slice(0, 40) : c.charName;
  cls = cls !== undefined ? String(cls).trim().slice(0, 40) : c.className;
  cp = cp !== undefined ? Math.max(0, parseInt(cp, 10) || 0) : c.cp;
  if (!playerName || !charName) return res.status(400).json({ error: 'ชื่อห้ามว่าง' });
  db.prepare('UPDATE characters SET playerName=?, charName=?, cp=?, className=? WHERE id=?')
    .run(playerName, charName, cp, cls, c.id);
  broadcast();
  res.json({ ok: true });
});

app.delete('/api/characters/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
  if (!c) return res.json({ ok: true });
  const token = req.headers['x-edit-token'] || '';
  if (token !== c.editToken && !isAdmin(req)) {
    return res.status(403).json({ error: 'ลบได้เฉพาะตัวละครของคุณ' });
  }
  db.prepare('DELETE FROM characters WHERE id=?').run(c.id);
  broadcast();
  res.json({ ok: true });
});

// ---------- parties (admin only) ----------
app.post('/api/parties', requireAdmin, (req, res) => {
  const { name, startTime } = req.body || {};
  const id = rid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sortOrder),0) m FROM parties').get().m;
  db.prepare('INSERT INTO parties (id, name, startTime, sortOrder, createdAt) VALUES (?,?,?,?,?)')
    .run(id, String(name || 'ตี้ใหม่').trim().slice(0, 40) || 'ตี้ใหม่',
         startTime ? Number(startTime) : null, maxOrder + 1, now());
  broadcast();
  res.json({ id });
});

app.put('/api/parties/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM parties WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบตี้' });
  const { name, startTime } = req.body || {};
  db.prepare('UPDATE parties SET name=?, startTime=? WHERE id=?').run(
    name !== undefined ? (String(name).trim().slice(0, 40) || p.name) : p.name,
    startTime !== undefined ? (startTime ? Number(startTime) : null) : p.startTime,
    p.id
  );
  broadcast();
  res.json({ ok: true });
});

app.delete('/api/parties/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE characters SET partyId=NULL WHERE partyId=?').run(req.params.id);
  db.prepare('DELETE FROM parties WHERE id=?').run(req.params.id);
  broadcast();
  res.json({ ok: true });
});

// ---------- drag-drop layout sync (admin only) ----------
// body: { pool: [charId...], parties: [{ id, memberIds: [charId...] }] }
app.post('/api/layout', requireAdmin, (req, res) => {
  const { pool = [], parties = [] } = req.body || {};
  for (const p of parties) {
    if ((p.memberIds || []).length > PARTY_SIZE) {
      return res.status(400).json({ error: `ตี้ลงได้สูงสุด ${PARTY_SIZE} คน` });
    }
  }
  const upd = db.prepare('UPDATE characters SET partyId=?, slotOrder=? WHERE id=?');
  const tx = db.transaction(() => {
    let order = 0;
    pool.forEach((cid) => upd.run(null, order++, cid));
    for (const p of parties) {
      (p.memberIds || []).forEach((cid) => upd.run(p.id, order++, cid));
    }
  });
  tx();
  broadcast();
  res.json({ ok: true });
});

// ---------- static + pages ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sanctuary party organizer running on :${PORT}`));
