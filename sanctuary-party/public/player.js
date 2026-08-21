(function () {
  const { fmtCountdown, classColor, clsHtml, clericBadge, dungeonName, toast, api, connect, esc, nfmt } = SP;
  const OWN_KEY = 'sanctuary_owned_v1';
  let owned = {};      // { charId: editToken }
  let state = { pool: [], parties: [], partySize: 10 };

  try { owned = JSON.parse(localStorage.getItem(OWN_KEY) || '{}'); } catch { owned = {}; }
  const saveOwned = () => localStorage.setItem(OWN_KEY, JSON.stringify(owned));

  const $ = (id) => document.getElementById(id);
  const allChars = () => [...state.pool, ...state.parties.flatMap((p) => p.members)];
  const partyOf = (cid) => state.parties.find((p) => p.members.some((m) => m.id === cid));

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
    wrap.innerHTML = '<label for="dungeon">จะลงดันไหน</label><select id="dungeon"></select>';
    btn.parentNode.insertBefore(wrap, btn);
  })();
  function populateDungeons() {
    const sel = $('dungeon'); if (!sel) return;
    const cur = sel.value;
    const opts = ['<option value="">— ยังไม่เลือก —</option>']
      .concat((state.groups || []).map((g) => `<option value="${g.id}">${esc(g.name)}</option>`));
    sel.innerHTML = opts.join('');
    if (cur) sel.value = cur;
  }

  // ---- add ----
  async function add() {
    const playerName = $('playerName').value.trim();
    const charName = $('charName').value.trim();
    const cp = $('cp').value;
    const cls = $('cls').value.trim();
    const dungeonId = ($('dungeon') && $('dungeon').value) || null;
    if (!playerName || !charName) { toast('กรอกชื่อคนเล่นและชื่อตัวละคร', true); return; }
    $('addBtn').disabled = true;
    try {
      const r = await api('POST', '/api/characters', { playerName, charName, cp, class: cls, dungeonId });
      owned[r.id] = r.editToken; saveOwned();
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
    const mine = allChars().filter((c) => owned[c.id]);
    const box = $('mine');
    if (!mine.length) { box.innerHTML = '<p class="empty">ยังไม่ได้ลงชื่อตัวละคร</p>'; return; }
    box.innerHTML = '';
    mine.forEach((c) => {
      const p = partyOf(c.id);
      const el = document.createElement('div');
      el.className = 'card' + (c.carry ? ' carry' : '');
      el.innerHTML = `
        <span class="cls-dot" style="color:${classColor(c.class)}"></span>
        <div class="idn">
          <div class="cn">${esc(c.charName)} ${p ? `<span class="tag assigned">${esc(p.name)}</span>` : ''}${dungeonName(state.groups, c.dungeonId) ? `<span class="tag dungeon">${esc(dungeonName(state.groups, c.dungeonId))}</span>` : ''}</div>
          <div class="pn">${esc(c.playerName)} · ${clsHtml(c.class)}</div>
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
    const dgOpts = [{ value: '', label: '— ยังไม่เลือก —' }]
      .concat((state.groups || []).map((g) => ({ value: g.id, label: g.name })));
    const vals = await SP.formModal('แก้ไขตัวละคร', [
      { name: 'charName', label: 'ชื่อตัวละคร', value: c.charName },
      { name: 'cp', label: 'CP', value: c.cp, type: 'number' },
      { name: 'cls', label: 'คลาส', value: c.class || '', list: 'classes' },
      { name: 'dungeonId', label: 'จะลงดันไหน', type: 'select', value: c.dungeonId || '', options: dgOpts },
    ], 'บันทึก');
    if (!vals) return;
    try {
      await api('PUT', '/api/characters/' + c.id,
        { charName: vals.charName, cp: vals.cp, class: vals.cls, dungeonId: vals.dungeonId }, { 'X-Edit-Token': owned[c.id] });
      toast('แก้ไขแล้ว');
    } catch (e) { toast(e.message, true); }
  }

  async function delChar(c) {
    const ok = await SP.confirmModal(`ลบ "${c.charName}" ออกจากรายชื่อ?`, 'ลบ');
    if (!ok) return;
    try {
      await api('DELETE', '/api/characters/' + c.id, null, { 'X-Edit-Token': owned[c.id] });
      delete owned[c.id]; saveOwned();
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
      const p = partyOf(c.id);
      return `<tr>
        <td><span class="cls-dot" style="color:${classColor(c.class)};display:inline-block;margin-right:7px"></span><b>${esc(c.charName)}</b></td>
        <td class="muted">${esc(c.playerName)}</td>
        <td>${clsHtml(c.class)}</td>
        <td>${dungeonName(state.groups, c.dungeonId) ? `<span class="tag dungeon">${esc(dungeonName(state.groups, c.dungeonId))}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${nfmt(c.cp)}</td>
        <td>${p ? `<span class="tag assigned">${esc(p.name)}</span>` : '<span class="tag pool">ยังไม่จัด</span>'}</td>
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
      <div class="slots"></div>`;
    const slots = card.querySelector('.slots');
    if (!n) slots.innerHTML = '<div class="empty-hint">ยังไม่มีสมาชิก</div>';
    else p.members.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'card' + (m.carry ? ' carry' : '');
      row.innerHTML = `
        <span class="slot-idx">${i + 1}</span>
        <span class="cls-dot" style="color:${classColor(m.class)}"></span>
        <div class="idn">
          <div class="cn">${esc(m.charName)}</div>
          <div class="pn">${esc(m.playerName)} · ${clsHtml(m.class)}</div>
        </div>
        <span class="cp">${nfmt(m.cp)}</span>`;
      slots.appendChild(row);
    });
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
  function render() { populateDungeons(); renderMine(); renderRoster(); renderBoard(); }
  connect((s) => { state = s; render(); }, (up) => {
    const dot = $('live');
    dot.classList.toggle('off', !up);
    dot.querySelector('i').nextSibling.textContent = up ? ' live' : ' offline';
  });
})();
