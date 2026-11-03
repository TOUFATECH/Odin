#!/usr/bin/env node
// Point d'entrée exécutable : Node ≥ 22.18 exécute le TypeScript directement
// (suppression des types native), donc aucune étape de compilation n'est nécessaire.

// Le module SQLite intégré à Node affiche un avertissement « expérimental » : on le masque.
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (/SQLite is an experimental feature|Type Stripping/i.test(text)) return;
  return emit.call(process, warning, ...rest);
};

await import('../src/cli/main.ts');
