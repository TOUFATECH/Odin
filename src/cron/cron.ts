// Expressions cron à 5 champs (minute heure jour-du-mois mois jour-de-semaine), sans dépendance.
// Gère * , - / et les raccourcis @hourly @daily @weekly @monthly. Heure locale du serveur.

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *',
};
const RANGES: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];

function parseField(field: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Pas invalide : ${part}`);
    let lo = min, hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      lo = a; hi = b ?? (stepStr ? max : a);
    }
    if (![lo, hi].every((n) => Number.isInteger(n)) || lo < min || hi > max + (max === 6 ? 1 : 0) || lo > hi) throw new Error(`Valeur hors limites : ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(max === 6 && v === 7 ? 0 : v); // 7 = dimanche
  }
  return out;
}

export interface CronSpec { fields: Set<number>[]; domStar: boolean; dowStar: boolean }

export function parseCron(expr: string): CronSpec {
  const e = ALIASES[expr.trim()] ?? expr.trim();
  const parts = e.split(/\s+/);
  if (parts.length !== 5) throw new Error(`Expression cron invalide « ${expr} » : 5 champs attendus (minute heure jour mois jour-semaine)`);
  return { fields: parts.map((p, i) => parseField(p, RANGES[i])), domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

/** Prochaine date (strictement après `from`) correspondant à l'expression. */
export function nextRun(expr: string, from: Date): Date {
  const { fields: [mi, h, dom, mon, dow], domStar, dowStar } = parseCron(expr);
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from.getTime() + 366 * 24 * 3600 * 1000 * 5;
  while (d.getTime() < limit) {
    if (!mon.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0); continue; }
    // Règle cron classique : si jour-du-mois ET jour-de-semaine sont restreints, l'un OU l'autre suffit.
    const dayOk = domStar && dowStar ? true : domStar ? dow.has(d.getDay()) : dowStar ? dom.has(d.getDate()) : dom.has(d.getDate()) || dow.has(d.getDay());
    if (!dayOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0); continue; }
    if (!h.has(d.getHours())) { d.setHours(d.getHours() + 1, 0); continue; }
    if (!mi.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1); continue; }
    return d;
  }
  throw new Error(`Aucune exécution trouvée pour « ${expr} »`);
}
