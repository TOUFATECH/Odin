// Pied du menu (src/web/pages/pied-menu.js) : les IA configurées lues dans l'état déjà reçu par la page, ou
// « Cerveau d'Odin · autonome » sans modèle ; la consommation seulement avec un modèle et si l'usage était reçu ;
// jamais d'adresse de serveur ni de clé. Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

interface Ligne { role: string; service: string; modele: string; id: string; enCours: boolean; titre: string }
interface Lignes { autonome: boolean; ia: Ligne[]; reste: number; conso: { jetons: number; cout: number } | null; pastille: { cerveau: boolean; sigle: string | null; titre: string } }
interface Pied { peindre: (s: unknown) => void; noterModele: (n: string) => void; logique: { lignes: (s: unknown, dernier?: string) => Lignes } }
const SRC = readFileSync(new URL('../src/web/pages/pied-menu.js', import.meta.url), 'utf8');
function charger(): Pied {
  const win: { OdinPiedMenu?: Pied } = {};
  vm.runInNewContext(SRC, { window: win });
  assert.ok(win.OdinPiedMenu, 'window.OdinPiedMenu est posé');
  return win.OdinPiedMenu;
}
const p = (index: number, label: string, model: string, extra: Record<string, unknown> = {}) => ({ index, preset: 'custom', model, baseUrl: 'http://10.0.0.5:11434/v1', tier: 'standard', ready: true, label, ...extra });
const USAGE = { tokens_in: 1200, tokens_out: 300, cost_usd: 0.0425 };

test('pied du menu : sans modèle de langue ou aucun modèle prêt → Cerveau d\'Odin autonome, sans consommation', () => {
  const { logique } = charger();
  const a = logique.lignes({ settings: { modelePret: false, providers: [p(0, 'Claude Sonnet 5.5 (Anthropic)', 'claude-sonnet-5-5')] }, usage: USAGE });
  assert.equal(a.autonome, true);
  assert.equal(a.ia.length, 0);
  assert.equal(a.conso, null);
  assert.equal(a.pastille.cerveau, true);
  assert.match(a.pastille.titre, /Cerveau d'Odin · autonome/);
  const b = logique.lignes({ settings: { modelePret: true, providers: [p(0, 'Kimi K2.6 (Kimi)', 'kimi-k2.6', { ready: false })] }, usage: USAGE });
  assert.equal(b.autonome, true, 'un modèle non prêt ne compte pas');
  assert.match(SRC, /Cerveau d'Odin · autonome/);
});

test('pied du menu : un modèle prêt → service, modèle, identifiant brut, principal en service, consommation', () => {
  const { logique } = charger();
  const r = logique.lignes({ settings: { modelePret: true, providers: [p(0, 'Claude Sonnet 5.5 (Anthropic)', 'claude-sonnet-5-5')] }, usage: USAGE });
  assert.equal(r.autonome, false);
  assert.equal(r.ia.length, 1);
  const l = r.ia[0];
  assert.equal(l.service, 'Anthropic');
  assert.equal(l.modele, 'Claude Sonnet 5.5');
  assert.equal(l.id, 'claude-sonnet-5-5');
  assert.equal(l.role, 'principal');
  assert.equal(l.enCours, true);
  assert.match(l.titre, /modèle configuré : claude-sonnet-5-5/);
  assert.deepEqual(JSON.parse(JSON.stringify(r.conso)), { jetons: 1500, cout: 0.0425 });
  assert.equal(r.pastille.cerveau, false);
  assert.equal(r.pastille.sigle, 'Cl');
});

test('pied du menu : trois modèles → deux lignes et un reste ; un non prêt est ignoré', () => {
  const { logique } = charger();
  const r = logique.lignes({ settings: { providers: [p(0, 'GPT-6 Luna (ChatGPT Codex)', 'gpt-6-luna'), p(1, 'Kimi K2.6 (Kimi)', 'kimi-k2.6'), p(2, 'Qwen3 14b (Ollama)', 'qwen3:14b', { ready: false }), p(3, 'DeepSeek Flash (DeepSeek)', 'deepseek-flash')] }, usage: USAGE });
  assert.equal(r.ia.length, 2);
  assert.equal(r.reste, 1);
  assert.deepEqual(r.ia.map((x) => x.role), ['principal', 'secours']);
  assert.ok(!JSON.stringify(r).includes('Qwen3'), 'le modèle non prêt n\'apparaît pas');
  assert.equal(r.pastille.sigle, 'GP', 'sigle de « GPT-6 Luna »');
});

test('pied du menu : sans usage reçu, pas de consommation', () => {
  const { logique } = charger();
  const r = logique.lignes({ settings: { providers: [p(0, 'Claude Sonnet 5.5 (Anthropic)', 'claude-sonnet-5-5')] } });
  assert.equal(r.autonome, false);
  assert.equal(r.conso, null);
});

test('pied du menu : la réponse reçue change le modèle en service', () => {
  const pied = charger();
  const st = { settings: { providers: [p(0, 'Claude Sonnet 5.5 (Anthropic)', 'claude-sonnet-5-5'), p(1, 'Kimi K2.6 (Kimi)', 'kimi-k2.6')] }, usage: USAGE };
  assert.deepEqual(pied.logique.lignes(st).ia.map((x) => x.enCours), [true, false]);
  assert.deepEqual(pied.logique.lignes(st, 'Kimi K2.6 (Kimi)').ia.map((x) => x.enCours), [false, true]);
  assert.deepEqual(pied.logique.lignes(st, 'kimi:kimi-k2.6').ia.map((x) => x.enCours), [false, true]);
  assert.deepEqual(pied.logique.lignes(st, 'inconnu').ia.map((x) => x.enCours), [true, false]);
  // Sans document, noterModele et peindre ne font rien de mal.
  pied.noterModele('Kimi K2.6 (Kimi)');
});

test('pied du menu : ni adresse de serveur, ni clé, ni jeton recopiés', () => {
  const { logique } = charger();
  const r = logique.lignes({ settings: { providers: [p(0, 'Qwen3 14b (Ollama)', 'qwen3:14b', { apiKey: 'sk-secret-123', token: 'sk-ant-xyz' })] }, usage: USAGE });
  const s = JSON.stringify(r);
  assert.ok(!s.includes('10.0.0.5'), 'pas d\'adresse');
  assert.ok(!s.includes('11434'), 'pas de port');
  assert.ok(!/sk-/.test(s), 'pas de clé');
  assert.doesNotMatch(SRC, /baseUrl/);
  assert.doesNotMatch(SRC, /(^|[^.\w])(confirm|alert|prompt)\(/m);
});
