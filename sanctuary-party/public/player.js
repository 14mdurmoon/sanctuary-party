(function () {
  const { fmtCountdown, classColor, clsHtml, clericBadge, dungeonName, dungeonTagsHtml, toast, api, connect, esc, nfmt } = SP;
  const OWN_KEY = 'sanctuary_owned_v1';
  const NAME_KEY = 'sanctuary_mynames_v1';
  let owned = {};      // { charId: editToken }
  let state = { pool: [], parties: [], partySize: 10 };

  try { owned = JSON.parse(localStorage.getItem(OWN_KEY) || '{}'); } catch { owned = {}; }
  const saveOwned = () => localStorage.setItem(OWN_KEY, JSON.stringify(owned));
  let myNames = {};
  try { myNames = JSON.parse(localStorage.getItem(NAME_KEY) || '{}'); } catch { myNames = {}; }
  const saveNames = () => localStorage.setItem(NAME_KEY, JSON.stringify(myNames));
  const nameOf = (c) => c.playerName || myNames[c.id] || '';

  let me = { enabled: false, user: null };
  let mineIds = [];
  const canEdit = (cid) => !!owned[cid] || mineIds.includes(cid);
  const editHeaders = (cid) => (owned[cid] ? { 'X-Edit-Token': owned[cid] } : {});

  const $ = (id) => document.getElementById(id);
  const allChars = () => state.characters || [];
  const partiesOf = (cid) => state.parties.filter((p) => p.members.some((m) => m.id === cid));
  const assignedTags = (cid) => partiesOf(cid).map((p) => `<span class="tag assigned">${esc(p.name)}</span>`).join(' ');

  // put the party board ABOVE the full roster so parties are seen first
  (function boardFirst() {
    const board = document.getElementById('board');
    const roster = document.getElementById('roster');
    if (!board || !roster) return;
    const boardSec = board.closest('.panel');
    const rosterSec = roster.closest('.panel');
    if (boardSec && rosterSec && boardSec.parentNode === rosterSec.parentNode) {
      rosterSec.parentNode.insertBefore(boardSec, rosterSec);
    }
  })();

  // collapse the long "รายชื่อทั้งหมด" list by default (toggle to show)
  (function collapsibleRoster() {
    const roster = document.getElementById('roster');
    if (!roster) return;
    const panel = roster.closest('.panel');
    const head = panel && panel.querySelector('.head');
    const body = panel && panel.querySelector('.body');
    if (!head || !body || head.querySelector('.roster-toggle')) return;
    let open = false;
    body.style.display = 'none';
    const btn = document.createElement('button');
    btn.className = 'btn ghost small roster-toggle';
    const sync = () => { btn.textContent = open ? 'ซ่อน' : 'แสดง'; };
    sync();
    btn.addEventListener('click', () => { open = !open; body.style.display = open ? '' : 'none'; sync(); });
    head.appendChild(btn);
  })();

  // inject "จะลงดันไหน" selector into the signup form (kept out of index.html)
  (function injectDungeon() {
    if (document.getElementById('dungeon')) return;
    const btn = $('addBtn'); if (!btn) return;
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML = '<label>จะลงดันไหน (เลือกได้หลายดัน)</label><div id="dungeon" class="dg-checks"></div>';
    btn.parentNode.insertBefore(wrap, btn);
  })();
  function populateDungeons() {
    const cont = $('dungeon'); if (!cont) return;
    const checked = new Set([...cont.querySelectorAll('input:checked')].map((c) => c.value));
    const groups = state.groups || [];
    cont.innerHTML = groups.length
      ? groups.map((g) => `<label class="dg-chip"><input type="checkbox" value="${g.id}" ${checked.has(g.id) ? 'checked' : ''}><span>${esc(g.name)}</span></label>`).join('')
      : '<span class="hint">แอดมินยังไม่ตั้งดัน</span>';
  }
  const readDungeonIds = () => {
    const cont = $('dungeon');
    return cont ? [...cont.querySelectorAll('input:checked')].map((c) => c.value) : [];
  };

  // ---- add ----
  async function add() {
    const playerName = $('playerName').value.trim();
    const charName = $('charName').value.trim();
    const cp = $('cp').value;
    const cls = $('cls').value.trim();
    const dungeonIds = readDungeonIds();
    if (!playerName || !charName) { toast('กรอกชื่อคนเล่นและชื่อตัวละคร', true); return; }
    $('addBtn').disabled = true;
    try {
      const r = await api('POST', '/api/characters', { playerName, charName, cp, class: cls, dungeonIds });
      owned[r.id] = r.editToken; saveOwned();
      myNames[r.id] = playerName; saveNames();
      $('charName').value = ''; $('cp').value = ''; // keep playerName + class for fast multi-add
      $('charName').focus();
      toast('เพิ่มตัวละครแล้ว');
    } catch (e) { toast(e.message, true); }
    finally { $('addBtn').disabled = false; }
  }
  $('addBtn').addEventListener('click', add);
  ['charName', 'cp', 'cls'].forEach((id) =>
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); }));

  // ---- my characters ----
  function renderMine() {
    const mine = allChars().filter((c) => canEdit(c.id));
    const box = $('mine');
    if (!mine.length) { box.innerHTML = '<p class="empty">ยังไม่ได้ลงชื่อตัวละคร</p>'; return; }
    box.innerHTML = '';
    mine.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'card' + (c.carry ? ' carry' : '');
      const parties = partiesOf(c.id);
      const assignHtml = parties.length
        ? `<span class="assign-label">อยู่ตี้:</span> ${parties.map((p) => `<span class="tag assigned">${esc(p.name)}</span>`).join(' ')}`
        : '<span class="muted">ยังไม่ถูกจัดลงตี้</span>';
      const dgHtml = dungeonTagsHtml(state.groups, c.dungeonIds);
      el.innerHTML = `
        <span class="cls-dot" style="color:${classColor(c.class)}"></span>
        <div class="idn">
          <div class="cn">${esc(c.charName)}</div>
          <div class="pn">${(me.user ? me.user.name : nameOf(c)) ? esc(me.user ? me.user.name : nameOf(c)) + ' · ' : ''}${clsHtml(c.class)}</div>
          <div class="assign-line">${assignHtml}</div>
          ${dgHtml ? `<div class="dg-line">${dgHtml}</div>` : ''}
        </div>
        <span class="cp">${nfmt(c.cp)}</span>
        <div class="acts">
          <button class="icon-btn" title="แก้ไข">✎</button>
          <button class="icon-btn del" title="ลบ">✕</button>
        </div>`;
      el.querySelector('.icon-btn:not(.del)').onclick = () => editChar(c);
      el.querySelector('.del').onclick = () => delChar(c);
      box.appendChild(el);
    });
  }

  async function editChar(c) {
    const dgOpts = (state.groups || []).map((g) => ({ value: g.id, label: g.name }));
    const vals = await SP.formModal('แก้ไขตัวละคร', [
      { name: 'charName', label: 'ชื่อตัวละคร', value: c.charName },
      { name: 'cp', label: 'CP', value: c.cp, type: 'number' },
      { name: 'cls', label: 'คลาส', value: c.class || '', list: 'classes' },
      { name: 'dungeonIds', label: 'จะลงดันไหน (เลือกได้หลายดัน)', type: 'multiselect', value: c.dungeonIds || [], options: dgOpts },
    ], 'บันทึก');
    if (!vals) return;
    try {
      await api('PUT', '/api/characters/' + c.id,
        { charName: vals.charName, cp: vals.cp, class: vals.cls, dungeonIds: vals.dungeonIds }, editHeaders(c.id));
      toast('แก้ไขแล้ว');
    } catch (e) { toast(e.message, true); }
  }

  async function delChar(c) {
    const ok = await SP.confirmModal(`ลบ "${c.charName}" ออกจากรายชื่อ?`, 'ลบ');
    if (!ok) return;
    try {
      await api('DELETE', '/api/characters/' + c.id, null, editHeaders(c.id));
      if (owned[c.id]) { delete owned[c.id]; saveOwned(); }
      toast('ลบแล้ว');
    } catch (e) { toast(e.message, true); }
  }

  // ---- roster ----
  function renderRoster() {
    const chars = allChars();
    $('rosterCount').textContent = `${chars.length} ตัวละคร`;
    const box = $('roster');
    if (!chars.length) { box.innerHTML = '<p class="empty">ยังไม่มีใครลงชื่อ</p>'; return; }
    const sorted = [...chars].sort((a, b) => (b.cp || 0) - (a.cp || 0));
    const rows = sorted.map((c) => {
      const tags = assignedTags(c.id);
      return `<tr>
        <td><span class="cls-dot" style="color:${classColor(c.class)};display:inline-block;margin-right:7px"></span><b>${esc(c.charName)}</b></td>
        <td class="muted">${nameOf(c) ? esc(nameOf(c)) : '<span class="muted">ซ่อน</span>'}</td>
        <td>${clsHtml(c.class)}</td>
        <td>${dungeonTagsHtml(state.groups, c.dungeonIds) || '<span class="muted">—</span>'}</td>
        <td class="num">${nfmt(c.cp)}</td>
        <td>${tags || '<span class="tag pool">ยังไม่จัด</span>'}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table class="roster">
      <thead><tr><th>ตัวละคร</th><th>คนเล่น</th><th>คลาส</th><th>ดัน</th><th>CP</th><th>สถานะ</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  // ---- party board ----
  function buildPartyCard(p) {
    const n = p.members.length;
    const cap = state.partySize;
    const totalCp = p.members.reduce((s, m) => s + (m.cp || 0), 0);
    const full = n >= cap;
    const card = document.createElement('div');
    card.className = 'party';
    card.innerHTML = `
      <div class="p-head">
        <div class="p-title-row"><span class="p-name">${esc(p.name)}</span></div>
        <div class="fill ${full ? 'full' : ''}">
          <div class="bar"><i style="width:${Math.min(100, (n / cap) * 100)}%"></i></div>
          <span class="count"><b>${n}</b>/${cap}</span>
        </div>
        <div class="p-cp">CP เฉลี่ย <b>${nfmt(n ? Math.round(totalCp / n) : 0)}</b></div>
        <div class="p-badges">${clericBadge(p.members)}</div>
        <div class="countdown" data-start="${p.startTime || ''}">
          <div class="cd-label">เริ่มลงในอีก</div>
          <div class="cd-clock">—</div>
          <div class="cd-when"></div>
        </div>
      </div>
      <div class="teams">
        <div class="slots team-col"></div>
        <div class="slots team-col"></div>
      </div>`;
    const zones = card.querySelectorAll('.team-col');
    const memberRow = (m, i) => {
      const row = document.createElement('div');
      row.className = 'card' + (m.carry ? ' carry' : '');
      row.innerHTML = `
        <span class="slot-idx">${i + 1}</span>
        <span class="cls-dot" style="color:${classColor(m.class)}"></span>
        <div class="idn">
          <div class="cn">${esc(m.charName)}${m.dungeonId ? dungeonTagsHtml(state.groups, [m.dungeonId]) : ''}</div>
          <div class="pn">${m.playerName ? esc(m.playerName) + ' · ' : ''}${clsHtml(m.class)}</div>
        </div>
        <span class="cp">${nfmt(m.cp)}</span>`;
      return row;
    };
    const teamA = p.teamA || [];
    const teamB = p.teamB || [];
    if (!teamA.length && !teamB.length) {
      zones[0].innerHTML = '<div class="empty-hint">ยังไม่มีสมาชิก</div>';
    } else {
      teamA.forEach((m, i) => zones[0].appendChild(memberRow(m, i)));
      teamB.forEach((m, i) => zones[1].appendChild(memberRow(m, i + 5)));
    }
    return card;
  }

  function renderBoard() {
    $('partyCount').textContent = `${state.parties.length} ตี้`;
    const board = $('board');
    board.classList.remove('grouped');
    if (!state.parties.length) { board.innerHTML = '<p class="empty">แอดมินยังไม่เปิดตี้</p>'; return; }
    board.innerHTML = '';

    const groups = state.groups || [];
    const byGroup = new Map();
    byGroup.set('none', []);
    groups.forEach((g) => byGroup.set(g.id, []));
    state.parties.forEach((p) => {
      const key = (p.groupId && byGroup.has(p.groupId)) ? p.groupId : 'none';
      byGroup.get(key).push(p);
    });

    // if no categories exist at all, keep the simple wrapping grid
    if (!groups.length) {
      board.classList.remove('sectioned');
      state.parties.forEach((p) => board.appendChild(buildPartyCard(p)));
      tickCountdowns();
      return;
    }
    board.classList.add('sectioned');

    const makeSection = (gid, title) => {
      const parties = byGroup.get(gid) || [];
      const sec = document.createElement('div');
      sec.className = 'party-section' + (gid === 'none' ? ' ungrouped' : '');
      sec.innerHTML = `
        <div class="section-head">
          <span class="section-title">${esc(title)}</span>
          <span class="section-count">${parties.length} ตี้</span>
        </div>
        <div class="section-grid"></div>`;
      const grid = sec.querySelector('.section-grid');
      parties.forEach((p) => grid.appendChild(buildPartyCard(p)));
      return sec;
    };
    const ungrouped = byGroup.get('none') || [];
    if (ungrouped.length) board.appendChild(makeSection('none', 'ยังไม่จัดหมวด'));
    groups.forEach((g) => board.appendChild(makeSection(g.id, g.name)));
    tickCountdowns();
  }

  // ---- countdown ticking ----
  function tickCountdowns() {
    document.querySelectorAll('.countdown').forEach((el) => {
      const raw = el.getAttribute('data-start');
      const st = raw ? Number(raw) : null;
      const { state: s, clock, when } = fmtCountdown(st);
      el.classList.remove('soon', 'live', 'unset');
      if (s === 'soon') el.classList.add('soon');
      else if (s === 'live') el.classList.add('live');
      else if (s === 'unset') el.classList.add('unset');
      el.querySelector('.cd-clock').textContent = clock;
      el.querySelector('.cd-when').textContent = when;
      el.querySelector('.cd-label').textContent = s === 'live' ? 'สถานะ' : s === 'unset' ? '' : 'เริ่มลงในอีก';
    });
  }
  setInterval(tickCountdowns, 1000);

  // ---- live wiring ----
  async function initAuth() {
    try { me = await api('GET', '/auth/me'); } catch { me = { enabled: false, user: null }; }
    renderAuthBar();
    if (me.user) {
      try { const r = await api('GET', '/api/mine'); mineIds = r.ids || []; } catch { mineIds = []; }
      const pn = $('playerName');
      if (pn) { pn.value = me.user.name; pn.readOnly = true; pn.title = 'ชื่อจาก Discord'; }
      render();
    }
    gateSignup();
  }

  function gateSignup() {
    const lock = me.enabled && !me.user;
    ['playerName', 'charName', 'cp', 'cls', 'addBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = lock; });
    const dg = $('dungeon'); if (dg) dg.querySelectorAll('input').forEach((i) => { i.disabled = lock; });
    let notice = document.getElementById('signupLock');
    if (lock) {
      const btn = $('addBtn');
      if (!notice && btn) {
        notice = document.createElement('div');
        notice.id = 'signupLock';
        notice.className = 'lock-notice';
        notice.innerHTML = '🔒 เข้าสู่ระบบด้วย Discord ก่อนลงชื่อตัวละคร<a class="btn small discord-btn" href="/auth/discord">เข้าสู่ระบบด้วย Discord</a>';
        btn.parentNode.insertBefore(notice, btn);
      }
      if (notice) notice.style.display = '';
    } else if (notice) {
      notice.style.display = 'none';
    }
  }
  function renderAuthBar() {
    const nav = document.querySelector('.masthead nav');
    if (!nav || !me.enabled) return;
    let bar = document.getElementById('authBar');
    if (!bar) { bar = document.createElement('span'); bar.id = 'authBar'; nav.insertBefore(bar, nav.firstChild); }
    if (me.user) {
      bar.innerHTML = `<span class="auth-user">🎮 ${esc(me.user.name)}</span> <button class="btn ghost small" id="logoutBtn">ออกจากระบบ</button>`;
      document.getElementById('logoutBtn').onclick = async () => {
        try { await api('POST', '/auth/logout'); } catch {}
        location.reload();
      };
    } else {
      bar.innerHTML = `<a class="btn small discord-btn" href="/auth/discord">เข้าสู่ระบบด้วย Discord</a>`;
    }
  }

  function render() { populateDungeons(); renderMine(); renderRoster(); renderBoard(); }
  initAuth();
  connect((s) => { state = s; render(); }, (up) => {
    const dot = $('live');
    dot.classList.toggle('off', !up);
    dot.querySelector('i').nextSibling.textContent = up ? ' live' : ' offline';
  });
})();
