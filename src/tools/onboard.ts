// Outil machine_onboard : prendre la main sur une machine (Proxmox ou autre) avec le mot de passe que
// le propriétaire a donné dans la discussion. Le modèle ne voit jamais ni l'ancien ni le nouveau mot de passe.
//
// Le mot de passe donné est rangé au coffre avant le modèle (le tri de la passerelle) : le modèle met dans « password »
// la RÉFÉRENCE « coffre:Nom/mot de passe », et le serveur la remplace par la valeur juste avant l'outil
// (src/heimdall/executer.ts, liste fermée : src/heimdall/references-coffre.ts). Demande du propriétaire (19/11,
// section 86) : « c'est le serveur qui lui-même vient remplir ce mot de passe ».

import { setConfigValue } from '../config.ts';
import { accord } from '../core/genre.ts';
import { writeSecret } from '../settings.ts';
import { forgetSecret, onboardMachine, pendingSecretLabel, takeSecret } from '../machines/onboard.ts';
import { adminDiagnosis, adminMode, adminPassword, checkSudoPassword, installNopasswd, setAdminPassword } from '../machines/access.ts';
import { resumeVoiceInstall } from '../voice/local.ts';
import type { Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
/** Une référence restée telle quelle : l'outil a été lancé sans passer par Heimdall, le seul à la remplacer. */
const referenceNonRemplacee = (v: string) => /^\s*coffre:/i.test(v);
const PASSWORD = { type: 'string', description: 'la RÉFÉRENCE au coffre, jamais la valeur : « coffre:Nom/mot de passe » (le nom vu dans « [rangé au coffre : Nom — mot de passe] »)' };

export const machineOnboard: Tool = {
  name: 'machine_onboard',
  description: 'Prend la main sur une machine avec un mot de passe rangé au coffre : mets dans « password » sa référence « coffre:Nom/mot de passe » (le nom vu dans « [rangé au coffre : Nom — mot de passe] ») ; le serveur la remplace par la valeur juste avant l\'outil. Connexion SSH, installation de la clé SSH d\'Odin (vérifiée), jeton d\'API si c\'est un Proxmox (enregistré dans les réglages), puis changement du mot de passe (le nouveau est envoyé au propriétaire en message privé éphémère et gardé chiffré). Tu ne vois jamais les mots de passe. Utilise-le dès que le propriétaire te donne un mot de passe pour une machine.',
  risk: 'exec',
  schema: { type: 'object', properties: {
    host: { type: 'string', description: 'IP ou nom de la machine (ex. 192.168.1.102)' },
    user: { type: 'string', description: 'compte (root par défaut)' },
    password: PASSWORD,
    label: { type: 'string', description: 'nom lisible (ex. « Proxmox »)' },
    change_password: { type: 'boolean', description: 'changer le mot de passe après avoir vérifié la clé SSH (oui par défaut)' },
  }, required: ['host'] },
  summarize: (i) => `prendre la main sur ${s(i.user) || 'root'}@${s(i.host)} : clé SSH d'Odin, jeton Proxmox si besoin${i.change_password === false ? '' : ', nouveau mot de passe envoyé en privé'}`,
  async run(i, ctx) {
    if (!ctx.home || !ctx.paths) return 'Coffre indisponible.';
    if (referenceNonRemplacee(s(i.password))) return 'La référence au coffre n\'a pas été remplacée par le serveur : je ne m\'en sers pas.';
    // La valeur du coffre (remplacée par le serveur) ; sinon, l'ancien rangement d'une heure (pending-secret).
    const password = s(i.password) || takeSecret(ctx.home);
    if (!password) return 'Je n\'ai pas de mot de passe : demande-le au propriétaire (il sera rangé au coffre), puis donne-moi sa référence dans « password » : « coffre:Nom/mot de passe ».';
    const r = await onboardMachine(ctx.home, { host: s(i.host).trim(), user: s(i.user).trim() || 'root', password, label: s(i.label).trim() || undefined, changePassword: i.change_password !== false, signal: ctx.signal });
    if (!r.ok) return r.steps.join('\n');
    forgetSecret(ctx.home);
    if (r.proxmox) {
      setConfigValue(ctx.paths, ['proxmox'], { url: r.proxmox.url });
      if (ctx.careCfg) ctx.careCfg.proxmox.url = r.proxmox.url;
      writeSecret(ctx.paths, 'PROXMOX_TOKEN', r.proxmox.token); ctx.redactor.add(r.proxmox.token);
    }
    if (r.newPassword) {
      ctx.redactor.add(r.newPassword);
      // Envoi direct au propriétaire, sans passer par le modèle : message éphémère (masqué, effacé ensuite).
      const msg = `🔑 Nouveau mot de passe de ${r.machine?.user}@${r.machine?.host} (${r.machine?.label}) :\n${r.newPassword}\n\nGarde-le dans ton gestionnaire de mots de passe : ce message s'effacera dans 10 minutes. Odin, lui, se connecte avec sa clé SSH.`;
      if (ctx.send) await ctx.send(ctx.channel, ctx.peer, msg, { secret: true }).catch(() => r.steps.push('(l\'envoi du nouveau mot de passe a échoué : il est dans le coffre, Réglages → Droits et machines)'));
    }
    return r.steps.join('\n');
  },
};

export const adminEnable: Tool = {
  name: 'admin_enable',
  description: 'Rend Odin administrateur de SA machine (celle où il est installé), pour de bon : vérifie le mot de passe de session que le propriétaire vient de donner (rangé au coffre : mets sa référence « coffre:Nom/mot de passe » dans « password », le serveur la remplace par la valeur juste avant l\'outil), puis installe une règle sudo sans mot de passe (vérifiée par visudo). Sans mot de passe, essaie avec les droits déjà disponibles. À utiliser dès que le propriétaire veut que tu agisses en administrateur ici.',
  risk: 'exec',
  schema: { type: 'object', properties: { password: PASSWORD }, required: [] },
  summarize: () => 'devenir administrateur de cette machine (règle sudo sans mot de passe, vérifiée par visudo)',
  async run(i, ctx) {
    if (!ctx.home) return 'Coffre indisponible.';
    if (referenceNonRemplacee(s(i?.password))) return 'La référence au coffre n\'a pas été remplacée par le serveur : je ne m\'en sers pas.';
    const mode = adminMode(ctx.home);
    const resume = () => (resumeVoiceInstall((msg) => void ctx.send?.(ctx.channel, ctx.peer, msg).catch(() => undefined), ctx.home) ? ' Je relance l\'installation de l\'écoute, qui attendait ces droits : je te préviens quand c\'est prêt.' : '');
    if (mode === 'root' || mode === 'nopasswd') return `Je suis déjà ${accord('administrateur', 'administratrice')} de cette machine : rien à faire.${resume()}`;
    // Service verrouillé, sudo absent, Windows non élevé : un mot de passe n'y changerait rien. La vraie cause, et la commande exacte.
    if (mode === 'absent' || mode === 'blocked') { const d = adminDiagnosis(ctx.home); return `Je ne peux pas devenir ${accord('administrateur', 'administratrice')} moi-même ici : ${d.state}.\n${d.fix}`; }
    // La valeur du coffre (remplacée par le serveur) ; sinon l'ancien rangement d'une heure, ou le mot de passe déjà gardé.
    const pw = s(i?.password) || takeSecret(ctx.home) || adminPassword(ctx.home);
    if (!pw) return 'Il me faut une seule fois le mot de passe de ta session sur cette machine : écris « le mot de passe admin de ce poste est … » (il ne sera ni affiché ni lu par l\'IA), et je m\'occupe du reste.';
    const c = checkSudoPassword(pw, ctx.home);
    if (!c.ok) return `Ce mot de passe ne marche pas pour sudo : ${c.message}.`;
    forgetSecret(ctx.home);
    setAdminPassword(ctx.home, pw); // repli si la règle ne peut pas être posée
    const r = installNopasswd(ctx.home, pw);
    return (r.ok ? `${r.message} Je peux désormais tout faire sur ce poste (installer, configurer, redémarrer des services). Pour revenir en arrière : sudo rm /etc/sudoers.d/odin.` : `Mot de passe vérifié et gardé chiffré : sudo marchera avec. (La règle permanente n'a pas pu être posée : ${r.message}.)`) + resume();
  },
};

/** Le mot de passe donné vise-t-il CE poste (session, sudo, admin…) plutôt qu'une autre machine ? */
export const isLocalAdminLabel = (label: string) => /admin|sudo|session|poste|pc|ordi|ordinateur|ce serveur|cette machine|local|compte|linux|mac/i.test(label) && !/\b(?:\d{1,3}\.){3}\d{1,3}\b|proxmox|nas|box|routeur/i.test(label);

/** Ligne pour le prompt : un mot de passe attend d'être utilisé (l'ancien rangement d'une heure, hors du tri de l'entrée). */
export function pendingSecretHint(home: string): string | undefined {
  const l = pendingSecretLabel(home);
  if (!l) return undefined;
  return isLocalAdminLabel(l)
    ? `Le propriétaire t'a donné le mot de passe de SA machine (${l}), gardé à part : appelle admin_enable tout de suite, sans « password », pour devenir administrateur de ce poste (sauf s'il parle clairement d'une autre machine : alors machine_onboard).`
    : `Le propriétaire t'a donné un mot de passe (${l}), gardé à part : utilise machine_onboard, sans « password », pour prendre la main sur la machine concernée (ou admin_enable si c'est le mot de passe de ce poste). Ne lui demande pas de le changer ni de ne pas le partager : c'est toi qui t'en occupes.`;
}
