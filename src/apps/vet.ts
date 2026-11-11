// Contrôle de sécurité d'un dépôt GitHub avant de l'installer : réputation du projet (étoiles, âge,
// activité, licence libre) et lecture du code à la recherche de ce qui « fait n'importe quoi »
// (porte dérobée, mineur de cryptomonnaie, vol de mots de passe, code caché, destruction).
// Tout est pur et testable ; la décision : critique → jamais installé ; alertes → ton accord ;
// propre → Odin installe.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface RepoInfo {
  full_name: string; description?: string | null; stargazers_count: number; forks_count: number; archived: boolean;
  created_at: string; pushed_at: string; license?: { spdx_id?: string | null } | null; owner?: { type?: string }; default_branch?: string; size?: number; html_url?: string;
}

/** « owner/nom », lien GitHub (avec .git, /tree/…) → owner et nom validés. Pur. */
export function parseRepo(input: string): { owner: string; name: string } | undefined {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/#?].*)?$/.exec(input.trim());
  return m && m[2] !== '.' && m[2] !== '..' ? { owner: m[1], name: m[2] } : undefined;
}

const OSI = /^(MIT|Apache-2\.0|GPL-[23]\.0|AGPL-3\.0|LGPL-[23]\.[01]|BSD-[234]-Clause|MPL-2\.0|ISC|Unlicense|0BSD|EPL-2\.0|Zlib|CC0-1\.0|BSL-1\.0|EUPL-1\.2|Artistic-2\.0|OSL-3\.0)/;

/** Réputation du projet : alertes lisibles et note (0 à 100). Pur. */
export function reputation(r: RepoInfo, now = Date.now()): { score: number; notes: string[]; license: string; libre: boolean } {
  const notes: string[] = [];
  let score = 50;
  const age = (now - Date.parse(r.created_at)) / 86_400_000, idle = (now - Date.parse(r.pushed_at)) / 86_400_000;
  if (r.stargazers_count >= 1000) score += 25; else if (r.stargazers_count >= 100) score += 15; else if (r.stargazers_count >= 20) score += 5; else { score -= 15; notes.push(`peu connu (${r.stargazers_count} étoiles)`); }
  if (age < 60) { score -= 20; notes.push(`projet très récent (${Math.round(age)} jours)`); } else if (age > 365) score += 5;
  if (idle > 730) { score -= 10; notes.push(`plus mis à jour depuis ${Math.round(idle / 365)} an(s)`); }
  if (r.archived) { score -= 10; notes.push('projet archivé (abandonné)'); }
  const license = r.license?.spdx_id ?? '';
  const libre = OSI.test(license);
  if (!libre) { score -= 10; notes.push(license && license !== 'NOASSERTION' ? `licence ${license} : vérifie qu'elle autorise ton usage` : 'pas de licence libre déclarée : usage non autorisé par défaut'); }
  return { score: Math.max(0, Math.min(100, score)), notes, license: license || 'aucune', libre };
}

export interface Finding { level: 'critique' | 'attention'; what: string; file: string; line: number }

// Ce qui tourne dans un conteneur en construction ou dans l'intégration continue du projet ne touche pas ta machine.
const BUILD_ONLY = /(^|\/)(\.github|\.gitlab|\.circleci|codemagic\.yaml|azure-pipelines)|(^|\/|\.)dockerfile$|\.dockerfile$|(^|\/)Dockerfile[^/]*$/i;
const RULES: Array<{ re: RegExp; level: Finding['level']; what: string; only?: RegExp; skip?: RegExp }> = [
  { re: /\b(xmrig|stratum\+tcp|coinhive|cryptonight|minergate|nicehash)\b/i, level: 'critique', what: 'mineur de cryptomonnaie' },
  { re: /bash\s+-i\s*>&\s*\/dev\/tcp\/|\/dev\/tcp\/\d{1,3}(\.\d{1,3}){3}\/\d+|\bnc(at)?\s+(-\w+\s+)*-e\s+\/bin\/(ba)?sh|socat\s+.*exec:.*sh/i, level: 'critique', what: 'porte dérobée (shell à distance)' },
  { re: /(eval|exec|Function)\s*\(\s*(base64\.b64decode|atob|Buffer\.from\([^)]*['"]base64['"]\)|codecs\.decode\([^)]*rot)/i, level: 'critique', what: 'code caché exécuté (base64 / chiffré)' },
  { re: /(\.ssh\/id_(rsa|ed25519)|\.aws\/credentials|wallet\.dat|Login Data|cookies\.sqlite|\.config\/google-chrome|keychain-db)[\s\S]{0,200}(requests\.post|fetch\(|axios|urllib|http\.request|curl\s)/i, level: 'critique', what: 'lit tes clés ou mots de passe puis les envoie' },
  { re: /discord(app)?\.com\/api\/webhooks\/\d+/i, level: 'critique', what: 'envoie des données vers un webhook Discord (typique des vols de données)' },
  { re: /\brm\s+-rf\s+(--no-preserve-root\s+)?\/(\s|$|\*)|\bmkfs(\.\w+)?\s+\/dev\/|dd\s+if=\/dev\/(zero|urandom)\s+of=\/dev\/(sd|nvme|vd)/, level: 'critique', what: 'destruction du système ou d\'un disque' },
  { re: /(curl|wget)\s+[^|;\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, level: 'attention', what: 'télécharge et exécute un script depuis Internet', skip: BUILD_ONLY },
  { re: /"(preinstall|postinstall|install)"\s*:\s*"[^"]*(curl|wget|node\s+-e|https?:\/\/)/, level: 'attention', what: 'script npm qui télécharge ou exécute du code à l\'installation', only: /package\.json$/ },
  { re: /\bchmod\s+[0-7]?[4-7][0-7]{3}\b|\bchmod\s+u\+s\b/, level: 'attention', what: 'rend un programme setuid (droits root)', skip: BUILD_ONLY },
  { re: /crontab\s+-|\/etc\/cron\.|\/etc\/systemd\/system\/|\/etc\/rc\.local/, level: 'attention', what: 'se lance tout seul au démarrage (persistance)', skip: BUILD_ONLY },
  { re: /\b(iptables\s+-F|ufw\s+disable|setenforce\s+0)\b/, level: 'attention', what: 'désactive le pare-feu ou la sécurité' },
  { re: /\b(pastebin\.com\/raw|transfer\.sh|ngrok\.io|[a-z0-9-]+\.onion)\b/i, level: 'attention', what: 'contacte un service souvent utilisé pour exfiltrer des données' },
];
const SKIP_DIR = /^(\.git|\.github|node_modules|vendor|dist|build|\.venv|venv|__pycache__|target|\.next|coverage|docs?|examples?|tests?|__tests__|fixtures?)$/i;
const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|ps1|rb|php|go|rs|pl|lua|json|ya?ml|toml|ini|cfg|conf|service|Dockerfile|mk|cmake|gradle|java|kt|swift|c|h|cpp|cs)$|^(Dockerfile|Makefile|install|setup|configure|entrypoint)/i;

/** Lit le code du dépôt (texte seulement, 4 000 fichiers et 1 Mo par fichier au plus). */
export function scanCode(root: string): { findings: Finding[]; files: number; longLines: number } {
  const findings: Finding[] = [];
  let files = 0, longLines = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || files > 4000) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, depth + 1); continue; }
      if (!TEXT_EXT.test(e.name) || statSync(p).size > 1_000_000) continue;
      files++;
      const rel = relative(root, p);
      const text = readFileSync(p, 'utf8');
      if (/\.min\.js$/.test(e.name)) continue;
      const lines = text.split('\n');
      for (const [i, l] of lines.entries()) {
        if (l.length > 3000 && /[A-Za-z0-9+/=]{2000,}/.test(l)) { longLines++; if (longLines <= 3) findings.push({ level: 'attention', what: 'longue chaîne codée (code possiblement caché)', file: rel, line: i + 1 }); }
      }
      for (const r of RULES) {
        if ((r.only && !r.only.test(rel)) || r.skip?.test(rel)) continue;
        const m = r.re.exec(text);
        if (m) findings.push({ level: r.level, what: r.what, file: rel, line: text.slice(0, m.index).split('\n').length });
      }
    }
  };
  walk(root, 0);
  return { findings: findings.slice(0, 40), files, longLines };
}

/** Comment l'installer et ce qu'il faut sur la machine (d'après les fichiers du dépôt et le README). Pur. */
export function installPlan(fileNames: string[], readme: string): { method: 'docker-compose' | 'docker' | 'python' | 'node' | 'go' | 'rust' | 'make' | 'inconnue'; needs: string[]; minRamGb?: number; gpu: boolean } {
  const has = (re: RegExp) => fileNames.some((f) => re.test(f));
  const method = has(/^(docker-)?compose\.ya?ml$/i) ? 'docker-compose' : has(/^Dockerfile$/) ? 'docker' : has(/^(requirements\.txt|pyproject\.toml|setup\.py)$/) ? 'python' : has(/^package\.json$/) ? 'node' : has(/^go\.mod$/) ? 'go' : has(/^Cargo\.toml$/) ? 'rust' : has(/^Makefile$/) ? 'make' : 'inconnue';
  const needs = method === 'docker-compose' || method === 'docker' ? ['docker'] : method === 'python' ? ['python3'] : method === 'node' ? ['node', 'npm'] : method === 'go' ? ['go'] : method === 'rust' ? ['cargo'] : method === 'make' ? ['make'] : [];
  const ram = /(\d+)\s*(go|gb|gib)\s*(de\s*)?(ram|memory|mémoire)|(ram|memory|mémoire)[^.\n]{0,30}?(\d+)\s*(go|gb|gib)/i.exec(readme);
  const minRamGb = ram ? Number(ram[1] ?? ram[6]) : undefined;
  const gpu = /\b(nvidia|cuda|gpu\s+(is\s+)?required|requires?\s+a?\s*gpu)\b/i.test(readme);
  return { method, needs, minRamGb: minRamGb && minRamGb < 512 ? minRamGb : undefined, gpu };
}
