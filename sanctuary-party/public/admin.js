(function () {
  const { fmtCountdown, classColor, clsHtml, clericBadge, dungeonTagsHtml, toast, api, connect, esc, nfmt } = SP;
  const TOKEN_KEY = 'sanctuary_admin_token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let state = { pool: [], parties: [], partySize: 10 };
  let dupWarned = false;
  let adminBans = [];
  const allPlacements = () => [...state.pool, ...state.parties.flatMap((p) => p.members)];
  const placementById = (pid) => allPlacements().find((x) => x.placementId === pid);
  const norm = (nm) => String(nm || '').trim().toLowerCase();
  let dragging = false;
  let pending = null;
  let sortables = [];

  const $ = (id) => document.getElementById(id);
  const authHeaders = () => ({ Authorization: 'Bearer ' + token });

  // ---------- date helpers ----------
  function toLocalInput(ms) {
    if (!ms) return '';
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

  // ---------- auth ----------
  async function tryAuth() {
    if (!token) return false;
    try { await api('GET', '/api/admin/check', null, authHeaders()); return true; }
    catch { token = ''; localStorage.removeItem(TOKEN_KEY); return false; }
  }
  async function login() {
    const pw = $('pw').value;
    if (!pw) return;
    $('loginBtn').disabled = true;
    try {
      const r = await api('POST', '/api/admin/login', { password: pw });
      token = r.token; localStorage.setItem(TOKEN_KEY, token);
      showConsole();
    } catch (e) { toast(e.message, true); }
    finally { $('loginBtn').disabled = false; }
  }
  $('loginBtn').addEventListener('click', login);
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('logout').addEventListener('click', () => {
    token = ''; localStorage.removeItem(TOKEN_KEY);
    $('console').style.display = 'none';
    $('logout').style.display = 'none';
    $('loginPanel').style.display = '';
  });

  function showConsole() {
    $('loginPanel').style.display = 'none';
    $('console').style.display = '';
    $('logout').style.display = '';
    initTools();
    if (!document.getElementById('bansBar')) {
      const bar = document.createElement('div');
      bar.className = 'bans-bar'; bar.id = 'bansBar'; bar.style.display = 'none';
      $('console').prepend(bar);
    }
    loadBans();
    startLive();
  }


  async function loadBans() {
    try { adminBans = await api('GET', '/api/admin/bans', null, authHeaders()); }
    catch { adminBans = []; }
    renderBans();
  }
  function renderBans() {
    const bar = document.getElementById('bansBar');
    if (!bar) return;
    if (!adminBans.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = `<span class="bans-title">🚫 IP ที่แบน (${adminBans.length})</span>` +
      adminBans.map((b) =>
        `<span class="ban-chip">${esc(b.ip)}<button class="unban" data-ip="${esc(b.ip)}">ปลดแบน</button></span>`
      ).join('');
  }

  // ---------- create party ----------
  $('createParty').addEventListener('click', async () => {
    const name = $('pName').value.trim() || 'ตี้ใหม่';
    const startTime = fromLocalInput($('pTime').value);
    try {
      await api('POST', '/api/parties', { name, startTime }, authHeaders());
      $('pName').value = ''; $('pTime').value = '';
      toast('สร้างตี้แล้ว');
    } catch (e) { toast(e.message, true); }
  });

  $('pName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createParty').click(); });
  $('gName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createGroup').click(); });
  $('createGroup').addEventListener('click', async () => {
    const name = $('gName').value.trim();
    if (!name) { toast('ใส่ชื่อหมวด', true); return; }
    try {
      await api('POST', '/api/groups', { name }, authHeaders());
      $('gName').value = '';
      toast('สร้างหมวดแล้ว');
    } catch (e) { toast(e.message, true); }
  });

  // ---------- render ----------
  function charCard(pl, idx) {
    const div = document.createElement('div');
    div.className = 'card drag' + (pl.carry ? ' carry' : '');
    div.dataset.id = pl.placementId;
    div.dataset.charid = pl.id;
    const dgTag = pl.dungeonId
      ? dungeonTagsHtml(state.groups, [pl.dungeonId])
      : '<span class="tag pool">ไม่ระบุดัน</span>';
    div.innerHTML =
      (idx != null ? `<span class="slot-idx">${idx + 1}</span>` : '') +
      `<span class="cls-dot" style="color:${classColor(pl.class)}"></span>
       <div class="idn">
         <div class="cn">${esc(pl.charName)}</div>
         <div class="pn"><span class="cls-line" style="color:${classColor(pl.class)}">${esc(pl.class || '—')}</span></div>
         <div class="dg-line">${dgTag}</div>
         ${pl.playerName ? `<div class="owner-line">${esc(pl.playerName)}</div>` : ''}
       </div>
       <span class="cp">${nfmt(pl.cp)}</span>
       <div class="acts">
         <button class="icon-btn ban" title="แบน IP คนนี้">🚫</button>
         <button class="icon-btn del" title="ลบตัวละคร (ทุกดัน)">✕</button>
       </div>`;
    return div;
  }

  function render() {
    sortables.forEach((s) => s.destroy());
    sortables = [];

    // pool
    const pool = $('pool');
    pool.innerHTML = '';
    state.pool.forEach((c) => pool.appendChild(charCard(c, null)));
    if (!state.pool.length) pool.innerHTML = '<div class="empty-hint">ทุกคนถูกจัดลงตี้แล้ว</div>';
    $('poolCount').textContent = `${state.pool.length} คน`;

    // board = category sections stacked vertically; parties flow in a grid inside each
    const board = $('board');
    $('partyCount').textContent = `${state.parties.length} ตี้`;
    board.innerHTML = '';
    board.classList.add('sectioned');

    const groups = state.groups || [];
    const byGroup = new Map();
    byGroup.set('none', []);
    groups.forEach((g) => byGroup.set(g.id, []));
    state.parties.forEach((p) => {
      const key = (p.groupId && byGroup.has(p.groupId)) ? p.groupId : 'none';
      byGroup.get(key).push(p);
    });

    const makeSection = (gid, title, deletable) => {
      const parties = byGroup.get(gid) || [];
      const sec = document.createElement('div');
      sec.className = 'party-section' + (gid === 'none' ? ' ungrouped' : '');
      sec.innerHTML = `
        <div class="section-head">
          <span class="section-title ${deletable ? 'g-edit' : ''}" ${deletable ? `data-gid="${gid}" title="คลิกเพื่อแก้ชื่อหมวด"` : ''}>${esc(title)}</span>
          <span class="section-count">${parties.length} ตี้</span>
          ${deletable ? `<button class="icon-btn del g-del" data-gid="${gid}" title="ลบหมวด">✕</button>` : ''}
        </div>
        <div class="section-grid" data-group="${gid}"></div>`;
      const grid = sec.querySelector('.section-grid');
      parties.forEach((p) => grid.appendChild(buildPartyCard(p)));
      return sec;
    };

    // ungrouped first, then each category
    board.appendChild(makeSection('none', 'ยังไม่จัดหมวด', false));
    groups.forEach((g) => board.appendChild(makeSection(g.id, g.name, true)));

    initSortables();
    tickCountdowns();
  }

  function buildPartyCard(p) {
    const n = p.members.length, cap = state.partySize, full = n >= cap;
    const totalCp = p.members.reduce((s, m) => s + (m.cp || 0), 0);
    const card = document.createElement('div');
    card.className = 'party';
    card.dataset.pid = p.id;
    card.innerHTML = `
      <div class="p-head">
        <div class="p-title-row">
          <span class="party-handle" title="ลากย้ายหมวด">⠿</span>
          <span class="p-name p-edit" data-pid="${p.id}" title="คลิกเพื่อแก้ชื่อ">${esc(p.name)}</span>
          <button class="icon-btn del p-del" data-pid="${p.id}" title="ลบตี้">✕</button>
        </div>
        <div class="fill ${full ? 'full' : ''}">
          <div class="bar"><i style="width:${Math.min(100, (n / cap) * 100)}%"></i></div>
          <span class="count"><b>${n}</b>/${cap}</span>
        </div>
        <div class="p-cp">CP เฉลี่ย <b>${nfmt(n ? Math.round(totalCp / n) : 0)}</b></div>
        <div class="p-badges">${clericBadge(p.members)}</div>
        <div class="field" style="margin:10px 0 0">
          <input type="datetime-local" class="p-time" data-pid="${p.id}" value="${toLocalInput(p.startTime)}">
        </div>
        <div class="countdown" data-start="${p.startTime || ''}">
          <div class="cd-label">เริ่มลงในอีก</div>
          <div class="cd-clock">—</div>
          <div class="cd-when"></div>
        </div>
      </div>
      <div class="slots dropzone" data-party="${p.id}"></div>`;
    const slots = card.querySelector('.slots');
    p.members.forEach((m, i) => slots.appendChild(charCard(m, i)));
    return card;
  }

  // ---------- drag & drop ----------
  function initSortables() {
    // member-level: pool + each party's slots
    const memberLists = [$('pool'), ...document.querySelectorAll('.slots[data-party]')];
    memberLists.forEach((el) => {
      sortables.push(new Sortable(el, {
        group: 'sanctuary',
        animation: 150,
        filter: '.icon-btn, .empty-hint',
        preventOnFilter: false,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onStart: () => { dragging = true; dupWarned = false; },
        onMove: (evt) => {
          const to = evt.to;
          if (to.dataset.party && to.dataset.party !== 'pool' && to !== evt.from) {
            if (to.querySelectorAll('[data-id]').length >= state.partySize) return false;
            const dragged = placementById(evt.dragged && evt.dragged.dataset.id);
            if (dragged) {
              const dup = [...to.querySelectorAll('[data-id]')].some((el) => {
                if (el === evt.dragged) return false;
                const m = placementById(el.dataset.id);
                return m && norm(m.playerName) === norm(dragged.playerName);
              });
              if (dup) {
                if (!dupWarned) { toast(`${dragged.playerName} อยู่ในตี้นี้แล้ว`, true); dupWarned = true; }
                return false;
              }
            }
          }
          return true;
        },
        onEnd: async () => {
          try { await syncLayout(); }
          finally { dragging = false; pending = false; refreshAdmin(); }
        },
      }));
    });

    // party-level: drag whole parties between category columns (via handle)
    document.querySelectorAll('.section-grid').forEach((el) => {
      sortables.push(new Sortable(el, {
        group: 'parties',
        handle: '.party-handle',
        animation: 150,
        draggable: '.party',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onStart: () => { dragging = true; },
        onEnd: async () => {
          try { await syncPartyLayout(); }
          finally { dragging = false; pending = false; refreshAdmin(); }
        },
      }));
    });
  }

  function collectPartyLayout() {
    const columns = [...document.querySelectorAll('.section-grid')].map((col) => ({
      groupId: col.dataset.group === 'none' ? null : col.dataset.group,
      partyIds: [...col.children].filter((el) => el.dataset && el.dataset.pid).map((el) => el.dataset.pid),
    }));
    const groupOrder = (state.groups || []).map((g) => g.id);
    return { columns, groupOrder };
  }

  async function syncPartyLayout() {
    try { await api('POST', '/api/parties/layout', collectPartyLayout(), authHeaders()); }
    catch (e) { toast(e.message, true); render(); }
  }

  function collectLayout() {
    const pool = [...$('pool').querySelectorAll('[data-id]')].map((e) => e.dataset.id);
    const parties = state.parties.map((p) => {
      const cont = document.querySelector(`.slots[data-party="${p.id}"]`);
      return { id: p.id, memberIds: cont ? [...cont.querySelectorAll('[data-id]')].map((e) => e.dataset.id) : [] };
    });
    return { pool, parties };
  }

  async function syncLayout() {
    const layout = collectLayout();
    // duplicate-player guard (reliable on touch where onMove may not cancel the drop)
    for (const p of layout.parties) {
      const seen = new Set();
      for (const id of p.memberIds) {
        const c = placementById(id);
        if (!c) continue;
        const k = norm(c.playerName);
        if (seen.has(k)) {
          toast(`${c.playerName} อยู่ในตี้เดียวกันซ้ำไม่ได้`, true);
          render(); // revert illegal drop to last server state
          return;
        }
        seen.add(k);
      }
    }
    try { await api('POST', '/api/layout', layout, authHeaders()); }
    catch (e) { toast(e.message, true); render(); }
  }

  // ---------- delegated controls ----------
  $('console').addEventListener('click', async (e) => {
    const gdel = e.target.closest('.g-del');
    if (gdel) {
      const gid = gdel.dataset.gid;
      if (await SP.confirmModal('ลบหมวดนี้? ตี้ในหมวดจะย้ายไปช่อง "ยังไม่จัดหมวด"', 'ลบหมวด')) {
        try { await api('DELETE', '/api/groups/' + gid, null, authHeaders()); toast('ลบหมวดแล้ว'); }
        catch (err) { toast(err.message, true); }
      }
      return;
    }
    const gedit = e.target.closest('.g-edit');
    if (gedit) {
      const gid = gedit.dataset.gid;
      const cur = (state.groups || []).find((g) => g.id === gid);
      const vals = await SP.formModal('เปลี่ยนชื่อหมวด', [
        { name: 'name', label: 'ชื่อหมวด', value: cur ? cur.name : '' },
      ], 'บันทึก');
      if (vals && vals.name) {
        try { await api('PUT', '/api/groups/' + gid, { name: vals.name }, authHeaders()); }
        catch (err) { toast(err.message, true); }
      }
      return;
    }
    const unban = e.target.closest('.unban');
    if (unban) {
      try { await api('POST', '/api/admin/unban', { ip: unban.dataset.ip }, authHeaders()); toast('ปลดแบนแล้ว'); loadBans(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    const ban = e.target.closest('.icon-btn.ban');
    if (ban) {
      const card = ban.closest('[data-id]');
      const id = card && card.dataset.charid;
      const name = (card && card.querySelector('.cn') && card.querySelector('.cn').textContent) || 'คนนี้';
      if (id && await SP.confirmModal(`แบน IP ของ "${name}"? ตัวละครทั้งหมดจาก IP นี้จะถูกลบ`, 'แบน')) {
        try { const r = await api('POST', '/api/admin/ban', { charId: id }, authHeaders()); toast(`แบนแล้ว · ลบ ${r.removed} ตัว`); loadBans(); }
        catch (err) { toast(err.message, true); }
      }
      return;
    }
    const del = e.target.closest('.del:not(.p-del)');
    if (del) {
      const card = del.closest('[data-id]');
      const id = card && card.dataset.charid;
      const name = card?.querySelector('.cn')?.textContent || 'ตัวละครนี้';
      if (id && await SP.confirmModal(`ลบ "${name}" ออกจากระบบ?`, 'ลบ')) {
        try { await api('DELETE', '/api/characters/' + id, null, authHeaders()); toast('ลบแล้ว'); }
        catch (err) { toast(err.message, true); }
      }
      return;
    }
    const pdel = e.target.closest('.p-del');
    if (pdel) {
      const pid = pdel.dataset.pid;
      if (await SP.confirmModal('ลบตี้นี้? สมาชิกจะกลับไปอยู่รายชื่อรอจัด', 'ลบตี้')) {
        try { await api('DELETE', '/api/parties/' + pid, null, authHeaders()); toast('ลบตี้แล้ว'); }
        catch (err) { toast(err.message, true); }
      }
      return;
    }
    const pedit = e.target.closest('.p-edit');
    if (pedit) {
      const pid = pedit.dataset.pid;
      const cur = state.parties.find((p) => p.id === pid);
      const vals = await SP.formModal('เปลี่ยนชื่อตี้', [
        { name: 'name', label: 'ชื่อตี้', value: cur ? cur.name : '' },
      ], 'บันทึก');
      if (vals && vals.name != null) {
        try { await api('PUT', '/api/parties/' + pid, { name: vals.name }, authHeaders()); }
        catch (err) { toast(err.message, true); }
      }
    }
  });

  // right-click a card to toggle "carry" (light red)
  $('console').addEventListener('contextmenu', async (e) => {
    if (e.target.closest('.icon-btn')) return;
    const card = e.target.closest('[data-id]');
    if (!card) return;
    e.preventDefault();
    try { await api('POST', '/api/characters/' + card.dataset.charid + '/carry', {}, authHeaders()); }
    catch (err) { toast(err.message, true); }
  });

  $('console').addEventListener('change', async (e) => {
    const t = e.target.closest('.p-time');
    if (t) {
      const pid = t.dataset.pid;
      try { await api('PUT', '/api/parties/' + pid, { startTime: fromLocalInput(t.value) }, authHeaders()); toast('ตั้งเวลาแล้ว'); }
      catch (err) { toast(err.message, true); }
    }
  });

  // ---------- countdown ----------
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

  // ---------- live ----------
  let liveStarted = false;
  let fetching = false, refetch = false;
  async function refreshAdmin() {
    if (dragging) { pending = true; return; }
    if (fetching) { refetch = true; return; }
    fetching = true;
    try { state = await api('GET', '/api/admin/state', null, authHeaders()); render(); }
    catch (e) { /* token may be stale */ }
    finally { fetching = false; if (refetch) { refetch = false; refreshAdmin(); } }
  }
  function startLive() {
    if (liveStarted) { refreshAdmin(); return; }
    liveStarted = true;
    refreshAdmin();
    connect(() => { refreshAdmin(); }, (up) => {
      const dot = $('live');
      dot.classList.toggle('off', !up);
      dot.querySelector('i').nextSibling.textContent = up ? ' live' : ' offline';
    });
  }

  // ---------- admin tools (players, activity log, stats, CSV) ----------
  let toolsOpen = false;
  function initTools() {
    const toggle = $('toolsToggle');
    if (!toggle || toggle._wired) return;
    toggle._wired = true;
    toggle.addEventListener('click', () => {
      toolsOpen = !toolsOpen;
      $('toolsBody').style.display = toolsOpen ? '' : 'none';
      toggle.textContent = toolsOpen ? 'ซ่อน' : 'แสดง';
      if (toolsOpen) loadTools();
    });
    $('toolsRefresh').addEventListener('click', loadTools);
    document.querySelectorAll('#adminTools .tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#adminTools .tab-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const tab = b.dataset.tab;
        $('toolsPlayers').style.display = tab === 'players' ? '' : 'none';
        $('toolsLog').style.display = tab === 'log' ? '' : 'none';
      });
    });
    $('exportCsv').addEventListener('click', exportCsv);
  }

  async function loadTools() {
    try {
      const [ins, log] = await Promise.all([
        api('GET', '/api/admin/insights', null, authHeaders()),
        api('GET', '/api/admin/history', null, authHeaders()),
      ]);
      renderStats(ins.stats);
      renderPlayers(ins.players);
      renderLog(log);
    } catch (e) { toast(e.message, true); }
  }

  function renderStats(st) {
    const perDg = Object.entries(st.perDungeon || {})
      .map(([k, v]) => `<span class="stat-chip">${esc(k)} <b>${v}</b></span>`).join('');
    $('toolsStats').innerHTML =
      `<span class="stat-chip">ผู้เล่น <b>${st.players}</b></span>` +
      `<span class="stat-chip">ตัวละคร <b>${st.characters}</b></span>` +
      `<span class="stat-chip">จัดลงตี้แล้ว <b>${st.assigned}</b></span>` +
      `<span class="stat-chip">ตี้ <b>${st.parties}</b></span>` +
      `<span class="stat-chip">ตี้เต็ม <b>${st.partiesFull}</b></span>` +
      (perDg ? `<span class="stat-sep"></span>${perDg}` : '');
  }

  function renderPlayers(players) {
    if (!players.length) { $('toolsPlayers').innerHTML = '<p class="empty">ยังไม่มีผู้ใช้งาน</p>'; return; }
    const rows = players.map((p) => `
      <tr>
        <td><b>${esc(p.playerName)}</b></td>
        <td class="num">${p.count}</td>
        <td class="muted">${p.chars.map((c) => esc(c.charName)).join(', ')}</td>
        <td class="mono">${p.ips.length ? p.ips.map(esc).join('<br>') : '<span class="muted">—</span>'}</td>
      </tr>`).join('');
    $('toolsPlayers').innerHTML = `<table class="roster tools-table">
      <thead><tr><th>คนเล่น</th><th>ตัว</th><th>ตัวละคร</th><th>IP</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function fmtTime(t) {
    return new Date(t).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function renderLog(log) {
    if (!log.length) { $('toolsLog').innerHTML = '<p class="empty">ยังไม่มีประวัติ</p>'; return; }
    $('toolsLog').innerHTML = `<ul class="log-list">` + log.map((e) => `
      <li>
        <span class="log-time">${fmtTime(e.t)}</span>
        <span class="log-detail">${esc(e.text || '')}</span>
        ${e.ip ? `<span class="log-ip mono">${esc(e.ip)}</span>` : ''}
      </li>`).join('') + `</ul>`;
  }

  function exportCsv() {
    const gname = {}; (state.groups || []).forEach((g) => { gname[g.id] = g.name; });
    const partiesOf = (cid) => state.parties.filter((p) => p.members.some((m) => m.id === cid)).map((p) => p.name);
    const rows = [['ตัวละคร', 'คนเล่น', 'คลาส', 'CP', 'ดัน', 'ตี้ที่ลง']];
    (state.characters || []).forEach((c) => {
      rows.push([
        c.charName, c.playerName, c.class, c.cp,
        (c.dungeonIds || []).map((id) => gname[id]).filter(Boolean).join(' / '),
        partiesOf(c.id).join(' / '),
      ]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sanctuary-roster.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- boot ----------
  (async () => { if (await tryAuth()) showConsole(); })();
})();
