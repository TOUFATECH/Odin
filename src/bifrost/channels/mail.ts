// Canal Mail : tu écris à Odin depuis ta boîte, il répond par mail. Seuls les mails du propriétaire,
// authentifiés par ton fournisseur (DMARC / DKIM), sont lus ; un mail qui imite ton adresse est ignoré.
// Les autres mails de la boîte ne sont jamais marqués comme lus. Option « mot-clé » : seuls les mails
// dont le sujet (ou le destinataire, ex. moi+odin@…) contient ce mot sont pour Odin.

import type { MailConfig } from '../../tools/mail.ts';
import { buildMail, smtpSend, takeOwnerMails } from '../../tools/mail.ts';
import type { Channel, Inbound } from '../channel.ts';

export class MailChannel implements Channel {
  readonly name = 'mail';
  readonly interactive = true;
  private timer?: NodeJS.Timeout;
  private running = false;
  private subjects = new Map<string, string>();
  private cfg: MailConfig; private owners: string[]; private tag: string; private everySec: number;
  constructor(cfg: MailConfig, owners: string[], tag = 'odin', everySec = 60) { this.cfg = cfg; this.owners = owners.map((o) => o.toLowerCase()); this.tag = tag; this.everySec = Math.max(20, everySec); }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    if (!this.owners.length) throw new Error('canal Mail : ajoute ton adresse (propriétaire)');
    this.running = true;
    console.log(`[bifrost] Mail : j'écoute les mails de ${this.owners.join(', ')}${this.tag ? ` contenant « ${this.tag} »` : ''}`);
    const loop = async () => {
      if (!this.running) return;
      try {
        for (const m of await takeOwnerMails(this.cfg, this.owners, this.tag)) {
          if (!m.trusted) { console.error(`[mail] message de ${m.from} non authentifié (DMARC/DKIM) : ignoré`); continue; }
          this.subjects.set(m.from, m.subject);
          const text = `${m.subject && !/^(re|tr|fwd?)\s*:/i.test(m.subject) ? `${m.subject}\n\n` : ''}${m.text}`.trim();
          if (text) void onMessage({ channel: this.name, peer: m.from, name: m.from, text }).catch((e) => console.error('[mail]', (e as Error).message));
        }
      } catch (e) { console.error('[mail]', (e as Error).message); }
      this.timer = setTimeout(loop, this.everySec * 1000);
    };
    void loop();
  }

  async send(peer: string, text: string, opts: Parameters<Channel['send']>[2] = {}): Promise<void> {
    if (opts?.secret) text = 'Je t\'ai préparé une information confidentielle : je ne l\'envoie pas par mail. Ouvre Odin (Telegram ou l\'application) pour la voir.';
    const tail = opts?.approval ? '\n\nRéponds simplement « oui » ou « non ».' : opts?.reminder ? '\n\nRéponds « fait » ou « plus tard ».' : opts?.habit ? '\n\nRéponds « oui » ou « non ».' : '';
    const subj = this.subjects.get(peer);
    const subject = subj ? (/^re\s*:/i.test(subj) ? subj : `Re: ${subj}`) : `Odin${this.tag && this.tag !== 'odin' ? ` [${this.tag}]` : ''}`;
    await smtpSend(this.cfg, [peer], buildMail(this.cfg.from || this.cfg.user, [peer], subject, `${text}${tail}\n\n— Odin`));
  }

  async stop(): Promise<void> { this.running = false; clearTimeout(this.timer); }
}
