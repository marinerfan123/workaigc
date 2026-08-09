import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, setAuthModalOpen } from '@/services/authStore';

/* 墨灵AI 全新承接落地页 — 自包含、作用域隔离（.moling-landing），不污染主程序其它页面。
   设计标准：反 AI-slop / 4pt 统一尺度 / 双主题 / GPU-only 动效 / 离线安全（无外网依赖）。 */
const CSS = `
.moling-landing{
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
  --space-5:24px; --space-6:32px; --space-7:48px; --space-8:64px; --space-9:96px; --space-10:128px;
  --r-xs:10px; --r-sm:14px; --r-md:20px; --r-lg:28px; --r-pill:999px;
  --ease:cubic-bezier(.16,1,.3,1);
  --accent-1:#7c5cff; --accent-2:#36d6ff; --warm:#ff8a5c;
  --font-sans:"Inter","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;
  --grad:linear-gradient(135deg,var(--accent-1),var(--accent-2));
  font-family:var(--font-sans); background:var(--bg); color:var(--text);
  line-height:1.6; -webkit-font-smoothing:antialiased; overflow-x:hidden; position:relative; min-height:100vh;
  transition:background .5s var(--ease),color .5s var(--ease);
}
.moling-landing *{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
.moling-landing[data-theme="dark"]{
  --bg:#07070b; --bg-2:#0c0c14; --surface:rgba(255,255,255,.04);
  --surface-2:rgba(255,255,255,.06); --border:rgba(255,255,255,.09);
  --text:#f4f4f8; --muted:rgba(244,244,248,.60); --hair:rgba(255,255,255,.06);
  --glass:rgba(14,14,22,.66);
}
.moling-landing[data-theme="light"]{
  --bg:#f6f6fb; --bg-2:#ffffff; --surface:rgba(12,12,24,.035);
  --surface-2:rgba(12,12,24,.05); --border:rgba(12,12,24,.10);
  --text:#0b0b12; --muted:rgba(11,11,18,.58); --hair:rgba(12,12,24,.07);
  --glass:rgba(255,255,255,.72);
}
.moling-landing a{color:inherit;text-decoration:none}
.moling-landing .wrap{max-width:1180px;margin:0 auto;padding:0 var(--space-5)}
.moling-landing .grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.moling-landing .eyebrow{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:600}
.moling-landing .section{padding:var(--space-9) 0}
.moling-landing .h2{font-size:clamp(28px,4.4vw,46px);line-height:1.12;font-weight:700;letter-spacing:-.02em}
.moling-landing .lead{font-size:clamp(16px,1.8vw,19px);color:var(--muted);max-width:60ch}
.moling-landing #bg{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.55}
.moling-landing .tint{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(60% 50% at 75% 0%,rgba(124,92,255,.16),transparent 60%),
             radial-gradient(50% 40% at 10% 20%,rgba(54,214,255,.12),transparent 55%);}
.moling-landing header{position:sticky;top:0;z-index:50;backdrop-filter:blur(18px) saturate(160%);
  background:var(--glass);border-bottom:1px solid var(--border);transition:background .5s var(--ease)}
.moling-landing .nav{display:flex;align-items:center;justify-content:space-between;height:68px}
.moling-landing .brand{display:flex;align-items:center;gap:var(--space-3);font-weight:700;font-size:18px;letter-spacing:-.01em}
.moling-landing .logo{width:30px;height:30px;border-radius:9px;background:var(--grad);position:relative;flex:0 0 auto;
  box-shadow:0 6px 20px rgba(124,92,255,.4)}
.moling-landing .logo::after{content:"";position:absolute;inset:7px;border-radius:5px;background:var(--bg);opacity:.9}
.moling-landing .nav-links{display:flex;gap:var(--space-6);font-size:14.5px;color:var(--muted)}
.moling-landing .nav-links a{transition:color .25s var(--ease)}
.moling-landing .nav-links a:hover{color:var(--text)}
.moling-landing .nav-right{display:flex;align-items:center;gap:var(--space-3)}
.moling-landing .theme-switch{display:flex;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pill);padding:3px}
.moling-landing .theme-switch button{width:30px;height:30px;border:0;background:transparent;color:var(--muted);border-radius:var(--r-pill);
  cursor:pointer;display:grid;place-items:center;transition:all .3s var(--ease);font-size:14px}
.moling-landing .theme-switch button[aria-pressed="true"]{background:var(--grad);color:#fff;box-shadow:0 4px 14px rgba(124,92,255,.4)}
.moling-landing .btn{display:inline-flex;align-items:center;gap:var(--space-2);font-weight:600;font-size:14.5px;
  padding:11px 20px;border-radius:var(--r-pill);border:1px solid var(--border);cursor:pointer;
  background:var(--surface);color:var(--text);transition:transform .4s var(--ease),background .3s var(--ease),box-shadow .4s var(--ease);will-change:transform}
.moling-landing .btn:hover{background:var(--surface-2)}
.moling-landing .btn-primary{background:var(--grad);color:#fff;border:0;box-shadow:0 10px 30px rgba(124,92,255,.35)}
.moling-landing .btn-primary:hover{box-shadow:0 14px 40px rgba(124,92,255,.5)}
.moling-landing .btn-ghost{background:transparent}
.moling-landing .menu-btn{display:none}
.moling-landing .mobile-menu{display:none}
.moling-landing .hero{position:relative;z-index:1;padding:var(--space-10) 0 var(--space-9);text-align:center}
.moling-landing .hero .pill{display:inline-flex;align-items:center;gap:var(--space-2);padding:7px 16px;border-radius:var(--r-pill);
  border:1px solid var(--border);background:var(--surface);font-size:13px;color:var(--muted);margin-bottom:var(--space-5)}
.moling-landing .hero .pill .dot{width:7px;height:7px;border-radius:50%;background:var(--accent-2);box-shadow:0 0 10px var(--accent-2)}
.moling-landing .hero h1{font-size:clamp(40px,7vw,82px);line-height:1.02;font-weight:800;letter-spacing:-.03em;margin:var(--space-4) auto var(--space-5);max-width:16ch}
.moling-landing .hero .lead{margin:0 auto var(--space-6);text-align:center}
.moling-landing .hero-cta{display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap}
.moling-landing .hero-note{margin-top:var(--space-5);font-size:13px;color:var(--muted)}
.moling-landing .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4);margin-top:var(--space-9);
  border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);padding:var(--space-6) 0}
.moling-landing .stat{text-align:center}
.moling-landing .stat .num{font-size:clamp(28px,3.6vw,42px);font-weight:800;letter-spacing:-.02em}
.moling-landing .stat .lbl{font-size:13px;color:var(--muted);margin-top:var(--space-1)}
.moling-landing .sec-head{text-align:center;max-width:48ch;margin:0 auto var(--space-7)}
.moling-landing .sec-head .h2{margin:var(--space-3) 0}
.moling-landing .features{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-5)}
.moling-landing .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:var(--space-6);
  transition:transform .5s var(--ease),border-color .4s var(--ease),background .4s var(--ease);position:relative;overflow:hidden}
.moling-landing .card:hover{transform:translateY(-6px);border-color:rgba(124,92,255,.45);background:var(--surface-2)}
.moling-landing .card .ic{width:46px;height:46px;border-radius:13px;background:var(--surface-2);border:1px solid var(--border);
  display:grid;place-items:center;font-size:22px;margin-bottom:var(--space-4)}
.moling-landing .card h3{font-size:19px;font-weight:700;margin-bottom:var(--space-2);letter-spacing:-.01em}
.moling-landing .card p{font-size:14.5px;color:var(--muted)}
.moling-landing .card .tag{position:absolute;top:var(--space-5);right:var(--space-5);font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted);border:1px solid var(--border);padding:3px 9px;border-radius:var(--r-pill)}
.moling-landing .gallery{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4)}
.moling-landing .tile{position:relative;border-radius:var(--r-md);overflow:hidden;aspect-ratio:3/4;border:1px solid var(--border);
  transition:transform .6s var(--ease);cursor:pointer}
.moling-landing .tile:hover{transform:translateY(-4px) scale(1.015)}
.moling-landing .tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:transform .8s var(--ease)}
.moling-landing .tile:hover img{transform:scale(1.06)}
.moling-landing .tile .badge{position:absolute;top:var(--space-3);left:var(--space-3);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.18);padding:3px 9px;border-radius:var(--r-pill);z-index:2}
.moling-landing .tile .ext{position:absolute;top:var(--space-3);right:var(--space-3);width:28px;height:28px;border-radius:var(--r-pill);background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.18);color:#fff;display:grid;place-items:center;font-size:13px;opacity:0;transition:opacity .3s var(--ease);z-index:2}
.moling-landing .tile:hover .ext{opacity:1}
.moling-landing .tile .meta{position:absolute;left:0;right:0;bottom:0;padding:var(--space-4);
  background:linear-gradient(to top,rgba(0,0,0,.72),transparent);color:#fff;opacity:0;transform:translateY(8px);
  transition:opacity .4s var(--ease),transform .4s var(--ease);z-index:2}
.moling-landing .tile:hover .meta{opacity:1;transform:none}
.moling-landing .tile .meta .t{font-size:14px;font-weight:600}
.moling-landing .tile .meta .p{font-size:12px;opacity:.8;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.moling-landing .plans{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-5);align-items:stretch}
.moling-landing .plan{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:var(--space-7) var(--space-6);
  display:flex;flex-direction:column;transition:transform .5s var(--ease),border-color .4s var(--ease)}
.moling-landing .plan:hover{transform:translateY(-6px)}
.moling-landing .plan.featured{border-color:rgba(124,92,255,.6);background:linear-gradient(180deg,var(--surface-2),var(--surface));
  box-shadow:0 20px 60px rgba(124,92,255,.18)}
.moling-landing .plan .name{font-size:15px;font-weight:700;letter-spacing:.02em}
.moling-landing .plan .price{font-size:clamp(34px,4vw,46px);font-weight:800;letter-spacing:-.02em;margin:var(--space-3) 0}
.moling-landing .plan .price small{font-size:14px;font-weight:500;color:var(--muted)}
.moling-landing .plan ul{list-style:none;margin:var(--space-5) 0;display:grid;gap:var(--space-3);font-size:14.5px;color:var(--muted)}
.moling-landing .plan li{display:flex;gap:var(--space-2);align-items:flex-start}
.moling-landing .plan li::before{content:"✓";color:var(--accent-2);font-weight:700}
.moling-landing .plan .btn{margin-top:auto;justify-content:center}
.moling-landing .faq{max-width:780px;margin:0 auto;display:grid;gap:var(--space-3)}
.moling-landing .qa{border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);overflow:hidden}
.moling-landing .qa button{width:100%;text-align:left;background:transparent;border:0;color:var(--text);cursor:pointer;
  padding:var(--space-4) var(--space-5);font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:var(--space-4)}
.moling-landing .qa .sign{transition:transform .3s var(--ease);color:var(--muted);font-size:20px}
.moling-landing .qa.open .sign{transform:rotate(45deg)}
.moling-landing .qa .ans{max-height:0;overflow:hidden;transition:max-height .4s var(--ease);color:var(--muted);font-size:14.5px}
.moling-landing .qa .ans p{padding:0 var(--space-5) var(--space-4)}
.moling-landing .cta{position:relative;text-align:center;border:1px solid var(--border);border-radius:var(--r-lg);
  padding:var(--space-9) var(--space-5);overflow:hidden;background:var(--surface)}
.moling-landing .cta::before{content:"";position:absolute;inset:0;background:var(--grad);opacity:.10}
.moling-landing .cta>*{position:relative}
.moling-landing .cta h2{font-size:clamp(30px,5vw,54px);font-weight:800;letter-spacing:-.02em;margin-bottom:var(--space-4)}
.moling-landing .cta .lead{margin:0 auto var(--space-6)}
.moling-landing footer{border-top:1px solid var(--border);padding:var(--space-7) 0 var(--space-6);margin-top:var(--space-9)}
.moling-landing .foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--space-5);align-items:center}
.moling-landing .foot .muted{color:var(--muted);font-size:13.5px}
.moling-landing .foot-links{display:flex;gap:var(--space-5);font-size:14px;color:var(--muted)}
.moling-landing .foot-links a:hover{color:var(--text)}
.moling-landing .reveal{opacity:0;transform:translateY(24px);transition:opacity .8s var(--ease),transform .8s var(--ease)}
.moling-landing .reveal.in{opacity:1;transform:none}
.moling-landing .reveal.d1{transition-delay:.08s}.moling-landing .reveal.d2{transition-delay:.16s}.moling-landing .reveal.d3{transition-delay:.24s}
@media(max-width:920px){
  .moling-landing .features,.moling-landing .plans{grid-template-columns:1fr 1fr}
  .moling-landing .gallery{grid-template-columns:1fr 1fr}
  .moling-landing .stats{grid-template-columns:1fr 1fr;gap:var(--space-6)}
}
@media(max-width:640px){
  .moling-landing .nav-links{display:none}
  .moling-landing .menu-btn{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--r-sm);
    border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
  .moling-landing .mobile-menu{display:flex;flex-direction:column;gap:2px;padding:var(--space-3) var(--space-5) var(--space-4);
    border-bottom:1px solid var(--border);background:var(--glass)}
  .moling-landing .mobile-menu a{padding:10px 0;color:var(--muted);font-size:15px}
  .moling-landing .features,.moling-landing .plans,.moling-landing .gallery{grid-template-columns:1fr}
  .moling-landing .hero{padding:var(--space-8) 0 var(--space-7)}
}
@media(prefers-reduced-motion:reduce){
  .moling-landing *{animation:none!important;transition:none!important}
  .moling-landing .reveal{opacity:1;transform:none}
  .moling-landing #bg{display:none}
}
`;

// 临时：展示网上高热度作品；TODO 后期对接 /api/media/public 推荐作品替换
const GALLERY_ITEMS = [
  { id: 'cyber-city', title: '霓虹都市', prompt: '赛博朋克夜景，电影感宽幅构图，霓虹与雨夜交织', tag: '热门', image: 'https://images.unsplash.com/photo-1515630278258-407f66498911?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/cyberpunk-city' },
  { id: 'warm-portrait', title: '暖光人像', prompt: '自然光人像，柔和高光与细腻肤色，情绪感特写', tag: '热门', image: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/portrait-photography' },
  { id: 'minimal-product', title: '极简产品', prompt: '电商静物，纯净背景与柔和倒影，商用授权质感', tag: '精选', image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/product-photography' },
  { id: 'concept-landscape', title: '幻境插画', prompt: '数字概念艺术，超现实风光与细腻笔触，工作室出品', tag: '精选', image: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/digital-art' },
  { id: 'sunset-beach', title: '落日海岸', prompt: '风景摄影风，黄金时刻海岸线，参考图引导生成', tag: '热门', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/sunset-landscape' },
  { id: 'abstract-fluid', title: '抽象流体', prompt: '动态渐变艺术，色彩流动，可作视频封面与背景', tag: '精选', image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/abstract-fluid' },
  { id: 'fashion-character', title: '角色设定', prompt: '时尚人像与角色气质，强烈风格化，角色库复用', tag: '热门', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/fashion-portrait' },
  { id: 'tech-blueprint', title: '科技蓝图', prompt: 'UI/科技概念图，冷色调与未来感，商用场景', tag: '精选', image: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&q=80&auto=format&fit=crop', sourceUrl: 'https://unsplash.com/s/photos/technology-futuristic' },
];

export default function LandingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('dark');
  const [menuOpen, setMenuOpen] = useState(false);

  // 主题：本地持久 + 作用域到落地页根，不影响主程序其它页面
  useEffect(() => {
    const saved = (localStorage.getItem('moling-theme') as 'light' | 'dark' | 'system') || 'dark';
    setTheme(saved);
  }, []);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const applied = theme === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme;
    root.setAttribute('data-theme', applied);
    localStorage.setItem('moling-theme', theme);
  }, [theme]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onSys = () => { if (theme === 'system' && rootRef.current) rootRef.current.setAttribute('data-theme', mq.matches ? 'light' : 'dark'); };
    mq.addEventListener('change', onSys);
    return () => mq.removeEventListener('change', onSys);
  }, [theme]);

  // 动效：磁吸 / 滚动揭示 / 数字计数 / FAQ / 粒子背景（全部自包含，尊重 reduced-motion）
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const q = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];

    q('.moling-landing .magnetic').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e as PointerEvent).clientX - r.left - r.width / 2;
        const y = (e as PointerEvent).clientY - r.top - r.height / 2;
        el.style.transform = `translate(${x * 0.18}px,${y * 0.28}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });

    const revObs = new IntersectionObserver((es) => {
      es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); revObs.unobserve(en.target); } });
    }, { threshold: 0.14 });
    q('.moling-landing .reveal').forEach((el) => revObs.observe(el));

    const cntObs = new IntersectionObserver((es) => {
      es.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target as HTMLElement;
        const target = +el.dataset.count!; const dec = +(el.dataset.dec || 0); const suf = el.dataset.suffix || '';
        const dur = 1400; const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
          el.textContent = (dec ? (target * e).toFixed(dec) : Math.round(target * e).toLocaleString()) + suf;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick); cntObs.unobserve(el);
      });
    }, { threshold: 0.5 });
    q('.moling-landing [data-count]').forEach((el) => cntObs.observe(el));

    q('.moling-landing .qa button').forEach((b) => {
      b.addEventListener('click', () => {
        const qa = b.parentElement!; const ans = qa.querySelector('.ans') as HTMLElement;
        const open = qa.classList.contains('open');
        q('.moling-landing .qa.open').forEach((o) => { if (o !== qa) { o.classList.remove('open'); (o.querySelector('.ans') as HTMLElement).style.maxHeight = ''; } });
        qa.classList.toggle('open', !open);
        ans.style.maxHeight = open ? '' : ans.scrollHeight + 'px';
      });
    });

    // 轻量粒子背景（无外部库）
    const c = document.getElementById('bg') as HTMLCanvasElement | null;
    if (c) {
      const x = c.getContext('2d'); if (x) {
        let w = 0, h = 0, dpr = 1, pts: any[] = [], raf = 0, running = true;
        const resize = () => {
          dpr = Math.min(2, window.devicePixelRatio || 1);
          w = c.width = window.innerWidth * dpr; h = c.height = window.innerHeight * dpr;
          c.style.width = window.innerWidth + 'px'; c.style.height = window.innerHeight + 'px';
          const n = Math.min(70, Math.floor(window.innerWidth / 22));
          pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.12 * dpr, vy: (Math.random() - 0.5) * 0.12 * dpr, r: (Math.random() * 1.6 + 0.6) * dpr }));
        };
        const draw = () => {
          if (!running) return;
          x.clearRect(0, 0, w, h);
          for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fillStyle = 'rgba(124,92,255,.55)'; x.fill(); }
          for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
            const a = pts[i], b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy), max = 130 * dpr;
            if (d < max) { x.globalAlpha = (1 - d / max) * 0.18; x.strokeStyle = '#36d6ff'; x.lineWidth = dpr * 0.6; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); x.globalAlpha = 1; }
          }
          raf = requestAnimationFrame(draw);
        };
        resize(); draw(); window.addEventListener('resize', resize);
        const onVis = () => { running = !document.hidden; if (running) draw(); else cancelAnimationFrame(raf); };
        document.addEventListener('visibilitychange', onVis);
      }
    }
  }, []);

  const start = () => (user ? navigate('/workspace') : setAuthModalOpen(true));

  return (
    <div className="moling-landing" ref={rootRef} data-theme={theme}>
      <style>{CSS}</style>
      <canvas id="bg" />
      <div className="tint" />

      <header>
        <div className="nav">
          <Link to="/" className="brand"><span className="logo" />墨灵AI</Link>
          <nav className="nav-links">
            <a href="#features">能力</a>
            <a href="#showcase">作品</a>
            <a href="#pricing">套餐</a>
            <a href="#faq">问答</a>
          </nav>
          <div className="nav-right">
            <div className="theme-switch" role="group" aria-label="主题切换">
              <button data-theme-btn="light" aria-pressed={theme === 'light'} title="亮色" onClick={() => setTheme('light')}>☀</button>
              <button data-theme-btn="dark" aria-pressed={theme === 'dark'} title="暗色" onClick={() => setTheme('dark')}>☾</button>
              <button data-theme-btn="system" aria-pressed={theme === 'system'} title="跟随系统" onClick={() => setTheme('system')}>◐</button>
            </div>
            <button className="btn btn-primary magnetic" onClick={start}>
              {user ? '进入工作台' : '免费开始'}
            </button>
            <button className="menu-btn" aria-label="菜单" onClick={() => setMenuOpen((o) => !o)}>≡</button>
          </div>
        </div>
        {menuOpen && (
          <div className="mobile-menu">
            <a href="#features" onClick={() => setMenuOpen(false)}>能力</a>
            <a href="#showcase" onClick={() => setMenuOpen(false)}>作品</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>套餐</a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>问答</a>
          </div>
        )}
      </header>

      <main className="wrap">
        {/* HERO */}
        <section className="hero">
          <span className="pill"><span className="dot" />全新 AI 创作引擎 · 图像 / 视频 / 智能体一体</span>
          <h1>把灵感，<span className="grad-text">即时</span>变为作品</h1>
          <p className="lead">一个工作台，承载从一句话提示词到成片、从个人创作到内容市集与商业分发的完整链路。多模型智能调度，按量计费，零门槛上手。</p>
          <div className="hero-cta">
            <button className="btn btn-primary magnetic" onClick={start}>✨ 立即免费创作</button>
            <a href="#showcase" className="btn btn-ghost magnetic">浏览作品市集 →</a>
          </div>
          <p className="hero-note">无需信用卡 · 新用户赠送创作额度 · 支持商用授权</p>

          <div className="stats reveal">
            <div className="stat"><div className="num" data-count="1200000">0</div><div className="lbl">累计生成作品</div></div>
            <div className="stat"><div className="num" data-count="38">0</div><div className="lbl">接入大模型</div></div>
            <div className="stat"><div className="num" data-count="99" data-suffix="%">0</div><div className="lbl">任务稳定完成</div></div>
            <div className="stat"><div className="num" data-count="1.2" data-dec="1">0</div><div className="lbl">平均出图(秒)</div></div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="section" id="features">
          <div className="sec-head reveal">
            <span className="eyebrow">核心能力</span>
            <h2 className="h2">为创作而生的<br />完整工作流</h2>
            <p className="lead" style={{ margin: 'var(--space-3) auto 0' }}>不是又一个玩具模型箱，而是一整套从构思、生成到分发的生产系统。</p>
          </div>
          <div className="features">
            <div className="card reveal d1"><div className="tag">Studio</div><div className="ic">🎨</div><h3>智能创作工作室</h3><p>画布式分镜、参考图引导、批量生成。把复杂项目拆成可编排的步骤，一次出一组同源变体。</p></div>
            <div className="card reveal d2"><div className="ic">🧩</div><h3>AI 技能市集</h3><p>prompt 配方、风格预设、技能智能体即装即用。官方与创作者共建，试用台一键体验再下单。</p></div>
            <div className="card reveal d3"><div className="ic">⚡</div><h3>多模型智能调度</h3><p>全局兜底模型 + 按成本自动均衡，高峰不拥堵、单点故障秒级切换，创作永不断流。</p></div>
            <div className="card reveal d1"><div className="ic">💎</div><h3>商业生态</h3><p>作品上架市集、会员订阅、按量计费与分销收益，让创作直接产生回报。</p></div>
            <div className="card reveal d2"><div className="ic">🛡️</div><h3>企业级隔离</h3><p>每用户存储命名空间隔离、支付 fails-closed 校验、账务双边精确算量，安全可审计。</p></div>
            <div className="card reveal d3"><div className="ic">🌐</div><h3>创作者主页</h3><p>公开主页 /user/:id 展示作品与套餐，自带流量承接，把观众变成客户。</p></div>
          </div>
        </section>

        {/* SHOWCASE */}
        <section className="section" id="showcase">
          <div className="sec-head reveal">
            <span className="eyebrow">作品市集</span>
            <h2 className="h2">看看大家用墨灵AI做了什么</h2>
          </div>
          <div className="gallery">
            {/* TODO: 后期对接 /api/media/public 推荐作品，替换 GALLERY_ITEMS */}
            {GALLERY_ITEMS.map((item, i) => (
              <a
                className={`tile reveal ${i % 2 ? 'd2' : 'd1'}`}
                key={item.id}
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`${item.title} — 在 Unsplash 查看更多热门作品`}
              >
                <img src={item.image} alt={item.prompt} loading="lazy" decoding="async" />
                {item.tag && <span className="badge">{item.tag}</span>}
                <span className="ext" aria-hidden="true">↗</span>
                <div className="meta"><div className="t">{item.title}</div><div className="p">{item.prompt}</div></div>
              </a>
            ))}
          </div>
        </section>

        {/* PRICING */}
        <section className="section" id="pricing">
          <div className="sec-head reveal">
            <span className="eyebrow">套餐</span>
            <h2 className="h2">按你的节奏付费</h2>
          </div>
          <div className="plans">
            <div className="plan reveal d1">
              <div className="name">体验版</div>
              <div className="price">¥0<small> / 永久</small></div>
              <ul><li>每日赠送创作额度</li><li>基础模型阵容</li><li>标准分辨率出图</li><li>社区支持</li></ul>
              <button className="btn magnetic" onClick={start}>免费开始</button>
            </div>
            <div className="plan featured reveal d2">
              <div className="name">创作者会员</div>
              <div className="price">¥39<small> / 月</small></div>
              <ul><li>高额月度额度</li><li>全部高级模型</li><li>高清 / 视频生成</li><li>作品市集零佣金上架</li><li>优先队列</li></ul>
              <button className="btn btn-primary magnetic" onClick={start}>升级会员</button>
            </div>
            <div className="plan reveal d3">
              <div className="name">团队版</div>
              <div className="price">按量<small> / 定制</small></div>
              <ul><li>多人协作空间</li><li>API 与批量调度</li><li>企业级隔离与审计</li><li>专属客户经理</li></ul>
              <button className="btn magnetic" onClick={() => navigate('/shop')}>联系我们</button>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq">
          <div className="sec-head reveal">
            <span className="eyebrow">常见问答</span>
            <h2 className="h2">开始前，先弄清楚</h2>
          </div>
          <div className="faq reveal">
            {[['生成的图片可以商用吗？', '可以。会员及以上套餐明确包含商用授权，作品可上架市集分发或用于商业项目，具体以所选模型的授权条款为准。'], ['没有 GPU 也能流畅创作吗？', '创作算力全部在云端，你只需浏览器即可。多模型智能调度会自动选择最优通道，弱网也不会中断任务。'], ['额度用完了怎么办？', '可随时充值按量包，或升级会员获取更高月度额度。全局兜底模型确保即使某模型拥堵也能完成生成。'], ['我的作品数据安全吗？', '每用户存储命名空间严格隔离，支付与账务采用 fails-closed 校验与双边精确算量，全程可审计。']].map(([q, a]) => (
              <div className="qa" key={q}><button>{q}<span className="sign">+</span></button><div className="ans"><p>{a}</p></div></div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="section">
          <div className="cta reveal">
            <h2>准备好把灵感变成作品了吗？</h2>
            <p className="lead">30 秒注册，立即领取创作额度。无需信用卡，随时可退。</p>
            <div className="hero-cta">
              <button className="btn btn-primary magnetic" onClick={start}>🚀 免费创建账户</button>
              <a href="#features" className="btn btn-ghost magnetic">再看看能力</a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap foot">
          <div className="brand"><span className="logo" />墨灵AI</div>
          <div className="foot-links"><a href="#features">能力</a><a href="#showcase">作品</a><a href="#pricing">套餐</a><a href="#">文档</a><a href="#">联系</a></div>
          <div className="muted">© 2026 墨灵AI · 把灵感即时变为作品</div>
        </div>
      </footer>
    </div>
  );
}
