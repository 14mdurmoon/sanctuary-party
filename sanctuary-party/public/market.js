(() => {
  const SP = window.SP;
  const { toast, api, esc, nfmt } = SP;
  const $ = (id) => document.getElementById(id);

  let me = { enabled: false, user: null };
  let server = 'TW';
  let typeFilter = 'all';
  let sort = 'latest';
  let listings = [];

  const timeAgo = (t) => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'เมื่อสักครู่';
    if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
    return `${Math.floor(s / 86400)} วันที่แล้ว`;
  };

  // ---------- real-time "someone wants to contact you" notifications ----------
  let audioCtx = null;
  function unlockAudio() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch {}
    if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch {} }
    window.removeEventListener('pointerdown', unlockAudio);
  }
  window.addEventListener('pointerdown', unlockAudio);

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      [[880, 0], [1174, 0.18], [880, 0.36]].forEach(([f, t]) => {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
        o.start(now + t); o.stop(now + t + 0.18);
      });
    } catch {}
  }

  function showPingBanner(d) {
    let host = document.getElementById('pingHost');
    if (!host) { host = document.createElement('div'); host.id = 'pingHost'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'ping-toast';
    const what = `${d.listingType === 'sell' ? 'ขาย' : 'รับซื้อ'} ${nfmt(d.rate)} บาท/1M (${d.server})`;
    const back = d.fromId ? `<a class="btn small discord-btn" href="https://discord.com/users/${encodeURIComponent(d.fromId)}" target="_blank" rel="noopener">ติดต่อกลับ</a>` : '';
    el.innerHTML = `<div class="ping-ico">🔔</div>
      <div class="ping-body"><b>${esc(d.fromName)}</b> สนใจประกาศของคุณ<br><span class="ping-what">${esc(what)}</span></div>
      <div class="ping-acts">${back}<button class="icon-btn ping-x">✕</button></div>`;
    el.querySelector('.ping-x').onclick = () => el.remove();
    host.appendChild(el);
    setTimeout(() => el.remove(), 30000);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('🔔 มีคนสนใจประกาศของคุณ', { body: `${d.fromName} — ${what}` }); } catch {}
    }
  }

  function onPing(d) { beep(); showPingBanner(d); }

  function connectNotify() {
    if (!me.user || !window.EventSource) return;
    try {
      const es = new EventSource('/api/market/notifications');
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (d && d.type === 'ping') onPing(d); } catch {} };
    } catch {}
  }

  async function initAuth() {
    try { me = await api('GET', '/auth/me'); } catch { me = { enabled: false, user: null }; }
    const bar = $('authBar');
    if (me.enabled && me.user) {
      bar.innerHTML = `<span class="auth-user">🎮 ${esc(me.user.name)}</span> <button class="btn ghost small" id="logoutBtn">ออกจากระบบ</button>`;
      $('logoutBtn').onclick = async () => { try { await api('POST', '/auth/logout'); } catch {} location.reload(); };
    } else if (me.enabled) {
      bar.innerHTML = `<a class="btn small discord-btn" href="/auth/discord">เข้าสู่ระบบด้วย Discord</a>`;
    } else {
      bar.innerHTML = '';
    }
    if (me.user) connectNotify();
  }

  async function load() {
    try {
      const r = await api('GET', `/api/market?server=${server}`);
      listings = r.listings || [];
    } catch (e) { listings = []; }
    render();
  }

  function render() {
    const box = $('marketList');
    let items = listings.slice();
    if (typeFilter !== 'all') items = items.filter((m) => m.type === typeFilter);
    items.sort((a, b) => {
      if (a.closed !== b.closed) return a.closed ? 1 : -1; // active first
      return sort === 'cheap' ? (a.rate - b.rate) : (b.createdAt - a.createdAt);
    });
    if (!items.length) {
      box.innerHTML = '<p class="empty">ยังไม่มีประกาศในเซิฟนี้ — เป็นคนแรกเลยสิ!</p>';
      return;
    }
    const myId = me.user ? me.user.discordId : null;
    box.innerHTML = items.map((m) => {
      const isSell = m.type === 'sell';
      const mine = myId && m.discordId === myId;
      const canManage = mine || (me.user && me.user.admin);
      const contact = `https://discord.com/users/${encodeURIComponent(m.discordId)}`;
      return `
      <div class="mk-card ${isSell ? 'sell' : 'buy'} ${m.closed ? 'closed' : ''}">
        <div class="mk-top">
          <span class="mk-type ${isSell ? 'sell' : 'buy'}">${isSell ? 'ขาย' : 'รับซื้อ'}</span>
          <span class="mk-rate">${nfmt(m.rate)} <small>บาท / 1M</small></span>
          ${m.closed ? '<span class="mk-closed-tag">ปิดแล้ว</span>' : ''}
        </div>
        ${m.amount ? `<div class="mk-amount">จำนวน: <b>${esc(m.amount)}</b></div>` : ''}
        ${m.note ? `<div class="mk-note">${esc(m.note)}</div>` : ''}
        <div class="mk-bottom">
          <div class="mk-owner">🎮 ${esc(m.ownerName || '-')} · <span class="mk-time">${timeAgo(m.createdAt)}</span></div>
          <div class="mk-acts">
            ${(!m.closed && !mine) ? `<button class="btn small mk-ping" data-id="${m.id}" title="แจ้งเตือนเจ้าของประกาศว่าคุณสนใจ (มีเสียงเตือนถ้าเขาออนไลน์)">🔔 เรียก</button>` : ''}
            ${m.closed ? '' : `<a class="btn small discord-btn" href="${contact}" target="_blank" rel="noopener">ติดต่อ</a>`}
            ${canManage ? `<button class="btn ghost small mk-close" data-id="${m.id}">${m.closed ? 'เปิดใหม่' : 'ปิด'}</button>` : ''}
            ${canManage ? `<button class="icon-btn mk-del" data-id="${m.id}" title="ลบ">✕</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  async function openPost() {
    if (!me.user) {
      const go = await SP.confirmModal('ต้องเข้าสู่ระบบด้วย Discord ก่อนจึงจะประกาศได้ ไปเข้าสู่ระบบเลยไหม?');
      if (go) location.href = '/auth/discord';
      return;
    }
    const vals = await SP.formModal(`ประกาศในเซิฟ ${server}`, [
      { name: 'type', label: 'ประเภท', type: 'select', value: 'sell',
        options: [{ value: 'sell', label: 'ขาย kina' }, { value: 'buy', label: 'รับซื้อ kina' }] },
      { name: 'rate', label: 'เรตราคา (บาท ต่อ 1M)', type: 'number', value: '' },
      { name: 'amount', label: 'จำนวน (เช่น 500M หรือ ไม่จำกัด)', value: '' },
      { name: 'note', label: 'รายละเอียด/เงื่อนไข (ไม่บังคับ)', value: '' },
    ], 'ประกาศ');
    if (!vals) return;
    if (!Number(vals.rate)) { toast('กรุณาใส่เรตราคา', true); return; }
    try {
      await api('POST', '/api/market', { ...vals, server });
      toast('ประกาศแล้ว!');
      load();
    } catch (e) { toast(e.message, true); }
  }

  // events
  $('serverSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    document.querySelectorAll('#serverSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); server = b.dataset.server; load();
  });
  $('typeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    document.querySelectorAll('#typeSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); typeFilter = b.dataset.type; render();
  });
  $('sortSeg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    document.querySelectorAll('#sortSeg .seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active'); sort = b.dataset.sort; render();
  });
  $('postBtn').addEventListener('click', openPost);
  $('marketList').addEventListener('click', async (e) => {
    const ping = e.target.closest('.mk-ping');
    if (ping) {
      ping.disabled = true;
      try {
        const r = await api('POST', `/api/market/${ping.dataset.id}/ping`);
        toast(r.online ? 'เรียกแล้ว! เจ้าของประกาศออนไลน์อยู่ 🔔' : 'ส่งแล้ว แต่เจ้าของไม่ออนไลน์ — ลองกด "ติดต่อ" ผ่าน Discord');
      } catch (err) { toast(err.message, true); }
      setTimeout(() => { ping.disabled = false; }, 3000);
      return;
    }
    const close = e.target.closest('.mk-close');
    const del = e.target.closest('.mk-del');
    if (close) {
      try { await api('POST', `/api/market/${close.dataset.id}/close`); load(); }
      catch (err) { toast(err.message, true); }
    } else if (del) {
      if (!(await SP.confirmModal('ลบประกาศนี้?'))) return;
      try { await api('DELETE', `/api/market/${del.dataset.id}`); toast('ลบแล้ว'); load(); }
      catch (err) { toast(err.message, true); }
    }
  });

  // refresh periodically so viewers see new posts without reload
  setInterval(load, 20000);

  initAuth().then(load);
})();
