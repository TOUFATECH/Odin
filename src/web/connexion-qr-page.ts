// La page du téléphone après avoir scanné le QR code d'un écran (connexion par QR code, voir connexion-qr.ts) :
// elle dit quel écran demande à entrer (appareil, adresse, appli) et au nom de qui, puis « Autoriser » ou « Refuser ».
// Le téléphone doit déjà être connecté à Odin : sinon, la page le dit et mène à l'écran de connexion.
import { CIEL_JS } from './ciel.ts';

export function pageConnexionQr(nonce: string, mascot: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Connecter un écran · Odin</title>
<style>
:root{--panel:#fff;--ink:#1c1f24;--muted:#4b5563;--line:#d1d5db;--accent:#2563eb;--bad:#b91c1c;--ok:#166534}
@media (prefers-color-scheme:dark){:root{--panel:#23262c;--ink:#f3f4f6;--muted:#c3c7ce;--line:#3f444c;--accent:#3b82f6;--bad:#fca5a5;--ok:#86efac}}
*{box-sizing:border-box}html,body{background:#000}body{margin:0;color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ciel{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
main{position:relative;z-index:1;max-width:440px;width:calc(100% - 24px);margin:16px auto 24px;padding:24px 16px 28px;display:flex;flex-direction:column;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:20px}
.m{width:72px;height:72px;margin:0 auto}.m svg{width:100%;height:100%}.m .orbit{display:none}
h1{margin:4px 0 0;font-size:22px;text-align:center}p{margin:0;line-height:1.5;color:var(--muted)}.c{text-align:center}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;padding:12px;border:1px solid var(--line);border-radius:12px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
.b{display:grid;grid-template-columns:1fr 1fr;gap:10px}
button,a.btn{min-height:52px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:16px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none}
button.ok{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.6}
.err{color:var(--bad);font-size:15px;text-align:center}.err:empty{display:none}.fait{color:var(--ok);font-weight:600;text-align:center;font-size:18px}
</style></head><body><canvas class="ciel" aria-hidden="true"></canvas><main>
<div class="m" aria-hidden="true">${mascot}</div>
<h1>Connecter un écran</h1>
<p class="c" id="intro">Lecture de la demande…</p>
<dl id="info" hidden><dt>Écran</dt><dd id="app"></dd><dt>Adresse</dt><dd id="ip"></dd><dt>Appli</dt><dd id="appli"></dd><dt>Au nom de</dt><dd id="qui"></dd></dl>
<p class="c" id="avert" hidden>Autorise seulement si c'est toi qui viens de scanner ce QR code, devant cet écran.</p>
<div class="b" id="choix" hidden><button type="button" id="non">Refuser</button><button type="button" class="ok" id="oui">Autoriser</button></div>
<a class="btn" id="seco" href="/" hidden>Se connecter à Odin sur ce téléphone</a>
<p class="err" id="err" role="alert"></p>
<p class="fait" id="fait" role="status" hidden></p>
</main><script nonce="${nonce}">
const $ = (s) => document.querySelector(s);
const c = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(b) }).then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })).catch(() => ({ ok: false, error: 'Odin ne répond pas.' }));
(async () => {
  if (!c) { $('#intro').textContent = 'Il manque le code : scanne à nouveau le QR code de l\\'écran.'; return; }
  const r = await post('/api/connexion-qr/voir', { c });
  if (r.status === 401) { $('#intro').textContent = 'Ce téléphone n\\'est pas connecté à Odin. Connecte-toi d\\'abord, puis scanne à nouveau le QR code de l\\'écran.'; $('#seco').hidden = false; return; }
  if (!r.ok) { $('#intro').textContent = r.error || 'Demande introuvable ou expirée : scanne à nouveau le QR code.'; return; }
  const d = r.demande;
  $('#intro').textContent = 'Un écran demande à entrer dans Odin.';
  $('#app').textContent = d.appareil; $('#ip').textContent = d.ip; $('#appli').textContent = d.appli || 'Interface d\\'Odin'; $('#qui').textContent = r.qui;
  $('#info').hidden = false;
  if (d.etat !== 'attente') { $('#fait').hidden = false; $('#fait').textContent = d.etat === 'ok' ? 'Déjà autorisé.' : 'Déjà refusé.'; return; }
  $('#avert').hidden = false; $('#choix').hidden = false;
  const decider = async (ok) => {
    $('#oui').disabled = $('#non').disabled = true;
    const x = await post('/api/connexion-qr/decider', { c, ok });
    if (!x.ok) { $('#err').textContent = x.error || 'Impossible.'; $('#oui').disabled = $('#non').disabled = false; return; }
    $('#choix').hidden = true; $('#avert').hidden = true; $('#fait').hidden = false;
    $('#fait').textContent = ok ? 'C\\'est autorisé : l\\'écran s\\'ouvre (si tu as le droit d\\'entrer dans cette appli).' : 'Refusé : l\\'écran reste fermé.';
  };
  $('#oui').addEventListener('click', () => decider(true)); $('#non').addEventListener('click', () => decider(false));
})();
</script><script nonce="${nonce}">${CIEL_JS}</script></body></html>`;
}
