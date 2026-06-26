/* ============================================================
   DUXEDO — script.js
   Auth: Supabase (email/password + Google OAuth)
   All other logic (payments, orders, reviews, admin, sheets,
   PDF generation) unchanged — still uses localStorage.
   ============================================================ */
'use strict';

/* ── Tiny helpers ── */
const $ = id => document.getElementById(id);
const currentPage = () => (location.pathname.split('/').pop() || 'index.html');

const ADMIN_PW = 'SHIVAM2DUX6EDO';

/* ============================================================
   SUPABASE CLIENT
   ============================================================ */
const SUPABASE_URL = 'https://bfqvlmqlhrotxtmnmsfo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1Wd1Albhz3k7Qiso9QpDTQ_Zd1TQBHP';

let _sbClient = null;
async function getSupabase() {
  if (_sbClient) return _sbClient;
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sbClient;
}

/* ============================================================
   AUTH STATE — Supabase wrapper
   ============================================================ */
const DxAuth = {
  async getUser() {
    try {
      const sb = await getSupabase();
      const { data: { user } } = await sb.auth.getUser();
      return user || null;
    } catch { return null; }
  },

  displayName(user) {
    if (!user) return '';
    return user.user_metadata?.full_name
      || user.user_metadata?.name
      || user.email?.split('@')[0]
      || 'Student';
  },

  initials(user) {
    const name = this.displayName(user);
    return name.trim().split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
  },

  async signUpEmail(email, password, fullName) {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } },
    });
    return { ok: !error, user: data?.user, msg: error?.message || '' };
  },

  async signInEmail(email, password) {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    return { ok: !error, user: data?.user, msg: error?.message || '' };
  },

  async signInGoogle() {
    const sb = await getSupabase();
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/index.html',
        queryParams: { prompt: 'select_account' },
      },
    });
    return { ok: !error, msg: error?.message || '' };
  },

  async resetPassword(email) {
    const sb = await getSupabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/index.html?resetPw=1',
    });
    return { ok: !error, msg: error?.message || '' };
  },

  async updatePassword(newPassword) {
    const sb = await getSupabase();
    const { error } = await sb.auth.updateUser({ password: newPassword });
    return { ok: !error, msg: error?.message || '' };
  },

  async signOut() {
    const sb = await getSupabase();
    await sb.auth.signOut();
  },

  async onAuthChange(callback) {
    const sb = await getSupabase();
    sb.auth.onAuthStateChange((_event, session) => callback(session?.user || null));
  },
};

/* ============================================================
   DxDB — Supabase database layer
   Saves payments and sheet orders to Supabase.
   Falls back silently to localStorage if Supabase is unavailable.

   Required tables in your Supabase project:

   ── TABLE: payments ──────────────────────────────────────────
   order_id        text  PRIMARY KEY
   user_id         uuid  (nullable — references auth.users.id)
   user_email      text
   user_name       text
   sheet_id        int
   sheet_title     text
   amount          int   DEFAULT 10
   payment_method  text
   utr             text
   status          text  DEFAULT 'Verified'
   created_at      timestamptz DEFAULT now()

   ── TABLE: sheet_orders ──────────────────────────────────────
   order_id        text  PRIMARY KEY (references payments.order_id)
   user_id         uuid  (nullable)
   user_email      text
   user_name       text
   sheet_title     text
   subject_title   text
   student_name    text
   class_branch    text
   roll_number     text
   sheet_number    text
   academic_year   text
   start_date      date  (nullable)
   submit_date     date  (nullable)
   utr             text
   created_at      timestamptz DEFAULT now()

   Set Row Level Security (RLS) policies:
   • payments:     INSERT for anon + authenticated; SELECT for authenticated only
   • sheet_orders: INSERT for anon + authenticated; SELECT for authenticated only
   ============================================================ */
const DxDB = {

  /* ── Save payment record to Supabase ── */
  async savePayment(rec) {
    try {
      const sb = await getSupabase();
      const user = await DxAuth.getUser();
      const { error } = await sb.from('payments').insert({
        order_id:       rec.orderId,
        user_id:        user?.id       || null,
        user_email:     rec.userIdentifier || user?.email || '',
        user_name:      rec.userName   || '',
        sheet_id:       rec.sheetId    || null,
        sheet_title:    rec.sheetTitle || '',
        amount:         rec.amount     || 10,
        payment_method: rec.method     || '',
        utr:            rec.utr        || '',
        status:         rec.status     || 'Verified',
      });
      if (error) console.warn('[DxDB] Payment save error:', error.message);
      return !error;
    } catch (err) {
      console.warn('[DxDB] savePayment failed:', err.message);
      return false;
    }
  },

  /* ── Save sheet order details to Supabase ── */
  async saveSheetOrder(rec) {
    try {
      const sb = await getSupabase();
      const user = await DxAuth.getUser();
      const { error } = await sb.from('sheet_orders').insert({
        order_id:      rec.orderId,
        user_id:       user?.id        || null,
        user_email:    rec.userIdentifier || user?.email || '',
        user_name:     rec.userName    || '',
        sheet_title:   rec.sheetTitle  || '',
        subject_title: rec.title       || '',    // Sheet Title / Subject field
        student_name:  rec.name        || '',    // Full Name
        class_branch:  rec.sClass      || '',    // Class / Branch
        roll_number:   rec.roll        || '',    // Roll Number / PRN
        sheet_number:  rec.sheetNo     || '',    // Sheet Number
        academic_year: rec.year        || '',    // Academic Year
        start_date:    rec.startDate   || null,  // Starting Date
        submit_date:   rec.submitDate  || null,  // Submission Date
        utr:           rec.utr         || '',    // UTR from payment
      });
      if (error) console.warn('[DxDB] Sheet order save error:', error.message);
      return !error;
    } catch (err) {
      console.warn('[DxDB] saveSheetOrder failed:', err.message);
      return false;
    }
  },
};

/* ============================================================
   STORE — localStorage (payments, orders, reviews only)
   Users are now managed by Supabase.
   ============================================================ */
const Store = {
  getPayments()   { try { return JSON.parse(localStorage.getItem('dx_payments') || '[]'); } catch { return []; } },
  addPayment(rec) { const p = this.getPayments(); p.unshift(rec); localStorage.setItem('dx_payments', JSON.stringify(p)); },

  getOrders()   { try { return JSON.parse(localStorage.getItem('dx_orders') || '[]'); } catch { return []; } },
  addOrder(rec) { const o = this.getOrders(); o.unshift(rec); localStorage.setItem('dx_orders', JSON.stringify(o)); },

  SEEDS: [
    { id:'s1', name:'Arjun Mehta',    role:'3rd Year, SVNIT',    rating:5, text:'"I used to waste 20 minutes formatting my sheet before every practical. Duxedo does it in 10 seconds. Life-changing for ₹10."', color:'#6c63ff', featured:true,  date:'2026-03-15' },
    { id:'s2', name:'Priya Sharma',   role:'2nd Year, NIT Surat', rating:5, text:'"The PDF quality is fantastic — looks like it came straight from AutoCAD. My lab teacher complimented the formatting."',        color:'#22c55e', featured:false, date:'2026-03-20' },
    { id:'s3', name:'Rahul Kulkarni', role:'Final Year, VJTI',    rating:5, text:'"My whole semester group uses Duxedo now. Costs basically nothing. Highly recommend for any engineering student."',             color:'#f59e0b', featured:false, date:'2026-03-28' },
  ],
  getUserReviews() { try { return JSON.parse(localStorage.getItem('dx_reviews') || '[]'); } catch { return []; } },
  addReview(rec)   { const r = this.getUserReviews(); r.unshift(rec); localStorage.setItem('dx_reviews', JSON.stringify(r)); },
  allReviews()     { return [...this.SEEDS, ...this.getUserReviews()]; },
  deleteReview(id) { const r = this.getUserReviews().filter(x => x.id !== id); localStorage.setItem('dx_reviews', JSON.stringify(r)); },

  /* Legacy stub — Supabase manages users now */
  getUsers() { try { return JSON.parse(localStorage.getItem('dx_legacy_users') || '[]'); } catch { return []; } },
};

/* ============================================================
   SHEET CATALOGUE — all 30 sheets
   ============================================================ */
const SHEETS = [
  { id:1,  title:'Basic AutoCAD Commands — Sheet 1',            subject:'CAD Lab',              color:'#6c63ff', cat:'cad real',      img:'SHEET-1.png',  full:'SHEET-1.png'  },
  { id:2,  title:'2D Object Drawings — Sheet 2',                subject:'Engineering Drawing',  color:'#22c55e', cat:'drawing real',  img:'SHEET-2.png',  full:'SHEET-2.png'  },
  { id:3,  title:'Projection of Points & Lines — Sheet 3',      subject:'Engineering Graphics', color:'#f59e0b', cat:'graphics real', img:'SHEET-3.png',  full:'SHEET-3.png'  },
  { id:4,  title:'Projection of Lines — Sheet 4',               subject:'Engineering Graphics', color:'#ec4899', cat:'graphics real', img:'SHEET-4.png',  full:'SHEET-4.png'  },
  { id:5,  title:'Isometric Projections — Sheet 5',             subject:'Engineering Graphics', color:'#a78bfa', cat:'isometric real',img:'SHEET-5.png',  full:'SHEET-5.png'  },
  { id:6,  title:'Orthographic Projections — Sheet 6',          subject:'Machine Drawing',      color:'#6c63ff', cat:'machine real',  img:'SHEET-6.png',  full:'SHEET-6.png'  },
  { id:7,  title:'House Plan — Sheet 7',                        subject:'CAD Lab',              color:'#22c55e', cat:'cad real',      img:'SHEET-7.png',  full:'SHEET-7.png'  },
  { id:8,  title:'Projection of Plane — Sheet 8',               subject:'Engineering Graphics', color:'#f59e0b', cat:'graphics real', img:'SHEET-8.png',  full:'SHEET-8.png'  },
  { id:9,  title:'Projections of Solids — Sheet 9',             subject:'Engineering Graphics', color:'#ec4899', cat:'graphics real', img:'SHEET-9.png',  full:'SHEET-9.png'  },
  { id:10, title:'Orthographic Projections (SE 2) — Sheet 10',  subject:'Machine Drawing',      color:'#a78bfa', cat:'machine real',  img:'SHEET-10.png', full:'SHEET-10.png' },
  { id:11, title:'Section of Solids — Sheet 11',                subject:'Engineering Graphics', color:'#6c63ff', cat:'graphics',      img:null },
  { id:12, title:'Development of Surfaces — Sheet 12',          subject:'Engineering Graphics', color:'#22c55e', cat:'graphics',      img:null },
  { id:13, title:'Isometric Projections (SE 2) — Sheet 13',     subject:'Engineering Graphics', color:'#f59e0b', cat:'isometric',     img:null },
  { id:14, title:'Screw Thread Conventions — Sheet 14',         subject:'Machine Drawing',      color:'#ec4899', cat:'machine',       img:null },
  { id:15, title:'Rivet Joint Details — Sheet 15',              subject:'Machine Drawing',      color:'#a78bfa', cat:'machine',       img:null },
  { id:16, title:'Welded Joint Symbols — Sheet 16',             subject:'Machine Drawing',      color:'#6c63ff', cat:'machine',       img:null },
  { id:17, title:'Rolling Contact Bearing — Sheet 17',          subject:'Machine Drawing',      color:'#22c55e', cat:'machine',       img:null },
  { id:18, title:'Key & Keyway — Sheet 18',                     subject:'Machine Drawing',      color:'#f59e0b', cat:'machine',       img:null },
  { id:19, title:'Coupling Assembly — Sheet 19',                subject:'Machine Drawing',      color:'#ec4899', cat:'machine',       img:null },
  { id:20, title:'Dimensioning Practice — Sheet 20',            subject:'Engineering Drawing',  color:'#a78bfa', cat:'drawing',       img:null },
  { id:21, title:'Geometric Tolerancing — Sheet 21',            subject:'Engineering Drawing',  color:'#6c63ff', cat:'drawing',       img:null },
  { id:22, title:'Intersection of Solids — Sheet 22',           subject:'Engineering Graphics', color:'#22c55e', cat:'graphics',      img:null },
  { id:23, title:'Computer-Aided Drawing — Sheet 23',           subject:'CAD Lab',              color:'#f59e0b', cat:'cad',           img:null },
  { id:24, title:'Conic Sections — Sheet 24',                   subject:'Engineering Drawing',  color:'#ec4899', cat:'drawing',       img:null },
  { id:25, title:'Special Curves — Sheet 25',                   subject:'Engineering Drawing',  color:'#a78bfa', cat:'drawing',       img:null },
  { id:26, title:'Valve Body Section — Sheet 26',               subject:'Machine Drawing',      color:'#6c63ff', cat:'machine',       img:null },
  { id:27, title:'Assembly Drawing — Sheet 27',                 subject:'Machine Drawing',      color:'#22c55e', cat:'machine',       img:null },
  { id:28, title:'3D Modelling Basics — Sheet 28',              subject:'CAD Lab',              color:'#f59e0b', cat:'cad',           img:null },
  { id:29, title:'Isometric Projections (TE Paper) — Sheet 29', subject:'Engineering Graphics', color:'#ec4899', cat:'isometric',     img:null },
  { id:30, title:'Detailed Part Drawing — Sheet 30',            subject:'Machine Drawing',      color:'#a78bfa', cat:'machine',       img:null },
];

function buildSheetSVG(sheet, large = false) {
  const w = large ? 580 : 220, h = large ? 380 : 200, c = sheet.color;
  const shapes = [
    `<line x1="${w*.5}" y1="${h*.08}" x2="${w*.18}" y2="${h*.88}" stroke="${c}" stroke-width="1.2"/><line x1="${w*.5}" y1="${h*.08}" x2="${w*.82}" y2="${h*.88}" stroke="${c}" stroke-width="1.2"/><ellipse cx="${w*.5}" cy="${h*.9}" rx="${w*.32}" ry="${h*.07}" stroke="${c}" stroke-width="1.2" stroke-dasharray="4 3" fill="none"/>`,
    `${[...Array(7)].map((_,i)=>`<line x1="${w*.2}" y1="${h*(.18+i*.1)}" x2="${w*.8}" y2="${h*(.18+i*.1)}" stroke="${c}" stroke-width="${i%2?'.6':'1.3'}"/>`).join('')}<rect x="${w*.2}" y="${h*.18}" width="${w*.6}" height="${h*.62}" stroke="${c}" stroke-width="1.2" fill="none"/>`,
    `<rect x="${w*.15}" y="${h*.2}" width="${w*.7}" height="${h*.55}" stroke="${c}" stroke-width="1.2" fill="none"/><line x1="${w*.15}" y1="${h*.2}" x2="${w*.05}" y2="${h*.2}" stroke="#aaa" stroke-width=".8"/><line x1="${w*.85}" y1="${h*.2}" x2="${w*.95}" y2="${h*.2}" stroke="#aaa" stroke-width=".8"/>`,
    `<circle cx="${w*.5}" cy="${h*.5}" r="${Math.min(w,h)*.3}" stroke="${c}" stroke-width="1.2" stroke-dasharray="5 3" fill="${c}0d"/><rect x="${w*.35}" y="${h*.15}" width="${w*.3}" height="${h*.7}" stroke="${c}" stroke-width="1.2" fill="none"/>`,
    `<path d="M${w*.12},${h*.78} C${w*.22},${h*.25} ${w*.38},${h*.62} ${w*.5},${h*.42} S${w*.72},${h*.18} ${w*.88},${h*.38}" stroke="${c}" stroke-width="1.5" fill="none"/>`,
  ];
  const idx = Math.max(0, (sheet.id - 11)) % shapes.length;
  const grid = `<line x1="0" y1="${h*.25}" x2="${w}" y2="${h*.25}" stroke="${c}" stroke-width=".4" opacity=".18"/><line x1="0" y1="${h*.5}" x2="${w}" y2="${h*.5}" stroke="${c}" stroke-width=".4" opacity=".18"/><line x1="${w*.25}" y1="0" x2="${w*.25}" y2="${h}" stroke="${c}" stroke-width=".4" opacity=".18"/><line x1="${w*.5}" y1="0" x2="${w*.5}" y2="${h}" stroke="${c}" stroke-width=".4" opacity=".18"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${grid}${shapes[idx]}</svg>`;
}

/* ============================================================
   GLOBAL BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  /* Ripple keyframe */
  const rs = document.createElement('style');
  rs.textContent = '@keyframes ripple-anim{to{transform:scale(1);opacity:0}}';
  document.head.appendChild(rs);

  /* Navbar scroll glass */
  const navbar = $('navbar');
  if (navbar && !navbar.classList.contains('scrolled')) {
    const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* Mobile menu */
  const hamburger  = $('hamburger');
  const navLinks   = $('navLinks');
  const navOverlay = $('navOverlay');

  function closeNav() {
    navLinks  ?.classList.remove('open');
    hamburger ?.classList.remove('open');
    navOverlay?.classList.remove('active');
    hamburger ?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open', open);
      navOverlay?.classList.toggle('active', open);
      hamburger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    navLinks.querySelectorAll('.nav-link, .btn-nav').forEach(el => {
      el.addEventListener('click', closeNav);
    });
    navOverlay?.addEventListener('click', closeNav);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
  }

  /* Ripple */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.ripple');
    if (!btn) return;
    const old = btn.querySelector('.ripple-circle'); if (old) old.remove();
    const rect = btn.getBoundingClientRect(), size = Math.max(rect.width, rect.height) * 1.5;
    const c = document.createElement('span');
    c.className = 'ripple-circle';
    Object.assign(c.style, { width:`${size}px`, height:`${size}px`, left:`${e.clientX-rect.left-size/2}px`, top:`${e.clientY-rect.top-size/2}px`, position:'absolute', borderRadius:'50%', background:'rgba(255,255,255,.22)', transform:'scale(0)', animation:'ripple-anim .55s ease forwards', pointerEvents:'none' });
    btn.appendChild(c); setTimeout(() => c.remove(), 600);
  });

  /* Password toggles */
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => { const inp = $(btn.dataset.target); if (inp) inp.type = inp.type === 'password' ? 'text' : 'password'; });
  });

  /* Sync nav */
  await syncNavAuthBtn();

  /* React to auth state changes (Google OAuth redirect, etc.) */
  DxAuth.onAuthChange(async user => {
    await syncNavAuthBtn();
    const overlay = $('authOverlay');
    if (overlay && !overlay.classList.contains('hidden')) await showCorrectAuthView();
    /* Auto-close modal after Google sign-in redirect */
    if (user) closeModal();
  });

  /* Route */
  const pg = currentPage();
  if (pg === 'index.html' || pg === '') initHome();
  if (pg === 'features.html')           initFeaturesPage();
  if (pg === 'pricing.html')            initPricingPage();
  if (pg === 'sheets.html')             initSheets();
  if (pg === 'payment.html')            initPayment();
  if (pg === 'reviews.html')            initReviews();
  if (pg === 'admin.html')              initAdmin();
});

/* ============================================================
   NAV AUTH BUTTON
   ============================================================ */
async function syncNavAuthBtn() {
  const btn = $('openAuthBtn');
  if (!btn) return;
  const user = await DxAuth.getUser();
  btn.textContent = user ? DxAuth.displayName(user).split(' ')[0] : 'Sign In';
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', () => {
    const pg = currentPage();
    if (pg === 'index.html' || pg === '') openModal();
    else window.location.href = 'index.html?showAuth=1';
  });
}

/* ============================================================
   AUTH MODAL — open / close / view
   ============================================================ */
function openModal() {
  const overlay = $('authOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  showCorrectAuthView();
}

function closeModal() {
  const overlay = $('authOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
  sessionStorage.setItem('dx_dismissed', '1');
}

async function showCorrectAuthView() {
  const user = await DxAuth.getUser();
  ['loginForm','signupForm','forgotForm','resetPwForm','loggedInView'].forEach(id => { const el=$(id); if(el) el.classList.add('hidden'); });
  const tabs = $('authTabBar');

  if (user) {
    $('loggedInView')?.classList.remove('hidden');
    if (tabs) tabs.style.display = 'none';
    if ($('authAvatar'))   $('authAvatar').textContent   = DxAuth.initials(user);
    if ($('authUsername')) $('authUsername').textContent = DxAuth.displayName(user);
    if ($('authUserId'))   $('authUserId').textContent   = user.email || '';
  } else {
    $('loginForm')?.classList.remove('hidden');
    if (tabs) tabs.style.display = '';
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'login'));
  }
}

/* ============================================================
   FEATURES PAGE INIT
   ============================================================ */
function initFeaturesPage() {
  syncNavAuthBtn();
  const items = document.querySelectorAll('.feature-card, .step-card');
  items.forEach((el, i) => { el.style.opacity='0'; el.style.transform='translateY(28px)'; el.style.transition=`opacity .55s ease ${i*80}ms, transform .55s ease ${i*80}ms`; });
  const obs = new IntersectionObserver(entries => { entries.forEach(e => { if(e.isIntersecting){e.target.style.opacity='1';e.target.style.transform='translateY(0)';obs.unobserve(e.target);} }); }, { threshold:.1 });
  items.forEach(el => obs.observe(el));
}

/* ============================================================
   PRICING PAGE INIT
   ============================================================ */
function initPricingPage() {
  syncNavAuthBtn();
  const items = document.querySelectorAll('.pricing-card, .pricing-side, .compare-table-wrap, .pricing-faq');
  items.forEach((el, i) => { el.style.opacity='0'; el.style.transform='translateY(24px)'; el.style.transition=`opacity .55s ease ${i*100}ms, transform .55s ease ${i*100}ms`; });
  const obs = new IntersectionObserver(entries => { entries.forEach(e => { if(e.isIntersecting){e.target.style.opacity='1';e.target.style.transform='translateY(0)';obs.unobserve(e.target);} }); }, { threshold:.08 });
  items.forEach(el => obs.observe(el));
}

/* ============================================================
   HOME PAGE INIT
   ============================================================ */
function initHome() {
  setupAuthModal();

  /* Handle Supabase password-reset redirect (?resetPw=1) */
  const params = new URLSearchParams(location.search);
  if (params.get('resetPw') === '1') {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => {
      openModal();
      ['loginForm','signupForm','forgotForm','loggedInView'].forEach(id => { const el=$(id); if(el) el.classList.add('hidden'); });
      $('authTabBar') && ($('authTabBar').style.display = 'none');
      $('resetPwForm')?.classList.remove('hidden');
    }, 300);
  }

  const wantsAuth = params.get('showAuth') === '1';
  const dismissed = sessionStorage.getItem('dx_dismissed') === '1';
  if (wantsAuth) history.replaceState(null, '', location.pathname);

  DxAuth.getUser().then(user => {
    if (wantsAuth || (!user && !dismissed)) setTimeout(openModal, 200);
  });

  /* Smooth scroll */
  const navbar = $('navbar');
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href'); if (href === '#') return;
      const target = document.querySelector(href); if (!target) return;
      e.preventDefault();
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - (navbar?.offsetHeight || 68) - 12, behavior: 'smooth' });
    });
  });

  /* Scroll-reveal */
  const items = document.querySelectorAll('.feature-card, .step-card, .pricing-card, .pricing-side');
  items.forEach((el, i) => { el.style.opacity='0'; el.style.transform='translateY(28px)'; el.style.transition=`opacity .55s ease ${el.dataset.delay||i*80}ms, transform .55s ease ${el.dataset.delay||i*80}ms`; });
  const revObs = new IntersectionObserver(entries => { entries.forEach(e => { if(e.isIntersecting){e.target.style.opacity='1';e.target.style.transform='translateY(0)';revObs.unobserve(e.target);} }); }, { threshold:.12, rootMargin:'0px 0px -40px 0px' });
  items.forEach(el => revObs.observe(el));

  /* Hero stagger */
  const heroEls = ['.hero-badge','.hero-title','.hero-sub','.hero-actions','.hero-stats'].map(s => document.querySelector(s));
  const heroVisual = document.querySelector('.hero-visual');
  heroEls.forEach(el => { if(!el)return; el.style.opacity='0'; el.style.transform='translateY(20px)'; el.style.transition='opacity .6s ease, transform .6s ease'; });
  if (heroVisual) { heroVisual.style.opacity='0'; heroVisual.style.transform='scale(.94) translateY(16px)'; heroVisual.style.transition='opacity .7s ease .3s, transform .7s ease .3s'; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    heroEls.forEach((el,i) => { if(!el)return; setTimeout(()=>{el.style.opacity='1';el.style.transform='translateY(0)';},100+i*120); });
    if (heroVisual) setTimeout(()=>{heroVisual.style.opacity='1';heroVisual.style.transform='scale(1) translateY(0)';},400);
  }));

  /* Stat counters */
  const cObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el=e.target,raw=el.textContent.trim(),pre=raw.match(/^[₹]/)?.[0]||'',num=raw.match(/[\d.]+/)?.[0]||'0',suf=raw.match(/[k+]+$/)?.[0]||'';
      const end=suf.includes('k')?parseFloat(num)*1000:parseFloat(num);
      let s=0,cur=0;
      const t=setInterval(()=>{s++;cur=Math.min(cur+end/50,end);const d=suf.includes('k')?`${(cur/1000).toFixed(cur<end?1:0)}k`:Math.round(cur);el.textContent=`${pre}${d}${suf.replace('k','').trim()}`;if(s>=50){el.textContent=raw;clearInterval(t);}},1400/50);
      cObs.unobserve(el);
    });
  }, { threshold:.8 });
  document.querySelectorAll('.stat-num').forEach(el => cObs.observe(el));

  /* Typing effect */
  const tObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      document.querySelectorAll('.field-value').forEach((el,i) => { const orig=el.textContent;el.textContent='';let idx=0;setTimeout(()=>{const iv=setInterval(()=>{el.textContent+=orig[idx++];if(idx>=orig.length)clearInterval(iv);},45);},i*300); });
      tObs.unobserve(e.target);
    });
  }, { threshold:.5 });
  const mk = document.querySelector('.sheet-mockup'); if (mk) tObs.observe(mk);

  /* Active nav */
  window.addEventListener('scroll', () => {
    const sy = window.scrollY+100;
    document.querySelectorAll('section[id]').forEach(s => {
      if (sy>=s.offsetTop && sy<s.offsetTop+s.offsetHeight)
        document.querySelectorAll('.nav-link').forEach(a => { a.style.color=a.getAttribute('href')==='#'+s.id?'var(--text)':''; });
    });
  }, { passive:true });

  /* Home testimonials */
  const homeGrid = $('homeTestimonials');
  if (homeGrid) {
    homeGrid.innerHTML='';
    Store.SEEDS.slice(0,3).forEach(r => {
      const stars='★'.repeat(r.rating)+'☆'.repeat(5-r.rating), init=r.name.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
      const card=document.createElement('div');
      card.className='testi-card'+(r.featured?' testi-featured':'');
      card.innerHTML=`<div class="testi-stars">${stars}</div><p class="testi-text">${r.text}</p><div class="testi-author"><div class="testi-avatar" style="--av-color:${r.color||'#6c63ff'}">${init}</div><div><div class="testi-name">${r.name}</div><div class="testi-role">${r.role}</div></div></div>`;
      homeGrid.appendChild(card);
    });
  }
}

/* ============================================================
   AUTH MODAL — full setup (Supabase)
   ============================================================ */
function setupAuthModal() {
  const overlay = $('authOverlay');
  if (!overlay) return;

  /* Tab switching */
  function switchTab(name) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab===name));
    $('loginForm')?.classList.toggle('hidden', name!=='login');
    $('signupForm')?.classList.toggle('hidden', name!=='signup');
    $('forgotForm')?.classList.add('hidden');
    $('resetPwForm')?.classList.add('hidden');
    $('authTabBar') && ($('authTabBar').style.display='');
    ['loginError','signupError','forgotError','forgotSuccess'].forEach(id => { const el=$(id); if(el){el.textContent='';el.style.color='';} });
  }
  document.querySelectorAll('.auth-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('.auth-switch-link').forEach(l => l.addEventListener('click', () => switchTab(l.dataset.tab)));

  $('authClose')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target===overlay) closeModal(); });

  /* Password toggles inside modal */
  overlay.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => { const inp=$(btn.dataset.target); if(inp) inp.type=inp.type==='password'?'text':'password'; });
  });

  /* ── Google Sign-In (both forms) ── */
  overlay.querySelectorAll('.btn-google').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<span style="margin-right:8px;">⏳</span> Redirecting to Google…';
      const res = await DxAuth.signInGoogle();
      if (!res.ok) {
        btn.disabled = false;
        btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width:18px;height:18px;margin-right:8px;vertical-align:middle;"/>Continue with Google';
        const errEl = btn.closest('#loginForm') ? $('loginError') : $('signupError');
        if (errEl) errEl.textContent = res.msg || 'Google sign-in failed. Please try again.';
      }
      /* On success, Supabase redirects — no further JS needed */
    });
  });

  /* ── Forgot password trigger ── */
  $('forgotTrigger')?.addEventListener('click', () => {
    $('loginForm')?.classList.add('hidden');
    $('authTabBar') && ($('authTabBar').style.display='none');
    $('forgotForm')?.classList.remove('hidden');
    const err=$('forgotError'),suc=$('forgotSuccess');
    if(err){err.textContent='';err.style.color='';}
    if(suc){suc.textContent='';suc.style.color='';}
    if($('forgotId'))$('forgotId').value='';
  });

  $('forgotBackBtn')?.addEventListener('click', () => switchTab('login'));

  /* ── FORGOT FORM — Supabase sends email reset link ── */
  $('forgotForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = ($('forgotId')?.value||'').trim();
    const err=$('forgotError'), suc=$('forgotSuccess');
    if(err){err.textContent='';err.style.color='';}
    if(suc){suc.textContent='';suc.style.color='';}
    if (!email||!email.includes('@')) { if(err)err.textContent='Enter a valid email address.'; return; }
    const btn=$('forgotSubmitBtn');
    if(btn){btn.disabled=true;btn.textContent='Sending…';}
    const res = await DxAuth.resetPassword(email);
    if(btn){btn.disabled=false;btn.textContent='Send Reset Link';}
    if (res.ok) {
      if(suc){suc.textContent='✓ Reset link sent! Check your inbox (and spam folder).';suc.style.color='var(--green)';}
      setTimeout(()=>switchTab('login'), 3500);
    } else {
      if(err) err.textContent = res.msg || 'Failed to send reset email. Try again.';
    }
  });

  /* ── RESET PASSWORD FORM — shown when user returns from email link ── */
  $('resetPwForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const pw=$('resetNewPw')?.value||'', pw2=$('resetNewPw2')?.value||'';
    const err=$('resetPwError'), suc=$('resetPwSuccess');
    if(err){err.textContent='';err.style.color='';}
    if(suc){suc.textContent='';suc.style.color='';}
    if (pw.length<6) { if(err)err.textContent='Password must be at least 6 characters.'; return; }
    if (pw!==pw2)    { if(err)err.textContent='Passwords do not match.'; return; }
    const btn=$('resetPwBtn');
    if(btn){btn.disabled=true;btn.textContent='Updating…';}
    const res = await DxAuth.updatePassword(pw);
    if(btn){btn.disabled=false;btn.textContent='Update Password';}
    if (res.ok) {
      if(suc){suc.textContent='✓ Password updated! Signing you in…';suc.style.color='var(--green)';}
      setTimeout(async () => { await showCorrectAuthView(); await syncNavAuthBtn(); closeModal(); }, 1600);
    } else {
      if(err) err.textContent = res.msg || 'Failed to update password. Link may have expired.';
    }
  });

  /* ── LOGIN FORM ── */
  $('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email=($('loginId')?.value||'').trim(), pw=($('loginPw')?.value||'');
    const err=$('loginError');
    if(err){err.textContent='';err.style.color='';}
    if (!email||!pw) { if(err)err.textContent='Please fill in both fields.'; return; }
    if (!email.includes('@')) { if(err)err.textContent='Please use your email address to sign in.'; return; }
    const btn=$('loginForm')?.querySelector('button[type="submit"]');
    if(btn){btn.disabled=true;btn.textContent='Signing in…';}
    const res = await DxAuth.signInEmail(email, pw);
    if(btn){btn.disabled=false;btn.textContent='Sign In';}
    if (!res.ok) { if(err)err.textContent=res.msg||'Incorrect email or password.'; return; }
    if(err)err.textContent='';
    await showCorrectAuthView();
    await syncNavAuthBtn();
    setTimeout(closeModal, 700);
  });

  /* ── SIGNUP FORM ── */
  $('signupForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name=($('signupName')?.value||'').trim(), email=($('signupId')?.value||'').trim();
    const pw=($('signupPw')?.value||''), pw2=($('signupPw2')?.value||'');
    const err=$('signupError');
    if(err){err.textContent='';err.style.color='';}
    if (!name||!email||!pw||!pw2) { if(err)err.textContent='Please fill in all fields.'; return; }
    if (pw.length<6) { if(err)err.textContent='Password must be at least 6 characters.'; return; }
    if (pw!==pw2)    { if(err)err.textContent='Passwords do not match.'; return; }
    if (!email.includes('@')) { if(err)err.textContent='Please use a valid email address.'; return; }
    const btn=$('signupForm')?.querySelector('button[type="submit"]');
    if(btn){btn.disabled=true;btn.textContent='Creating account…';}
    const res = await DxAuth.signUpEmail(email, pw, name);
    if(btn){btn.disabled=false;btn.textContent='Create Account';}
    if (!res.ok) { if(err)err.textContent=res.msg||'Sign-up failed. Please try again.'; return; }
    if(err)err.textContent='';
    const confirmed = res.user?.confirmed_at || res.user?.email_confirmed_at;
    if (confirmed) {
      /* Email confirmation disabled in Supabase — user is already logged in */
      await showCorrectAuthView();
      await syncNavAuthBtn();
      setTimeout(closeModal, 700);
    } else {
      /* Supabase sent a confirmation email */
      if(err){ err.style.color='var(--green)'; err.textContent='✓ Account created! Check your email to confirm, then sign in.'; }
    }
  });

  /* ── LOGOUT ── */
  $('logoutBtn')?.addEventListener('click', async () => {
    await DxAuth.signOut();
    sessionStorage.removeItem('dx_dismissed');
    await showCorrectAuthView();
    await syncNavAuthBtn();
    setTimeout(openModal, 300);
  });
}

/* ============================================================
   SHEETS PAGE
   ============================================================ */
function initSheets() {
  const filterBtns = document.querySelectorAll('.sheets-filter-btn');
  const grid = $('sheetsGrid');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      grid?.querySelectorAll('.sheet-card').forEach(card => {
        const cats = (card.dataset.cat||'').split(' ');
        card.style.display = (cat==='all'||cats.includes(cat)) ? '' : 'none';
      });
    });
  });

  /* Stagger entrance */
  requestAnimationFrame(() => {
    grid?.querySelectorAll('.sheet-card').forEach((c,i) => {
      c.style.opacity='0'; c.style.transform='translateY(22px)';
      c.style.transition=`opacity .4s ease ${i*28}ms, transform .4s ease ${i*28}ms`;
      setTimeout(()=>{c.style.opacity='1';c.style.transform='translateY(0)';},50+i*28);
    });
  });

  /* Guard preview modal (sheets.html has inline JS — avoid double-binding) */
  if (!window._sheetsModalInit) {
    window._sheetsModalInit = true;
    const overlay = $('previewOverlay');
    $('previewClose')?.addEventListener('click', () => { overlay?.classList.add('hidden'); document.body.style.overflow=''; });
    overlay?.addEventListener('click', e => { if(e.target===overlay){overlay.classList.add('hidden');document.body.style.overflow='';} });
    document.addEventListener('keydown', e => { if(e.key==='Escape'&&overlay&&!overlay.classList.contains('hidden')){overlay.classList.add('hidden');document.body.style.overflow='';} });
  }
}

/* ============================================================
   PAYMENT PAGE
   ============================================================ */
function initPayment() {
  const params  = new URLSearchParams(location.search);
  const sheetId = parseInt(params.get('sheet')||'1');
  const sheet   = SHEETS.find(s=>s.id===sheetId)||SHEETS[0];
  const nameEl  = $('paySheetName');
  if (nameEl) nameEl.textContent = sheet.title;

  const methods = document.querySelectorAll('.pay-method');
  const panels  = document.querySelectorAll('.pay-panel');
  methods.forEach(btn => {
    btn.addEventListener('click', () => {
      methods.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      panels.forEach(p=>p.classList.add('hidden')); $(`panel-${btn.dataset.method}`)?.classList.remove('hidden');
    });
  });

  $('cardNum')?.addEventListener('input', function(){let v=this.value.replace(/\D/g,'').slice(0,16);this.value=v.replace(/(.{4})/g,'$1 ').trim();});
  $('cardExp')?.addEventListener('input', function(){let v=this.value.replace(/\D/g,'').slice(0,4);if(v.length>=3)v=v.slice(0,2)+' / '+v.slice(2);this.value=v;});

  $('payNowBtn')?.addEventListener('click', async () => {
    const method = document.querySelector('.pay-method.active')?.dataset.method||'upi-qr';
    const err = $('payError'); if(err)err.textContent='';
    let utr='';
    if (method==='upi-qr')    { utr=($('utrInput')?.value||'').trim();  if(!utr||utr.length<8){if(err)err.textContent='Please enter your UTR / Transaction Reference Number (min 8 digits).';return;} }
    else if (method==='upi-id'){ const uid=($('upiIdInput')?.value||'').trim();utr=($('utrInput2')?.value||'').trim();if(!uid||!uid.includes('@')){if(err)err.textContent='Please enter a valid UPI ID.';return;}if(!utr||utr.length<8){if(err)err.textContent='Please enter your UTR number.';return;} }
    else if (method==='card')  { const cn=($('cardNum')?.value||'').replace(/\s/g,''),nm=($('cardName')?.value||'').trim(),exp=($('cardExp')?.value||'').trim(),cvv=($('cardCvv')?.value||'').trim();if(!nm){if(err)err.textContent='Enter cardholder name.';return;}if(cn.length!==16){if(err)err.textContent='Enter a valid 16-digit card number.';return;}if(!exp||exp.length<7){if(err)err.textContent='Enter a valid expiry.';return;}if(!cvv||cvv.length<3){if(err)err.textContent='Enter a valid CVV.';return;}utr='CARD-'+Date.now(); }
    else if (method==='netbanking'){ if(!$('bankSelect')?.value){if(err)err.textContent='Please select your bank.';return;}utr=($('utrNet')?.value||'').trim();if(!utr||utr.length<6){if(err)err.textContent='Please enter the transaction reference.';return;} }

    const payBtn=$('payNowBtn'); payBtn.textContent='⏳ Verifying…'; payBtn.disabled=true;
    setTimeout(async () => {
      const orderId='DX'+Date.now().toString().slice(-8).toUpperCase();
      const user=await DxAuth.getUser();
      const payRec = {
        orderId,
        sheetId:        sheet.id,
        sheetTitle:     sheet.title,
        amount:         10,
        method,
        utr,
        userName:       user ? DxAuth.displayName(user) : 'Guest',
        userIdentifier: user?.email || '',
        date:           new Date().toISOString(),
        status:         'Verified',
      };
      /* Save to localStorage (local admin panel) */
      Store.addPayment(payRec);
      /* Save to Supabase payments table */
      DxDB.savePayment(payRec);
      /* Store UTR so sheet-details form can attach it */
      sessionStorage.setItem('dx_pending_order', orderId);
      sessionStorage.setItem('dx_pending_sheet', sheet.title);
      sessionStorage.setItem('dx_pending_utr',   utr);
      payBtn.textContent='Confirm Payment — ₹10'; payBtn.disabled=false;
      $('sheetDetailsOverlay')?.classList.remove('hidden'); document.body.style.overflow='hidden';
    }, 1800);
  });

  $('sheetDetailsForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const vals = {
      title:      ($('sTitle')?.value      || '').trim(),  // Sheet Title / Subject
      name:       ($('sName')?.value       || '').trim(),  // Full Name
      sClass:     ($('sClass')?.value      || '').trim(),  // Class / Branch
      roll:       ($('sRoll')?.value       || '').trim(),  // Roll Number / PRN
      sheetNo:    ($('sSheetNo')?.value    || '').trim(),  // Sheet Number
      year:       ($('sYear')?.value       || '').trim(),  // Academic Year
      startDate:  ($('sStartDate')?.value  || '').trim(),  // Starting Date
      submitDate: ($('sSubmitDate')?.value || '').trim(),  // Submission Date
    };
    const err=$('sheetDetailsError');
    if(!vals.title||!vals.name||!vals.sClass||!vals.roll||!vals.sheetNo){
      if(err) err.textContent='Please fill all required fields.';
      return;
    }

    const orderId       = sessionStorage.getItem('dx_pending_order')  || ('DX'+Date.now().toString().slice(-8).toUpperCase());
    const pendingSheet  = sessionStorage.getItem('dx_pending_sheet')  || vals.title;
    const pendingUtr    = sessionStorage.getItem('dx_pending_utr')    || '';
    const user          = await DxAuth.getUser();

    const orderRec = {
      orderId,
      sheetTitle:     pendingSheet,
      utr:            pendingUtr,           // UTR / Reference Number
      ...vals,
      userName:       user ? DxAuth.displayName(user) : 'Guest',
      userIdentifier: user?.email || '',
      paidAt:         new Date().toISOString(),
    };

    /* Save to localStorage (local admin panel) */
    Store.addOrder(orderRec);

    /* Save to Supabase sheet_orders table — all 9 user-entered fields */
    const submitBtn = $('sheetDetailsForm')?.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled=true; submitBtn.textContent='Saving…'; }
    await DxDB.saveSheetOrder(orderRec);
    if (submitBtn) { submitBtn.disabled=false; submitBtn.textContent='Generate & Download Sheet'; }

    $('sheetDetailsOverlay')?.classList.add('hidden');
    if($('successSheet'))   $('successSheet').textContent   = pendingSheet;
    if($('successOrderId')) $('successOrderId').textContent = orderId;
    $('successOverlay')?.classList.remove('hidden');
    generateSheet(vals, orderId);
    sessionStorage.removeItem('dx_pending_order');
    sessionStorage.removeItem('dx_pending_sheet');
    sessionStorage.removeItem('dx_pending_utr');
  });
}

function generateSheet(d, orderId) {
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${d.title} — Duxedo</title><style>@page{size:A3 landscape;margin:15mm}body{font-family:Arial,sans-serif;background:#fff;color:#000;margin:0}.outer{border:2px solid #222;padding:16px;height:calc(100vh - 40px);display:flex;flex-direction:column}.top{border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}.brand{font-weight:900;font-size:1.4rem;letter-spacing:.1em}.grid-info{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #222}.cell{padding:8px 12px;border-right:1px solid #222}.cell:last-child{border-right:none}.lbl{font-size:.6rem;text-transform:uppercase;color:#666;display:block}.val{font-size:.9rem;font-weight:700;display:block}.area{flex:1;border:1px solid #ccc;margin-top:10px;background-image:linear-gradient(#eee 1px,transparent 1px),linear-gradient(90deg,#eee 1px,transparent 1px);background-size:10mm 10mm;position:relative}.frame{position:absolute;inset:5mm;border:1px solid #999}.foot{margin-top:8px;display:flex;justify-content:space-between;font-size:.7rem;color:#666}</style></head><body><div class="outer"><div class="top"><div class="brand">DUXEDO</div><div>${d.title}</div><div style="font-size:.75rem;color:#666">Order: ${orderId}</div></div><div class="grid-info"><div class="cell"><span class="lbl">Name</span><span class="val">${d.name}</span></div><div class="cell"><span class="lbl">Class</span><span class="val">${d.sClass}</span></div><div class="cell"><span class="lbl">Roll No.</span><span class="val">${d.roll}</span></div><div class="cell"><span class="lbl">Sheet No.</span><span class="val">${d.sheetNo}</span></div><div class="cell"><span class="lbl">Year</span><span class="val">${d.year||'—'}</span></div><div class="cell"><span class="lbl">Subject</span><span class="val">${d.title}</span></div><div class="cell"><span class="lbl">Start Date</span><span class="val">${d.startDate||'—'}</span></div><div class="cell"><span class="lbl">Submit Date</span><span class="val">${d.submitDate||'—'}</span></div></div><div class="area"><div class="frame"></div></div><div class="foot"><span>Duxedo — duxedo.in</span><span>Verified ✓</span><span>${new Date().toLocaleDateString('en-IN')}</span></div></div><script>window.onload=()=>window.print();<\/script></body></html>`;
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([html],{type:'text/html'})),download:`Duxedo_${orderId}.html`});
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

/* ============================================================
   REVIEWS PAGE
   ============================================================ */
function initReviews() {
  renderReviewsPage(0); updateReviewStats();
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderReviewsPage(parseInt(btn.dataset.rating)); });
  });
  let selRating=0;
  const stars=document.querySelectorAll('#starPickerPage .star-opt');
  stars.forEach(s => {
    s.addEventListener('mouseenter',()=>stars.forEach((x,i)=>x.classList.toggle('active',i<parseInt(s.dataset.val))));
    s.addEventListener('mouseleave',()=>stars.forEach((x,i)=>x.classList.toggle('active',i<selRating)));
    s.addEventListener('click',()=>{selRating=parseInt(s.dataset.val);if($('rvRating'))$('rvRating').value=selRating;stars.forEach((x,i)=>x.classList.toggle('active',i<selRating));});
  });
  $('reviewFormPage')?.addEventListener('submit', e => {
    e.preventDefault();
    const name=($('rvName')?.value||'').trim(),role=($('rvRole')?.value||'').trim(),rating=parseInt($('rvRating')?.value||'0'),text=($('rvText')?.value||'').trim(),err=$('rvError');
    if(!name){if(err)err.textContent='Enter your name.';return;}
    if(!role){if(err)err.textContent='Enter your college & year.';return;}
    if(rating<1){if(err)err.textContent='Please select a star rating.';return;}
    if(text.length<15){if(err)err.textContent='Review must be at least 15 characters.';return;}
    const COLORS=['#6c63ff','#22c55e','#f59e0b','#ec4899','#a78bfa'];
    Store.addReview({id:'u'+Date.now(),name,role,rating,text:`"${text}"`,color:COLORS[Math.floor(Math.random()*COLORS.length)],featured:false,date:new Date().toISOString().slice(0,10)});
    if(err)err.textContent=''; $('reviewFormPage')?.reset(); selRating=0; if($('rvRating'))$('rvRating').value='0';
    stars.forEach(x=>x.classList.remove('active')); renderReviewsPage(0); updateReviewStats();
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.rating==='0'));
    $('reviewsPageGrid')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
function renderReviewsPage(filterRating) {
  const grid=$('reviewsPageGrid'),empty=$('reviewsEmpty'); if(!grid)return;
  const all=Store.allReviews(),filtered=filterRating>0?all.filter(r=>r.rating===filterRating):all;
  grid.innerHTML=''; if(!filtered.length){empty?.classList.remove('hidden');return;} empty?.classList.add('hidden');
  filtered.forEach(r=>{const stars='★'.repeat(r.rating)+'☆'.repeat(5-r.rating),init=r.name.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);const card=document.createElement('div');card.className='testi-card'+(r.featured?' testi-featured':'');card.innerHTML=`<div class="testi-stars">${stars}</div><p class="testi-text">${r.text}</p><div class="testi-author"><div class="testi-avatar" style="--av-color:${r.color||'#6c63ff'}">${init}</div><div><div class="testi-name">${r.name}</div><div class="testi-role">${r.role}</div></div></div>`;grid.appendChild(card);});
}
function updateReviewStats() {
  const all=Store.allReviews();
  if($('totalReviewCount'))$('totalReviewCount').textContent=all.length;
  if($('avgRating')&&all.length)$('avgRating').textContent=(all.reduce((s,r)=>s+r.rating,0)/all.length).toFixed(1);
}

/* ============================================================
   ADMIN PORTAL
   ============================================================ */
function initAdmin() {
  const gate=$('adminGate'),dashboard=$('adminDashboard');
  function unlock(){gate?.classList.add('hidden');dashboard?.classList.remove('hidden');loadAdminData();}
  function lock(){gate?.classList.remove('hidden');dashboard?.classList.add('hidden');}
  if(sessionStorage.getItem('dx_admin')==='1')unlock();
  $('adminLoginBtn')?.addEventListener('click',()=>{if(($('adminPwInput')?.value||'').trim()===ADMIN_PW){sessionStorage.setItem('dx_admin','1');if($('adminPwError'))$('adminPwError').textContent='';unlock();}else{if($('adminPwError'))$('adminPwError').textContent='Incorrect password.';}});
  $('adminPwInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('adminLoginBtn')?.click();});
  $('adminLogoutBtn')?.addEventListener('click',()=>{sessionStorage.removeItem('dx_admin');lock();if($('adminPwInput'))$('adminPwInput').value='';});
  document.querySelectorAll('.admin-nav-item').forEach(btn=>{
    btn.addEventListener('click',()=>{document.querySelectorAll('.admin-nav-item').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.admin-section').forEach(s=>s.classList.add('hidden'));$(`section-${btn.dataset.section}`)?.classList.remove('hidden');loadAdminData();});
  });
}
function fmtDate(iso){if(!iso)return'—';const d=new Date(iso);return d.toLocaleDateString('en-IN')+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});}
function fmtDateShort(iso){if(!iso)return'—';return new Date(iso).toLocaleDateString('en-IN');}
function loadAdminData(){
  const payments=Store.getPayments(),orders=Store.getOrders(),users=Store.getUsers(),reviews=Store.getUserReviews();
  if($('totalPayments'))$('totalPayments').textContent=payments.length;
  if($('totalRevenue')) $('totalRevenue').textContent='₹'+payments.length*10;
  if($('totalOrders'))  $('totalOrders').textContent=orders.length;
  if($('totalUsers'))   $('totalUsers').textContent=users.length;
  renderRecentTable(payments.slice(0,5));renderPaymentsTable(payments);renderOrdersTable(orders);renderUsersTable(users,orders);renderReviewsAdmin(reviews);setupAdminFilters(payments,orders,users,reviews);
}
function renderRecentTable(rows){const tbody=$('recentTableBody');if(!tbody)return;tbody.innerHTML=rows.length?rows.map(r=>`<tr><td><strong>${r.orderId||'—'}</strong></td><td>${r.userName||'—'}</td><td>${r.sheetTitle||'—'}</td><td style="color:var(--green)">₹${r.amount||10}</td><td>${r.method||'—'}</td><td>${r.utr||'—'}</td><td>${fmtDate(r.date)}</td><td><span class="status-badge status-verified">✓ Verified</span></td></tr>`).join(''):'<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">No activity yet.</td></tr>';}
function renderPaymentsTable(rows){const tbody=$('paymentsTableBody'),empty=$('paymentsEmpty');if(!tbody)return;if(!rows.length){tbody.innerHTML='';empty?.classList.remove('hidden');return;}empty?.classList.add('hidden');tbody.innerHTML=rows.map(r=>`<tr><td><strong>${r.orderId||'—'}</strong></td><td>${r.userName||'—'}<br><span style="font-size:.72rem;color:var(--text-faint)">${r.userIdentifier||''}</span></td><td>${r.sheetTitle||'—'}</td><td style="color:var(--green)">₹${r.amount||10}</td><td>${r.method||'—'}</td><td>${r.utr||'—'}</td><td>${fmtDate(r.date)}</td><td><span class="status-badge status-verified">✓ Verified</span></td><td><button class="admin-action-btn">View</button></td></tr>`).join('');}
function renderOrdersTable(rows){const tbody=$('ordersTableBody'),empty=$('ordersEmpty');if(!tbody)return;if(!rows.length){tbody.innerHTML='';empty?.classList.remove('hidden');return;}empty?.classList.add('hidden');tbody.innerHTML=rows.map(r=>`<tr><td><strong>${r.orderId||'—'}</strong></td><td>${r.title||r.sheetTitle||'—'}</td><td>${r.name||'—'}</td><td>${r.sClass||'—'}</td><td>${r.roll||'—'}</td><td>${r.sheetNo||'—'}</td><td>${r.year||'—'}</td><td>${r.startDate||'—'}</td><td>${r.submitDate||'—'}</td><td>${fmtDateShort(r.paidAt)}</td></tr>`).join('');const cf=$('orderClassFilter'),yf=$('orderYearFilter');if(cf&&cf.options.length===1){[...new Set(rows.map(r=>r.sClass).filter(Boolean))].forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;cf.appendChild(o);});}if(yf&&yf.options.length===1){[...new Set(rows.map(r=>r.year).filter(Boolean))].forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;yf.appendChild(o);});}}
function renderUsersTable(users,orders){const tbody=$('usersTableBody'),empty=$('usersEmpty');if(!tbody)return;if(!users.length){tbody.innerHTML='';empty?.classList.remove('hidden');return;}empty?.classList.add('hidden');tbody.innerHTML=users.map((u,i)=>`<tr><td>${i+1}</td><td><strong>${u.name}</strong></td><td>${u.identifier}</td><td>${fmtDateShort(u.createdAt)}</td><td>${orders.filter(o=>o.userIdentifier===u.identifier).length}</td></tr>`).join('');}
function renderReviewsAdmin(reviews){const tbody=$('reviewsAdminBody'),empty=$('reviewsAdminEmpty');if(!tbody)return;if(!reviews.length){tbody.innerHTML='';empty?.classList.remove('hidden');return;}empty?.classList.add('hidden');tbody.innerHTML=reviews.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${r.name||'—'}</strong></td><td>${r.role||'—'}</td><td style="color:var(--amber)">${'★'.repeat(r.rating||5)}</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(r.text||'').replace(/[""]/g,'')}</td><td>${r.date||'—'}</td><td><button class="admin-delete-btn" data-rid="${r.id}">Delete</button></td></tr>`).join('');tbody.querySelectorAll('.admin-delete-btn').forEach(btn=>{btn.addEventListener('click',()=>{if(confirm('Delete this review?')){Store.deleteReview(btn.dataset.rid);loadAdminData();}});});}
function setupAdminFilters(payments,orders,users,reviews){
  function filterPay(){const q=($('paySearch')?.value||'').toLowerCase(),m=($('payMethodFilter')?.value||'').toLowerCase(),st=($('payStatusFilter')?.value||'').toLowerCase();renderPaymentsTable(payments.filter(r=>{const t=(r.userName+r.sheetTitle+r.utr+r.orderId).toLowerCase();return(!q||t.includes(q))&&(!m||r.method?.toLowerCase()===m)&&(!st||r.status?.toLowerCase()===st);}));}
  $('paySearch')?.addEventListener('input',filterPay);$('payMethodFilter')?.addEventListener('change',filterPay);$('payStatusFilter')?.addEventListener('change',filterPay);
  function filterOrd(){const q=($('orderSearch')?.value||'').toLowerCase(),cl=($('orderClassFilter')?.value||''),yr=($('orderYearFilter')?.value||'');renderOrdersTable(orders.filter(r=>{const t=(r.name+r.roll+r.sheetTitle+r.title+r.orderId).toLowerCase();return(!q||t.includes(q))&&(!cl||r.sClass===cl)&&(!yr||r.year===yr);}));}
  $('orderSearch')?.addEventListener('input',filterOrd);$('orderClassFilter')?.addEventListener('change',filterOrd);$('orderYearFilter')?.addEventListener('change',filterOrd);
  $('userSearch')?.addEventListener('input',()=>{const q=($('userSearch')?.value||'').toLowerCase();renderUsersTable(users.filter(u=>(u.name+u.identifier).toLowerCase().includes(q)),orders);});
  function filterRev(){const q=($('reviewSearch')?.value||'').toLowerCase(),rat=parseInt($('reviewRatingFilter')?.value||'0');renderReviewsAdmin(reviews.filter(r=>{const t=(r.name+r.role+r.text).toLowerCase();return(!q||t.includes(q))&&(!rat||r.rating===rat);}));}
  $('reviewSearch')?.addEventListener('input',filterRev);$('reviewRatingFilter')?.addEventListener('change',filterRev);
}
window.exportCSV=function(type){
  let headers=[],rows=[],filename='export.csv';
  if(type==='payments'){headers=['Order ID','User','Sheet','Amount','Method','UTR','Date','Status'];rows=Store.getPayments().map(r=>[r.orderId,r.userName,r.sheetTitle,'₹'+r.amount,r.method,r.utr,fmtDate(r.date),r.status]);filename='duxedo_payments.csv';}
  else if(type==='orders'){headers=['Order ID','Title','Name','Class','Roll No','Sheet No','Year','Start','Submit','Paid On'];rows=Store.getOrders().map(r=>[r.orderId,r.title||r.sheetTitle,r.name,r.sClass,r.roll,r.sheetNo,r.year,r.startDate,r.submitDate,fmtDateShort(r.paidAt)]);filename='duxedo_orders.csv';}
  else if(type==='users'){headers=['Name','Email/Phone','Registered On'];rows=Store.getUsers().map(u=>[u.name,u.identifier,fmtDateShort(u.createdAt)]);filename='duxedo_users.csv';}
  const csv=[headers,...rows].map(r=>r.map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:filename});
  document.body.appendChild(a);a.click();document.body.removeChild(a);
};
