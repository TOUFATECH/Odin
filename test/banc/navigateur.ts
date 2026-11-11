// Un vrai navigateur (Chromium piloté par Playwright) pour les scénarios qui regardent l'interface.
// Playwright n'est pas une dépendance d'Odin : s'il n'est pas installé, les scénarios le disent et
// passent ces vérifications. Le code exécuté dans la page est donné en texte (pas besoin des types du navigateur).

import { createRequire } from 'node:module';
import type { T } from './lib.ts';

export interface ConsoleMsg { type(): string; text(): string }
export interface Page {
  goto(url: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForSelector(sel: string, o?: { timeout?: number; state?: string }): Promise<unknown>;
  waitForFunction(js: string, arg?: unknown, o?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<R = unknown>(js: string): Promise<R>;
  on(ev: 'console', fn: (m: ConsoleMsg) => void): void;
  on(ev: 'pageerror', fn: (e: Error) => void): void;
  on(ev: 'requestfailed' | 'response', fn: (r: { url(): string; status?(): number; failure?(): { errorText: string } | null }) => void): void;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  fill(sel: string, value: string): Promise<void>;
  click(sel: string, o?: { timeout?: number }): Promise<void>;
  setViewportSize(v: { width: number; height: number }): Promise<void>;
  close(): Promise<void>;
}
export interface Context { newPage(): Promise<Page>; addCookies(c: Array<Record<string, unknown>>): Promise<void>; close(): Promise<void> }
export interface Browser { newContext(o?: Record<string, unknown>): Promise<Context>; close(): Promise<void> }

/** Lance Chromium ; undefined si Playwright (ou son navigateur) n'est pas disponible. */
export async function openBrowser(t: T): Promise<Browser | undefined> {
  try {
    const pw = createRequire(import.meta.url)('playwright') as { chromium: { launch(o?: Record<string, unknown>): Promise<Browser> } };
    const b = await pw.chromium.launch(); t.onEnd(() => b.close());
    return b;
  } catch { return undefined; }
}
