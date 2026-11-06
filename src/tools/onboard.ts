// Outil machine_onboard : prendre la main sur une machine (Proxmox ou autre) avec le mot de passe que
// le propriétaire a donné dans la discussion. Le modèle ne voit jamais ni l'ancien ni le nouveau mot de passe.

import { setConfigValue } from '../config.ts';
import { writeSecret } from '../settings.ts';
import { forgetSecret, onboardMachine, pendingSecretLabel, takeSecret } from '../machines/onboard.ts';
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

/** Ligne pour le prompt : un mot de passe attend d'être utilisé. */
export function pendingSecretHint(home: string): string | undefined {
  const l = pendingSecretLabel(home);
  return l ? `Le propriétaire t'a donné un mot de passe (${l}), gardé à part : référence secret:dernier. Utilise machine_onboard pour prendre la main sur la machine concernée. Ne lui demande pas de le changer ni de ne pas le partager : c'est toi qui le changes.` : undefined;
}
