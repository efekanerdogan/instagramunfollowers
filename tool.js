(() => {
'use strict';
/* 🦊 EE Unfollowers v2 — Instagram'da geri takip etmeyenleri bulur ve takipten çıkarır.
   Tamamen tarayıcıda çalışır; hiçbir veri üçüncü bir sunucuya gönderilmez. */

const VERSION = '2.0.0';
const APP_ID = '936619743392459';
const QUERY_HASH = '3dec7e2c57367ef3da3d987d89f9dbc8';
const DEMO = window.EE_UNF_DEMO === true;
const KEY = (DEMO ? 'ee_unf_demo_' : 'ee_unf_') + 'v2_';

const existing = document.getElementById('ee-root');
if (existing) {
  existing.classList.remove('ee-min');
  existing.querySelector('.ee-panel').animate([{ transform: 'scale(.98)' }, { transform: 'scale(1)' }], { duration: 180 });
  return;
}

const SPEEDS = {
  turbo: { icon: '⚡', label: 'Turbo', min: 120, max: 260, every: 0, rest: 0, desc: '120–260 ms · mola yok · yüksek risk' },
  fast: { icon: '🚀', label: 'Hızlı', min: 400, max: 800, every: 40, rest: 30000, desc: '0,4–0,8 sn · her 40 kişide 30 sn mola' },
  safe: { icon: '🛡️', label: 'Güvenli', min: 1200, max: 2500, every: 15, rest: 90000, desc: '1,2–2,5 sn · her 15 kişide 90 sn mola' }
};

/* ---------- yardımcılar ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(KEY + k); } catch (e) {} }
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n || 0).toLocaleString('tr-TR');
const getCookie = (n) => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; };
const ago = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'az önce';
  if (s < 3600) return Math.round(s / 60) + ' dk önce';
  if (s < 86400) return Math.round(s / 3600) + ' sa önce';
  return Math.round(s / 86400) + ' gün önce';
};
const normUser = (u) => ({
  id: String(u.id || u.pk_id || u.pk),
  username: u.username || '',
  full_name: u.full_name || '',
  pic: u.profile_pic_url || '',
  verified: !!u.is_verified,
  private: !!u.is_private
});

/* ---------- Instagram API ---------- */
class RateLimitError extends Error {}
class AuthError extends Error {}

const igHeaders = () => {
  const h = { 'x-ig-app-id': APP_ID, 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': getCookie('csrftoken') || '' };
  try { const c = sessionStorage.getItem('www-claim-v2'); if (c) h['x-ig-www-claim'] = c; } catch (e) {}
  return h;
};

const getJSON = async (url) => {
  const short = url.split('?')[0];
  const res = await fetch(url, { headers: igHeaders(), credentials: 'include' });
  console.info('[Unfollowers] ' + short + ' → HTTP ' + res.status);
  if (res.status === 429) throw new RateLimitError('429');
  if (res.status === 401 || res.status === 403) throw new AuthError(String(res.status));
  if (!res.ok) throw new Error(short + ' → HTTP ' + res.status);
  let data;
  try { data = await res.json(); } catch (e) { throw new Error(short + ' → JSON olmayan yanıt'); }
  if (data && data.message === 'login_required') throw new AuthError('login_required');
  if (data && (data.spam || data.message === 'feedback_required')) throw new RateLimitError('spam');
  return data;
};

const API = {
  viewerId() { return getCookie('ds_user_id'); },
  /* Yöntem 1: GraphQL — "follows_viewer" alanı sayesinde tek listeyle sonuç verir. */
  async scanGraphQL(uid, ctx) {
    const following = [];
    let after = null, more = true;
    while (more) {
      ctx.checkStop();
      const vars = { id: uid, include_reel: false, fetch_mutual: false, first: 50, after };
      const d = await ctx.retry(() => getJSON('/graphql/query/?query_hash=' + QUERY_HASH + '&variables=' + encodeURIComponent(JSON.stringify(vars))));
      const edge = d && d.data && d.data.user && d.data.user.edge_follow;
      if (!edge) throw new Error('GraphQL yanıtı beklenen biçimde değil');
      if (edge.count) ctx.total = edge.count;
      if (edge.edges.length && !edge.edges.some((e) => 'follows_viewer' in e.node)) throw new Error('GraphQL yanıtında follows_viewer alanı yok');
      edge.edges.forEach((e) => following.push(Object.assign(normUser(e.node), { followsBack: !!e.node.follows_viewer })));
      ctx.progress(following.length, 'Takip edilenler taranıyor');
      more = edge.page_info.has_next_page;
      after = edge.page_info.end_cursor;
      if (more) await sleep(rand(220, 480));
    }
    if (!following.length || (ctx.total && following.length < ctx.total * 0.9)) {
      throw new Error('GraphQL eksik liste döndürdü (' + following.length + '/' + (ctx.total || '?') + ')');
    }
    return { following, nonFollowers: following.filter((u) => !u.followsBack) };
  },
  /* Yöntem 2: REST — takipçi ve takip listelerini ayrı ayrı çekip karşılaştırır. */
  async scanREST(uid, ctx) {
    const pull = async (kind, label, total) => {
      const out = [];
      let maxId = '';
      do {
        ctx.checkStop();
        const d = await ctx.retry(() => getJSON('/api/v1/friendships/' + uid + '/' + kind + '/?count=100' + (maxId ? '&max_id=' + encodeURIComponent(maxId) : '')));
        (d.users || []).forEach((u) => out.push(normUser(u)));
        ctx.total = total;
        ctx.progress(out.length, label);
        maxId = d.next_max_id || '';
        if (maxId) await sleep(rand(300, 650));
      } while (maxId);
      return out;
    };
    const following = await pull('following', 'Takip edilenler taranıyor', 0);
    const followers = await pull('followers', 'Takipçiler taranıyor', 0);
    if (!following.length) throw new Error('Takip listesi boş geldi (Instagram liste vermedi)');
    const fset = new Set(followers.map((u) => u.id));
    following.forEach((u) => { u.followsBack = fset.has(u.id); });
    return { following, nonFollowers: following.filter((u) => !u.followsBack) };
  },
  async unfollow(id) {
    const headers = Object.assign(igHeaders(), { 'content-type': 'application/x-www-form-urlencoded' });
    const endpoints = ['/api/v1/friendships/destroy/' + id + '/', '/web/friendships/' + id + '/unfollow/'];
    let last = { ok: false, reason: 'unknown' };
    for (const ep of endpoints) {
      let res, data = {};
      try { res = await fetch(ep, { method: 'POST', headers, credentials: 'include', body: 'user_id=' + id }); }
      catch (e) { last = { ok: false, reason: 'network' }; continue; }
      try { data = await res.json(); } catch (e) {}
      if (res.status === 429 || data.spam || data.message === 'feedback_required') return { ok: false, limited: true };
      if (res.status === 401 || data.message === 'login_required') return { ok: false, auth: true };
      if (res.ok && data.status !== 'fail') return { ok: true };
      last = { ok: false, reason: 'HTTP ' + res.status };
    }
    return last;
  }
};

/* ---------- Demo (sahte veri, ağ isteği yok) ---------- */
if (DEMO) {
  const A = ['kahve', 'mavi', 'gece', 'deniz', 'kuzey', 'ruzgar', 'pixel', 'atlas', 'zeytin', 'nar', 'bulut', 'lale', 'kum', 'yildiz', 'orman', 'tarcin', 'retro', 'mor'];
  const B = ['sever', 'kus', 'yolcu', 'studio', 'notlari', 'daily', 'art', 'foto', 'gezgin', 'mutfak', 'design', 'tv', 'kitap', 'music', 'club', 'lab'];
  const N = ['Ece', 'Mert', 'Zeynep', 'Can', 'Deniz', 'Elif', 'Kaan', 'Selin', 'Burak', 'Ada', 'Emre', 'İrem', 'Onur', 'Defne', 'Arda', 'Nil'];
  const S = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Aydın', 'Arslan', 'Doğan', 'Kılıç', 'Koç'];
  const pick = (a) => a[rand(0, a.length - 1)];
  const seen = new Set();
  const fake = (i) => {
    let un;
    do { un = pick(A) + pick(['.', '_', '']) + pick(B) + (Math.random() < 0.4 ? rand(1, 99) : ''); } while (seen.has(un));
    seen.add(un);
    const brand = Math.random() < 0.12;
    return { id: String(9000 + i), username: un, full_name: brand ? un.replace(/[._\d]/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) : pick(N) + ' ' + pick(S), pic: '', verified: brand, private: !brand && Math.random() < 0.35, followsBack: Math.random() < 0.72 };
  };
  const all = Array.from({ length: 248 }, (_, i) => fake(i));
  API.viewerId = () => 'demo';
  API.scanGraphQL = async (uid, ctx) => {
    ctx.total = all.length;
    for (let i = 0; i < all.length; i += 50) { ctx.checkStop(); await sleep(260); ctx.progress(Math.min(all.length, i + 50), 'Takip edilenler taranıyor (demo)'); }
    const following = all.map((u) => Object.assign({}, u));
    return { following, nonFollowers: following.filter((u) => !u.followsBack) };
  };
  API.unfollow = async () => { await sleep(rand(60, 160)); return Math.random() < 0.96 ? { ok: true } : { ok: false, reason: 'demo' }; };
}

/* ---------- Durum ---------- */
const viewerId = API.viewerId();
const S = {
  tab: 'non',
  users: [],
  followingCount: 0,
  scannedAt: 0,
  selected: new Set(),
  whitelist: store.get('whitelist', {}),
  history: store.get('history', []),
  filters: { verified: true, private: true, public: true },
  sort: 'default',
  query: '',
  speed: SPEEDS[store.get('speed', 'fast')] ? store.get('speed', 'fast') : 'fast',
  busy: null,
  stop: false,
  lastIndex: -1,
  viewer: null
};
const cached = viewerId ? store.get('cache_' + viewerId, null) : null;
if (cached && Array.isArray(cached.users)) {
  S.users = cached.users;
  S.followingCount = cached.followingCount || 0;
  S.scannedAt = cached.t || 0;
}
const saveCache = () => { if (viewerId) store.set('cache_' + viewerId, { t: S.scannedAt, followingCount: S.followingCount, users: S.users }); };

/* ---------- Stil ---------- */
const CSS = `
#ee-root{--ac:#ff6b00;--ac2:#ff8a3d;--acs:rgba(255,107,0,.14);--bg:#121010;--bg2:#1a1715;--bg3:#24201d;--ln:rgba(255,255,255,.08);--ln2:rgba(255,255,255,.14);--tx:#f6f3f0;--tx2:#a39b94;--tx3:#6f6862;--ok:#22c55e;--bad:#ef4444;--warn:#f59e0b;
all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--tx);font-size:13px;line-height:1.4}
:where(#ee-root) *,:where(#ee-root) *::before,:where(#ee-root) *::after{box-sizing:border-box;margin:0;padding:0;letter-spacing:normal}
:where(#ee-root) :is(button,input,select,a,textarea){font:inherit;color:inherit}
:where(#ee-root) button{cursor:pointer;background:none;border:0;text-align:inherit}
#ee-root button:focus-visible,#ee-root input:focus-visible,#ee-root select:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
#ee-root svg{display:block;flex-shrink:0}
.ee-panel{position:fixed;z-index:2147483646;top:50%;left:50%;transform:translate(-50%,-50%);width:min(760px,calc(100vw - 24px));height:min(820px,calc(100vh - 24px));display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--ln2);border-radius:20px;box-shadow:0 40px 120px rgba(0,0,0,.65),0 0 0 1px rgba(0,0,0,.4);overflow:hidden;animation:ee-in .35s cubic-bezier(.16,1,.3,1)}
@keyframes ee-in{from{opacity:0;transform:translate(-50%,-46%) scale(.98)}}
.ee-panel.ee-full{top:0!important;left:0!important;transform:none!important;width:100vw;height:100vh;border-radius:0;animation:none}
#ee-root.ee-min .ee-panel{display:none}
.ee-pill{display:none;position:fixed;z-index:2147483646;right:20px;bottom:20px;align-items:center;gap:10px;padding:10px 16px 10px 12px;background:var(--bg);border:1px solid var(--ln2);border-radius:999px;box-shadow:0 18px 50px rgba(0,0,0,.5);font-weight:600}
#ee-root.ee-min .ee-pill{display:flex}
.ee-pill-ring{width:28px;height:28px;border-radius:50%;background:conic-gradient(var(--ac) var(--p,0%),var(--bg3) 0);display:grid;place-items:center}
.ee-pill-ring::after{content:"🦊";width:22px;height:22px;border-radius:50%;background:var(--bg);display:grid;place-items:center;font-size:12px}
.ee-head{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 18px;border-bottom:1px solid var(--ln);cursor:grab;user-select:none;background:linear-gradient(180deg,rgba(255,107,0,.07),transparent)}
.ee-full .ee-head{cursor:default}
.ee-logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--ac),#ff3d6e);display:grid;place-items:center;font-size:18px;box-shadow:0 6px 18px rgba(255,107,0,.35)}
.ee-title{flex:1;min-width:0}
.ee-title b{display:block;font-size:15px;font-weight:700}
.ee-title span{display:block;font-size:12px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ee-hbtn{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--tx2);transition:.15s}
.ee-hbtn:hover{background:var(--bg3);color:var(--tx)}
.ee-hbtn.ee-x:hover{background:rgba(239,68,68,.16);color:var(--bad)}
.ee-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 18px 4px}
.ee-stat{background:var(--bg2);border:1px solid var(--ln);border-radius:12px;padding:10px 12px}
.ee-stat b{display:block;font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}
.ee-stat span{font-size:11px;color:var(--tx2)}
.ee-stat.ee-hl b{color:var(--ac2)}
.ee-tabs{display:flex;gap:4px;padding:12px 18px 0;border-bottom:1px solid var(--ln);overflow-x:auto;scrollbar-width:none}
.ee-tab{white-space:nowrap;flex-shrink:0;padding:9px 12px 11px;color:var(--tx2);font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px;display:flex;align-items:center;gap:6px;transition:.15s}
.ee-tab:hover{color:var(--tx)}
.ee-tab.on{color:var(--tx);border-bottom-color:var(--ac)}
.ee-tab i{font-style:normal;font-size:11px;background:var(--bg3);color:var(--tx2);padding:1px 7px;border-radius:99px}
.ee-tab.on i{background:var(--acs);color:var(--ac2)}
.ee-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 18px}
.ee-search{flex:1 1 180px;display:flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--ln);border-radius:10px;padding:0 10px;height:36px;color:var(--tx3)}
.ee-search:focus-within{border-color:var(--ac)}
.ee-search input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--tx);height:100%}
.ee-search input::placeholder{color:var(--tx3)}
.ee-select{height:36px;background:var(--bg2);border:1px solid var(--ln);border-radius:10px;color:var(--tx);padding:0 10px;outline:0}
.ee-select option{background:var(--bg2)}
.ee-chips{display:flex;gap:6px;flex-wrap:wrap}
.ee-chip{height:30px;padding:0 11px;border-radius:99px;border:1px solid var(--ln2);color:var(--tx2);font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px;transition:.15s}
.ee-chip:hover{border-color:var(--tx3)}
.ee-chip.on{background:var(--acs);border-color:rgba(255,107,0,.5);color:var(--ac2)}
.ee-chip.ee-ghost{border-style:dashed}
.ee-spacer{flex:1}
.ee-link{color:var(--ac2);font-weight:700;font-size:12px;padding:6px 4px}
.ee-link:hover{text-decoration:underline}
.ee-link:disabled{opacity:.4;cursor:default;text-decoration:none}
.ee-list{flex:1;min-height:0;overflow-y:auto;padding:0 10px 10px;scrollbar-width:thin;scrollbar-color:#3a3430 transparent}
.ee-row{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:12px;border:1px solid transparent;cursor:pointer;transition:background .12s;user-select:none}
.ee-row:hover{background:var(--bg2)}
.ee-row.sel{background:var(--acs);border-color:rgba(255,107,0,.35)}
.ee-row.ee-nosel{cursor:default}
.ee-av{width:42px;height:42px;border-radius:50%;flex-shrink:0;object-fit:cover;background:var(--bg3);display:grid;place-items:center;font-weight:700;font-size:15px;color:#fff;text-transform:uppercase}
.ee-info{flex:1;min-width:0}
.ee-un{display:flex;align-items:center;gap:5px;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden}
.ee-un span{overflow:hidden;text-overflow:ellipsis}
.ee-fn{font-size:12px;color:var(--tx2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.ee-ver{color:#3897f0}.ee-lock{color:var(--tx3)}
.ee-act{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--tx3);opacity:0;transition:.15s;text-decoration:none}
.ee-row:hover .ee-act,.ee-act.on,.ee-act:focus-visible{opacity:1}
.ee-act:hover{background:var(--bg3);color:var(--tx)}
.ee-act.on{color:#facc15}
.ee-chk{width:22px;height:22px;border-radius:50%;border:2px solid #4a433e;display:grid;place-items:center;flex-shrink:0;transition:.15s;color:transparent}
.ee-row.sel .ee-chk{background:var(--ac);border-color:var(--ac);color:#fff;box-shadow:0 0 0 4px rgba(255,107,0,.18)}
.ee-time{font-size:11px;color:var(--tx3);white-space:nowrap}
.ee-empty{height:100%;min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;color:var(--tx2);padding:24px}
.ee-empty .ee-big{font-size:38px}
.ee-empty b{color:var(--tx);font-size:15px}
.ee-empty p{max-width:360px;font-size:13px}
.ee-more{display:block;margin:8px auto 0;padding:8px 14px;border-radius:10px;background:var(--bg2);color:var(--tx2);font-weight:600;font-size:12px}
.ee-foot{border-top:1px solid var(--ln);padding:12px 18px 16px;background:var(--bg2);display:flex;flex-direction:column;gap:12px}
.ee-speed{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ee-seg{display:inline-flex;background:var(--bg);border:1px solid var(--ln);border-radius:10px;padding:3px}
.ee-seg button{padding:6px 12px;border-radius:7px;font-weight:600;font-size:12px;color:var(--tx2);transition:.15s}
.ee-seg button.on{background:var(--bg3);color:var(--tx);box-shadow:0 1px 0 rgba(255,255,255,.06) inset}
.ee-seg button[data-speed=turbo].on{color:var(--warn)}
.ee-speed small{color:var(--tx3);font-size:11.5px}
.ee-run{display:flex;align-items:center;gap:14px}
.ee-prog{flex:1;min-width:0}
.ee-bar{height:6px;background:var(--bg3);border-radius:99px;overflow:hidden}
.ee-bar div{height:100%;width:0;background:linear-gradient(90deg,var(--ac),#ff3d6e);border-radius:99px;transition:width .3s}
.ee-bar.ee-indet div{width:30%!important;animation:ee-ind 1.1s ease-in-out infinite}
@keyframes ee-ind{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
.ee-status{font-size:12px;color:var(--tx2);margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ee-btn{height:44px;padding:0 22px;border-radius:12px;font-weight:700;font-size:13.5px;color:#fff;background:linear-gradient(135deg,var(--ac),#e2560a);box-shadow:0 8px 22px rgba(255,107,0,.28);transition:.18s;white-space:nowrap;display:inline-flex;align-items:center;gap:8px}
.ee-btn:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(255,107,0,.4)}
.ee-btn.ee-danger{background:linear-gradient(135deg,#ef4444,#c62828);box-shadow:0 8px 22px rgba(239,68,68,.28)}
.ee-btn.ee-stop{background:var(--bg3);box-shadow:none;border:1px solid var(--ln2)}
.ee-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
.ee-modal{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:grid;place-items:center;padding:16px;animation:ee-fade .2s}
@keyframes ee-fade{from{opacity:0}}
.ee-box{width:min(420px,100%);background:var(--bg);border:1px solid var(--ln2);border-radius:20px;padding:24px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.6);animation:ee-pop .25s cubic-bezier(.16,1,.3,1)}
@keyframes ee-pop{from{transform:scale(.94);opacity:0}}
.ee-box .ee-ico{width:52px;height:52px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;font-size:24px;background:var(--acs)}
.ee-box h3{font-size:18px;font-weight:700;margin-bottom:8px}
.ee-box p{color:var(--tx2);font-size:13.5px;line-height:1.55;margin-bottom:20px}
.ee-box p b{color:var(--tx)}
.ee-box .ee-btns{display:flex;gap:10px}
.ee-box .ee-btns button{flex:1;justify-content:center}
.ee-btn2{height:44px;border-radius:12px;font-weight:600;background:var(--bg3);color:var(--tx);border:1px solid var(--ln2)}
.ee-btn2:hover{background:#2e2925}
.ee-toast{position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);background:#f6f3f0;color:#121010;font-weight:600;padding:10px 16px;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.4);animation:ee-toast 2.6s forwards;pointer-events:none}
@keyframes ee-toast{0%{opacity:0;transform:translate(-50%,10px)}10%,85%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
.ee-menu{position:relative}
.ee-drop{position:absolute;right:0;top:calc(100% + 6px);min-width:210px;background:var(--bg2);border:1px solid var(--ln2);border-radius:12px;padding:6px;box-shadow:0 20px 50px rgba(0,0,0,.5);z-index:3;display:none}
.ee-drop.open{display:block}
.ee-drop button{display:flex;width:100%;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:var(--tx);font-size:13px}
.ee-drop button:hover{background:var(--bg3)}
.ee-drop hr{border:0;border-top:1px solid var(--ln);margin:5px 0}
.ee-drop .ee-red{color:#f87171}
@media (max-width:640px){
.ee-panel{top:0!important;left:0!important;transform:none!important;width:100vw;height:100vh;height:100dvh;border-radius:0;animation:none;border:0}
.ee-head{cursor:default}
.ee-full-btn{display:none}
.ee-stats{grid-template-columns:repeat(2,1fr);padding:12px 14px 2px}
.ee-tabs,.ee-tools{padding-left:14px;padding-right:14px}
.ee-tab{padding:9px 8px 11px;font-size:12.5px}
.ee-foot{padding:12px 14px 14px}
.ee-act{opacity:1}
.ee-run{flex-direction:column;align-items:stretch}
.ee-btn{justify-content:center}
}`;

/* ---------- İkonlar ---------- */
const I = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  min: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',
  full: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
  ver: '<svg class="ee-ver" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5 14.6 4l3.5-.4.9 3.4 3 1.9-1.4 3.1 1.4 3.1-3 1.9-.9 3.4-3.5-.4L12 22.5 9.4 20l-3.5.4L5 17l-3-1.9L3.4 12 2 8.9 5 7l.9-3.4 3.5.4zm-1.3 13.9 6-6-1.4-1.4-4.6 4.6-2.3-2.3-1.4 1.4z"/></svg>',
  lock: '<svg class="ee-lock" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17 9V7A5 5 0 0 0 7 7v2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM9 7a3 3 0 0 1 6 0v2H9z"/></svg>',
  star: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  starO: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  ext: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
};

const style = document.createElement('style');
style.id = 'ee-style';
style.textContent = CSS;
document.head.appendChild(style);

const root = document.createElement('div');
root.id = 'ee-root';
document.body.appendChild(root);

const toast = (msg) => {
  const t = document.createElement('div');
  t.className = 'ee-toast';
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => t.remove(), 2700);
};

const modal = ({ icon = '⚠️', title, html, ok = 'Tamam', cancel = 'Vazgeç', danger = false }) => new Promise((resolve) => {
  const m = document.createElement('div');
  m.className = 'ee-modal';
  m.innerHTML = '<div class="ee-box" role="dialog" aria-modal="true"><div class="ee-ico">' + icon + '</div><h3>' + esc(title) + '</h3><p>' + html + '</p><div class="ee-btns">' +
    (cancel ? '<button class="ee-btn2" data-v="0">' + esc(cancel) + '</button>' : '') +
    '<button class="ee-btn' + (danger ? ' ee-danger' : '') + '" data-v="1">' + esc(ok) + '</button></div></div>';
  const done = (v) => { m.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (e.target === m) done(false); });
  document.addEventListener('keydown', onKey, true);
  root.appendChild(m);
  m.querySelector('[data-v="1"]').focus();
});

/* ---------- Yanlış site ---------- */
if (!DEMO && !/(^|\.)instagram\.com$/.test(location.hostname)) {
  modal({ icon: '🦊', title: 'Instagram açık değil', html: 'Bu araç yalnızca <b>instagram.com</b> üzerinde, oturum açıkken çalışır. Instagram\'ı yeni sekmede açmak ister misin?', ok: 'Instagram\'ı aç' })
    .then((go) => { if (go) window.open('https://www.instagram.com/', '_blank', 'noopener'); root.remove(); style.remove(); });
  return;
}

/* ---------- İskelet ---------- */
root.innerHTML = `
<div class="ee-panel" role="dialog" aria-label="Unfollowers">
  <div class="ee-head">
    <div class="ee-logo">🦊</div>
    <div class="ee-title"><b>Unfollowers${DEMO ? ' · Demo' : ''}</b><span class="ee-sub">Hazır</span></div>
    <button class="ee-hbtn" data-a="minimize" title="Küçült">${I.min}</button>
    <button class="ee-hbtn ee-full-btn" data-a="full" title="Tam ekran">${I.full}</button>
    <button class="ee-hbtn ee-x" data-a="close" title="Kapat (Esc)">${I.close}</button>
  </div>
  <div class="ee-stats">
    <div class="ee-stat"><b data-s="following">–</b><span>Takip edilen</span></div>
    <div class="ee-stat ee-hl"><b data-s="non">–</b><span>Geri takip etmeyen</span></div>
    <div class="ee-stat"><b data-s="sel">0</b><span>Seçili</span></div>
    <div class="ee-stat"><b data-s="done">0</b><span>Bu oturumda çıkarılan</span></div>
  </div>
  <div class="ee-tabs" role="tablist">
    <button class="ee-tab on" data-tab="non">Takip etmeyenler <i data-c="non">0</i></button>
    <button class="ee-tab" data-tab="wl">Beyaz liste <i data-c="wl">0</i></button>
    <button class="ee-tab" data-tab="hist">Geçmiş <i data-c="hist">0</i></button>
  </div>
  <div class="ee-tools">
    <label class="ee-search">${I.search}<input type="search" placeholder="Kullanıcı adı veya isim ara…" autocomplete="off"></label>
    <select class="ee-select" data-a="sort" title="Sırala">
      <option value="default">Takip sırası</option>
      <option value="az">A → Z</option>
      <option value="za">Z → A</option>
      <option value="verified">Onaylılar önce</option>
      <option value="private">Gizliler önce</option>
    </select>
    <div class="ee-menu">
      <button class="ee-hbtn" data-a="menu" title="Diğer işlemler">${I.more}</button>
      <div class="ee-drop">
        <button data-a="csv">⬇️ Listeyi CSV olarak indir</button>
        <button data-a="copy">📋 Kullanıcı adlarını kopyala</button>
        <hr>
        <button data-a="wl-export">📤 Beyaz listeyi dışa aktar</button>
        <button data-a="wl-import">📥 Beyaz liste içe aktar</button>
        <hr>
        <button data-a="clear-hist" class="ee-red">🗑️ Geçmişi temizle</button>
        <button data-a="clear-cache" class="ee-red">♻️ Kayıtlı taramayı sil</button>
      </div>
    </div>
    <div class="ee-chips ee-filter-row" style="width:100%">
      <button class="ee-chip on" data-f="verified">${I.ver} Onaylı</button>
      <button class="ee-chip on" data-f="private">${I.lock} Gizli</button>
      <button class="ee-chip on" data-f="public">🌐 Herkese açık</button>
      <span class="ee-spacer"></span>
      <button class="ee-link" data-a="toggle-all">Tümünü seç</button>
    </div>
  </div>
  <div class="ee-list" tabindex="-1"></div>
  <div class="ee-foot">
    <div class="ee-speed">
      <div class="ee-seg" role="radiogroup" aria-label="Hız modu">
        ${Object.keys(SPEEDS).map((k) => `<button data-speed="${k}" role="radio">${SPEEDS[k].icon} ${SPEEDS[k].label}</button>`).join('')}
      </div>
      <small class="ee-speed-desc"></small>
    </div>
    <div class="ee-run">
      <div class="ee-prog"><div class="ee-bar"><div></div></div><div class="ee-status">Analizi başlatmak için butona bas.</div></div>
      <button class="ee-btn" data-a="main">Analizi başlat</button>
    </div>
  </div>
</div>
<button class="ee-pill" data-a="restore"><span class="ee-pill-ring"></span><span class="ee-pill-txt">Unfollowers</span></button>`;

const $ = (s) => root.querySelector(s);
const $$ = (s) => Array.from(root.querySelectorAll(s));
const UI = {
  panel: $('.ee-panel'), head: $('.ee-head'), sub: $('.ee-sub'), list: $('.ee-list'), search: $('.ee-search input'),
  sort: $('[data-a="sort"]'), drop: $('.ee-drop'), toggleAll: $('[data-a="toggle-all"]'), filterRow: $('.ee-filter-row'),
  bar: $('.ee-bar'), fill: $('.ee-bar div'), status: $('.ee-status'), main: $('[data-a="main"]'),
  speedDesc: $('.ee-speed-desc'), pill: $('.ee-pill'), pillTxt: $('.ee-pill-txt'), pillRing: $('.ee-pill-ring')
};

let sessionDone = 0;
let renderLimit = 300;

/* ---------- Görünüm ---------- */
const setStatus = (txt, pct) => {
  UI.status.textContent = txt;
  UI.pillTxt.textContent = txt.length > 46 ? txt.slice(0, 45) + '…' : txt;
  if (pct === null) { UI.bar.classList.add('ee-indet'); }
  else if (pct !== undefined) {
    UI.bar.classList.remove('ee-indet');
    const p = Math.max(0, Math.min(100, pct)) + '%';
    UI.fill.style.width = p;
    UI.pillRing.style.setProperty('--p', p);
  }
};

const avatar = (u) => {
  const hue = [...u.username].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const init = esc((u.username || '?').replace(/[^a-z0-9]/gi, '').charAt(0) || '?');
  return u.pic
    ? `<img class="ee-av" src="${esc(u.pic)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-init="${init}" data-hue="${hue}">`
    : `<div class="ee-av" style="background:hsl(${hue} 45% 32%)">${init}</div>`;
};

const visibleUsers = () => {
  const q = S.query.trim().toLowerCase().replace(/^@/, '');
  const f = S.filters;
  let list = S.users.filter((u) => {
    if (S.whitelist[u.id]) return false;
    const type = u.verified ? f.verified : u.private ? f.private : f.public;
    return type && (!q || u.username.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q));
  });
  const by = (fn) => list.slice().sort(fn);
  const az = (a, b) => a.username.localeCompare(b.username, 'tr');
  if (S.sort === 'az') list = by(az);
  else if (S.sort === 'za') list = by((a, b) => -az(a, b));
  else if (S.sort === 'verified') list = by((a, b) => (b.verified - a.verified));
  else if (S.sort === 'private') list = by((a, b) => (b.private - a.private));
  return list;
};

const searchFilter = (arr) => {
  const q = S.query.trim().toLowerCase().replace(/^@/, '');
  return q ? arr.filter((u) => u.username.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)) : arr;
};

const empty = (big, title, text) => `<div class="ee-empty"><div class="ee-big">${big}</div><b>${title}</b><p>${text}</p></div>`;

let currentVisible = [];
const render = () => {
  const wlCount = Object.keys(S.whitelist).length;
  const nonCount = S.users.filter((u) => !S.whitelist[u.id]).length;
  root.querySelector('[data-s="following"]').textContent = S.scannedAt ? fmt(S.followingCount) : '–';
  root.querySelector('[data-s="non"]').textContent = S.scannedAt ? fmt(nonCount) : '–';
  root.querySelector('[data-s="sel"]').textContent = fmt(S.selected.size);
  root.querySelector('[data-s="done"]').textContent = fmt(sessionDone);
  root.querySelector('[data-c="non"]').textContent = fmt(nonCount);
  root.querySelector('[data-c="wl"]').textContent = fmt(wlCount);
  root.querySelector('[data-c="hist"]').textContent = fmt(S.history.length);
  $$('.ee-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === S.tab));
  UI.filterRow.style.display = S.tab === 'non' ? '' : 'none';
  UI.sort.style.display = S.tab === 'non' ? '' : 'none';

  let html = '';
  if (S.tab === 'non') {
    currentVisible = visibleUsers();
    if (!S.scannedAt) html = empty('🔍', S.busy === 'scan' ? 'Taranıyor…' : 'Henüz analiz yapılmadı', S.busy === 'scan' ? 'Takip listen sayfa sayfa okunuyor. Bu, takip ettiğin kişi sayısına göre biraz sürebilir.' : 'Aşağıdaki <b>Analizi başlat</b> butonuna bas. Takip ettiğin herkes kontrol edilir ve seni geri takip etmeyenler burada listelenir.');
    else if (!S.users.length) html = empty('🎉', 'Herkes seni geri takip ediyor', 'Takip ettiğin hesapların tamamı seni de takip ediyor.');
    else if (!currentVisible.length) html = empty('🫥', 'Sonuç yok', 'Arama veya filtrelere uyan kullanıcı bulunamadı.');
    else {
      html = currentVisible.slice(0, renderLimit).map((u, i) => `
        <div class="ee-row${S.selected.has(u.id) ? ' sel' : ''}" data-id="${esc(u.id)}" data-i="${i}">
          ${avatar(u)}
          <div class="ee-info"><div class="ee-un"><span>${esc(u.username)}</span>${u.verified ? I.ver : ''}${u.private ? I.lock : ''}</div><div class="ee-fn">${esc(u.full_name) || '&nbsp;'}</div></div>
          <button class="ee-act" data-a="wl" title="Beyaz listeye ekle (asla seçilmez)">${I.starO}</button>
          <a class="ee-act" href="https://www.instagram.com/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener" title="Profili aç">${I.ext}</a>
          <div class="ee-chk">${I.check}</div>
        </div>`).join('');
      if (currentVisible.length > renderLimit) html += `<button class="ee-more" data-a="more">${fmt(currentVisible.length - renderLimit)} kişi daha göster</button>`;
    }
    const allSel = currentVisible.length > 0 && currentVisible.every((u) => S.selected.has(u.id));
    UI.toggleAll.textContent = allSel ? 'Seçimi kaldır' : `Tümünü seç (${fmt(currentVisible.length)})`;
    UI.toggleAll.disabled = !currentVisible.length || !!S.busy;
  } else if (S.tab === 'wl') {
    const wl = searchFilter(Object.values(S.whitelist));
    html = !wl.length
      ? empty('⭐', 'Beyaz liste boş', 'Takipten çıkmak istemediğin hesapların yanındaki yıldıza bas. Beyaz listedekiler hiçbir zaman seçilmez ve listeden gizlenir.')
      : wl.map((u) => `
        <div class="ee-row ee-nosel" data-id="${esc(u.id)}">
          ${avatar(u)}
          <div class="ee-info"><div class="ee-un"><span>${esc(u.username)}</span>${u.verified ? I.ver : ''}${u.private ? I.lock : ''}</div><div class="ee-fn">${esc(u.full_name) || '&nbsp;'}</div></div>
          <button class="ee-act on" data-a="wl" title="Beyaz listeden çıkar">${I.star}</button>
          <a class="ee-act" href="https://www.instagram.com/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener" title="Profili aç">${I.ext}</a>
        </div>`).join('');
  } else {
    const h = searchFilter(S.history);
    html = !h.length
      ? empty('🕓', 'Geçmiş boş', 'Takipten çıkardığın hesaplar tarih bilgisiyle burada tutulur (bu tarayıcıda, son 1000 kayıt).')
      : h.slice(0, 1000).map((u) => `
        <div class="ee-row ee-nosel">
          ${avatar(u)}
          <div class="ee-info"><div class="ee-un"><span>${esc(u.username)}</span></div><div class="ee-fn">${esc(u.full_name) || '&nbsp;'}</div></div>
          <span class="ee-time">${ago(u.t)}</span>
          <a class="ee-act" href="https://www.instagram.com/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener" title="Profili aç">${I.ext}</a>
        </div>`).join('');
  }
  UI.list.innerHTML = html;
  renderFooter();
};

const renderFooter = () => {
  $$('.ee-seg button').forEach((b) => { const on = b.dataset.speed === S.speed; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.disabled = S.busy === 'unfollow'; });
  UI.speedDesc.textContent = SPEEDS[S.speed].desc;
  const m = UI.main;
  m.classList.remove('ee-danger', 'ee-stop');
  m.disabled = !!S.busy && S.stop;
  if (S.busy) { m.textContent = 'Durdur'; m.classList.add('ee-stop'); }
  else if (S.selected.size) { m.textContent = fmt(S.selected.size) + ' kişiyi takipten çık'; m.classList.add('ee-danger'); }
  else m.textContent = S.scannedAt ? 'Yeniden tara' : 'Analizi başlat';
};

const updateSub = () => {
  const who = S.viewer && S.viewer.username ? '@' + S.viewer.username : '';
  const when = S.scannedAt ? 'Son tarama ' + ago(S.scannedAt) : 'Henüz taranmadı';
  UI.sub.textContent = [who, when, 'v' + VERSION].filter(Boolean).join(' · ');
};

/* ---------- İşlemler ---------- */
const waitCountdown = async (sec, label) => {
  for (let s = sec; s > 0; s--) {
    if (S.stop) return false;
    setStatus(label + ' · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
    await sleep(1000);
  }
  return !S.stop;
};

const scan = async () => {
  if (!viewerId) {
    await modal({ icon: '🔒', title: 'Oturum bulunamadı', html: 'Önce Instagram hesabına giriş yap, sayfayı yenile ve aracı tekrar çalıştır.', cancel: null });
    return;
  }
  S.busy = 'scan'; S.stop = false; S.selected.clear(); S.tab = 'non';
  console.info('[Unfollowers] tarama başladı, kullanıcı id: ' + viewerId);
  setStatus('Takip listesi isteniyor…', null);
  render();
  const ctx = {
    total: 0,
    checkStop() { if (S.stop) throw new Error('STOP'); },
    progress(n, label) {
      const t = ctx.total || 0;
      setStatus(label + ' · ' + fmt(n) + (t ? ' / ' + fmt(t) : ''), t ? (n / t) * 100 : null);
    },
    async retry(fn) {
      for (let attempt = 0; ; attempt++) {
        try { return await fn(); }
        catch (e) {
          if (!(e instanceof RateLimitError) || attempt >= 3) throw e;
          const ok = await waitCountdown(60 * (attempt + 1), '⏳ Instagram yavaşlattı, bekleniyor');
          if (!ok) throw new Error('STOP');
        }
      }
    }
  };
  try {
    let result;
    try { result = await API.scanGraphQL(viewerId, ctx); }
    catch (e) {
      if (e.message === 'STOP' || e instanceof AuthError) throw e;
      console.warn('[Unfollowers] GraphQL başarısız, REST yöntemine geçiliyor:', e);
      setStatus('1. yöntem başarısız (' + e.message + '), 2. yöntem deneniyor…', null);
      result = await API.scanREST(viewerId, ctx);
    }
    S.users = result.nonFollowers;
    S.followingCount = result.following.length;
    S.scannedAt = Date.now();
    saveCache();
    const n = S.users.filter((u) => !S.whitelist[u.id]).length;
    setStatus('✅ Tarama bitti · ' + fmt(result.following.length) + ' hesap kontrol edildi, ' + fmt(n) + ' kişi seni geri takip etmiyor.', 100);
  } catch (e) {
    if (e.message === 'STOP') setStatus('Tarama durduruldu.', 0);
    else if (e instanceof AuthError) setStatus('🔒 Oturum doğrulanamadı. Instagram\'a tekrar giriş yapıp sayfayı yenile.', 0);
    else if (e instanceof RateLimitError) setStatus('⚠️ Instagram geçici olarak sınırladı. Birkaç dakika sonra tekrar dene.', 0);
    else { console.error('[Unfollowers]', e); setStatus('❌ Tarama başarısız: ' + e.message, 0); }
  } finally {
    S.busy = null;
    updateSub();
    render();
  }
};

const runUnfollow = async () => {
  const queue = S.users.filter((u) => S.selected.has(u.id) && !S.whitelist[u.id]);
  if (!queue.length) return;
  const sp = SPEEDS[S.speed];
  const turboWarn = S.speed === 'turbo' && queue.length > 50
    ? '<br><br>⚠️ Turbo modda çok sayıda kişiyi hızlıca çıkarmak Instagram\'ın <b>işlem engeli</b> (action block) uygulamasına yol açabilir.' : '';
  const ok = await modal({
    icon: '👋', title: fmt(queue.length) + ' kişi takipten çıkarılsın mı?', danger: true, ok: 'Takipten çık',
    html: 'Seçtiğin hesaplar <b>' + sp.icon + ' ' + sp.label + '</b> modunda (' + esc(sp.desc) + ') takipten çıkarılacak. İstediğin an durdurabilirsin.' + turboWarn
  });
  if (!ok) return;

  S.busy = 'unfollow'; S.stop = false;
  render();
  let done = 0, failed = 0, limitHits = 0;
  const total = queue.length;
  const label = () => sp.icon + ' ' + fmt(done + failed) + ' / ' + fmt(total) + ' · ' + fmt(done) + ' çıkarıldı' + (failed ? ', ' + fmt(failed) + ' başarısız' : '');
  setStatus(label(), 0);

  for (let i = 0; i < queue.length; i++) {
    if (S.stop) break;
    const u = queue[i];
    if (S.whitelist[u.id] || !S.selected.has(u.id)) continue;
    setStatus(label() + ' · @' + u.username, ((done + failed) / total) * 100);
    const r = await API.unfollow(u.id);
    if (r.ok) {
      done++; sessionDone++; limitHits = 0;
      S.selected.delete(u.id);
      S.users = S.users.filter((x) => x.id !== u.id);
      S.followingCount = Math.max(0, S.followingCount - 1);
      S.history.unshift({ id: u.id, username: u.username, full_name: u.full_name, pic: u.pic, t: Date.now() });
      if (S.history.length > 1000) S.history.length = 1000;
    } else if (r.limited) {
      limitHits++;
      if (limitHits > 2) { setStatus('⛔ Instagram limit uyguladı. Birkaç saat ara verip tekrar dene. ' + label(), ((done + failed) / total) * 100); S.stop = true; break; }
      const goOn = await waitCountdown(300 * limitHits, '⏳ Instagram limit uyguladı, otomatik bekleniyor');
      if (!goOn) break;
      i--;
      continue;
    } else if (r.auth) {
      setStatus('🔒 Oturum düştü. Instagram\'a tekrar giriş yap.', ((done + failed) / total) * 100);
      S.stop = true;
      break;
    } else {
      failed++;
      console.warn('[Unfollowers] @' + u.username + ' çıkarılamadı:', r.reason);
    }
    store.set('history', S.history);
    if (i % 10 === 0) saveCache();
    const top = UI.list.scrollTop;
    render();
    UI.list.scrollTop = top;
    setStatus(label(), ((done + failed) / total) * 100);
    if (i < queue.length - 1 && !S.stop) {
      if (sp.every && done > 0 && r.ok && done % sp.every === 0) {
        if (!(await waitCountdown(Math.round(sp.rest / 1000), '☕ Güvenlik molası'))) break;
      } else await sleep(rand(sp.min, sp.max));
    }
  }
  store.set('history', S.history);
  saveCache();
  const stopped = S.stop && done + failed < total;
  S.busy = null; S.stop = false;
  if (!/⛔|🔒/.test(UI.status.textContent)) setStatus((stopped ? '⏹️ Durduruldu · ' : '✅ Bitti · ') + fmt(done) + ' kişi takipten çıkarıldı' + (failed ? ', ' + fmt(failed) + ' başarısız' : '') + '.', stopped ? undefined : 100);
  render();
  if (root.classList.contains('ee-min')) toast('Unfollowers: ' + fmt(done) + ' kişi takipten çıkarıldı');
};

const download = (name, text, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  root.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};

const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    root.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
};

const currentRows = () => (S.tab === 'non' ? currentVisible : S.tab === 'wl' ? Object.values(S.whitelist) : S.history);

const actions = {
  minimize() { root.classList.add('ee-min'); },
  restore() { root.classList.remove('ee-min'); },
  full() { UI.panel.classList.toggle('ee-full'); UI.panel.style.left = UI.panel.style.top = ''; },
  async close() {
    if (S.busy === 'unfollow' && !(await modal({ icon: '⏹️', title: 'İşlem devam ediyor', html: 'Kapatırsan takipten çıkarma işlemi durdurulur.', ok: 'Durdur ve kapat', danger: true }))) return;
    S.stop = true;
    document.removeEventListener('keydown', onKey);
    root.remove(); style.remove();
  },
  main() {
    if (S.busy) { S.stop = true; setStatus('Durduruluyor…'); UI.main.disabled = true; return; }
    if (S.selected.size) runUnfollow(); else scan();
  },
  menu() { UI.drop.classList.toggle('open'); },
  more() { renderLimit += 500; render(); },
  'toggle-all'() {
    const allSel = currentVisible.every((u) => S.selected.has(u.id));
    currentVisible.forEach((u) => (allSel ? S.selected.delete(u.id) : S.selected.add(u.id)));
    render();
  },
  csv() {
    const rows = currentRows();
    if (!rows.length) return toast('Dışa aktarılacak kimse yok');
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['kullanici_adi', 'isim', 'onayli', 'gizli', 'profil'].join(',')].concat(rows.map((u) => [q(u.username), q(u.full_name), u.verified ? 1 : 0, u.private ? 1 : 0, q('https://www.instagram.com/' + u.username + '/')].join(',')));
    download('unfollowers-' + S.tab + '-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
    toast(fmt(rows.length) + ' satır indirildi');
  },
  async copy() {
    const rows = currentRows();
    if (!rows.length) return toast('Kopyalanacak kimse yok');
    toast((await copyText(rows.map((u) => '@' + u.username).join('\n'))) ? fmt(rows.length) + ' kullanıcı adı kopyalandı' : 'Kopyalanamadı');
  },
  'wl-export'() {
    const list = Object.values(S.whitelist);
    if (!list.length) return toast('Beyaz liste boş');
    download('unfollowers-beyaz-liste.json', JSON.stringify(list, null, 2), 'application/json');
  },
  'wl-import'() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const arr = JSON.parse(await inp.files[0].text());
        let n = 0;
        (Array.isArray(arr) ? arr : []).forEach((u) => { if (u && u.id && u.username) { S.whitelist[String(u.id)] = normUser(Object.assign({}, u, { profile_pic_url: u.pic })); n++; } });
        store.set('whitelist', S.whitelist);
        toast(fmt(n) + ' hesap beyaz listeye eklendi');
        render();
      } catch (e) { toast('Dosya okunamadı'); }
    };
    inp.click();
  },
  async 'clear-hist'() {
    if (!(await modal({ icon: '🗑️', title: 'Geçmiş silinsin mi?', html: 'Bu tarayıcıdaki takipten çıkarma geçmişi silinir. Instagram hesabın etkilenmez.', ok: 'Sil', danger: true }))) return;
    S.history = []; store.set('history', []); render();
  },
  async 'clear-cache'() {
    if (S.busy) return;
    S.users = []; S.scannedAt = 0; S.followingCount = 0; S.selected.clear();
    if (viewerId) store.del('cache_' + viewerId);
    setStatus('Kayıtlı tarama silindi.', 0);
    updateSub(); render();
  }
};

/* ---------- Olaylar ---------- */
root.addEventListener('click', (e) => {
  const tab = e.target.closest('.ee-tab');
  if (tab) { S.tab = tab.dataset.tab; renderLimit = 300; UI.list.scrollTop = 0; render(); return; }
  const chip = e.target.closest('[data-f]');
  if (chip) { const k = chip.dataset.f; S.filters[k] = !S.filters[k]; chip.classList.toggle('on', S.filters[k]); render(); return; }
  const sp = e.target.closest('[data-speed]');
  if (sp && !S.busy) { S.speed = sp.dataset.speed; store.set('speed', S.speed); renderFooter(); return; }
  if (!e.target.closest('.ee-menu')) UI.drop.classList.remove('open');
  const act = e.target.closest('[data-a]');
  if (act && act.tagName !== 'SELECT') {
    const name = act.dataset.a;
    if (name === 'wl') {
      e.stopPropagation();
      const id = act.closest('.ee-row').dataset.id;
      if (S.whitelist[id]) { delete S.whitelist[id]; toast('Beyaz listeden çıkarıldı'); }
      else { const u = S.users.find((x) => x.id === id); if (u) { S.whitelist[id] = { id: u.id, username: u.username, full_name: u.full_name, pic: u.pic, verified: u.verified, private: u.private }; S.selected.delete(id); toast('⭐ @' + u.username + ' beyaz listeye eklendi'); } }
      store.set('whitelist', S.whitelist);
      render();
      return;
    }
    if (act.closest('.ee-drop')) UI.drop.classList.remove('open');
    if (actions[name]) { actions[name](); return; }
  }
  if (e.target.closest('a')) return;
  const row = e.target.closest('.ee-row:not(.ee-nosel)');
  if (row && S.busy !== 'unfollow') {
    const id = row.dataset.id, idx = +row.dataset.i;
    const willSelect = !S.selected.has(id);
    if (e.shiftKey && S.lastIndex >= 0) {
      const [a, b] = [Math.min(S.lastIndex, idx), Math.max(S.lastIndex, idx)];
      currentVisible.slice(a, b + 1).forEach((u) => (willSelect ? S.selected.add(u.id) : S.selected.delete(u.id)));
    } else if (willSelect) S.selected.add(id); else S.selected.delete(id);
    S.lastIndex = idx;
    const top = UI.list.scrollTop;
    render();
    UI.list.scrollTop = top;
  }
});

UI.list.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  const d = document.createElement('div');
  d.className = 'ee-av';
  d.style.background = 'hsl(' + img.dataset.hue + ' 45% 32%)';
  d.textContent = img.dataset.init;
  img.replaceWith(d);
}, true);

let searchT;
UI.search.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { S.query = UI.search.value; renderLimit = 300; S.lastIndex = -1; render(); }, 120); });
UI.sort.addEventListener('change', () => { S.sort = UI.sort.value; S.lastIndex = -1; render(); });

const onKey = (e) => {
  if (e.key === 'Escape' && !root.querySelector('.ee-modal')) {
    if (UI.drop.classList.contains('open')) UI.drop.classList.remove('open');
    else if (!root.classList.contains('ee-min')) actions.minimize();
  }
};
document.addEventListener('keydown', onKey);

/* Sürükle-taşı (başlıktan) */
(() => {
  let drag = null;
  UI.head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || UI.panel.classList.contains('ee-full') || window.innerWidth <= 640) return;
    const r = UI.panel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    UI.head.setPointerCapture(e.pointerId);
    UI.head.style.cursor = 'grabbing';
  });
  UI.head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    UI.panel.style.left = Math.max(80, Math.min(window.innerWidth - 80, drag.cx + e.clientX - drag.x)) + 'px';
    UI.panel.style.top = Math.max(40, Math.min(window.innerHeight - 40, drag.cy + e.clientY - drag.y)) + 'px';
  });
  const end = () => { drag = null; UI.head.style.cursor = ''; };
  UI.head.addEventListener('pointerup', end);
  UI.head.addEventListener('pointercancel', end);
  UI.head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) actions.full(); });
})();

window.addEventListener('beforeunload', (e) => { if (S.busy === 'unfollow') { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Başlat ---------- */
updateSub();
render();
if (S.scannedAt) setStatus('Kayıtlı tarama yüklendi (' + ago(S.scannedAt) + '). Güncel sonuç için yeniden tara.', 100);
})();
