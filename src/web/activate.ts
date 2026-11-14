// La page du téléphone pour la première connexion à Odin (comme l'activation d'une télé) : l'écran de
// l'ordinateur montre un code et un QR code ; ici, on tape le code (ou il est déjà rempli par le QR code),
// puis prénom, nom, e-mail et mot de passe. L'ordinateur s'ouvre tout seul sur Odin dès que c'est fait.
import { CIEL_JS } from './ciel.ts';

// Fond : le ciel noir étoilé des écrans d'accueil (ciel.js), le formulaire sur une carte par-dessus.
export function activationPage(nonce: string, mascot: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Activer Odin</title>
<style>
:root{--bg:#f4f5f7;--panel:#fff;--ink:#1c1f24;--muted:#4b5563;--line:#d1d5db;--accent:#2563eb;--bad:#b91c1c;--ok:#166534}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--panel:#23262c;--ink:#f3f4f6;--muted:#c3c7ce;--line:#3f444c;--accent:#3b82f6;--bad:#fca5a5;--ok:#86efac}}
*{box-sizing:border-box}html,body{background:#000}body{margin:0;color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ciel{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
main{position:relative;z-index:1;max-width:440px;width:calc(100% - 24px);margin:16px auto 24px;padding:24px 16px 32px;display:flex;flex-direction:column;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.55)}
.m{width:84px;height:84px;margin:0 auto;animation:f 4s ease-in-out infinite}@keyframes f{50%{transform:translateY(-6px)}}@media (prefers-reduced-motion:reduce){.m{animation:none}}
.m svg{width:100%;height:100%}.m .orbit{display:none}
h1{margin:4px 0 0;font-size:24px;text-align:center}p{margin:0;line-height:1.5;color:var(--muted)}.c{text-align:center}
label{font-size:14px;font-weight:600}input{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:0 14px;font-size:16px}
#code{font-size:24px;letter-spacing:.2em;text-transform:uppercase;text-align:center;font-weight:700}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.row>div{display:flex;flex-direction:column;gap:6px}@media (max-width:360px){.row{grid-template-columns:1fr}}
button{min-height:52px;border-radius:12px;border:0;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer}button:disabled{opacity:.6}
.err{color:var(--bad);font-size:14px}.err:empty{display:none}.ok{color:var(--ok);font-weight:600;text-align:center;font-size:18px}
form{display:flex;flex-direction:column;gap:8px}
</style></head><body><canvas class="ciel" aria-hidden="true"></canvas><main>
<div class="m" aria-hidden="true">${mascot}</div>
<h1>Créer ton compte Odin</h1>
<p class="c">L'écran d'Odin attend : dès que c'est fait, il s'ouvre tout seul.</p>
<form id="f" novalidate>
<label for="code">Code affiché sur l'écran</label><input id="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="8" required>
<div class="row"><div><label for="pn">Prénom</label><input id="pn" autocomplete="given-name" maxlength="60" required></div><div><label for="nm">Nom</label><input id="nm" autocomplete="family-name" maxlength="60" required></div></div>
<label for="em">Adresse e-mail</label><input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" required>
<label for="pw">Mot de passe (10 caractères au moins)</label><input id="pw" type="password" autocomplete="new-password" minlength="10" maxlength="200" required>
<label for="pw2">Confirme le mot de passe</label><input id="pw2" type="password" autocomplete="new-password" maxlength="200" required>
<span class="err" id="err" role="alert"></span>
<button id="go" type="submit">Créer et ouvrir Odin sur l'écran</button>
<p class="c" style="font-size:13px">Tes identifiants restent sur la machine d'Odin. Le mot de passe n'y est jamais gardé en clair.</p>
</form>
<p class="ok" id="done" hidden role="status">C'est fait ! L'écran d'Odin s'ouvre. Ce téléphone est connecté aussi.</p>
</main><script nonce="${nonce}">
const $ = (s) => document.querySelector(s);
const c = new URLSearchParams(location.search).get('c'); if (c) $('#code').value = c.toUpperCase();
setTimeout(() => (c ? $('#pn') : $('#code')).focus(), 60);
for (const i of document.querySelectorAll('input')) i.addEventListener('input', () => { $('#err').textContent = ''; });
$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = { code: $('#code').value.trim(), prenom: $('#pn').value.trim(), nom: $('#nm').value.trim(), email: $('#em').value.trim(), password: $('#pw').value };
  const err = v.code.length < 6 ? 'Tape le code affiché sur l\\'écran d\\'Odin.' : !v.prenom ? 'Indique ton prénom.' : !v.nom ? 'Indique ton nom.' : !/^[^\\s@]+@[^\\s@]+\\.[^\\s@.]{2,}$/.test(v.email) ? 'Cette adresse e-mail n\\'a pas la bonne forme.' : v.password.length < 10 ? 'Le mot de passe doit faire au moins 10 caractères.' : v.password !== $('#pw2').value ? 'Les deux mots de passe ne sont pas identiques.' : '';
  if (err) { $('#err').textContent = err; return; }
  $('#go').disabled = true;
  const r = await fetch('/api/account/create', { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(v) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Odin ne répond pas.' }));
  if (!r.ok) { $('#err').textContent = r.error || 'Création impossible.'; $('#go').disabled = false; return; }
  $('#f').hidden = true; $('#done').hidden = false; setTimeout(() => location.replace('/'), 2500);
});
</script><script nonce="${nonce}">${CIEL_JS}</script></body></html>`;
}
