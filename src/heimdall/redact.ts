// Heimdall — masquage des secrets.
// Appliqué aux sorties d'outils AVANT qu'elles n'atteignent le modèle, aux journaux
// et aux messages sortants : un secret lu par erreur ne peut ni fuiter ni être mémorisé.

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,                 // Anthropic
  /sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}/g,    // OpenAI / OpenRouter
  /gh[pousr]_[A-Za-z0-9]{30,}/g,                // GitHub
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /AKIA[0-9A-Z]{16}/g,                          // AWS
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,              // Slack
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,            // Telegram bot
  /AIza[0-9A-Za-z_-]{35}/g,                     // Google
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?<=\b(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*["']?)[^\s"']{6,}/gi,
  /(?<=Bearer\s)[A-Za-z0-9._~+/=-]{20,}/g,
];

export class Redactor {
  private exact: string[];

  /** `knownSecrets` : valeurs réelles (variables d'environnement) à masquer à coup sûr. */
  constructor(knownSecrets: string[] = []) {
    this.exact = knownSecrets.filter((s) => s && s.length >= 8);
  }

  /** Ajoute un secret saisi en cours de route (ex. clé enregistrée depuis l'interface web). */
  add(secret: string): void {
    if (secret && secret.length >= 8 && !this.exact.includes(secret)) this.exact.push(secret);
  }

  redact(text: string): string {
    let out = text;
    for (const s of this.exact) out = out.split(s).join('[SECRET]');
    for (const re of PATTERNS) out = out.replace(re, '[SECRET]');
    return out;
  }

  /** Construit un masqueur à partir des variables d'environnement sensibles. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Redactor {
    const values = Object.entries(env)
      .filter(([k]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k))
      .map(([, v]) => v ?? '');
    return new Redactor(values);
  }
}
