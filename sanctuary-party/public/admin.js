(function () {
  const { fmtCountdown, classColor, clsHtml, clericBadge, toast, api, connect, esc, nfmt } = SP;
  const TOKEN_KEY = 'sanctuary_admin_token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let state = { pool: [], parties: [], partySize: 10 };
  let dupWarned = false;
  const allChars = () => [...state.pool, ...state.parties.flatMap((p) => p.members)];
  const charById = (id) => allChars().find((c) => c.id === id);
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
    startLive();
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

  // ---------- render ----------
  function charCard(c, idx) {
    const div = document.createElement('div');
    div.className = 'card drag';
    div.dataset.id = c.id;
    div.innerHTML =
      (idx != null ? `<span class="slot-idx">${idx + 1}</span>` : '') +
      `<span class="cls-dot" style="color:${classColor(c.class)}"></span>
       <div class="idn">
         <div class="cn">${esc(c.charName)}</div>
         <div class="pn">${esc(c.playerName)} · ${clsHtml(c.class)}</div>
       </div>
       <span class="cp">${nfmt(c.cp)}</span>
       <div class="acts"><button class="icon-btn del" title="ลบตัวละคร">✕</button></div>`;
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

    // board
    const board = $('board');
    $('partyCount').textContent = `${state.parties.length} ตี้`;
    board.innerHTML = '';
    if (!state.parties.length) board.innerHTML = '<p class="empty">ยังไม่มีตี้ — สร้างด้านบน</p>';

    state.parties.forEach((p) => {
      const n = p.members.length, cap = state.partySize, full = n >= cap;
      const totalCp = p.members.reduce((s, m) => s + (m.cp || 0), 0);
      const card = document.createElement('div');
      card.className = 'party';
      card.dataset.pid = p.id;
      card.innerHTML = `
        <div class="p-head">
          <div class="p-title-row">
            <span class="p-name p-edit" data-pid="${p.id}" title="คลิกเพื่อแก้ชื่อ">${esc(p.name)}</span>
            <button class="icon-btn del p-del" data-pid="${p.id}" title="ลบตี้">✕</button>
          </div>
          <div class="fill ${full ? 'full' : ''}">
            <div class="bar"><i style="width:${Math.min(100, (n / cap) * 100)}%"></i></div>
            <span class="count"><b>${n}</b>/${cap}</span>
          </div>
          <div class="p-cp">CP รวม <b>${nfmt(totalCp)}</b></div>
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
      board.appendChild(card);
    });

    initSortables();
    tickCountdowns();
  }

  // ---------- drag & drop ----------
  function initSortables() {
    const lists = [$('pool'), ...document.querySelectorAll('.slots[data-party]')];
    lists.forEach((el) => {
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
            const dragged = charById(evt.dragged && evt.dragged.dataset.id);
            if (dragged) {
              const dup = [...to.querySelectorAll('[data-id]')].some((el) => {
                if (el === evt.dragged) return false;
                const m = charById(el.dataset.id);
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
          finally { dragging = false; if (pending) { state = pending; pending = null; render(); } }
        },
      }));
    });
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
        const c = charById(id);
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
    const del = e.target.closest('.del:not(.p-del)');
    if (del) {
      const id = del.closest('[data-id]')?.dataset.id;
      const card = del.closest('[data-id]');
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
  function startLive() {
    if (liveStarted) { render(); return; }
    liveStarted = true;
    connect((s) => {
      if (dragging) { pending = s; return; }   // don't clobber an in-progress drag
      state = s; render();
    }, (up) => {
      const dot = $('live');
      dot.classList.toggle('off', !up);
      dot.querySelector('i').nextSibling.textContent = up ? ' live' : ' offline';
    });
  }

  // ---------- boot ----------
  (async () => { if (await tryAuth()) showConsole(); })();
})();
