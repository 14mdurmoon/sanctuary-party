'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PARTY_SIZE = 10;

// ---------- storage (JSON file, no native deps) ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'sanctuary.json');

let store = { characters: [], parties: [] };
try {
  store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(store.characters)) store.characters = [];
  if (!Array.isArray(store.parties)) store.parties = [];
} catch { /* fresh store */ }

function save() {
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) { console.error('[save] failed:', e.message); }
}

// ---------- helpers ----------
const rid = () => crypto.randomBytes(9).toString('hex');
const now = () => Date.now();
const findChar = (id) => store.characters.find((c) => c.id === id);
const findParty = (id) => store.parties.find((p) => p.id === id);

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
  const chars = [...store.characters].sort(
    (a, b) => (a.slotOrder - b.slotOrder) || (a.createdAt - b.createdAt)
  );
  const byParty = {};
  const pool = [];
  for (const c of chars) {
    const pub = { id: c.id, playerName: c.playerName, charName: c.charName, cp: c.cp, class: c.className };
    if (c.partyId && findParty(c.partyId)) (byParty[c.partyId] || (byParty[c.partyId] = [])).push(pub);
    else pool.push(pub);
  }
  const parties = [...store.parties]
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt))
    .map((p) => ({ id: p.id, name: p.name, startTime: p.startTime, sortOrder: p.sortOrder, members: byParty[p.id] || [] }));
  return { partySize: PARTY_SIZE, pool, parties };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.disable('x-powered-by');

// ---------- live stream (SSE) ----------
const clients = new Set();
function broadcast() {
  const payload = `data: ${JSON.stringify(getState())}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch {} }
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
  const maxOrder = store.characters.reduce((m, c) => Math.max(m, c.slotOrder || 0), 0);
  const ch = {
    id: rid(), playerName, charName, cp, className: cls,
    partyId: null, slotOrder: maxOrder + 1, editToken: rid() + rid(), createdAt: now(),
  };
  store.characters.push(ch);
  save(); broadcast();
  res.json({ id: ch.id, editToken: ch.editToken });
});

app.put('/api/characters/:id', (req, res) => {
  const c = findChar(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  const token = req.headers['x-edit-token'] || '';
  if (token !== c.editToken && !isAdmin(req)) {
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะตัวละครของคุณ' });
  }
  let { playerName, charName, cp, class: cls } = req.body || {};
  if (playerName !== undefined) c.playerName = String(playerName).trim().slice(0, 40) || c.playerName;
  if (charName !== undefined) c.charName = String(charName).trim().slice(0, 40) || c.charName;
  if (cls !== undefined) c.className = String(cls).trim().slice(0, 40);
  if (cp !== undefined) c.cp = Math.max(0, parseInt(cp, 10) || 0);
  save(); broadcast();
  res.json({ ok: true });
});

app.delete('/api/characters/:id', (req, res) => {
  const c = findChar(req.params.id);
  if (!c) return res.json({ ok: true });
  const token = req.headers['x-edit-token'] || '';
  if (token !== c.editToken && !isAdmin(req)) {
    return res.status(403).json({ error: 'ลบได้เฉพาะตัวละครของคุณ' });
  }
  store.characters = store.characters.filter((x) => x.id !== c.id);
  save(); broadcast();
  res.json({ ok: true });
});

// ---------- parties (admin only) ----------
app.post('/api/parties', requireAdmin, (req, res) => {
  const { name, startTime } = req.body || {};
  const maxOrder = store.parties.reduce((m, p) => Math.max(m, p.sortOrder || 0), 0);
  const p = {
    id: rid(),
    name: String(name || 'ตี้ใหม่').trim().slice(0, 40) || 'ตี้ใหม่',
    startTime: startTime ? Number(startTime) : null,
    sortOrder: maxOrder + 1, createdAt: now(),
  };
  store.parties.push(p);
  save(); broadcast();
  res.json({ id: p.id });
});

app.put('/api/parties/:id', requireAdmin, (req, res) => {
  const p = findParty(req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบตี้' });
  const { name, startTime } = req.body || {};
  if (name !== undefined) p.name = String(name).trim().slice(0, 40) || p.name;
  if (startTime !== undefined) p.startTime = startTime ? Number(startTime) : null;
  save(); broadcast();
  res.json({ ok: true });
});

app.delete('/api/parties/:id', requireAdmin, (req, res) => {
  for (const c of store.characters) if (c.partyId === req.params.id) c.partyId = null;
  store.parties = store.parties.filter((p) => p.id !== req.params.id);
  save(); broadcast();
  res.json({ ok: true });
});

// ---------- drag-drop layout sync (admin only) ----------
// body: { pool: [charId...], parties: [{ id, memberIds: [charId...] }] }
app.post('/api/layout', requireAdmin, (req, res) => {
  const { pool = [], parties = [] } = req.body || {};
  for (const p of parties) {
    const ids = p.memberIds || [];
    if (ids.length > PARTY_SIZE) {
      return res.status(400).json({ error: `ตี้ลงได้สูงสุด ${PARTY_SIZE} คน` });
    }
    const seen = new Set();
    for (const cid of ids) {
      const c = findChar(cid);
      if (!c) continue;
      const key = String(c.playerName || '').trim().toLowerCase();
      if (seen.has(key)) {
        return res.status(400).json({ error: `ตี้เดียวมีคนเล่นซ้ำไม่ได้: ${c.playerName}` });
      }
      seen.add(key);
    }
  }
  let order = 0;
  const setPos = (id, partyId) => {
    const c = findChar(id);
    if (c) { c.partyId = partyId; c.slotOrder = order++; }
  };
  pool.forEach((id) => setPos(id, null));
  for (const p of parties) (p.memberIds || []).forEach((id) => setPos(id, p.id));
  save(); broadcast();
  res.json({ ok: true });
});

// ---------- static + pages ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sanctuary party organizer running on :${PORT}`));
