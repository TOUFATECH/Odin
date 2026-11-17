// Orphée — la voix d'Odin réunie en un module : comprendre, parler, annoncer sur les enceintes de la maison (Stentor)
// et dire une alerte à voix haute partout (Triton). Réutilise src/voice (pas de doublon).
// Depuis le 17/11/2026, Odin n'utilise aucun modèle qui ne soit pas le sien : ni Whisper, ni ElevenLabs, ni Piper, ni
// la synthèse vocale de Home Assistant. Écouter, parler et annoncer répondent « pas encore » tant que les modèles
// d'écoute et de voix d'Odin ne sont pas entraînés ; le reste (ordre écrit, mots appris, projet actif) marche.

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { ModelePasEntraine, pasEntraine } from '../../langue/pas-entraine.ts';
import { audioKind, hear, listVoices, speakAudio, sttReady, ttsIsLocal, ttsReady, type VoiceConfig } from '../../voice/voice.ts';
import { indexerProjet, projetActif, repondreProjet } from '../../muninn/projet.ts';
import { audiosGardes, purgerAudio } from '../../voice/audio-brut.ts';
import { orphee } from '../../voice/orphee.ts';
import { apprendreVoix, corrigerVoix, vocabulaire } from '../huginn-voix.ts';
import type { ModCtx, Module } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
/** Un son fabriqué par « Dire » : l'heure de sa fabrication et son format, rien d'autre. */
const AUDIO = /^odin-(\d{10,16})\.(wav|mp3|ogg|m4a|webm)$/;
/** Le fichier d'un son fabriqué par « Dire » (dossier d'Orphée donné), s'il existe : rien d'autre ne sort par là. */
export function sonDit(dossierOrphee: string, ref: string): string | undefined { const f = AUDIO.test(ref) ? join(dossierOrphee, 'audio', ref) : ''; return f && existsSync(f) && statSync(f).isFile() ? f : undefined; }
const MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.flac': 'audio/flac' };

/** Annoncer sur les enceintes passait par la synthèse vocale de Home Assistant (un modèle d'autrui) : pas encore. */
async function announce(_ctx: ModCtx, _message: string, _where?: string): Promise<string> {
  throw new ModelePasEntraine('annoncer');
}

export function bragi(voice: () => VoiceConfig): Module {
  const m: Module = {
    id: 'bragi', name: 'Orphée', family: 'Maison',
    what: 'La voix d\'Odin : comprendre ce que tu dis, parler, annoncer sur les enceintes.',
    does: ['comprendre les vocaux, parler, annoncer sur les enceintes, converser en direct : à venir, avec les modèles d\'écoute et de voix d\'Odin (pas encore entraînés)', 'ordre écrit : compris sans IA et confié à la bonne appli', 'Logos pour la voix : corrige les mots mal entendus d\'après leur prononciation et retient tes corrections', 'projet actif : répond sans IA à partir des fichiers d\'un projet, en citant la source'],
    from: ['Home Assistant Assist', 'Rhasspy', 'Wyoming', 'Piper', 'Whisper', 'openWakeWord'], upstream: ['rhasspy/piper', 'openai/whisper', 'rhasspy/wyoming'],
    modes: ['Stentor · annonces', 'Triton · alertes à voix haute'],
    words: ['voix', 'parle', 'dis', 'annonce', 'enceinte', 'haut-parleur', 'transcris', 'transcription', 'vocal', 'audio', 'lis a voix haute', 'lis à voix haute'],
    // Un fichier audio envoyé depuis le navigateur pour être transcrit arrive dans « depots » (copie effacée après la transcription).
    depot: (ctx) => ({ dossier: join(ctx.dir, 'depots'), ref: (nom) => join(ctx.dir, 'depots', nom) }),
    // Un son fabriqué par « Dire » peut être remis à l'appareil ; rien d'autre du dossier d'Orphée ne sort par là.
    retrait: (ctx, ref) => sonDit(ctx.dir, ref),
    actions: [
      { id: 'etat', label: 'État de la voix', what: 'Ce qui est prêt', read: true, run: () => { const v = voice(); return { text: `Comprendre : ${sttReady(v) ? 'prêt' : pasEntraine('ecouter', v.stt.language)}\nParler : ${ttsReady(v) ? `prêt (${v.tts.provider}${ttsIsLocal(v) ? ', sur la machine' : ', en ligne'})` : pasEntraine('parler', v.stt.language)}` }; } },
      { id: 'dire', label: 'Dire', what: 'Fabrique un fichier audio avec la voix d\'Odin (à télécharger et à écouter)', params: [{ key: 'texte', label: 'Texte', kind: 'textarea', required: true }], words: ['dis', 'lis'], run: async (ctx, i) => {
        const texte = s(i.texte).trim(); if (!texte) throw new Error('écris le texte à dire');
        if (!ttsReady(voice())) throw new ModelePasEntraine('parler', voice().stt.language);
        const a = await speakAudio(texte.slice(0, 4000), voice()); const dir = join(ctx.dir, 'audio'); mkdirSync(dir, { recursive: true });
        // Les vieux fichiers s'en vont (7 jours) : ce dossier ne grossit pas sans fin.
        for (const n of readdirSync(dir)) { const m = AUDIO.exec(n); if (m && ctx.now().getTime() - Number(m[1]) > 7 * 86_400_000) rmSync(join(dir, n), { force: true }); }
        // La vraie extension du son reçu : le fichier s'ouvre partout.
        const nom = `odin-${ctx.now().getTime()}.${audioKind(a.data) || (a.mime.includes('ogg') ? 'ogg' : a.mime.includes('wav') ? 'wav' : 'mp3')}`, f = join(dir, nom); writeFileSync(f, a.data, { mode: 0o600 });
        return { text: '🗣 Audio prêt.', data: { file: f }, fichiers: [{ nom, ref: nom }] };
      } },
      { id: 'annoncer', label: 'Annoncer', what: 'Sur une enceinte (nom), ou « partout »', params: [{ key: 'message', label: 'Message', kind: 'textarea', required: true }, { key: 'ou', label: 'Enceinte (ou « partout »)', kind: 'text', default: '' }], words: ['annonce', 'enceinte', 'previens a voix haute', 'préviens à voix haute'], run: async (ctx, i) => ({ text: await announce(ctx, s(i.message), s(i.ou) || undefined) }) },
      { id: 'transcrire', label: 'Transcrire', what: 'Fichier audio → texte (un fichier de la machine d\'Odin, ou un vocal envoyé depuis ton appareil)', read: true, params: [{ key: 'fichier', label: 'Fichier audio', kind: 'text', required: true, depot: {}, help: 'Son chemin sur la machine d\'Odin, ou un fichier de cet appareil (un vocal, par exemple) : il est envoyé, transcrit, puis effacé d\'Odin.' }], words: ['transcris', 'transcription'], run: async (ctx, i) => {
        const f = s(i.fichier), mime = MIME[extname(f).toLowerCase()] ?? 'audio/mpeg';
        if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`fichier audio introuvable : ${f}`);
        // Un vocal envoyé depuis ton appareil pour être transcrit : c'est une copie, effacée d'Odin dès le texte rendu.
        const envoye = dirname(f) === join(ctx.dir, 'depots');
        try { const h = await hear(readFileSync(f), mime, voice()); return { text: h.text, data: h }; } finally { if (envoye) rmSync(f, { force: true }); }
      } },
      { id: 'ordre', label: 'Ordre à la voix', what: 'Comprend un ordre dit ou écrit (« mets Inception sur la télé », « allume le salon ») et le fait faire par la bonne appli, sans IA. Une action grave n\'est jamais lancée ainsi.', params: [{ key: 'texte', label: 'Ordre (texte)', kind: 'text', default: '' }, { key: 'fichier', label: 'ou fichier audio', kind: 'text', default: '' }], quiet: true, words: ['ordre', 'ordre vocal', 'commande vocale'], run: async (ctx, i) => {
        let text = s(i.texte).trim();
        if (!text && s(i.fichier)) { const f = s(i.fichier); text = (await hear(readFileSync(f), MIME[extname(f).toLowerCase()] ?? 'audio/mpeg', voice())).text.trim(); }
        if (!text) throw new Error('rien à comprendre : donne un texte ou un fichier audio');
        // Logos pour la voix : les mots mal entendus sont corrigés d'après leur prononciation (« nase » → NAS).
        const c = corrigerVoix(text, vocabulaire({ modules: ctx.modules(), home: ctx.home, prononciations: voice().speech?.pronunciations }));
        const r = await ctx.order(c.texte);
        ctx.emit('ordre', { texte: c.texte.slice(0, 200), compris: r.ok !== false });
        return { ok: r.ok, text: `🎙 « ${c.texte} »${c.doute ? `\n${c.doute}` : ''}\n${r.text}`, data: { corrections: c.corrections } };
      } },
      { id: 'temps_reel', label: 'Conversation en direct', what: 'État du service vocal temps réel (détection de la parole, fin de phrase, texte en direct, coupure)', read: true, words: ['conversation en direct', 'voix temps reel', 'voix temps réel'], run: async () => {
        const o = orphee(); if (!o.pret && o.etat !== 'absent') await o.demarrer();
        const m = o.moteurs;
        return { text: o.pret ? `🟢 Service temps réel prêt · parole : ${m?.vad} · fin de phrase : ${m?.tour} · texte en direct : ${m?.stt}` : `⚪ ${o.raison || o.etat}`, data: o.resume() };
      } },
      { id: 'temps_reel_relancer', label: 'Relancer le service temps réel', what: 'Arrête puis relance le service vocal temps réel', quick: false, run: async () => { const o = orphee(); o.arreter(); const ok = await o.demarrer(); return { ok, text: ok ? '🟢 Service temps réel relancé.' : o.raison || o.etat }; } },
      { id: 'mot_entendu', label: 'Apprendre un mot mal entendu', what: 'Logos pour la voix : ce qu\'Odin a entendu, et le mot que tu voulais dire (servi à toute la voix et à la dictée)', params: [{ key: 'entendu', label: 'Ce qu\'Odin a entendu', kind: 'text', required: true }, { key: 'mot', label: 'Le mot voulu', kind: 'text', required: true }], quick: false, run: (ctx, i) => ({ text: apprendreVoix(s(i.entendu), s(i.mot), ctx.home) ? `📖 Noté : « ${s(i.entendu)} » → « ${s(i.mot)} ».` : 'Rien de nouveau à retenir.' }) },
      { id: 'projet_actif', label: 'Choisir le projet actif', what: 'Mnémosyne range les fichiers d\'un projet pour répondre à son sujet sans IA (les fichiers de secrets ne sont jamais lus)', params: [{ key: 'dossier', label: 'Dossier du projet', kind: 'text', required: true }, { key: 'nom', label: 'Nom (facultatif)', kind: 'text', default: '' }], words: ['projet actif'], run: (ctx, i) => { const f = indexerProjet(s(i.dossier), { home: ctx.home, nom: s(i.nom) || undefined, now: ctx.now() }); return { text: `📁 Projet actif : ${f.nom} · ${f.fichiers} fichier(s), ${f.passages} passage(s)${f.ignores ? ` · ${f.ignores} ignoré(s)` : ''}${f.masques ? ` · ${f.masques} ligne(s) de secret masquée(s)` : ''}.`, data: f }; } },
      { id: 'projet_question', label: 'Question sur le projet', what: 'Réponse tirée des fichiers du projet actif, sans IA, avec sa source (fichier et lignes)', read: true, external: true, params: [{ key: 'q', label: 'Question', kind: 'text', required: true }], words: ['dans le projet', 'question sur le projet'], run: (ctx, i) => { const r = repondreProjet(s(i.q), { home: ctx.home }); return { ok: r.trouve, text: r.texte, data: r }; } },
      { id: 'voix', label: 'Voix disponibles', what: 'Voix du fournisseur', read: true, run: async () => ({ text: (await listVoices(voice())).map((x) => `- ${x.name} (${x.category}) ${x.id}`).join('\n') || 'Aucune.' }) },
      { id: 'gjallarhorn', label: 'Alertes à voix haute', what: 'Dire les alertes critiques sur les enceintes', params: [{ key: 'actif', label: 'Activé', kind: 'boolean', default: false }, { key: 'ou', label: 'Enceinte (ou « partout »)', kind: 'text', default: 'partout' }, { key: 'heures', label: 'Heures autorisées (ex. 7-22)', kind: 'text', default: '7-22' }], run: (ctx, i) => {
        // Dire une alerte sur les enceintes passait par la synthèse vocale de Home Assistant : Triton reste éteint (même
        // un ancien réglage « activé »), et l'activer dit franchement « pas encore ».
        ctx.saveSettings({ horn: false, hornWhere: s(i.ou) || 'partout', hornHours: s(i.heures) || '7-22' });
        return i.actif === true || i.actif === 'true' ? { ok: false, text: pasEntraine('annoncer', voice().stt.language) } : { text: 'Triton désactivé.' };
      } },
    ],
    // L'audio brut : effacé quand il a dépassé sa durée, et tout entier dès que « Garder l'audio brut » est décoché.
    watch: { every: 3600, run(ctx) { const p = voice().privacy; purgerAudio(ctx.home, p?.keepAudio ? Math.max(1, p.keepAudioDays || 7) : 0, ctx.now().getTime()); } },
    view(ctx) {
      const v = voice();
      return {
        subtitle: `${sttReady(v) ? 'comprend' : 'ne comprend pas encore'} · ${ttsReady(v) ? 'parle' : 'ne parle pas encore'}`,
        tabs: ['Orphée · voix', 'Stentor · annonces', 'Triton · alertes'],
        kpis: [{ label: 'Comprendre', value: sttReady(v) ? 'prêt' : 'non', tone: sttReady(v) ? 'bon' : 'attention' }, { label: 'Parler', value: ttsReady(v) ? v.tts.provider : 'non', tone: ttsReady(v) ? 'bon' : 'attention' }, { label: 'En direct', value: orphee().pret ? 'prêt' : orphee().etat, tone: orphee().pret ? 'bon' : 'neutre', hint: orphee().raison || undefined }, { label: 'Triton', value: 'pas encore', tone: 'neutre' }],
        sections: [{ kind: 'text', title: 'Comment ça marche', text: `${pasEntraine('ecouter', v.stt.language)}\n${pasEntraine('parler', v.stt.language)}\nUn ordre écrit (« allume le salon ») est compris sans IA et confié à la bonne appli.` },
          { kind: 'text', title: 'Conversation en direct', text: pasEntraine('conversationDirect', v.stt.language) },
          { kind: 'text', title: 'Projet actif (Mnémosyne)', text: (() => { const p = projetActif(ctx.home); return p ? `${p.nom} · ${p.fichiers} fichier(s), indexé le ${p.at.slice(0, 10)}. Pose une question : la réponse cite le fichier et les lignes.` : 'Aucun projet actif : choisis le dossier d\'un projet pour qu\'Odin réponde à son sujet sans IA.'; })() },
          { kind: 'text', title: 'Audio brut', text: v.privacy?.keepAudio && !v.privacy.privateMode ? `Gardé ${v.privacy.keepAudioDays} jour(s) sur la machine d'Odin (Réglages → Voix) : ${audiosGardes(ctx.home).length} enregistrement(s).` : 'Jamais gardé (Réglages → Voix → « Garder l\'audio brut » pour le conserver quelques jours).' }],
        side: [{ kind: 'form', title: 'Annoncer', action: 'annoncer', submit: 'Annoncer', params: m.actions.find((a) => a.id === 'annoncer')?.params ?? [] }, { kind: 'form', title: 'Triton', action: 'gjallarhorn', submit: 'Enregistrer', params: m.actions.find((a) => a.id === 'gjallarhorn')?.params ?? [] }],
      };
    },
  };
  return m;
}
