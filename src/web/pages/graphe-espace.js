// Le « Graphe 3D » d'Odin : le même graphe que le 2D (src/web/graph.js), mais dans l'espace. Un fond sombre avec une
// poussière d'étoiles, des points lumineux avec un halo (colorés par groupe, plus gros quand ils ont beaucoup de liens),
// des liens fins colorés, le nom des groupes en capitales de leur couleur et le nom des points en petit. On tourne en
// glissant (deux axes), on zoome à la molette ou en pinçant ; un toucher sur un point fait voler la caméra vers lui et
// l'ouvre (le même onOpen que le 2D). Rotation lente tant qu'on ne touche à rien ; rien ne tourne onglet caché.
//
// Choix de rendu : une toile 2D seule, sans WebGL. Le halo est une petite image dessinée une fois par couleur puis
// recopiée en mélange additif (« lighter ») : c'est l'opération que les navigateurs accélèrent le mieux, même sur une
// carte graphique intégrée modeste ; 300 points et 600 liens tiennent dans quelques millisecondes. Une seule façon de
// dessiner (donc une seule à vérifier), pas de contexte WebGL perdu à gérer ni de plafond de contextes quand plusieurs
// graphes sont ouverts, et les noms s'écrivent sur la même toile. Si une image dépasse le budget, le niveau de détail
// baisse tout seul (moins d'étoiles, plus de halo, moins de noms, moins de pixels) au lieu de saccader.
//
// Rien d'extérieur : ni bibliothèque, ni police, ni image. Les noms s'écrivent par le texte de la toile ou par
// textContent, jamais en HTML. Une liste de boutons cachée à l'œil garde le clavier et les lecteurs d'écran.
//   OdinGrapheEspace.mount(boîte, données, options) — données comme OdinGraph.mount : { nodes, edges, legend, label,
//     counter, onOpen } ; un point peut porter `pos: { x, y, z }` (dans [-1, 1]) pour une place qui a un sens.
//   OdinGrapheEspace.choix(boîte, { cle, donnees, defaut }) — le choix « Graphe | Graphe 3D », retenu par endroit.
//   OdinGrapheEspace.logique — fonctions pures, vérifiées par test/graphe-espace.test.ts.
(() => {
  'use strict';
  if (window.OdinGrapheEspace) return;

  // ---------------- Textes (dans la langue de la page ; l'anglais si elle n'est pas connue ici)
  const TEXTES = {
    fr: { graphe: 'Graphe', graphe3d: 'Graphe 3D', vue: 'Vue du graphe', aide: 'Glisser : tourner · molette ou pincer : zoomer · toucher un point : y aller', recentrer: 'Recentrer', plus: 'Zoomer', moins: 'Dézoomer', replie: 'Vue 3D indisponible ici (moins de mouvement demandé, ou appareil trop lent) : voici le graphe. Touche « Graphe 3D » pour l\'ouvrir quand même.', points: 'points', liens: 'liens', vide: 'Rien à montrer pour l\'instant.', liste: 'Points du graphe' },
    en: { graphe: 'Graph', graphe3d: '3D graph', vue: 'Graph view', aide: 'Drag: rotate · wheel or pinch: zoom · tap a point: fly to it', recentrer: 'Recenter', plus: 'Zoom in', moins: 'Zoom out', replie: '3D view unavailable here (reduced motion requested, or device too slow): here is the graph. Tap “3D graph” to open it anyway.', points: 'points', liens: 'links', vide: 'Nothing to show yet.', liste: 'Graph points' },
    es: { graphe: 'Grafo', graphe3d: 'Grafo 3D', vue: 'Vista del grafo', aide: 'Arrastrar: girar · rueda o pellizcar: zoom · tocar un punto: ir a él', recentrer: 'Recentrar', plus: 'Acercar', moins: 'Alejar', replie: 'Vista 3D no disponible aquí (menos movimiento solicitado o dispositivo lento): aquí está el grafo. Toca «Grafo 3D» para abrirla de todos modos.', points: 'puntos', liens: 'enlaces', vide: 'Nada que mostrar por ahora.', liste: 'Puntos del grafo' },
    de: { graphe: 'Graph', graphe3d: '3D-Graph', vue: 'Graphansicht', aide: 'Ziehen: drehen · Mausrad oder Zwei-Finger: zoomen · Punkt antippen: hinfliegen', recentrer: 'Zentrieren', plus: 'Vergrößern', moins: 'Verkleinern', replie: '3D-Ansicht hier nicht verfügbar (weniger Bewegung gewünscht oder Gerät zu langsam): hier ist der Graph. „3D-Graph“ antippen, um sie trotzdem zu öffnen.', points: 'Punkte', liens: 'Verbindungen', vide: 'Noch nichts anzuzeigen.', liste: 'Punkte des Graphen' },
    it: { graphe: 'Grafo', graphe3d: 'Grafo 3D', vue: 'Vista del grafo', aide: 'Trascina: ruota · rotella o pizzica: zoom · tocca un punto: raggiungilo', recentrer: 'Ricentra', plus: 'Ingrandisci', moins: 'Riduci', replie: 'Vista 3D non disponibile qui (movimento ridotto richiesto o dispositivo lento): ecco il grafo. Tocca «Grafo 3D» per aprirla comunque.', points: 'punti', liens: 'collegamenti', vide: 'Ancora niente da mostrare.', liste: 'Punti del grafo' },
    pt: { graphe: 'Grafo', graphe3d: 'Grafo 3D', vue: 'Vista do grafo', aide: 'Arrastar: girar · roda ou pinça: zoom · tocar num ponto: ir até ele', recentrer: 'Recentrar', plus: 'Aproximar', moins: 'Afastar', replie: 'Vista 3D indisponível aqui (menos movimento pedido ou aparelho lento): eis o grafo. Toque em «Grafo 3D» para abri-la mesmo assim.', points: 'pontos', liens: 'ligações', vide: 'Nada para mostrar por enquanto.', liste: 'Pontos do grafo' },
    nl: { graphe: 'Graaf', graphe3d: '3D-graaf', vue: 'Graafweergave', aide: 'Slepen: draaien · scrollwiel of knijpen: zoomen · punt aantikken: erheen vliegen', recentrer: 'Centreren', plus: 'Inzoomen', moins: 'Uitzoomen', replie: '3D-weergave hier niet beschikbaar (minder beweging gevraagd of apparaat te traag): hier is de graaf. Tik op „3D-graaf” om hem toch te openen.', points: 'punten', liens: 'verbindingen', vide: 'Nog niets te tonen.', liste: 'Punten van de graaf' },
    ru: { graphe: 'Граф', graphe3d: '3D-граф', vue: 'Вид графа', aide: 'Перетаскивание: вращение · колесо или щипок: масштаб · касание точки: перелёт к ней', recentrer: 'По центру', plus: 'Приблизить', moins: 'Отдалить', replie: '3D-вид здесь недоступен (запрошено меньше движения или устройство слишком медленное): вот граф. Нажмите «3D-граф», чтобы всё равно открыть его.', points: 'точек', liens: 'связей', vide: 'Пока нечего показать.', liste: 'Точки графа' },
    zh: { graphe: '图谱', graphe3d: '3D 图谱', vue: '图谱视图', aide: '拖动：旋转 · 滚轮或双指：缩放 · 点按一个点：飞向它', recentrer: '居中', plus: '放大', moins: '缩小', replie: '此处无法使用 3D 视图（已请求减少动态效果，或设备太慢）：这是图谱。点按“3D 图谱”仍可打开。', points: '个点', liens: '条连线', vide: '暂无内容。', liste: '图谱中的点' },
    ja: { graphe: 'グラフ', graphe3d: '3D グラフ', vue: 'グラフの表示', aide: 'ドラッグ：回転 · ホイールまたはピンチ：ズーム · 点をタップ：そこへ移動', recentrer: '中央に戻す', plus: '拡大', moins: '縮小', replie: 'ここでは 3D 表示を使えません（視差効果を減らす設定、または端末が遅い）：グラフを表示しています。「3D グラフ」をタップすると開けます。', points: '点', liens: 'リンク', vide: 'まだ表示するものはありません。', liste: 'グラフの点' },
    ko: { graphe: '그래프', graphe3d: '3D 그래프', vue: '그래프 보기', aide: '드래그: 회전 · 휠 또는 핀치: 확대/축소 · 점 탭: 그 점으로 이동', recentrer: '가운데로', plus: '확대', moins: '축소', replie: '여기서는 3D 보기를 쓸 수 없습니다(동작 줄이기 요청 또는 기기가 느림): 그래프를 보여 드립니다. 그래도 열려면 「3D 그래프」를 누르세요.', points: '개 점', liens: '개 연결', vide: '아직 보여 줄 것이 없습니다.', liste: '그래프의 점' },
    ar: { graphe: 'المخطط', graphe3d: 'مخطط ثلاثي الأبعاد', vue: 'عرض المخطط', aide: 'اسحب: تدوير · العجلة أو القرص: تكبير · المس نقطة: انتقل إليها', recentrer: 'توسيط', plus: 'تكبير', moins: 'تصغير', replie: 'العرض ثلاثي الأبعاد غير متاح هنا (طُلبت حركة أقل أو الجهاز بطيء): هذا هو المخطط. المس «مخطط ثلاثي الأبعاد» لفتحه رغم ذلك.', points: 'نقاط', liens: 'روابط', vide: 'لا شيء لعرضه الآن.', liste: 'نقاط المخطط' },
    hi: { graphe: 'ग्राफ़', graphe3d: '3D ग्राफ़', vue: 'ग्राफ़ दृश्य', aide: 'खींचें: घुमाएँ · व्हील या पिंच: ज़ूम · किसी बिंदु को छुएँ: वहाँ जाएँ', recentrer: 'बीच में लाएँ', plus: 'ज़ूम इन', moins: 'ज़ूम आउट', replie: '3D दृश्य यहाँ उपलब्ध नहीं (कम गति माँगी गई या उपकरण धीमा है): यह रहा ग्राफ़। फिर भी खोलने के लिए «3D ग्राफ़» छुएँ।', points: 'बिंदु', liens: 'कड़ियाँ', vide: 'अभी दिखाने को कुछ नहीं।', liste: 'ग्राफ़ के बिंदु' },
    tr: { graphe: 'Grafik', graphe3d: '3B grafik', vue: 'Grafik görünümü', aide: 'Sürükle: döndür · tekerlek veya iki parmak: yakınlaştır · bir noktaya dokun: oraya git', recentrer: 'Ortala', plus: 'Yakınlaştır', moins: 'Uzaklaştır', replie: '3B görünüm burada kullanılamıyor (daha az hareket istendi veya cihaz yavaş): işte grafik. Yine de açmak için «3B grafik»e dokunun.', points: 'nokta', liens: 'bağlantı', vide: 'Henüz gösterilecek bir şey yok.', liste: 'Grafiğin noktaları' },
    sw: { graphe: 'Grafu', graphe3d: 'Grafu ya 3D', vue: 'Mwonekano wa grafu', aide: 'Buruta: zungusha · gurudumu au bana: kuza · gusa nukta: nenda kwake', recentrer: 'Weka katikati', plus: 'Kuza', moins: 'Punguza', replie: 'Mwonekano wa 3D haupatikani hapa (mwendo mdogo umeombwa, au kifaa ni cha polepole): hii ndiyo grafu. Gusa «Grafu ya 3D» kuifungua hata hivyo.', points: 'nukta', liens: 'viungo', vide: 'Hakuna cha kuonyesha bado.', liste: 'Nukta za grafu' },
  };
  /** La langue de la page (« fr-FR » → « fr ») parmi celles connues ici ; l'anglais sinon. */
  function langueDe(code) {
    const c = String(code || '').toLowerCase().split(/[-_]/)[0];
    return TEXTES[c] ? c : 'en';
  }
  const texte = (cle, langue) => (TEXTES[langueDe(langue)] || TEXTES.en)[cle] || TEXTES.en[cle] || cle;

  // ---------------- Logique pure (sans document)

  /** Un entier stable tiré d'un texte (FNV-1a). */
  function graine(t) {
    let h = 2166136261; const s = String(t == null ? '' : t);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /** Un tirage pseudo-aléatoire répétable (mulberry32) : même graine, même suite. */
  function alea(g) {
    let a = g >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // Les couleurs d'Odin dans l'espace : vives et lumineuses sur fond sombre.
  const PALETTE = ['#5EE7FF', '#FFB547', '#7CFF8A', '#FF6FD8', '#B48CFF', '#FFE45E', '#FF7A6B', '#5B8CFF', '#3DF5C1', '#F9A8FF', '#C9F25B', '#FF9F43'];
  /** La couleur d'un groupe : toujours la même pour le même nom. */
  const couleurGroupe = (nom) => PALETTE[graine(nom) % PALETTE.length];

  /** « #abc », « #aabbcc » ou « rgb(…) » → { r, g, b } ; null si on ne sait pas lire. */
  function versRgb(c) {
    const s = String(c || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]) };
    return null;
  }
  /** Une couleur trop sombre pour l'espace est éclaircie (un gris de « hors ligne » reste lisible sur le fond). */
  function lumineuse(c) {
    const v = versRgb(c); if (!v) return null;
    const l = (0.2126 * v.r + 0.7152 * v.g + 0.0722 * v.b) / 255;
    if (l >= 0.45) return `rgb(${v.r},${v.g},${v.b})`;
    const k = (0.45 - l) / (1 - l + 1e-9);
    const f = (x) => Math.round(x + (255 - x) * k);
    return `rgb(${f(v.r)},${f(v.g)},${f(v.b)})`;
  }

  /**
   * Les données du 2D (nodes, edges, legend) rangées pour l'espace : liens sans doublon ni boucle, degré de chaque
   * point, groupe (son `groupe`, sinon le nom de sa couleur dans la légende) et couleur (la sienne, sinon celle du
   * groupe). Ne modifie rien de ce qu'on lui donne.
   */
  function normaliser(d) {
    const src = d && Array.isArray(d.nodes) ? d.nodes : [];
    const legende = d && Array.isArray(d.legend) ? d.legend.filter((x) => Array.isArray(x) && x.length >= 2) : [];
    const nomCouleur = new Map(legende.map(([c, n]) => [String(c).toLowerCase(), String(n)]));
    const noeuds = [], index = new Map();
    for (const n of src) {
      if (!n || n.id == null) continue;
      const id = String(n.id); if (index.has(id)) continue;
      const couleurPropre = n.color ? String(n.color) : '';
      const groupe = n.groupe != null ? String(n.groupe) : n.group != null ? String(n.group) : couleurPropre && nomCouleur.has(couleurPropre.toLowerCase()) ? nomCouleur.get(couleurPropre.toLowerCase()) : '';
      const label = String(n.label != null ? n.label : id);
      const pos = n.pos && [n.pos.x, n.pos.y, n.pos.z].every(Number.isFinite) ? { x: n.pos.x, y: n.pos.y, z: n.pos.z } : null;
      index.set(id, noeuds.length);
      noeuds.push({ id, label, sub: n.sub != null ? String(n.sub) : '', titre: String(n.title || (n.sub ? `${label} — ${n.sub}` : label)), libelle: n.libelle ? String(n.libelle) : '', hub: Boolean(n.hub), off: Boolean(n.off), groupe, couleur: lumineuse(couleurPropre) || (couleurPropre && /^[a-z]+$/i.test(couleurPropre) ? couleurPropre : '') || couleurGroupe(groupe || (n.hub ? 'centre' : 'point')), pos, deg: 0, alerte: Boolean(n.alert && n.alert.n) });
    }
    const liens = [], vus = new Set();
    for (const e of (d && Array.isArray(d.edges) ? d.edges : [])) {
      if (!e) continue;
      const a = String(Array.isArray(e) ? e[0] : e.a), b = String(Array.isArray(e) ? e[1] : e.b);
      if (a === b || !index.has(a) || !index.has(b)) continue;
      const cle = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`; if (vus.has(cle)) continue; vus.add(cle);
      const i = index.get(a), j = index.get(b);
      noeuds[i].deg++; noeuds[j].deg++;
      const dash = !Array.isArray(e) && e.dash ? (Array.isArray(e.dash) ? e.dash.filter(Number.isFinite) : [5, 4]) : null;
      liens.push({ a, b, i, j, couleur: !Array.isArray(e) && e.color ? (lumineuse(e.color) || '') : '', dash: dash && dash.length ? dash : null });
    }
    return { noeuds, liens, legende };
  }

  /** Le rayon d'un point (unités du monde × 100) : plus il a de liens, plus il est gros ; un centre est plus gros. */
  const rayonPoint = (deg, hub) => Math.min(13, (2.6 + 1.5 * Math.sqrt(Math.max(0, deg || 0))) * (hub ? 1.5 : 1));

  /**
   * Le plafond de tours du placement : le calcul est en n² par tour, sur le fil de la page ; au-delà d'environ
   * 12 millions de paires (≈ 300 points × 260 tours), on fait moins de tours pour ne jamais geler la page sur un grand
   * graphe (3 tours au moins : les liens et les groupes se voient déjà).
   */
  const toursMax = (n) => Math.max(3, Math.floor(1.2e7 / Math.max(1, n * n)));

  /**
   * La place de chaque point dans l'espace (une sphère de rayon 1), par forces : les liens rapprochent, tous les points
   * se repoussent, ceux d'un même groupe se rassemblent en amas. Graine fixe : même graphe, même dessin. Un point qui
   * porte `pos` reste à sa place (sa position a un sens : fraîcheur, usage…).
   * `depart` (facultatif) : Map id → { x, y, z } pour repartir d'une place déjà connue.
   */
  function placer3D(noeuds, liens, o = {}) {
    const n = noeuds.length; if (!n) return [];
    const r = alea(graine(noeuds.map((x) => x.id).sort().join('|')));
    const P = noeuds.map((nd) => {
      if (nd.pos) return { x: nd.pos.x, y: nd.pos.y, z: nd.pos.z, fixe: true };
      const d0 = o.depart && o.depart.get(nd.id); if (d0) return { x: d0.x, y: d0.y, z: d0.z, fixe: false };
      const u = r() * 2 - 1, t = r() * Math.PI * 2, rr = Math.cbrt(r()) * 0.9, s = Math.sqrt(1 - u * u);
      return { x: rr * s * Math.cos(t), y: rr * u, z: rr * s * Math.sin(t), fixe: false };
    });
    const libres = P.filter((p) => !p.fixe).length;
    if (libres) {
      const k = 1.6 / Math.cbrt(n), k2 = k * k;
      const tours = Math.min(o.tours != null ? o.tours : n <= 60 ? 260 : n <= 150 ? 180 : Math.max(70, Math.round(26000 / n)), toursMax(n));
      const F = P.map(() => ({ x: 0, y: 0, z: 0 }));
      const groupes = new Map(); noeuds.forEach((nd, i) => { if (nd.groupe) { if (!groupes.has(nd.groupe)) groupes.set(nd.groupe, []); groupes.get(nd.groupe).push(i); } });
      for (let t = 0; t < tours; t++) {
        const temp = 0.12 * (1 - t / tours) + 0.004;
        for (const f of F) { f.x = 0; f.y = 0; f.z = 0; }
        for (let i = 0; i < n; i++) {
          const a = P[i];
          for (let j = i + 1; j < n; j++) {
            const b = P[j]; let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            let d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < 1e-6) { dx = (r() - 0.5) * 1e-3; dy = (r() - 0.5) * 1e-3; dz = (r() - 0.5) * 1e-3; d2 = 1e-6; }
            const f = k2 / d2; // force k²/d, rapportée au vecteur (÷ d)
            F[i].x += dx * f; F[i].y += dy * f; F[i].z += dz * f; F[j].x -= dx * f; F[j].y -= dy * f; F[j].z -= dz * f;
          }
        }
        for (const l of liens) {
          const a = P[l.i], b = P[l.j], dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3, f = d / k; // force d²/k, ÷ d
          F[l.i].x -= dx * f; F[l.i].y -= dy * f; F[l.i].z -= dz * f; F[l.j].x += dx * f; F[l.j].y += dy * f; F[l.j].z += dz * f;
        }
        for (const ids of groupes.values()) {
          if (ids.length < 2) continue;
          let cx = 0, cy = 0, cz = 0; for (const i of ids) { cx += P[i].x; cy += P[i].y; cz += P[i].z; }
          cx /= ids.length; cy /= ids.length; cz /= ids.length;
          for (const i of ids) { F[i].x += (cx - P[i].x) * 0.9 / k; F[i].y += (cy - P[i].y) * 0.9 / k; F[i].z += (cz - P[i].z) * 0.9 / k; }
        }
        for (let i = 0; i < n; i++) {
          const p = P[i]; if (p.fixe) continue;
          const f = F[i]; f.x -= p.x * 1.2 / k; f.y -= p.y * 1.2 / k; f.z -= p.z * 1.2 / k; // un peu de gravité vers le centre
          const m = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z);
          if (m > 0) { const pas = Math.min(m, temp) / m; p.x += f.x * pas; p.y += f.y * pas; p.z += f.z * pas; }
        }
      }
    }
    // Recadrer : centrés, et le plus loin à 1 (les points fixés gardent leur place).
    if (libres === n) {
      let cx = 0, cy = 0, cz = 0; for (const p of P) { cx += p.x; cy += p.y; cz += p.z; }
      cx /= n; cy /= n; cz /= n;
      let m = 0; for (const p of P) { p.x -= cx; p.y -= cy; p.z -= cz; m = Math.max(m, Math.hypot(p.x, p.y, p.z)); }
      if (m > 1e-9) for (const p of P) { p.x /= m; p.y /= m; p.z /= m; }
    } else if (libres) {
      let m = 0; for (const p of P) if (!p.fixe) m = Math.max(m, Math.hypot(p.x, p.y, p.z));
      if (m > 1) for (const p of P) if (!p.fixe) { p.x /= m; p.y /= m; p.z /= m; }
    }
    return P.map((p) => ({ x: +p.x.toFixed(6), y: +p.y.toFixed(6), z: +p.z.toFixed(6) }));
  }

  /** La caméra au départ : un peu au-dessus, un peu de côté, assez loin pour tout voir. */
  const cameraDepart = () => ({ yaw: 0.6, pitch: 0.32, dist: 2.45, cible: { x: 0, y: 0, z: 0 } });

  /**
   * Projette un point du monde à l'écran, en perspective. La caméra tourne autour de sa cible (yaw : autour de l'axe
   * vertical, pitch : de haut en bas) à la distance `dist`. `prof` croît vers l'avant (le plus grand est devant) ;
   * `echelle` : pixels par unité du monde à cette profondeur ; `visible` : faux derrière la caméra.
   */
  function projeter(p, cam, larg, haut) {
    const c = cam.cible || { x: 0, y: 0, z: 0 };
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy;
    const y2 = dy * cp - z1 * sp, z2 = dy * sp + z1 * cp;
    const prof = cam.dist - z2;
    const f = Math.min(larg, haut) * 0.85;
    if (prof <= 0.05) return { sx: 0, sy: 0, prof: -prof, echelle: 0, visible: false };
    const s = f / prof;
    return { sx: larg / 2 + x1 * s, sy: haut / 2 - y2 * s, prof: -prof, echelle: s, visible: true };
  }

  /**
   * Le point sous le doigt ou la souris. D'abord ceux qu'on touche vraiment (dans leur disque) : celui de devant gagne ;
   * sinon le plus proche à portée de `minRayon` px (cibles de 40 px au moins sur un téléphone). Rien → null.
   * points : [{ id, sx, sy, prof, taille, visible? }]
   */
  function choisir(points, x, y, minRayon = 20) {
    let devant = null, profDevant = -Infinity, proche = null, dProche = Infinity;
    for (const p of points || []) {
      if (!p || p.visible === false) continue;
      const d = Math.hypot((p.sx || 0) - x, (p.sy || 0) - y), t = p.taille || 0;
      if (d <= t + 2 && p.prof > profDevant) { profDevant = p.prof; devant = p.id; }
      if (d <= Math.max(minRayon, t + 4) && d < dProche) { dProche = d; proche = p.id; }
    }
    return devant != null ? devant : proche;
  }

  // Les niveaux de détail : 0 = tout, 3 = le strict nécessaire. On ne saccade pas : on simplifie.
  const NIVEAUX = [
    { etoiles: 900, halo: true, etiquettes: 45, dprMax: 2, ips: 60 },
    { etoiles: 420, halo: true, etiquettes: 30, dprMax: 1.5, ips: 60 },
    { etoiles: 140, halo: false, etiquettes: 22, dprMax: 1.25, ips: 40 },
    { etoiles: 0, halo: false, etiquettes: 10, dprMax: 1, ips: 30 },
  ];
  /**
   * Le niveau de détail suivant, d'après le temps moyen d'une image (ms) et le budget : au-dessus du budget on
   * simplifie d'un cran ; très en dessous (moins de 25 %), on rajoute un cran de détail.
   */
  function niveauDetail(msMoyen, niveau, budget = 12) {
    const n = Math.max(0, Math.min(NIVEAUX.length - 1, niveau | 0));
    if (!Number.isFinite(msMoyen)) return n;
    if (msMoyen > budget && n < NIVEAUX.length - 1) return n + 1;
    if (msMoyen < budget * 0.25 && n > 0) return n - 1; // seuils écartés : pas d'aller-retour entre deux niveaux
    return n;
  }

  /**
   * Faut-il rester sur le graphe 2D ? Oui si la toile manque, ou — sauf si la personne a touché « Graphe 3D »
   * (`force`) — si elle a demandé moins de mouvement, si l'appareil n'a pas de carte graphique (WebGL absent) ou si la
   * première image a été beaucoup trop lente.
   */
  function doitReplier(o = {}) {
    if (o.ctx2d === false) return true;
    if (o.force) return false;
    if (o.reducedMotion) return true;
    if (o.webgl === false) return true;
    if (typeof o.premiereImageMs === 'number' && o.premiereImageMs > (o.seuilMs || 120)) return true;
    return false;
  }
  /** La vue d'un endroit au départ : celle retenue, sinon celle par défaut de l'endroit ('2d' ou '3d'). */
  const vueInitiale = (memorise, defaut) => (memorise === '2d' || memorise === '3d' ? memorise : defaut === '3d' ? '3d' : '2d');

  const recouvre = (r, q) => r.x1 < q.x2 && q.x1 < r.x2 && r.y1 < q.y2 && q.y1 < r.y2;
  /**
   * Les noms de points à écrire et leur place : de devant vers le fond (les centres, les points en alerte et les plus
   * reliés d'abord), sans qu'un nom en recouvre un autre ni recouvre une zone déjà prise (`o.occupes` : les noms des
   * groupes, posés avant), au plus `max`. Chaque nom essaie, dans l'ordre, les places de `o.places` (sous le point,
   * au-dessus, à droite, à gauche). points : [{ id, sx, sy, prof, taille, visible, prio }] ; largeurs : Map id →
   * largeur du nom (px). Rend [{ id, x, y, align }] (x : ancre du texte, y : haut de la ligne), dans l'ordre.
   */
  function poserEtiquettes(points, largeurs, max, larg, haut, o = {}) {
    const ligne = o.ligne || 13, places = o.places || ['dessous', 'dessus', 'droite', 'gauche'];
    const ordre = (points || []).filter((p) => p.visible !== false).slice().sort((a, b) => (b.prio || 0) - (a.prio || 0) || b.prof - a.prof);
    const poses = (o.occupes || []).slice(), out = [];
    for (const p of ordre) {
      if (out.length >= max) break;
      const w = (largeurs && largeurs.get(p.id)) || 40, t = p.taille || 0;
      for (const pl of places) {
        const r = pl === 'dessous' ? { x1: p.sx - w / 2, x2: p.sx + w / 2, y1: p.sy + t + 2, y2: p.sy + t + 2 + ligne, x: p.sx, align: 'center' }
          : pl === 'dessus' ? { x1: p.sx - w / 2, x2: p.sx + w / 2, y1: p.sy - t - 2 - ligne, y2: p.sy - t - 2, x: p.sx, align: 'center' }
          : pl === 'droite' ? { x1: p.sx + t + 3, x2: p.sx + t + 3 + w, y1: p.sy - ligne / 2, y2: p.sy + ligne / 2, x: p.sx + t + 3 + w / 2, align: 'center' }
          : { x1: p.sx - t - 3 - w, x2: p.sx - t - 3, y1: p.sy - ligne / 2, y2: p.sy + ligne / 2, x: p.sx - t - 3 - w / 2, align: 'center' };
        if (r.x1 < 0 || r.x2 > larg || r.y1 < 0 || r.y2 > haut) continue;
        if (poses.some((q) => recouvre(r, q))) continue;
        poses.push(r); out.push({ id: p.id, x: r.x, y: r.y1, align: r.align });
        break;
      }
    }
    return out;
  }
  /** Les noms à écrire (ids seulement), sous leur point : la forme simple de poserEtiquettes. */
  const etiquettes = (points, largeurs, max, larg, haut, ligne = 13) => poserEtiquettes(points, largeurs, max, larg, haut, { ligne, places: ['dessous'] }).map((x) => x.id);
  /**
   * Combien de noms de points écrire sur une toile de cette taille : à peu près un pour 12 000 px² (un téléphone en
   * montre une quinzaine, un grand écran le plafond du niveau de détail), jamais plus que `plafond`.
   */
  const nombreNoms = (larg, haut, plafond) => Math.max(0, Math.min(plafond, Math.floor((Math.max(0, larg) * Math.max(0, haut)) / 12000)));

  /**
   * Le centre (à l'écran) de chaque groupe d'au moins deux points visibles, pour y écrire son nom en capitales : dans
   * le haut de son amas (au-dessus du centre d'une demi-dispersion, et de 14 px au moins).
   */
  function centresGroupes(points) {
    const g = new Map();
    for (const p of points || []) {
      if (!p.groupe || p.visible === false) continue;
      const c = g.get(p.groupe) || { groupe: p.groupe, couleur: p.couleur, x: 0, y: 0, y2: 0, n: 0 };
      c.x += p.sx; c.y += p.sy; c.y2 += p.sy * p.sy; c.n++; g.set(p.groupe, c);
    }
    return [...g.values()].filter((c) => c.n >= 2).map((c) => {
      const my = c.y / c.n, sd = Math.sqrt(Math.max(0, c.y2 / c.n - my * my));
      return { groupe: c.groupe, couleur: c.couleur, x: c.x / c.n, y: my - Math.max(14, sd * 0.5), n: c.n };
    });
  }
  /**
   * La place des noms de groupes (posés AVANT ceux des points) : le plus gros groupe d'abord ; deux noms qui se
   * toucheraient sont écartés (au-dessus, au-dessous, puis de côté, avec une marge), sinon le second est laissé.
   * centres : ceux de centresGroupes ; largeur(t) : largeur du texte. Rend [{ groupe, couleur, texte, x, y, w, x1, x2, y1, y2 }]
   * (y : ligne de base) ; x1…y2 est la zone protégée que les noms des points évitent.
   */
  function poserTitres(centres, largeur, larg, haut, o = {}) {
    const ligne = o.ligne || 14, marge = 8, out = [];
    for (const c of (centres || []).slice().sort((a, b) => b.n - a.n)) {
      const texte = String(c.groupe).toLocaleUpperCase().slice(0, 32), w = largeur(texte);
      const essais = [[0, 0], [0, -(ligne + 8)], [0, ligne + 8], [0, -2 * (ligne + 8)], [0, 2 * (ligne + 8)], [-(w + marge * 2) / 2 - 4, 0], [(w + marge * 2) / 2 + 4, 0]];
      for (const [dx, dy] of essais) {
        const x = c.x + dx, y = c.y + dy;
        const r = { x1: x - w / 2 - marge / 2, x2: x + w / 2 + marge / 2, y1: y - ligne, y2: y + 4 };
        if (r.x1 < 0 || r.x2 > larg || r.y1 < 0 || r.y2 > haut) continue;
        if (out.some((q) => r.x1 < q.x2 + marge && q.x1 < r.x2 + marge && r.y1 < q.y2 + 4 && q.y1 < r.y2 + 4)) continue;
        out.push({ groupe: c.groupe, couleur: c.couleur, texte, x, y, w, ...r });
        break;
      }
    }
    return out;
  }

  /** Un nom pour la toile : sans l'icône (émoji) qui le précède, coupé avec « … » au-delà de `max` caractères. */
  function nomCourt(t, max = 28) {
    const s = String(t == null ? '' : t);
    let sans = s;
    try { sans = s.replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+/u, ''); } catch { /* moteur sans \p : nom gardé */ }
    const nom = sans.trim() || s.trim();
    const cars = Array.from(nom);
    return cars.length > max ? `${cars.slice(0, max - 1).join('').trimEnd()}…` : nom;
  }

  /** Une courbe douce pour le vol de la caméra (0 → 1). */
  const doux = (t) => { const x = Math.max(0, Math.min(1, t)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  /** La caméra à l'instant t (0 → 1) d'un vol de `a` vers `b`. */
  function camEntre(a, b, t) {
    const e = doux(t), m = (u, v) => u + (v - u) * e;
    return { yaw: m(a.yaw, b.yaw), pitch: m(a.pitch, b.pitch), dist: m(a.dist, b.dist), cible: { x: m(a.cible.x, b.cible.x), y: m(a.cible.y, b.cible.y), z: m(a.cible.z, b.cible.z) } };
  }
  /** La distance de la caméra, bornée d'après le rayon du graphe : on peut entrer dans l'amas, pas s'y perdre. */
  const borneDist = (d, rayon = 1) => { const R = Math.max(0.2, rayon || 1); return Math.max(0.3 * R, Math.min(7 * R, d)); };
  const bornePitch = (p) => Math.max(-1.45, Math.min(1.45, p));
  /** Le rayon du graphe : la distance du point le plus loin du centre (0,2 au moins). */
  const rayonGraphe = (P) => { let m = 0; for (const p of P || []) m = Math.max(m, Math.hypot(p.x, p.y, p.z)); return Math.max(0.2, m); };

  /**
   * Le facteur de zoom d'un tour de molette : un cran (≈ 100 px, ou 3 lignes) multiplie la distance par 0,9 ou par
   * 1/0,9 ; un événement ne compte jamais plus d'un cran (certains navigateurs envoient des deltas énormes) ; un
   * pavé tactile, qui envoie de petits deltas, zoome en douceur.
   */
  function pasMolette(deltaY, deltaMode = 0) {
    const px = (Number(deltaY) || 0) * (deltaMode === 1 ? 33 : deltaMode === 2 ? 400 : 1);
    const crans = Math.max(-1, Math.min(1, px / 100));
    return Math.pow(0.9, -crans);
  }

  /**
   * Le zoom vers un endroit de l'écran (le curseur, le milieu des doigts) : la distance est multipliée par `facteur`
   * (bornée d'après le rayon) et la cible glisse pour que ce qui est sous le curseur y reste. La cible ne sort pas de
   * la sphère du graphe. Pur : rend une nouvelle caméra.
   */
  function zoomVers(cam, facteur, mx, my, larg, haut, rayon = 1) {
    const d0 = cam.dist, d1 = borneDist(d0 * facteur, rayon);
    const c = cam.cible || { x: 0, y: 0, z: 0 };
    const out = { yaw: cam.yaw, pitch: cam.pitch, dist: d1, cible: { x: c.x, y: c.y, z: c.z } };
    if (!(larg > 0 && haut > 0) || !Number.isFinite(mx) || !Number.isFinite(my)) return out;
    const f = Math.min(larg, haut) * 0.85, s = f / d0;
    const ox = (mx - larg / 2) / s, oy = -(my - haut / 2) / s, k = 1 - d1 / d0;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // Les axes de l'écran dans le monde (l'inverse des rotations de projeter) : droite et haut.
    const R = { x: cy, y: 0, z: -sy }, U = { x: -sy * sp, y: cp, z: -cy * sp };
    out.cible = { x: c.x + (R.x * ox + U.x * oy) * k, y: c.y + (R.y * ox + U.y * oy) * k, z: c.z + (R.z * ox + U.z * oy) * k };
    const R0 = Math.max(0.2, rayon || 1), m = Math.hypot(out.cible.x, out.cible.y, out.cible.z);
    if (m > R0) { out.cible.x *= R0 / m; out.cible.y *= R0 / m; out.cible.z *= R0 / m; }
    return out;
  }

  /**
   * La distance de caméra qui fait tenir tout le graphe dans la toile (marge comprise), quel que soit l'angle de la
   * rotation lente autour de l'axe vertical : on essaie huit angles et on garde le plus exigeant. Bornée par le rayon.
   */
  function cadrer(P, cam, larg, haut, marge = 0.84) {
    if (!P || !P.length || !(larg > 0 && haut > 0)) return cameraDepart().dist;
    const f = Math.min(larg, haut) * 0.85, lx = (larg / 2) * marge, ly = (haut / 2) * marge;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    let d = 0;
    for (let a = 0; a < 8; a++) {
      const yaw = cam.yaw + (a * Math.PI) / 4, cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const p of P) {
        const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
        const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
        d = Math.max(d, z2 + (Math.abs(x1) * f) / lx, z2 + (Math.abs(y2) * f) / ly);
      }
    }
    return borneDist(Math.max(d, 0.5), rayonGraphe(P));
  }

  /** Le rayon du halo d'un point de cette taille : 2,6 fois, mais les gros centres ne débordent pas de plus de 22 px. */
  const rayonHalo = (taille) => Math.min(taille * 2.6, taille + 22);
  /**
   * Le plafond du mélange additif : quand les halos couvrent beaucoup de la toile (un centre dense), ils s'additionnent
   * jusqu'au blanc ; on baisse alors leur intensité (0,35 au moins) pour que les couleurs restent lisibles.
   * tailles : rayons des points visibles (px).
   */
  function densiteHalo(tailles, larg, haut) {
    if (!(larg > 0 && haut > 0)) return 1;
    let s = 0; for (const t of tailles || []) { const r = rayonHalo(t); s += r * r * 3.1416; }
    const dens = s / (larg * haut);
    return dens > 0.3 ? Math.max(0.35, Math.sqrt(0.3 / dens)) : 1;
  }

  /** La poussière d'étoiles : des points lointains, toujours les mêmes (graine fixe). */
  function etoiles(n, g = 7) {
    const r = alea(g), out = [];
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 7 + r() * 9;
      out.push({ x: R * s * Math.cos(t), y: R * u, z: R * s * Math.sin(t), b: 0.25 + r() * 0.75, t: r() < 0.08 ? 2 : 1 });
    }
    return out;
  }

  const logique = { graine, alea, toursMax, couleurGroupe, versRgb, lumineuse, normaliser, rayonPoint, placer3D, cameraDepart, projeter, choisir, NIVEAUX, niveauDetail, doitReplier, vueInitiale, etiquettes, poserEtiquettes, nombreNoms, centresGroupes, poserTitres, nomCourt, doux, camEntre, borneDist, bornePitch, rayonGraphe, pasMolette, zoomVers, cadrer, densiteHalo, etoiles, langueDe, texte };

  // ---------------- Navigateur
  const aDocument = typeof document !== 'undefined' && document && typeof document.createElement === 'function';
  const el = (t, a = {}, ...kids) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(9)) if (c != null && c !== false) n.append(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const langue = () => { try { return (document.documentElement && document.documentElement.lang) || (typeof navigator !== 'undefined' && navigator.language) || 'en'; } catch { return 'en'; } };
  const T = (cle) => texte(cle, langue());
  const maintenant = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());
  const reducedMotion = () => { try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
  // L'appareil a-t-il une carte graphique ? Demandé une seule fois, et le contexte d'essai est rendu aussitôt (aucun
  // contexte WebGL ne reste ouvert, quel que soit le nombre de graphes montés).
  let webglMemo = null;
  const webglDispo = () => {
    if (webglMemo !== null) return webglMemo;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext && (c.getContext('webgl') || c.getContext('experimental-webgl'));
      webglMemo = Boolean(gl);
      try { const x = gl && typeof gl.getExtension === 'function' && gl.getExtension('WEBGL_lose_context'); if (x && typeof x.loseContext === 'function') x.loseContext(); } catch { /* rien */ }
    } catch { webglMemo = false; }
    return webglMemo;
  };
  const lire = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sans stockage : le choix n'est pas gardé */ } };
  const prochaineImage = (f) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));
  const annulerImage = (id) => { try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id); } catch { /* rien */ } };

  const CSS = `
.ge{position:relative;height:min(68vh,640px);min-height:360px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#07060f;touch-action:none;color:#ECEAF7}
.ge.ge-plein{height:100%;min-height:0;border:0;border-radius:0}
.ge canvas{display:block;width:100%;height:100%;cursor:grab}.ge canvas.on{cursor:pointer}.ge canvas.drag{cursor:grabbing}
.ge canvas:focus-visible{outline:2px solid var(--accent,#8f7bff);outline-offset:-3px}
.ge-haut{position:absolute;left:10px;top:10px;right:64px;display:flex;gap:8px;flex-wrap:wrap;pointer-events:none}
.ge-haut span{font-size:12.5px;color:#C9C4E8;background:rgba(10,8,24,.62);padding:4px 9px;border-radius:8px;overflow-wrap:anywhere}
.ge-z{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;gap:6px}
.ge-z button{width:40px;height:40px;border-radius:10px;border:1px solid rgba(200,190,255,.28);background:rgba(14,11,32,.78);color:#ECEAF7;font:inherit;font-size:18px;line-height:1;cursor:pointer;display:grid;place-items:center}
.ge-z button:hover{background:rgba(40,32,84,.9)}.ge-z button:focus-visible{outline:2px solid var(--accent,#8f7bff)}
.ge-leg{position:absolute;left:10px;bottom:10px;max-width:calc(100% - 80px);display:flex;gap:4px 12px;flex-wrap:wrap;font-size:12px;color:#C9C4E8;background:rgba(10,8,24,.62);padding:5px 9px;border-radius:9px;pointer-events:none}
.ge-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px;box-shadow:0 0 6px currentColor}
.ge-tip{position:absolute;z-index:3;pointer-events:none;background:rgba(14,11,32,.92);color:#ECEAF7;border:1px solid rgba(200,190,255,.28);border-radius:8px;padding:4px 8px;font-size:12.5px;max-width:280px;overflow-wrap:anywhere}
.ge-tip[hidden]{display:none}
.ge-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.ge-sr:focus-within{z-index:4;left:10px;top:10px;width:auto;height:auto;max-width:calc(100% - 80px);max-height:calc(100% - 20px);overflow:auto;clip-path:none;white-space:normal;background:rgba(14,11,32,.94);border:1px solid rgba(200,190,255,.28);border-radius:10px;padding:4px}
.ge-sr button{display:block;min-height:40px;width:100%;text-align:start;padding:0 10px;border:0;border-radius:8px;background:none;color:#ECEAF7;font:inherit;font-size:13px;cursor:pointer}
.ge-sr button:focus-visible{outline:2px solid var(--accent,#8f7bff);outline-offset:-2px}
.ge-vide{position:absolute;inset:0;display:grid;place-items:center;color:#C9C4E8;font-size:14px;padding:16px;text-align:center;pointer-events:none}
.ge-vide[hidden],.ge-leg[hidden],.ge-haut span[hidden]{display:none}
@media (pointer:coarse){.ge-z button{width:44px;height:44px}}
@media (max-width:600px){.ge{height:62vh}.ge.ge-plein{height:100%}.ge-leg{display:none}}
.ge-choix{display:flex;flex-direction:column;gap:8px;min-width:0}
.ge-choix.ge-plein{position:absolute;inset:0;gap:0}
.ge-choix.ge-plein>.ge-bar{padding:8px 12px}
.ge-choix.ge-plein>.ge-boite{flex:1;min-height:0;position:relative}
.ge-choix.ge-plein>.ge-boite>*{height:100%}
.ge-bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.ge-seg{display:inline-flex;gap:2px;padding:2px;border-radius:12px;border:1px solid var(--line);background:var(--panel)}
.ge-seg button{min-height:40px;padding:0 14px;border:0;border-radius:10px;background:none;color:var(--muted);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
.ge-seg button[aria-pressed=true]{background:var(--accent);color:var(--on-accent,#fff);font-weight:600}
.ge-seg button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ge-note{margin:0;font-size:13px;color:var(--muted);flex:1 1 240px;min-width:0}.ge-note[hidden]{display:none}
@media (pointer:coarse){.ge-seg button{min-height:44px}}
`;
  function style() { if (!document.getElementById('ge-css')) document.head.append(el('style', { id: 'ge-css' }, CSS)); }

  /** Le halo d'une couleur : dessiné une fois (64 px), recopié ensuite en mélange additif. */
  const halos = new Map();
  function halo(couleur) {
    if (halos.has(couleur)) return halos.get(couleur);
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext && c.getContext('2d'); if (!x) { halos.set(couleur, null); return null; }
    const v = versRgb(couleur) || { r: 200, g: 200, b: 255 };
    const rgba = (a) => `rgba(${v.r},${v.g},${v.b},${a})`;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, rgba(1)); g.addColorStop(0.22, rgba(0.55)); g.addColorStop(0.45, rgba(0.16)); g.addColorStop(1, rgba(0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    if (halos.size > 64) halos.clear();
    halos.set(couleur, c); return c;
  }

  /**
   * Monte le graphe dans l'espace. `donnees` : celles de OdinGraph.mount ; `options` s'y ajoutent (onOpen, onReplier,
   * force, plein). Rend { el, replie, update(d), redessiner(), detacher() }.
   * Repli : opts.onReplier(boite, motif) s'il est donné, sinon le graphe 2D est monté à la place.
   */
  function mount(boite, donnees, options = {}) {
    const o = { ...(donnees || {}), ...(options || {}) };
    const replier = (motif) => {
      if (typeof o.onReplier === 'function') { o.onReplier(boite, motif); return { el: null, replie: true, motif, update() {}, redessiner() {}, detacher() {} }; }
      if (window.OdinGraph) { const g = window.OdinGraph.mount(boite, donnees || {}); return { el: g && g.el, replie: true, motif, g, update(d) { if (g && g.update) g.update(d); }, redessiner() { if (g && g.redessiner) g.redessiner(); }, detacher() {} }; }
      return { el: null, replie: true, motif, update() {}, redessiner() {}, detacher() {} };
    };
    const force = Boolean(o.force);
    const mouvementReduit = reducedMotion();
    if (doitReplier({ force, reducedMotion: mouvementReduit, webgl: force ? undefined : webglDispo() })) return replier('appareil');
    style();
    const cvs = el('canvas', { tabindex: '0', role: 'img' });
    const ctx = cvs.getContext && cvs.getContext('2d');
    if (!ctx) return replier('toile');

    const compteur = el('span', {}), aide = el('span', {}, T('aide'));
    const haut = el('div', { class: 'ge-haut' }, compteur, aide);
    const tip = el('div', { class: 'ge-tip', hidden: true });
    const sr = el('div', { class: 'ge-sr', role: 'list', 'aria-label': T('liste') });
    const leg = el('div', { class: 'ge-leg', 'aria-hidden': 'true' });
    const btn = (lab, sym, f) => el('button', { type: 'button', title: lab, 'aria-label': lab, onclick: f }, sym);
    // Zoomer (boutons, clavier, molette, pincée) : vers un endroit de l'écran (le milieu par défaut), borné d'après le
    // rayon du graphe. Une fois que la personne a zoomé, le cadrage automatique ne touche plus à la distance.
    const zoomer = (k, mx, my) => { vol = null; cam = zoomVers(cam, k, mx != null ? mx : larg / 2, my != null ? my : hautPx / 2, larg, hautPx, rayon); cadreParElle = true; toucher(); demander(); };
    const zbar = el('div', { class: 'ge-z' }, btn(T('plus'), '+', () => zoomer(0.8)), btn(T('moins'), '−', () => zoomer(1.25)), btn(T('recentrer'), '⟲', () => { cadreParElle = false; voler(null); }));
    const vide = el('div', { class: 'ge-vide', hidden: true }, T('vide'));
    const racine = el('div', { class: `ge${o.plein ? ' ge-plein' : ''}` }, cvs, haut, leg, zbar, tip, vide, sr);
    boite.replaceChildren(racine);

    // ---- État
    let G = { noeuds: [], liens: [], legende: [] }, P = [], parId = new Map(), points = [];
    let cam = cameraDepart(), vol = null, larg = 0, hautPx = 0, dpr = 1, niveau = 0, ciel = etoiles(NIVEAUX[0].etoiles);
    let fond = null, raf = 0, derniere = 0, dernierGeste = -1e9, moyenne = NaN, images = 0, choisi = null, survol = null, vivant = true;
    // rayon : celui du graphe placé (les bornes du zoom en dépendent) ; cadreParElle : la personne a zoomé ou volé
    // vers un point, le cadrage automatique (à la taille de la toile) ne change plus la distance.
    let rayon = 1, cadreParElle = false;
    const largeurs = new Map();
    /** La caméra de départ, cadrée sur la toile : tout le graphe tient dedans, en grand. */
    const departCadre = () => { const c = cameraDepart(); c.dist = cadrer(P, c, larg, hautPx); return c; };
    const recadrer = () => { if (cadreParElle || vol || !larg || !hautPx || !P.length) return; const c = departCadre(); cam.dist = c.dist; cam.cible = c.cible; };

    function charger(d, garder) {
      const avant = garder ? new Map(G.noeuds.map((nd, i) => [nd.id, P[i]])) : null;
      G = normaliser(d);
      const memes = avant && G.noeuds.length === avant.size && G.noeuds.every((nd) => avant.has(nd.id) && !nd.pos);
      P = memes ? G.noeuds.map((nd) => avant.get(nd.id)) : placer3D(G.noeuds, G.liens, { depart: avant || undefined, tours: avant && avant.size ? 60 : undefined });
      parId = new Map(G.noeuds.map((nd, i) => [nd.id, i]));
      rayon = rayonGraphe(P); recadrer();
      largeurs.clear();
      const nb = G.noeuds.length, nl = G.liens.length;
      compteur.textContent = typeof o.counter === 'function' ? String(o.counter(donneesBrutes.nodes || [], donneesBrutes.edges || [])) : `${nb} ${T('points')} · ${nl} ${T('liens')}`;
      cvs.setAttribute('aria-label', `${o.label ? `${o.label} — ` : ''}${T('graphe3d')} : ${nb} ${T('points')}, ${nl} ${T('liens')}.`);
      vide.hidden = nb > 0;
      // La légende : la couleur et le nom, écrits en texte.
      leg.replaceChildren(...G.legende.map(([c, n]) => { const i = el('i', {}); const cc = lumineuse(c) || String(c); i.style.background = cc; i.style.color = cc; return el('span', {}, i, String(n)); }));
      leg.hidden = !G.legende.length;
      // La liste pour le clavier et les lecteurs d'écran (un bouton par point).
      sr.replaceChildren(...G.noeuds.map((nd) => el('div', { role: 'listitem' }, el('button', { type: 'button', onclick: () => ouvrir(nd.id) }, nd.libelle || (nd.sub ? `${nd.label} — ${nd.sub}` : nd.label)))));
    }
    let donneesBrutes = o;
    charger(o, false);

    function taille() {
      const r = cvs.getBoundingClientRect();
      larg = Math.max(0, Math.round(r.width)); hautPx = Math.max(0, Math.round(r.height));
      dpr = Math.min(NIVEAUX[niveau].dprMax, (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio) || 1);
      cvs.width = Math.max(1, Math.round(larg * dpr)); cvs.height = Math.max(1, Math.round(hautPx * dpr));
      fond = null;
      recadrer();
    }

    function dessiner() {
      if (!larg || !hautPx) return;
      const t0 = maintenant();
      const N = NIVEAUX[niveau];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      // Le fond : un violet très sombre, plus clair au milieu.
      if (!fond) { fond = ctx.createRadialGradient(larg * 0.5, hautPx * 0.45, 0, larg * 0.5, hautPx * 0.5, Math.max(larg, hautPx) * 0.75); fond.addColorStop(0, '#1c1342'); fond.addColorStop(0.55, '#0e0a26'); fond.addColorStop(1, '#05040c'); }
      ctx.fillStyle = fond; ctx.fillRect(0, 0, larg, hautPx);
      // La poussière d'étoiles.
      if (N.etoiles) {
        ctx.fillStyle = '#d9d4ff';
        const camE = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, cible: { x: 0, y: 0, z: 0 } };
        for (let i = 0; i < ciel.length && i < N.etoiles; i++) {
          const s = ciel[i], p = projeter(s, camE, larg, hautPx);
          if (!p.visible || p.sx < 0 || p.sy < 0 || p.sx > larg || p.sy > hautPx) continue;
          ctx.globalAlpha = s.b * 0.55; ctx.fillRect(p.sx, p.sy, s.t, s.t);
        }
        ctx.globalAlpha = 1;
      }
      // Les points projetés.
      points = G.noeuds.map((nd, i) => {
        const p = projeter(P[i], cam, larg, hautPx);
        const taille = Math.max(1.6, Math.min(30, rayonPoint(nd.deg, nd.hub) * 0.0095 * p.echelle));
        // L'ordre des noms : le point choisi, celui sous le doigt, ceux en alerte (une panne a toujours son nom), les centres, les plus reliés.
        return { id: nd.id, nd, i, ...p, taille, groupe: nd.groupe, couleur: nd.couleur, prio: (nd.id === choisi ? 1000 : 0) + (nd.id === survol ? 900 : 0) + (nd.alerte ? 400 : 0) + (nd.hub ? 50 : 0) + nd.deg };
      });
      // Les liens : fins, de la couleur de leur point de départ, plus pâles au fond ; un seul tracé par couleur.
      ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1;
      const paquets = new Map();
      for (const l of G.liens) {
        const a = points[l.i], b = points[l.j]; if (!a.visible || !b.visible) continue;
        const prof = (a.prof + b.prof) / 2, fort = choisi && (l.a === choisi || l.b === choisi);
        const alpha = fort ? 0.85 : Math.max(0.07, Math.min(0.42, 0.42 + prof * 0.08));
        const cle = `${l.couleur || a.couleur}|${Math.round(alpha * 10)}|${l.dash ? l.dash.join(',') : ''}`;
        let q = paquets.get(cle); if (!q) { q = { c: l.couleur || a.couleur, a: Math.round(alpha * 10) / 10, dash: l.dash, s: [] }; paquets.set(cle, q); }
        q.s.push(a.sx, a.sy, b.sx, b.sy);
      }
      for (const q of paquets.values()) {
        ctx.strokeStyle = q.c; ctx.globalAlpha = q.a; if (ctx.setLineDash) ctx.setLineDash(q.dash || []);
        ctx.beginPath(); for (let k = 0; k < q.s.length; k += 4) { ctx.moveTo(q.s[k], q.s[k + 1]); ctx.lineTo(q.s[k + 2], q.s[k + 3]); } ctx.stroke();
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
      // Les points lumineux, du fond vers l'avant.
      const ordre = points.filter((p) => p.visible).sort((a, b) => a.prof - b.prof);
      // Un centre dense ne vire pas au blanc : l'intensité des halos baisse quand ils couvrent beaucoup de la toile.
      const kHalo = N.halo ? densiteHalo(ordre.map((p) => p.taille), larg, hautPx) : 1;
      for (const p of ordre) {
        const proche = Math.max(0.35, Math.min(1, 1.25 + p.prof * 0.12));
        ctx.globalAlpha = p.nd.off ? proche * 0.55 : proche;
        const h = N.halo ? halo(p.couleur) : null;
        if (h) { const r = rayonHalo(p.taille); ctx.globalAlpha *= 0.8 * kHalo; ctx.drawImage(h, p.sx - r, p.sy - r, r * 2, r * 2); }
        else { ctx.fillStyle = p.couleur; ctx.beginPath(); ctx.arc(p.sx, p.sy, p.taille, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      for (const p of ordre) {
        if (p.nd.alerte) { ctx.strokeStyle = '#FF6B5B'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.sx, p.sy, p.taille + 4, 0, Math.PI * 2); ctx.stroke(); }
        if (p.id === choisi || p.id === survol) { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, p.taille + 6, 0, Math.PI * 2); ctx.stroke(); }
      }
      // Les noms des groupes, en capitales et de leur couleur.
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 12px system-ui, sans-serif';
      // Posés en premier : leur zone est protégée, les noms des points l'évitent ; deux noms qui se toucheraient sont écartés.
      const titres = poserTitres(centresGroupes(ordre), (t) => ctx.measureText(t).width, larg, hautPx);
      for (const c of titres) {
        ctx.globalAlpha = 0.95; ctx.fillStyle = 'rgba(5,4,12,.7)'; ctx.fillText(c.texte, c.x + 1, c.y + 1);
        ctx.fillStyle = c.couleur; ctx.fillText(c.texte, c.x, c.y);
      }
      // Les noms des points, en petit, sans se recouvrir ni recouvrir les noms des groupes ; leur nombre suit la place.
      ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
      for (const p of ordre) if (!largeurs.has(p.id)) largeurs.set(p.id, ctx.measureText(nomCourt(p.nd.label)).width + 6);
      const retenus = poserEtiquettes(ordre, largeurs, nombreNoms(larg, hautPx, N.etiquettes), larg, hautPx, { occupes: titres });
      for (const r of retenus) {
        const p = points[parId.get(r.id)], t = nomCourt(p.nd.label);
        ctx.globalAlpha = r.id === choisi || r.id === survol ? 1 : Math.max(0.5, Math.min(0.92, 1.2 + p.prof * 0.12));
        ctx.textAlign = r.align;
        ctx.fillStyle = 'rgba(5,4,12,.6)'; ctx.fillText(t, r.x + 1, r.y + 1);
        ctx.fillStyle = '#F2F0FF'; ctx.fillText(t, r.x, r.y);
      }
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1;
      // Le budget de l'image : au-dessus, on simplifie (moins d'étoiles, plus de halo…), sans saccade.
      const ms = maintenant() - t0;
      moyenne = Number.isFinite(moyenne) ? moyenne * 0.85 + ms * 0.15 : ms;
      // (changer de niveau retaille la toile, qui s'efface : on redessine aussitôt, une fois)
      if (++images % 20 === 0) { const n2 = niveauDetail(moyenne, niveau); if (n2 !== niveau) { niveau = n2; taille(); dessiner(); } }
      return ms;
    }

    // ---- La boucle : seulement quand quelque chose bouge (vol, rotation lente, geste), jamais onglet caché.
    const ROTATION = 0.00006; // rad/ms : un tour en presque deux minutes
    const anime = () => Boolean(vol) || (!mouvementReduit && maintenant() - dernierGeste > 3500);
    let etaitBranche = false;
    // Retiré de la page (la page s'est redessinée) : on s'arrête et on se débranche tout seul. Vérifié à chaque image,
    // mais aussi quand la boucle ne tourne plus (hors de l'écran, onglet caché, moins de mouvement) : au retour de
    // l'onglet, au changement de visibilité ou de taille.
    function debranche() {
      if (!vivant) return true;
      if (racine.isConnected === true) { etaitBranche = true; return false; }
      if (racine.isConnected === false && etaitBranche) { detacher(); return true; }
      return false;
    }
    function boucle() {
      raf = 0;
      if (!vivant || debranche()) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (horsEcran) return;
      const t = maintenant(), dt = Math.min(64, derniere ? t - derniere : 16);
      // La rotation lente seule se contente de 30 images par seconde.
      const ips = vol || t - dernierGeste < 3500 ? NIVEAUX[niveau].ips : Math.min(30, NIVEAUX[niveau].ips);
      if (!vol && derniere && t - derniere < 1000 / ips - 2) { raf = prochaineImage(boucle); return; }
      derniere = t;
      if (vol) { const k = Math.min(1, (t - vol.t0) / vol.duree); cam = camEntre(vol.de, vol.vers, k); if (k >= 1) vol = null; }
      else if (!mouvementReduit && t - dernierGeste > 3500) cam.yaw += ROTATION * dt;
      dessiner();
      if (anime()) raf = prochaineImage(boucle);
      else derniere = 0;
    }
    function demander() { if (!raf && vivant) raf = prochaineImage(boucle); }
    // Après un geste, la rotation lente reprend d'elle-même quand on ne touche plus à rien.
    let reprise = 0;
    const toucher = () => {
      dernierGeste = maintenant();
      if (mouvementReduit) return;
      try { clearTimeout(reprise); } catch { /* rien */ }
      reprise = setTimeout(() => { if (vivant) { derniere = 0; demander(); } }, 3700);
    };

    /** Fait voler la caméra vers un point (ou vers la vue d'ensemble avec null). Sans animation si moins de mouvement. */
    function voler(id) {
      const i = id != null ? parId.get(id) : undefined;
      const vers = i === undefined ? departCadre() : { yaw: cam.yaw, pitch: cam.pitch, dist: borneDist(Math.min(cam.dist, 1.15 * rayon), rayon), cible: { ...P[i] } };
      if (i === undefined) { vers.yaw = cam.yaw; choisi = null; cadreParElle = false; } else { choisi = id; cadreParElle = true; }
      toucher();
      if (mouvementReduit) { cam = vers; vol = null; derniere = 0; dessiner(); return; }
      vol = { de: { ...cam, cible: { ...cam.cible } }, vers, t0: maintenant(), duree: 700 };
      derniere = 0; demander();
    }
    function ouvrir(id) { voler(id); if (typeof o.onOpen === 'function') o.onOpen(id); }

    // ---- Gestes : glisser pour tourner (deux axes), pincer ou molette pour zoomer, toucher pour aller vers un point.
    const doigts = new Map();
    let geste = null;
    const local = (e) => { const r = cvs.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const ecart = () => { const [a, b] = [...doigts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    cvs.addEventListener('pointerdown', (e) => {
      doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { cvs.setPointerCapture(e.pointerId); } catch { /* rien */ }
      toucher(); vol = null; aide.hidden = true;
      if (doigts.size === 2) geste = { pince: ecart(), bouge: true };
      else geste = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, bouge: false };
    });
    cvs.addEventListener('pointermove', (e) => {
      if (doigts.has(e.pointerId)) doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (geste) {
        toucher();
        if (doigts.size >= 2 && geste.pince) {
          // Pincer : zoom vers le milieu des deux doigts, pas à pas (l'écart précédent sert de référence).
          const e2 = ecart(), [a, b] = [...doigts.values()], r = cvs.getBoundingClientRect();
          zoomer(geste.pince / e2, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); geste.pince = e2; return;
        }
        if (!geste.bouge && Math.hypot(e.clientX - geste.x, e.clientY - geste.y) >= 6) { geste.bouge = true; cvs.classList.add('drag'); tip.hidden = true; }
        if (geste.bouge && geste.yaw != null) { cam.yaw = geste.yaw + (e.clientX - geste.x) * 0.008; cam.pitch = bornePitch(geste.pitch + (e.clientY - geste.y) * 0.008); demander(); }
        return;
      }
      const p = local(e), id = choisir(points, p.x, p.y, e.pointerType === 'mouse' ? 10 : 20);
      if (id !== survol) { survol = id; cvs.classList.toggle('on', id != null); demander(); }
      if (id != null) {
        const pt = points[parId.get(id)];
        tip.textContent = pt.nd.titre; tip.hidden = false;
        tip.style.left = `${Math.max(4, Math.min(larg - 220, pt.sx + 12))}px`; tip.style.top = `${Math.max(4, pt.sy - 34)}px`;
      } else tip.hidden = true;
    });
    const lacher = (e) => {
      doigts.delete(e.pointerId);
      if (!geste) return;
      const g = geste; if (doigts.size === 0) { geste = null; cvs.classList.remove('drag'); }
      else if (doigts.size === 1) { const [d] = [...doigts.values()]; geste = { x: d.x, y: d.y, yaw: cam.yaw, pitch: cam.pitch, bouge: true }; }
      if (e.type === 'pointerup' && !g.bouge && doigts.size === 0) {
        const p = local(e), id = choisir(points, p.x, p.y, e.pointerType === 'mouse' ? 10 : 20);
        if (id != null) ouvrir(id);
      }
      demander();
    };
    cvs.addEventListener('pointerup', lacher);
    cvs.addEventListener('pointercancel', lacher);
    cvs.addEventListener('pointerleave', () => { if (!geste) { tip.hidden = true; if (survol != null) { survol = null; demander(); } } });
    // Molette : un cran = ×0,9 au plus, vers le curseur.
    cvs.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomer(pasMolette(e.deltaY, e.deltaMode), p.x, p.y); }, { passive: false });
    cvs.addEventListener('keydown', (e) => {
      const k = e.key; let fait = true;
      if (k === 'ArrowLeft') cam.yaw -= 0.15; else if (k === 'ArrowRight') cam.yaw += 0.15;
      else if (k === 'ArrowUp') cam.pitch = bornePitch(cam.pitch - 0.12); else if (k === 'ArrowDown') cam.pitch = bornePitch(cam.pitch + 0.12);
      else if (k === '+' || k === '=') zoomer(0.8); else if (k === '-') zoomer(1.25);
      else if (k === '0') { voler(null); }
      else if ((k === 'Enter' || k === ' ') && survol != null) ouvrir(survol);
      else fait = false;
      if (fait) { e.preventDefault(); toucher(); vol = k === '0' ? vol : null; demander(); }
    });

    let obs = null, vu = null;
    try { if (typeof ResizeObserver === 'function') { obs = new ResizeObserver(() => { if (debranche()) return; taille(); dessiner(); demander(); }); obs.observe(cvs); } } catch { obs = null; }
    // Hors de l'écran : on ne dessine plus (le petit processeur est ménagé).
    let horsEcran = false;
    try { if (typeof IntersectionObserver === 'function') { vu = new IntersectionObserver((es) => { if (debranche()) return; horsEcran = !es.some((x) => x.isIntersecting); if (!horsEcran) demander(); }); vu.observe(racine); } } catch { vu = null; }
    const auRetour = () => { if (debranche()) return; if (!document.hidden && !horsEcran) { derniere = 0; demander(); } };
    document.addEventListener('visibilitychange', auRetour);
    function detacher() {
      vivant = false; if (raf) annulerImage(raf); raf = 0;
      try { clearTimeout(reprise); } catch { /* rien */ }
      try { if (obs) obs.disconnect(); } catch { /* rien */ }
      try { if (vu) vu.disconnect(); } catch { /* rien */ }
      document.removeEventListener('visibilitychange', auRetour);
      points = []; G = { noeuds: [], liens: [], legende: [] }; P = []; parId = new Map(); largeurs.clear();
    }

    // La première image : mesurée. Beaucoup trop lente même simplifiée → le graphe 2D (sauf si la personne a choisi le 3D).
    taille();
    let premiere = dessiner();
    // Trop lente en plein détail : on mesure l'image simplifiée, c'est elle qui décide du repli.
    if (typeof premiere === 'number' && premiere > 60) { niveau = NIVEAUX.length - 1; taille(); premiere = dessiner(); }
    if (doitReplier({ force, premiereImageMs: premiere })) { detacher(); return replier('lent'); }
    toucher(); demander();

    return {
      el: racine, replie: false,
      update(d) { donneesBrutes = { ...o, ...(d || {}) }; if (d && typeof d.onOpen === 'function') o.onOpen = d.onOpen; if (d && typeof d.counter === 'function') o.counter = d.counter; charger(donneesBrutes, true); dessiner(); demander(); },
      redessiner() { taille(); dessiner(); demander(); },
      voler: (id) => voler(id),
      detacher,
      etat: () => ({ niveau, cam: { ...cam, cible: { ...cam.cible } }, points: points.length, choisi }),
    };
  }

  /**
   * Le choix « Graphe | Graphe 3D » à côté d'un graphe, retenu par endroit (`cle`). `donnees` : celles de
   * OdinGraph.mount, données telles quelles au 3D. `defaut` : '2d' (par défaut) ou '3d'. `plein` : remplit son parent.
   * `monter2D(boite, d)` remplace OdinGraph.mount si besoin. Rend { el, vue(), basculer(v), update(d), redessiner(), detacher() }.
   */
  function choix(hote, o = {}) {
    style();
    const cle = `odin.graphe.vue.${o.cle || 'graphe'}`;
    const memo = lire(cle);
    let donnees = o.donnees || {}, ctrl = null, vue = vueInitiale(memo, o.defaut);
    // « Graphe 3D » choisi par la personne (et retenu) : il est respecté à chaque ouverture, comme un toucher.
    let parElle = memo === '3d';
    const b2 = el('button', { type: 'button', 'data-vue': '2d', 'aria-pressed': 'false', onclick: () => basculer('2d', true) }, T('graphe'));
    const b3 = el('button', { type: 'button', 'data-vue': '3d', 'aria-pressed': 'false', onclick: () => basculer('3d', true) }, T('graphe3d'));
    const seg = el('div', { class: 'ge-seg', role: 'group', 'aria-label': T('vue') }, b2, b3);
    const note = el('p', { class: 'ge-note', role: 'status', hidden: true });
    const boite = el('div', { class: 'ge-boite' });
    const racine = el('div', { class: `ge-choix${o.plein ? ' ge-plein' : ''}` }, el('div', { class: 'ge-bar' }, seg, note), boite);
    hote.replaceChildren(racine);
    const monter2D = typeof o.monter2D === 'function' ? o.monter2D : (b, d) => (window.OdinGraph ? window.OdinGraph.mount(b, d) : null);
    function peindre(force) {
      if (ctrl && ctrl.detacher) { try { ctrl.detacher(); } catch { /* rien */ } }
      ctrl = null; note.hidden = true; note.textContent = '';
      if (vue === '3d') {
        ctrl = mount(boite, donnees, { force, plein: o.plein, onReplier: () => { vue = '2d'; note.textContent = T('replie'); note.hidden = false; } });
        if (ctrl.replie) ctrl = monter2D(boite, donnees);
      } else ctrl = monter2D(boite, donnees);
      b2.setAttribute('aria-pressed', String(vue === '2d')); b3.setAttribute('aria-pressed', String(vue === '3d'));
    }
    function basculer(v, parLaPersonne) {
      vue = v === '3d' ? '3d' : '2d';
      if (parLaPersonne) { ecrire(cle, vue); parElle = vue === '3d'; }
      peindre(parElle);
    }
    peindre(parElle);
    return {
      el: racine,
      vue: () => vue,
      basculer: (v) => basculer(v, true),
      update(d) { donnees = d || donnees; if (ctrl && typeof ctrl.update === 'function') ctrl.update(donnees); else peindre(parElle); },
      redessiner() { if (ctrl && typeof ctrl.redessiner === 'function') ctrl.redessiner(); },
      detacher() { if (ctrl && ctrl.detacher) { try { ctrl.detacher(); } catch { /* rien */ } } },
    };
  }

  window.OdinGrapheEspace = { mount, choix, logique, TEXTES, textes: () => TEXTES[langueDe(aDocument ? langue() : 'en')] };
})();
