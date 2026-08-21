/* shared helpers for both player and admin pages */
window.SP = (function () {
  const pad = (n) => String(n).padStart(2, '0');

  function fmtCountdown(startTime) {
    if (!startTime) return { state: 'unset', clock: 'ยังไม่ตั้งเวลา', when: '' };
    const diff = startTime - Date.now();
    const when = new Date(startTime).toLocaleString('th-TH', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
    if (diff <= 0) {
      const since = Math.floor(-diff / 60000);
      return { state: 'live', clock: 'ลงแล้ว', when: since < 90 ? `เริ่มมา ${since} นาที` : `เริ่ม ${when}` };
    }
    const s = Math.floor(diff / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const clock = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
    const state = diff < 15 * 60000 ? 'soon' : 'ok';
    return { state, clock, when: `เริ่ม ${when}` };
  }

  const CLERIC_GREEN = '#4fe0a1';
  const isCleric = (cls) => /cleric/i.test(cls || '');
  const clsHtml = (cls) => {
    const t = esc(cls || '—');
    return isCleric(cls) ? `<span class="cls" style="color:${CLERIC_GREEN}">${t}</span>` : `<span class="cls">${t}</span>`;
  };
  const clericBadge = (members) => {
    const n = (members || []).filter((m) => isCleric(m.class)).length;
    return n > 0
      ? `<span class="tag ok">✚ Cleric ×${n}</span>`
      : `<span class="tag warn">⚠ ยังไม่มี Cleric</span>`;
  };

  function classColor(cls) {
    if (isCleric(cls)) return CLERIC_GREEN;
    if (!cls) return 'hsl(220, 12%, 55%)';
    let h = 0;
    for (let i = 0; i < cls.length; i++) h = (h * 31 + cls.charCodeAt(i)) % 360;
    return `hsl(${h}, 62%, 62%)`;
  }

  let toastTimer;
  function toast(msg, isErr) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function api(method, url, body, headers) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data;
  }

  function connect(onState, onStatus) {
    let es;
    function start() {
      es = new EventSource('/api/stream');
      es.onopen = () => onStatus && onStatus(true);
      es.onmessage = (e) => { try { onState(JSON.parse(e.data)); } catch {} };
      es.onerror = () => { onStatus && onStatus(false); };
    }
    start();
    setInterval(async () => {
      if (!es || es.readyState === 2) {
        try { onState(await api('GET', '/api/state')); onStatus && onStatus(true); } catch {}
      }
    }, 8000);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nfmt = (n) => Number(n || 0).toLocaleString('en-US');

  // ---------- in-page modal (works in in-app browsers where prompt/confirm are blocked) ----------
  let modalResolve = null;
  function ensureModal() {
    if (document.getElementById('spModal')) return;
    const style = document.createElement('style');
    style.textContent = `
      .sp-modal{position:fixed;inset:0;background:rgba(5,8,18,.72);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;z-index:120;padding:18px}
      .sp-modal.open{display:flex}
      .sp-card{width:100%;max-width:360px;background:linear-gradient(180deg,#1b2340,#141b30);border:1px solid #2a3358;border-radius:16px;box-shadow:0 24px 60px -20px #000;overflow:hidden;animation:sppop .16s ease}
      @keyframes sppop{from{transform:translateY(8px);opacity:.6}to{transform:translateY(0);opacity:1}}
      .sp-title{font-family:"Cinzel","Sarabun",serif;font-size:1rem;letter-spacing:.06em;padding:15px 18px;border-bottom:1px solid #222a49;color:#eef1ff}
      .sp-body{padding:16px 18px}
      .sp-body .field{margin-bottom:12px}.sp-body .field:last-child{margin-bottom:0}
      .sp-msg{color:#c9cfe6;font-size:.95rem;line-height:1.5;margin:0}
      .sp-acts{display:flex;gap:10px;padding:0 18px 18px;justify-content:flex-end}
      .sp-checks{display:flex;flex-wrap:wrap;gap:8px}
      .sp-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border:1px solid #2a3358;border-radius:999px;background:#0e1324;cursor:pointer;font-size:.88rem;color:#e7eaf6}
      .sp-chip input{width:auto;margin:0;accent-color:#63d6ea}
      .sp-chip:hover{border-color:#2f6f7e}
    `;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'spModal';
    el.className = 'sp-modal';
    el.innerHTML =
      `<div class="sp-card">
        <div class="sp-title"></div>
        <div class="sp-body"></div>
        <div class="sp-acts">
          <button class="btn ghost" data-act="cancel">ยกเลิก</button>
          <button class="btn primary" data-act="ok">บันทึก</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el && modalResolve) modalResolve(false); });
  }

  function showModal(opts) {
    ensureModal();
    const el = document.getElementById('spModal');
    el.querySelector('.sp-title').textContent = opts.title || '';
    const body = el.querySelector('.sp-body');
    body.innerHTML = '';
    const inputs = {};
    if (opts.message) {
      const p = document.createElement('p'); p.className = 'sp-msg'; p.textContent = opts.message; body.appendChild(p);
    }
    (opts.fields || []).forEach((f) => {
      const wrap = document.createElement('div'); wrap.className = 'field';
      const lab = document.createElement('label'); lab.textContent = f.label; wrap.appendChild(lab);
      let inp;
      if (f.type === 'multiselect') {
        inp = document.createElement('div');
        inp.className = 'sp-checks';
        const chosen = (f.value || []).map(String);
        if (!(f.options || []).length) inp.innerHTML = '<span class="hint">ยังไม่มีตัวเลือก</span>';
        (f.options || []).forEach((o) => {
          const lab = document.createElement('label'); lab.className = 'sp-chip';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = o.value;
          if (chosen.includes(String(o.value))) cb.checked = true;
          const sp = document.createElement('span'); sp.textContent = o.label;
          lab.appendChild(cb); lab.appendChild(sp); inp.appendChild(lab);
        });
      } else if (f.type === 'select') {
        inp = document.createElement('select');
        (f.options || []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.value; opt.textContent = o.label;
          if (String(o.value) === String(f.value == null ? '' : f.value)) opt.selected = true;
          inp.appendChild(opt);
        });
      } else {
        inp = document.createElement('input');
        inp.type = f.type || 'text'; inp.value = f.value == null ? '' : f.value;
        if (f.list) inp.setAttribute('list', f.list);
      }
      wrap.appendChild(inp); body.appendChild(wrap); inputs[f.name] = inp;
    });
    const okBtn = el.querySelector('[data-act="ok"]');
    okBtn.textContent = opts.okLabel || 'บันทึก';
    okBtn.classList.toggle('danger', !!opts.okDanger);
    okBtn.classList.toggle('primary', !opts.okDanger);
    const cancelBtn = el.querySelector('[data-act="cancel"]');
    el.classList.add('open');
    const first = body.querySelector('input');
    if (first) setTimeout(() => first.focus(), 60);
    return new Promise((resolve) => {
      modalResolve = (result) => { el.classList.remove('open'); modalResolve = null; resolve(result); };
      okBtn.onclick = () => {
        if (opts.fields) {
          const out = {};
          for (const k in inputs) {
            const el = inputs[k];
            if (el.classList && el.classList.contains('sp-checks')) {
              out[k] = [...el.querySelectorAll('input:checked')].map((c) => c.value);
            } else out[k] = el.value;
          }
          modalResolve(out);
        } else modalResolve(true);
      };
      cancelBtn.onclick = () => modalResolve(opts.fields ? null : false);
      body.querySelectorAll('input').forEach((inp) =>
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); }));
    });
  }

  const confirmModal = (message, okLabel) =>
    showModal({ title: 'ยืนยัน', message, okLabel: okLabel || 'ตกลง', okDanger: true });
  const formModal = (title, fields, okLabel) =>
    showModal({ title, fields, okLabel: okLabel || 'บันทึก' });

  const dungeonName = (groups, id) => {
    if (!id) return '';
    const g = (groups || []).find((x) => x.id === id);
    return g ? g.name : '';
  };
  const dungeonTagsHtml = (groups, ids) => {
    if (!Array.isArray(ids) || !ids.length) return '';
    return ids.map((id) => dungeonName(groups, id))
      .filter(Boolean)
      .map((nm) => `<span class="tag dungeon">${esc(nm)}</span>`)
      .join(' ');
  };

  return { fmtCountdown, classColor, isCleric, clsHtml, clericBadge, dungeonName, dungeonTagsHtml, toast, api, connect, esc, nfmt, showModal, confirmModal, formModal };
})();
