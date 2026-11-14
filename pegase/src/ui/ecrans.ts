// Les écrans avant le navigateur : démarrage (logo et 3 points), 1er lancement, connexion.
import type { Etat } from '../commun/types';
import { LOGO, type Ctx } from './commun';

let dernier = '';
export function rendreEcran(E: Etat, _ctx: Ctx): void {
  const el = document.getElementById('ecran')!;
  const cle = E.ecran;
  if (cle === dernier) return;
  dernier = cle;
  if (cle === 'navigateur') { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="ecran" role="status" aria-label="Pégase démarre"><div>${LOGO(112)}<div class="trois-points" aria-hidden="true"><span></span><span></span><span></span></div></div></div>`;
}
