// Domaine « voix et texte » : répondre à la voix quand c'est possible et le dire honnêtement sinon ; suivre qui parle
// (un membre n'a pas les droits du propriétaire). Aucune voix n'est installée dans l'Odin jetable (ODIN_NO_VOICE_INSTALL).
import { ok, ouvrir, type Scenario } from './banc.ts';

export const VOIX: Scenario[] = [
  {
    id: 'voix-dire-sans-moteur', domaine: 'voix', partie: 'sans-modele', exigence: 'D (répondre à la voix), honnêteté',
    titre: 'Orphée « dire bonjour » sans moteur de voix installé', attendu: 'l\'action ne prétend pas avoir parlé',
    async jouer() {
      const s = await ouvrir({ applis: true });
      try {
        const { valhallaOf } = await import('../../src/valhalla/odin.ts');
        const v = valhallaOf();
        if (!v) return ok(false, 'applis non démarrées');
        let texte = '';
        try { const r = await v.act('bragi', 'dire', { texte: 'bonjour', text: 'bonjour' }, { by: 'toi' } as never) as { text?: string }; texte = String(r?.text ?? JSON.stringify(r)); } catch (e) { texte = `erreur : ${(e as Error).message}`; }
        const pretend = /^(✅|dit|j'ai dit)/i.test(texte.trim());
        return ok(!pretend, texte.slice(0, 120));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'voix-vocal-transcrit', domaine: 'voix', partie: 'sans-modele', exigence: 'demande n° 7 (lui parler à la voix)', nature: 'discutable', // le texte arrive déjà transcrit : la voix n'est pas essayée
    titre: 'un message arrivé en vocal (déjà transcrit) est traité comme le texte', attendu: 'même réponse sans IA qu\'à l\'écrit',
    async jouer() {
      const s = await ouvrir({ applis: true });
      try {
        const n0 = s.envoyes.length;
        const r = await s.dire('qui est connecté sur le VPN ?', 'moi', true);
        return ok(r.appelsModele === 0 && /Vortex/.test(r.texte) && s.envoyes.length > n0, r.texte.split('\n')[0].slice(0, 90));
      } finally { s.fermer(); }
    },
  },
  {
    id: 'voix-membre-fiche', domaine: 'voix', partie: 'sans-modele', exigence: 'élément 3 (crit. 5), demande n° 7', nature: 'pas-code',
    titre: 'un membre demande « qu\'est-ce que tu sais sur Alex ? »', attendu: 'refus poli, sans IA',
    async jouer() {
      const s = await ouvrir();
      try {
        s.o.muninn.remember('Le propriétaire s\'appelle Alex et travaille à Mamoudzou.', 'owner', 'fact', '', { subject: 'proprietaire' });
        const lea = s.o.muninn.saveUser({ name: 'Léa', role: 'member' }); s.o.muninn.linkIdentity('controle', 'lea', lea.id);
        const r = await s.dire('qu\'est-ce que tu sais sur Alex ?', 'lea');
        const fuite = /Mamoudzou/.test(r.texte) || /Mamoudzou/.test(s.contexte());
        return ok(r.appelsModele === 0 && !fuite, `${r.appelsModele ? 'passé au modèle' : 'sans IA'} ; la fiche du propriétaire ${fuite ? 'EST dans ce que voit le membre ou le modèle' : 'n\'est pas montrée'}`);
      } finally { s.fermer(); }
    },
  },
  {
    id: 'voix-membre-pas-proprio', domaine: 'voix', partie: 'sans-modele', exigence: 'demande n° 7 (droits de qui parle)',
    titre: 'Odin sait qui parle : un membre n\'est pas le propriétaire', attendu: 'le membre est reconnu « member »',
    async jouer() {
      const { Gateway } = await import('../../src/bifrost/gateway.ts');
      const s = await ouvrir();
      try {
        const lea = s.o.muninn.saveUser({ name: 'Léa', role: 'member' }); s.o.muninn.linkIdentity('controle', 'lea', lea.id);
        const gw = new Gateway(s.o, { owners: { controle: ['moi'] } });
        return ok(gw.speakerOf('controle', 'lea').role === 'member' && gw.speakerOf('controle', 'moi').role === 'owner', `lea : ${gw.speakerOf('controle', 'lea').role} ; moi : ${gw.speakerOf('controle', 'moi').role}`);
      } finally { s.fermer(); }
    },
  },
];
