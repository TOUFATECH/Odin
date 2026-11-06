// Outil machine_onboard : prendre la main sur une machine (Proxmox ou autre) avec le mot de passe que
// le propriétaire a donné dans la discussion. Le modèle ne voit jamais ni l'ancien ni le nouveau mot de passe.

import { setConfigValue } from '../config.ts';
import { writeSecret } from '../settings.ts';
import { forgetSecret, onboardMachine, pendingSecretLabel, takeSecret } from '../machines/onboard.ts';
import { adminMode, adminPassword, checkSudoPassword, installNopasswd, setAdminPassword } from '../machines/access.ts';
import type { Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');

export const machineOnboard: Tool = {
  name: 'machine_onboard',
  description: 'Prend la main sur une machine avec le mot de passe que le propriétaire vient de donner (référence secret:dernier) : connexion SSH, installation de la clé SSH d\'Odin (vérifiée), jeton d\'API si c\'est un Proxmox (enregistré dans les réglages), puis changement du mot de passe (le nouveau est envoyé au propriétaire en message privé éphémère et gardé chiffré). Tu ne vois jamais les mots de passe. Utilise-le dès que le propriétaire te donne un mot de passe pour une machine.',
  risk: 'exec',
  schema: { type: 'object', properties: {
    host: { type: 'string', description: 'IP ou nom de la machine (ex. 192.168.1.102)' },
    user: { type: 'string', description: 'compte (root par défaut)' },
    label: { type: 'string', description: 'nom lisible (ex. « Proxmox »)' },
    change_password: { type: 'boolean', description: 'changer le mot de passe après avoir vérifié la clé SSH (oui par défaut)' },
  }, required: ['host'] },
  summarize: (i) => `prendre la main sur ${s(i.user) || 'root'}@${s(i.host)} : clé SSH d'Odin, jeton Proxmox si besoin${i.change_password === false ? '' : ', nouveau mot de passe envoyé en privé'}`,
  async run(i, ctx) {
    if (!ctx.home || !ctx.paths) return 'Coffre indisponible.';
    const password = takeSecret(ctx.home);
    if (!password) return 'Je n\'ai pas de mot de passe en attente (il expire au bout d\'une heure). Demande au propriétaire de me le redonner : « le mot de passe root de 192.168.1.102 est … ».';
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
  description: 'Rend Odin administrateur de SA machine (celle où il est installé), pour de bon : vérifie le mot de passe de session que le propriétaire vient de donner (secret:dernier), puis installe une règle sudo sans mot de passe (vérifiée par visudo). Sans mot de passe en attente, essaie avec les droits déjà disponibles. À utiliser dès que le propriétaire veut que tu agisses en administrateur ici.',
  risk: 'exec',
  schema: { type: 'object', properties: {}, required: [] },
  summarize: () => 'devenir administrateur de cette machine (règle sudo sans mot de passe, vérifiée par visudo)',
  async run(_i, ctx) {
    if (!ctx.home) return 'Coffre indisponible.';
    const mode = adminMode(ctx.home);
    if (mode === 'root' || mode === 'nopasswd') return 'Je suis déjà administrateur de cette machine : rien à faire.';
    if (mode === 'absent') return process.platform === 'win32' ? 'Windows : il faut lancer Odin depuis une session administrateur (clic droit → Exécuter en tant qu\'administrateur, ou service installé en administrateur).' : 'sudo est absent : installe-le (en root : apt install sudo), ou lance Odin en root.';
    const pw = takeSecret(ctx.home) ?? adminPassword(ctx.home);
    if (!pw) return 'Il me faut une seule fois le mot de passe de ta session sur cette machine : écris « le mot de passe admin de ce poste est … » (il ne sera ni affiché ni lu par l\'IA), et je m\'occupe du reste.';
    const c = checkSudoPassword(pw, ctx.home);
    if (!c.ok) return `Ce mot de passe ne marche pas pour sudo : ${c.message}.`;
    forgetSecret(ctx.home);
    setAdminPassword(ctx.home, pw); // repli si la règle ne peut pas être posée
    const r = installNopasswd(ctx.home, pw);
    return r.ok ? `${r.message} Je peux désormais tout faire sur ce poste (installer, configurer, redémarrer des services). Pour revenir en arrière : sudo rm /etc/sudoers.d/odin.` : `Mot de passe vérifié et gardé chiffré : sudo marchera avec. (La règle permanente n'a pas pu être posée : ${r.message}.)`;
  },
};

/** Le mot de passe donné vise-t-il CE poste (session, sudo, admin…) plutôt qu'une autre machine ? */
export const isLocalAdminLabel = (label: string) => /admin|sudo|session|poste|pc|ordi|ordinateur|ce serveur|cette machine|local|compte|linux|mac/i.test(label) && !/\b(?:\d{1,3}\.){3}\d{1,3}\b|proxmox|nas|box|routeur/i.test(label);

/** Ligne pour le prompt : un mot de passe attend d'être utilisé. */
export function pendingSecretHint(home: string): string | undefined {
  const l = pendingSecretLabel(home);
  if (!l) return undefined;
  return isLocalAdminLabel(l)
    ? `Le propriétaire t'a donné le mot de passe de SA machine (${l}), gardé à part : référence secret:dernier. Appelle admin_enable tout de suite pour devenir administrateur de ce poste (sauf s'il parle clairement d'une autre machine : alors machine_onboard).`
    : `Le propriétaire t'a donné un mot de passe (${l}), gardé à part : référence secret:dernier. Utilise machine_onboard pour prendre la main sur la machine concernée (ou admin_enable si c'est le mot de passe de ce poste). Ne lui demande pas de le changer ni de ne pas le partager : c'est toi qui t'en occupes.`;
}
