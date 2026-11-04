// Odin Agent IA — comportements du site. Aucun cookie, aucun traceur, aucune requête externe.
(() => {
  const d = document, root = d.documentElement;
  root.classList.add('js');

  // Changement de page : on arrive toujours en haut de la nouvelle page (certains navigateurs et
  // cadres d'aperçu gardent la position de défilement de la page précédente).
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* rien */ }
  const toTopNow = () => { if (!location.hash) { root.style.scrollBehavior = 'auto'; scrollTo(0, 0); try { top !== window && top.scrollTo(0, 0); } catch { /* autre origine */ } root.style.scrollBehavior = ''; } };
  toTopNow();
  addEventListener('pageshow', toTopNow);
  d.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]'); if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname) return; // autre site, ou ancre de la même page
    e.preventDefault(); root.style.scrollBehavior = 'auto'; scrollTo(0, 0); root.style.scrollBehavior = '';
    requestAnimationFrame(() => { location.href = url.href; });
  });
  const $ = (s, el = d) => el.querySelector(s), $$ = (s, el = d) => [...el.querySelectorAll(s)];

  // Thème : sombre par défaut ; le choix reste dans le navigateur (localStorage, pas un cookie).
  let theme = null;
  try { theme = localStorage.getItem('odin-site-theme'); } catch { /* stockage indisponible */ }
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  $('#themeBtn')?.addEventListener('click', () => {
    const light = root.getAttribute('data-theme') !== 'light';
    if (light) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('odin-site-theme', light ? 'light' : 'dark'); } catch { /* rien */ }
  });

  // Menu mobile
  const menuBtn = $('#menuBtn'), mobile = $('#mobileNav');
  menuBtn?.addEventListener('click', () => { const open = mobile.hidden; mobile.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu'); });
  $$('#mobileNav a').forEach((a) => a.addEventListener('click', () => { mobile.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }));

  // Bouton « haut de page », barre de progression, ombre de l'en-tête
  const toTop = $('#toTop'), progress = $('#progress'), header = $('.site-header');
  const onScroll = () => {
    const y = scrollY, max = d.documentElement.scrollHeight - innerHeight;
    toTop?.classList.toggle('on', y > 600);
    header?.classList.toggle('scrolled', y > 8);
    if (progress) progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  };
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();

  // Cartes : halo qui suit le pointeur (souris seulement)
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    d.addEventListener('pointermove', (e) => {
      const c = e.target.closest?.('.card'); if (!c) return;
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  // Mascotte : elle réagit quand on la touche, et ses yeux suivent le doigt ou la souris.
  const faces = $$('.odin'), moods = ['poke', 'wow', 'spin'];
  let mood = 0;
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
  const look = (f, x, y) => { const r = f.getBoundingClientRect(); f.style.setProperty('--ex', `${clamp((x - r.left - r.width / 2) / 28, 6)}px`); f.style.setProperty('--ey', `${clamp((y - r.top - r.height / 2) / 28, 5)}px`); f.classList.add('follow'); };
  faces.forEach((f) => {
    f.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const m = moods[mood++ % moods.length];
      f.classList.remove(...moods); void f.offsetWidth; f.classList.add(m);
      look(f, e.clientX, e.clientY);
      setTimeout(() => f.classList.remove(m), 950);
      setTimeout(() => f.classList.remove('follow'), 1800);
    });
  });
  if (faces.length && matchMedia('(hover:hover) and (pointer:fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let raf = 0;
    d.addEventListener('pointermove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        for (const f of faces) {
          const r = f.getBoundingClientRect(); if (!r.width) continue;
          const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
          if (Math.hypot(dx, dy) < 340) look(f, e.clientX, e.clientY); else f.classList.remove('follow');
        }
      });
    }, { passive: true });
  }

  // Mascotte du héros : elle « réfléchit » pendant que le terminal travaille, sourit à la fin
  const heroOdin = $('#heroOdin');

  // Révélation au défilement
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rv = $$('.rv');
  if (reduce || !('IntersectionObserver' in window)) rv.forEach((el) => el.classList.add('in'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    rv.forEach((el) => io.observe(el));
  }

  // Compteurs
  $$('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count), suffix = el.dataset.suffix || '';
    if (reduce) { el.textContent = target.toLocaleString('fr-FR') + suffix; return; }
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return; io.disconnect();
      const t0 = performance.now(), dur = 1200;
      const tick = (t) => { const p = Math.min(1, (t - t0) / dur), v = Math.round(target * (1 - Math.pow(1 - p, 3))); el.textContent = v.toLocaleString('fr-FR') + suffix; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    io.observe(el);
  });

  // Terminal animé (héros) : rejoue la scène en boucle
  const term = $('#term');
  if (term) {
    const lines = [...term.children];
    const play = () => {
      lines.forEach((l, i) => { l.style.animation = 'none'; l.offsetHeight; l.style.animation = ''; l.style.animationDelay = `${reduce ? 0 : 0.35 + i * 0.55}s`; });
      if (heroOdin && !reduce) {
        heroOdin.classList.remove('happy'); heroOdin.classList.add('thinking');
        setTimeout(() => { heroOdin.classList.remove('thinking'); heroOdin.classList.add('happy'); }, 350 + (lines.length - 2) * 550);
        setTimeout(() => heroOdin.classList.remove('happy'), 350 + lines.length * 550 + 2500);
      }
    };
    play();
    if (!reduce) setInterval(play, 0.35 * 1000 + lines.length * 550 + 6000);
  }

  // Onglets (installation)
  $$('[role=tablist]').forEach((list) => {
    const tabs = $$('[role=tab]', list);
    const show = (tab) => {
      tabs.forEach((t) => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; const p = d.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on; });
    };
    tabs.forEach((t) => { t.addEventListener('click', () => show(t)); t.addEventListener('keydown', (e) => { const i = tabs.indexOf(t); if (e.key === 'ArrowRight') { tabs[(i + 1) % tabs.length].focus(); show(tabs[(i + 1) % tabs.length]); } if (e.key === 'ArrowLeft') { tabs[(i - 1 + tabs.length) % tabs.length].focus(); show(tabs[(i - 1 + tabs.length) % tabs.length]); } }); });
    // Pré-sélection selon le système du visiteur
    const ua = navigator.userAgent, want = /Windows/.test(ua) ? 'win' : /Mac/.test(ua) ? 'mac' : /Linux|X11/.test(ua) ? 'linux' : null;
    const pre = want && tabs.find((t) => t.dataset.os === want);
    show(pre || tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0]);
  });

  // Boutons « copier »
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.copy;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copié ✓'; } catch { b.textContent = 'Sélectionne et copie'; }
    setTimeout(() => { b.textContent = 'Copier'; }, 1800);
  }));

  // Tableaux : titres de colonnes recopiés dans chaque cellule (affichage en fiches sur téléphone)
  $$('table.rtable').forEach((t) => {
    const heads = $$('thead th', t).map((h) => h.textContent.trim());
    $$('tbody tr', t).forEach((tr) => [...tr.children].forEach((td, i) => { if (i > 0 && heads[i]) td.setAttribute('data-label', heads[i]); }));
  });

  // FAQ : ouvrir la question visée par l'ancre
  const openHash = () => { const el = location.hash && d.getElementById(location.hash.slice(1)); if (el && el.tagName === 'DETAILS') el.open = true; };
  addEventListener('hashchange', openHash); openHash();
})();
