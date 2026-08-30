'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PARTY_SIZE = 10;
const TEAM_SIZE = 5;

// ---------- storage (JSON file, no native deps) ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'sanctuary.json');

let store = { characters: [], parties: [], bans: [], groups: [], assignments: {}, history: [], sessions: {}, adminDiscordIds: [], market: [] };
try {
  store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(store.characters)) store.characters = [];
  if (!Array.isArray(store.parties)) store.parties = [];
  if (!Array.isArray(store.bans)) store.bans = [];
  if (!Array.isArray(store.groups)) store.groups = [];
  for (const c of store.characters) {
    if (!Array.isArray(c.dungeonIds)) c.dungeonIds = c.dungeonId ? [c.dungeonId] : [];
  }
  if (typeof store.assignments !== 'object' || store.assignments === null) store.assignments = {};
  if (!Array.isArray(store.log)) store.log = [];
  if (!Array.isArray(store.history)) store.history = [];
  if (typeof store.sessions !== 'object' || store.sessions === null) store.sessions = {};
  if (!Array.isArray(store.adminDiscordIds)) store.adminDiscordIds = [];
  if (!Array.isArray(store.market)) store.market = [];
  if (!store._assignMigrated) {
    for (const c of store.characters) {
      if (c.partyId) {
        const party = store.parties.find((p) => p.id === c.partyId);
        let d = null;
        if (c.dungeonIds && c.dungeonIds.length) {
          d = (party && party.groupId && c.dungeonIds.includes(party.groupId)) ? party.groupId : c.dungeonIds[0];
        }
        store.assignments[c.id + '|' + (d || '')] = { partyId: c.partyId, slotOrder: c.slotOrder || 0 };
      }
    }
    store._assignMigrated = true;
  }
  if (!store._teamMigrated) {
    // split each party's assigned members into two 5-man teams by slot order
    const byParty = {};
    for (const [k, a] of Object.entries(store.assignments)) {
      if (a && a.partyId) (byParty[a.partyId] || (byParty[a.partyId] = [])).push([k, a]);
    }
    for (const pid of Object.keys(byParty)) {
      byParty[pid]
        .sort((x, y) => (x[1].slotOrder || 0) - (y[1].slotOrder || 0))
        .forEach(([, a], i) => { a.subteam = i < 5 ? 0 : 1; });
    }
    store._teamMigrated = true;
  }
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
function logEvent(text, ip) {
  store.history.push({ t: now(), text: String(text || '').slice(0, 160), ip: ip || '' });
  if (store.history.length > 300) store.history = store.history.slice(-300);
}
const findChar = (id) => store.characters.find((c) => c.id === id);
const findParty = (id) => store.parties.find((p) => p.id === id);
const findGroup = (id) => store.groups.find((g) => g.id === id);
const cleanDungeonIds = (arr) => {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const id of arr) { if (id && findGroup(id) && !seen.has(id)) { seen.add(id); out.push(id); } }
  return out;
};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[warn] ADMIN_PASSWORD not set — using default "admin1234". Set it in Railway variables!');
}
const adminTokens = new Set();

// ---------- Discord OAuth (optional) ----------
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_ENABLED = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return store.sessions[sid] || null;
}
function redirectUri(req) {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.headers.host}/auth/discord/callback`;
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
function isDiscordAdmin(id) {
  return ADMIN_DISCORD_IDS.includes(id) || (store.adminDiscordIds || []).includes(id);
}
function isAdmin(req) {
  if (adminTokens.has(bearer(req))) return true;
  const u = currentUser(req);
  return !!(u && isDiscordAdmin(u.discordId));
}
// "manage admins" = password admin or env super-admin (not discord-granted admins)
function canManage(req) {
  if (adminTokens.has(bearer(req))) return true;
  const u = currentUser(req);
  return !!(u && ADMIN_DISCORD_IDS.includes(u.discordId));
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}
function requireManage(req, res, next) {
  if (canManage(req)) return next();
  res.status(403).json({ error: 'เฉพาะแอดมินหลักเท่านั้น' });
}

// a character generates one "placement" per selected dungeon (or one null placement if none)
function placementsOf(c) {
  const valid = (Array.isArray(c.dungeonIds) ? c.dungeonIds : []).filter((d) => findGroup(d));
  const ds = valid.length ? valid : [null];
  return ds.map((d) => ({
    placementId: c.id + '|' + (d || ''),
    id: c.id, playerName: c.playerName, charName: c.charName,
    cp: c.cp, class: c.className, dungeonId: d || null, carry: !!c.carry,
  }));
}

function buildState(full) {
  const byPartyTeam = {};
  const pool = [];
  for (const c of store.characters) {
    for (const pl of placementsOf(c)) {
      const a = store.assignments[pl.placementId];
      const order = a && typeof a.slotOrder === 'number' ? a.slotOrder : 0;
      if (a && a.partyId && findParty(a.partyId)) {
        const t = a.subteam === 1 ? 1 : 0;
        const slot = byPartyTeam[a.partyId] || (byPartyTeam[a.partyId] = [[], []]);
        slot[t].push({ pl, order });
      } else {
        pool.push({ pl, order });
      }
    }
  }
  const strip = (arr) => arr.sort((x, y) => x.order - y.order).map((o) => o.pl);
  const parties = [...store.parties]
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt))
    .map((p) => {
      const t = byPartyTeam[p.id] || [[], []];
      const teamA = strip(t[0]);
      const teamB = strip(t[1]);
      return { id: p.id, name: p.name, groupId: p.groupId || null, startTime: p.startTime, sortOrder: p.sortOrder, teamA, teamB, members: [...teamA, ...teamB] };
    });
  const groups = [...store.groups]
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt))
    .map((g) => ({ id: g.id, name: g.name }));
  const characters = store.characters.map((c) => {
    const base = { id: c.id, charName: c.charName, cp: c.cp, class: c.className, dungeonIds: Array.isArray(c.dungeonIds) ? c.dungeonIds : [], carry: !!c.carry };
    if (full) { base.playerName = c.playerName; base.ip = c.ip || ''; base.createdAt = c.createdAt || 0; }
    return base;
  });
  const state = { partySize: PARTY_SIZE, characters, pool: strip(pool), parties, groups };
  if (full) return state;
  // public: scrub player identity (playerName) from everything
  const scrub = (x) => { const { playerName, ...rest } = x; return rest; };
  return {
    ...state,
    characters: state.characters.map(scrub),
    pool: state.pool.map(scrub),
    parties: state.parties.map((p) => ({ ...p, teamA: p.teamA.map(scrub), teamB: p.teamB.map(scrub), members: p.members.map(scrub) })),
  };
}
function getState() { return buildState(false); }

// ---------- app ----------
const app = express();
app.set('trust proxy', true);
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
app.get('/api/admin/can-manage', requireAdmin, (req, res) => res.json({ canManage: canManage(req) }));

// list Discord users who have logged in (so the main admin can grant admin rights)
app.get('/api/admin/discord-users', requireAdmin, (_req, res) => {
  const map = {};
  for (const sid of Object.keys(store.sessions)) {
    const sess = store.sessions[sid];
    if (sess && sess.discordId) map[sess.discordId] = sess.name || sess.discordId;
  }
  for (const id of (store.adminDiscordIds || [])) if (!map[id]) map[id] = id;
  for (const id of ADMIN_DISCORD_IDS) if (!map[id]) map[id] = id;
  const users = Object.keys(map).map((id) => ({
    discordId: id, name: map[id],
    isAdmin: isDiscordAdmin(id),
    isSuper: ADMIN_DISCORD_IDS.includes(id),
  })).sort((a, b) => (b.isAdmin ? 1 : 0) - (a.isAdmin ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  res.json({ enabled: DISCORD_ENABLED, users });
});

app.post('/api/admin/grant', requireManage, (req, res) => {
  const { discordId } = req.body || {};
  if (!discordId) return res.status(400).json({ error: 'discordId required' });
  if (!store.adminDiscordIds) store.adminDiscordIds = [];
  if (!store.adminDiscordIds.includes(discordId)) store.adminDiscordIds.push(discordId);
  logEvent(`ให้สิทธิ์แอดมิน Discord ${discordId}`, req.ip);
  save();
  res.json({ ok: true });
});

app.post('/api/admin/revoke', requireManage, (req, res) => {
  const { discordId } = req.body || {};
  if (ADMIN_DISCORD_IDS.includes(discordId)) return res.status(400).json({ error: 'ถอดสิทธิ์ super admin (env) ไม่ได้' });
  store.adminDiscordIds = (store.adminDiscordIds || []).filter((x) => x !== discordId);
  logEvent(`ถอดสิทธิ์แอดมิน Discord ${discordId}`, req.ip);
  save();
  res.json({ ok: true });
});

// ---------- Discord auth routes ----------
app.get('/auth/me', (req, res) => {
  const u = currentUser(req);
  res.json({
    enabled: DISCORD_ENABLED,
    user: u ? { discordId: u.discordId, name: u.name, avatar: u.avatar || '', admin: isDiscordAdmin(u.discordId) } : null,
  });
});

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_ENABLED) return res.status(404).send('Discord login is not configured');
  const state = rid();
  const https = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600000, secure: https });
  const url = 'https://discord.com/api/oauth2/authorize?' + new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'identify',
    state,
  }).toString();
  res.redirect(url);
});

app.get('/auth/discord/callback', async (req, res) => {
  if (!DISCORD_ENABLED) return res.status(404).send('Discord login is not configured');
  const { code, state } = req.query;
  const cookies = parseCookies(req);
  if (!code || !state || state !== cookies.oauth_state) return res.status(400).send('OAuth state ไม่ถูกต้อง ลองใหม่');
  try {
    const tokRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri(req),
      }).toString(),
    });
    const tok = await tokRes.json();
    if (!tok.access_token) throw new Error('token exchange failed');
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tok.access_token },
    });
    const u = await meRes.json();
    if (!u || !u.id) throw new Error('fetch user failed');
    const name = (u.global_name || u.username || ('user' + u.id)).slice(0, 40);
    const sid = rid() + rid();
    store.sessions[sid] = { discordId: u.id, name, avatar: u.avatar || '', createdAt: now() };
    // prune very old sessions (>60 days)
    const cutoff = now() - 60 * 864e5;
    for (const k of Object.keys(store.sessions)) if ((store.sessions[k].createdAt || 0) < cutoff) delete store.sessions[k];
    save();
    const https = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5, secure: https });
    res.clearCookie('oauth_state');
    res.redirect('/');
  } catch (e) {
    console.error('[discord] oauth error:', e.message);
    res.status(500).send('เข้าสู่ระบบ Discord ไม่สำเร็จ');
  }
});

app.post('/auth/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) delete store.sessions[sid];
  save();
  res.clearCookie('sid');
  res.json({ ok: true });
});

// which character ids belong to the logged-in user (for cross-device editing)
app.get('/api/mine', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.json({ ids: [] });
  res.json({ ids: store.characters.filter((c) => c.ownerId === u.discordId).map((c) => c.id) });
});
app.get('/api/admin/state', requireAdmin, (_req, res) => res.json(buildState(true)));
app.get('/api/admin/history', requireAdmin, (_req, res) => res.json([...store.history].reverse().slice(0, 200)));

// ---------- characters ----------
app.post('/api/characters', (req, res) => {
  let { playerName, charName, cp, class: cls, dungeonIds } = req.body || {};
  playerName = String(playerName || '').trim().slice(0, 40);
  charName = String(charName || '').trim().slice(0, 40);
  cls = String(cls || '').trim().slice(0, 40);
  cp = Math.max(0, parseInt(cp, 10) || 0);
  dungeonIds = cleanDungeonIds(dungeonIds);
  const _user = currentUser(req);
  if (DISCORD_ENABLED && !_user && !isAdmin(req)) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วย Discord ก่อนลงชื่อตัวละคร' });
  }
  if (_user && !playerName) playerName = String(_user.name || '').trim().slice(0, 40);
  if (!playerName || !charName) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อคนเล่นและชื่อตัวละคร' });
  }
  const ip = req.ip || '';
  if (store.bans.includes(ip)) {
    return res.status(403).json({ error: 'IP ของคุณถูกระงับการใช้งาน' });
  }
  const maxOrder = store.characters.reduce((m, c) => Math.max(m, c.slotOrder || 0), 0);
  const ch = {
    id: rid(), playerName, charName, cp, className: cls, dungeonIds,
    partyId: null, slotOrder: maxOrder + 1, editToken: rid() + rid(), createdAt: now(), ip,
    ownerId: _user ? _user.discordId : null,
  };
  store.characters.push(ch);
  logEvent(`เพิ่มตัวละคร "${charName}" — คนเล่น ${playerName}`, ip);
  save(); broadcast();
  res.json({ id: ch.id, editToken: ch.editToken });
});

app.put('/api/characters/:id', (req, res) => {
  const c = findChar(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  const token = req.headers['x-edit-token'] || '';
  const _u = currentUser(req);
  const _owns = _u && c.ownerId && c.ownerId === _u.discordId;
  if (token !== c.editToken && !_owns && !isAdmin(req)) {
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะตัวละครของคุณ' });
  }
  let { playerName, charName, cp, class: cls, dungeonIds } = req.body || {};
  if (playerName !== undefined) c.playerName = String(playerName).trim().slice(0, 40) || c.playerName;
  if (charName !== undefined) c.charName = String(charName).trim().slice(0, 40) || c.charName;
  if (cls !== undefined) c.className = String(cls).trim().slice(0, 40);
  if (cp !== undefined) c.cp = Math.max(0, parseInt(cp, 10) || 0);
  if (dungeonIds !== undefined) c.dungeonIds = cleanDungeonIds(dungeonIds);
  logEvent(`แก้ไขตัวละคร "${c.charName}" — คนเล่น ${c.playerName}`, c.ip);
  save(); broadcast();
  res.json({ ok: true });
});

app.delete('/api/characters/:id', (req, res) => {
  const c = findChar(req.params.id);
  if (!c) return res.json({ ok: true });
  const token = req.headers['x-edit-token'] || '';
  const _u = currentUser(req);
  const _owns = _u && c.ownerId && c.ownerId === _u.discordId;
  if (token !== c.editToken && !_owns && !isAdmin(req)) {
    return res.status(403).json({ error: 'ลบได้เฉพาะตัวละครของคุณ' });
  }
  store.characters = store.characters.filter((x) => x.id !== c.id);
  for (const k of Object.keys(store.assignments)) if (k.split('|')[0] === c.id) delete store.assignments[k];
  logEvent(`ลบตัวละคร "${c.charName}" — คนเล่น ${c.playerName}`, c.ip);
  save(); broadcast();
  res.json({ ok: true });
});

// toggle "carry" marker (admin only)
app.post('/api/characters/:id/carry', requireAdmin, (req, res) => {
  const c = findChar(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  c.carry = !c.carry;
  save(); broadcast();
  res.json({ carry: !!c.carry });
});

// ---------- IP bans (admin only) ----------
app.get('/api/admin/bans', requireAdmin, (_req, res) => {
  const counts = {};
  for (const c of store.characters) if (c.ip) counts[c.ip] = (counts[c.ip] || 0) + 1;
  res.json(store.bans.map((ip) => ({ ip, chars: counts[ip] || 0 })));
});

app.post('/api/admin/ban', requireAdmin, (req, res) => {
  const { charId } = req.body || {};
  const c = findChar(charId);
  if (!c) return res.status(404).json({ error: 'ไม่พบตัวละคร' });
  const ip = c.ip || '';
  if (!ip) return res.status(400).json({ error: 'ตัวละครนี้ไม่มีข้อมูล IP (สร้างก่อนเปิดระบบแบน)' });
  if (!store.bans.includes(ip)) store.bans.push(ip);
  const removedIds = store.characters.filter((x) => x.ip === ip).map((x) => x.id);
  store.characters = store.characters.filter((x) => x.ip !== ip);
  for (const k of Object.keys(store.assignments)) if (removedIds.includes(k.split('|')[0])) delete store.assignments[k];
  const removed = removedIds.length;
  logEvent(`แบน IP ${ip} (ลบ ${removed} ตัวละคร)`, ip);
  save(); broadcast();
  res.json({ ip, removed });
});

app.post('/api/admin/unban', requireAdmin, (req, res) => {
  const { ip } = req.body || {};
  store.bans = store.bans.filter((x) => x !== ip);
  logEvent('ปลดแบน IP', 'แอดมิน', ip, req.ip);
  save();
  res.json({ ok: true });
});

// ---------- admin insights & activity log ----------
app.get('/api/admin/insights', requireAdmin, (_req, res) => {
  const groupName = {};
  store.groups.forEach((g) => { groupName[g.id] = g.name; });

  const playersMap = {};
  for (const c of store.characters) {
    const key = (c.playerName || '').trim() || '(ไม่ระบุ)';
    const pm = playersMap[key] || (playersMap[key] = { playerName: key, count: 0, ips: new Set(), chars: [] });
    pm.count++;
    if (c.ip) pm.ips.add(c.ip);
    pm.chars.push({
      charName: c.charName, cp: c.cp, class: c.className,
      dungeons: (c.dungeonIds || []).map((id) => groupName[id]).filter(Boolean),
    });
  }
  const players = Object.values(playersMap)
    .map((p) => ({ playerName: p.playerName, count: p.count, ips: [...p.ips], chars: p.chars }))
    .sort((a, b) => b.count - a.count);

  const perDungeon = {};
  for (const c of store.characters) {
    for (const id of (c.dungeonIds || [])) if (groupName[id]) perDungeon[groupName[id]] = (perDungeon[groupName[id]] || 0) + 1;
  }
  let assigned = 0;
  const partyCounts = {};
  for (const k of Object.keys(store.assignments)) {
    const a = store.assignments[k];
    if (a && a.partyId) { assigned++; partyCounts[a.partyId] = (partyCounts[a.partyId] || 0) + 1; }
  }
  const partiesFull = store.parties.filter((p) => (partyCounts[p.id] || 0) >= PARTY_SIZE).length;

  res.json({
    players,
    stats: {
      players: players.length,
      characters: store.characters.length,
      parties: store.parties.length,
      assigned,
      partiesFull,
      perDungeon,
    },
  });
});

// ---------- parties (admin only) ----------
app.post('/api/parties', requireAdmin, (req, res) => {
  const { name, startTime, groupId } = req.body || {};
  const maxOrder = store.parties.reduce((m, p) => Math.max(m, p.sortOrder || 0), 0);
  const p = {
    id: rid(),
    name: String(name || 'ตี้ใหม่').trim().slice(0, 40) || 'ตี้ใหม่',
    groupId: (groupId && findGroup(groupId)) ? groupId : null,
    startTime: startTime ? Number(startTime) : null,
    sortOrder: maxOrder + 1, createdAt: now(),
  };
  store.parties.push(p);
  logEvent(`สร้างตี้ "${p.name}"`);
  save(); broadcast();
  res.json({ id: p.id });
});

app.put('/api/parties/:id', requireAdmin, (req, res) => {
  const p = findParty(req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบตี้' });
  const { name, startTime, groupId } = req.body || {};
  if (name !== undefined) p.name = String(name).trim().slice(0, 40) || p.name;
  if (groupId !== undefined) p.groupId = (groupId && findGroup(groupId)) ? groupId : null;
  if (startTime !== undefined) p.startTime = startTime ? Number(startTime) : null;
  save(); broadcast();
  res.json({ ok: true });
});

app.delete('/api/parties/:id', requireAdmin, (req, res) => {
  for (const k of Object.keys(store.assignments)) {
    if (store.assignments[k] && store.assignments[k].partyId === req.params.id) delete store.assignments[k];
  }
  const dp = findParty(req.params.id);
  store.parties = store.parties.filter((p) => p.id !== req.params.id);
  logEvent(`ลบตี้ "${dp ? dp.name : ''}"`);
  save(); broadcast();
  res.json({ ok: true });
});

// ---------- groups / categories (admin only) ----------
app.post('/api/groups', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  const maxOrder = store.groups.reduce((m, g) => Math.max(m, g.sortOrder || 0), 0);
  const g = { id: rid(), name: String(name || 'หมวดใหม่').trim().slice(0, 40) || 'หมวดใหม่', sortOrder: maxOrder + 1, createdAt: now() };
  store.groups.push(g);
  logEvent(`สร้างหมวด "${g.name}"`);
  save(); broadcast();
  res.json({ id: g.id });
});

app.put('/api/groups/:id', requireAdmin, (req, res) => {
  const g = findGroup(req.params.id);
  if (!g) return res.status(404).json({ error: 'ไม่พบหมวด' });
  const { name } = req.body || {};
  if (name !== undefined) g.name = String(name).trim().slice(0, 40) || g.name;
  save(); broadcast();
  res.json({ ok: true });
});

app.delete('/api/groups/:id', requireAdmin, (req, res) => {
  for (const p of store.parties) if (p.groupId === req.params.id) p.groupId = null;
  const gg = findGroup(req.params.id);
  store.groups = store.groups.filter((g) => g.id !== req.params.id);
  logEvent(`ลบหมวด "${gg ? gg.name : ''}"`);
  save(); broadcast();
  res.json({ ok: true });
});

// drag parties between categories (admin only)
// body: { columns: [{ groupId: id|null, partyIds: [id...] }], groupOrder: [id...] }
app.post('/api/parties/layout', requireAdmin, (req, res) => {
  const { columns = [], groupOrder = [] } = req.body || {};
  let order = 0;
  for (const col of columns) {
    const gid = col.groupId && findGroup(col.groupId) ? col.groupId : null;
    for (const pid of col.partyIds || []) {
      const p = findParty(pid);
      if (p) { p.groupId = gid; p.sortOrder = order++; }
    }
  }
  if (Array.isArray(groupOrder) && groupOrder.length) {
    let go = 0;
    for (const gid of groupOrder) { const g = findGroup(gid); if (g) g.sortOrder = go++; }
  }
  save(); broadcast();
  res.json({ ok: true });
});

// ---------- drag-drop layout sync (admin only) ----------
// body: { pool: [charId...], parties: [{ id, memberIds: [charId...] }] }
app.post('/api/layout', requireAdmin, (req, res) => {
  const { pool = [], parties = [] } = req.body || {};
  const charOf = (placementId) => findChar(String(placementId).split('|')[0]);
  for (const p of parties) {
    const teamA = p.teamA || [];
    const teamB = p.teamB || [];
    if (teamA.length > TEAM_SIZE || teamB.length > TEAM_SIZE) {
      return res.status(400).json({ error: `แต่ละทีมลงได้สูงสุด ${TEAM_SIZE} คน` });
    }
    const seen = new Set();
    for (const plid of [...teamA, ...teamB]) {
      const c = charOf(plid);
      if (!c) continue;
      const key = String(c.playerName || '').trim().toLowerCase();
      if (seen.has(key)) {
        return res.status(400).json({ error: `ตี้เดียวมีคนเล่นซ้ำไม่ได้: ${c.playerName}` });
      }
      seen.add(key);
    }
  }
  let order = 0;
  pool.forEach((plid) => { store.assignments[plid] = { partyId: null, slotOrder: order++ }; });
  for (const p of parties) {
    (p.teamA || []).forEach((plid) => { store.assignments[plid] = { partyId: p.id, subteam: 0, slotOrder: order++ }; });
    (p.teamB || []).forEach((plid) => { store.assignments[plid] = { partyId: p.id, subteam: 1, slotOrder: order++ }; });
  }
  save(); broadcast();
  res.json({ ok: true });
});

// ---------- static + pages ----------
// ---------- Market (kina trading) ----------
// real-time notifications: poster subscribes; buyers can "ping" a listing
const marketSubs = new Map(); // discordId -> Set(res)
function pushMarketNotify(discordId, payload) {
  const set = marketSubs.get(discordId);
  if (!set || !set.size) return false;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) { try { res.write(data); } catch {} }
  return true;
}
app.get('/api/market/notifications', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
  res.write(': connected\n\n');
  let set = marketSubs.get(u.discordId);
  if (!set) { set = new Set(); marketSubs.set(u.discordId, set); }
  set.add(res);
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ka); set.delete(res); if (!set.size) marketSubs.delete(u.discordId); });
});

const marketPingLimit = new Map(); // ip|listingId -> ts
app.post('/api/market/:id/ping', (req, res) => {
  const m = store.market.find((x) => x.id === req.params.id);
  if (!m || m.closed) return res.status(404).json({ error: 'ไม่พบประกาศ' });
  const key = (req.ip || '') + '|' + m.id;
  const last = marketPingLimit.get(key) || 0;
  if (Date.now() - last < 30000) return res.status(429).json({ error: 'เพิ่งเรียกไปเมื่อกี้ รอสักครู่' });
  marketPingLimit.set(key, Date.now());
  const u = currentUser(req);
  const online = pushMarketNotify(m.discordId, {
    type: 'ping', listingId: m.id, listingType: m.type, rate: m.rate, server: m.server,
    fromName: u ? u.name : 'ผู้สนใจ', fromId: u ? u.discordId : null, at: Date.now(),
  });
  res.json({ ok: true, online });
});

app.get('/api/market', (req, res) => {
  const server = req.query.server === 'Global' ? 'Global' : 'TW';
  const listings = store.market
    .filter((m) => m.server === server)
    .map((m) => ({
      id: m.id, type: m.type, server: m.server, rate: m.rate, amount: m.amount, note: m.note,
      ownerName: m.ownerName, discordId: m.discordId, createdAt: m.createdAt, closed: !!m.closed,
    }));
  res.json({ listings });
});

app.post('/api/market', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วย Discord ก่อนประกาศ' });
  let { type, server, rate, amount, note } = req.body || {};
  type = type === 'buy' ? 'buy' : 'sell';
  server = server === 'Global' ? 'Global' : 'TW';
  rate = Math.max(0, Number(rate) || 0);
  amount = String(amount || '').trim().slice(0, 60);
  note = String(note || '').trim().slice(0, 300);
  if (!rate) return res.status(400).json({ error: 'กรุณาใส่เรตราคา (บาทต่อ 1M)' });
  const m = { id: rid(), type, server, rate, amount, note, ownerId: u.discordId, ownerName: u.name, discordId: u.discordId, createdAt: now(), closed: false };
  store.market.unshift(m);
  if (store.market.length > 3000) store.market.length = 3000;
  logEvent(`ประกาศตลาด ${type === 'sell' ? 'ขาย' : 'รับซื้อ'} kina (${server})`, u.name);
  save();
  res.json({ id: m.id });
});

app.put('/api/market/:id', (req, res) => {
  const m = store.market.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'ไม่พบประกาศ' });
  const u = currentUser(req);
  if (!(u && m.ownerId === u.discordId) && !isAdmin(req)) return res.status(403).json({ error: 'แก้ไขได้เฉพาะประกาศของตัวเอง' });
  let { type, server, rate, amount, note } = req.body || {};
  if (type !== undefined) m.type = type === 'buy' ? 'buy' : 'sell';
  if (server !== undefined) m.server = server === 'Global' ? 'Global' : 'TW';
  if (rate !== undefined) { const r = Math.max(0, Number(rate) || 0); if (r) m.rate = r; }
  if (amount !== undefined) m.amount = String(amount || '').trim().slice(0, 60);
  if (note !== undefined) m.note = String(note || '').trim().slice(0, 300);
  save();
  res.json({ ok: true });
});

app.post('/api/market/:id/close', (req, res) => {
  const m = store.market.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const u = currentUser(req);
  if (!(u && m.ownerId === u.discordId) && !isAdmin(req)) return res.status(403).json({ error: 'จัดการได้เฉพาะประกาศของตัวเอง' });
  m.closed = !m.closed;
  save();
  res.json({ ok: true, closed: m.closed });
});

app.delete('/api/market/:id', (req, res) => {
  const m = store.market.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const u = currentUser(req);
  if (!(u && m.ownerId === u.discordId) && !isAdmin(req)) return res.status(403).json({ error: 'ลบได้เฉพาะประกาศของตัวเอง' });
  store.market = store.market.filter((x) => x.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/market', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'market.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sanctuary party organizer running on :${PORT}`));
