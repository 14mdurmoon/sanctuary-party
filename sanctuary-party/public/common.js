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

  // deterministic hue from class name so colors are stable
  function classColor(cls) {
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

  // SSE with fallback polling
  function connect(onState, onStatus) {
    let es;
    function start() {
      es = new EventSource('/api/stream');
      es.onopen = () => onStatus && onStatus(true);
      es.onmessage = (e) => { try { onState(JSON.parse(e.data)); } catch {} };
      es.onerror = () => { onStatus && onStatus(false); };
    }
    start();
    // safety poll in case a proxy drops the stream
    setInterval(async () => {
      if (!es || es.readyState === 2) {
        try { onState(await api('GET', '/api/state')); onStatus && onStatus(true); } catch {}
      }
    }, 8000);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nfmt = (n) => Number(n || 0).toLocaleString('en-US');

  return { fmtCountdown, classColor, toast, api, connect, esc, nfmt };
})();
