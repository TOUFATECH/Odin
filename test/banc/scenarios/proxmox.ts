// Hydre contre un Proxmox simulé (même API, HTTPS auto-signé, jeton) : deux serveurs réunis,
// démarrer, arrêter, instantané, retour en arrière, alertes quand une machine tombe ou qu'un nœud
// disparaît. Un vrai Proxmox demande une machine entière : ici c'est son API qui est rejouée.

import { ymir } from '../../../src/valhalla/modules/ymir.ts';
import { proxmoxSim } from '../sim/proxmox.ts';
import { has, type Scenario } from '../lib.ts';

export const proxmox: Scenario = {
  id: 'proxmox', title: 'Hydre ↔ Proxmox VE', mode: 'simulé',
  what: 'L\'API de Proxmox rejouée par un simulateur (HTTPS, jeton) : deux serveurs, machines, démarrer, arrêter, instantanés, alertes.',
  async run(t) {
    if (!(await has('openssl'))) t.skip('openssl absent (certificat du simulateur)');
    const a = await proxmoxSim(), b = await proxmoxSim({ token: 'odin@pve!grange=aaaa1111-2222-3333-4444-banc00000002' });
    t.onEnd(() => a.close()); t.onEnd(() => b.close());
    b.nodes.splice(0, b.nodes.length, { node: 'grange', status: 'online', maxmem: 16 * 1024 ** 3, mem: 4 * 1024 ** 3, cpu: 0.05, maxcpu: 4 });
    b.guests.splice(0, b.guests.length, { vmid: 200, name: 'sauvegardes', type: 'lxc', node: 'grange', status: 'running', maxmem: 2 * 1024 ** 3, mem: 1024 ** 3, cpu: 0.02, maxdisk: 1000 * 1024 ** 3, disk: 400 * 1024 ** 3, snapshots: [] });
    const env = { PROXMOX_TOKEN: process.env.PROXMOX_TOKEN, PROXMOX_TOKEN_GRANGE: process.env.PROXMOX_TOKEN_GRANGE };
    t.onEnd(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    delete process.env.PROXMOX_TOKEN; delete process.env.PROXMOX_TOKEN_GRANGE;

    const { v, alerts, events } = t.valhalla([ymir]);
    const ctx = v.ctx('ymir'), act = (x: string, i: Record<string, unknown> = {}, o = {}) => v.act('ymir', x, i, o);

    const add = await act('serveur', { nom: 'principal', adresse: a.url });
    t.match(add.text, /PROXMOX_TOKEN\)/, 'serveur ajouté : Odin dit où ranger le jeton (coffre)');
    t.ok(!JSON.stringify(ctx.settings).includes(a.token.split('=')[1]), 'aucun jeton dans les réglages de l\'appli');
    t.match((await act('machines')).text, /Aucune machine/, 'sans jeton dans le coffre : rien n\'est lu');
    process.env.PROXMOX_TOKEN = 'odin@pve!banc=jeton-faux';
    t.match((await act('machines')).text, /jeton refusé/, 'jeton faux : « jeton refusé », message clair');
    process.env.PROXMOX_TOKEN = a.token;
    const list = await act('machines');
    t.ok(/100 nas \(VM, principal\/pve1\) · running/.test(list.text) && /110 bac-a-sable \(conteneur, principal\/pve2\) · stopped/.test(list.text), 'machines et conteneurs listés (certificat auto-signé accepté sur le réseau local)', list.text);

    t.match((await act('serveur', { nom: 'Grange', adresse: b.url })).text, /PROXMOX_TOKEN_GRANGE/, 'deuxième serveur : son propre jeton dans le coffre');
    process.env.PROXMOX_TOKEN_GRANGE = b.token;
    const both = await act('machines');
    t.ok(/200 sauvegardes \(conteneur, Grange\/grange\)/.test(both.text) && /100 nas/.test(both.text), 'les deux serveurs sont réunis (mode Asgard)', both.text);
    const view = await ymir.view(ctx, new URLSearchParams());
    t.ok(view.kpis?.some((k) => k.label === 'Machines actives' && k.value === '4 / 5') && view.side?.some((x) => x.kind === 'list' && x.items.length === 3), 'la page compte 4 machines actives sur 5 et 3 nœuds', JSON.stringify(view.kpis));

    const start = await act('demarrer', { vmid: 110 });
    t.ok(start.ok && a.guests.find((g) => g.vmid === 110)?.status === 'running', 'démarrer : le conteneur 110 démarre sur le serveur', start.text);
    const autoStop = await act('arreter', { vmid: 100 }, { auto: true });
    t.ok(autoStop.ok === false && a.guests.find((g) => g.vmid === 100)?.status === 'running', 'arrêter une machine est refusé à une automatisation', autoStop.text);
    const snap = await act('instantane', { vmid: 100, nom: 'avant-travaux' });
    t.ok(snap.ok && a.guests.find((g) => g.vmid === 100)?.snapshots.includes('avant-travaux'), 'instantané créé', snap.text);
    const auto = await act('instantane', { vmid: 102 });
    t.ok(auto.ok && /^odin-?\d+/.test(a.guests.find((g) => g.vmid === 102)?.snapshots[0] ?? ''), 'instantané sans nom : Odin en choisit un valide', `${auto.text} ${JSON.stringify(a.guests.find((g) => g.vmid === 102)?.snapshots)}`);
    const back = await act('revenir', { vmid: 100, nom: 'avant-travaux' });
    t.ok(back.ok && a.calls.some((c) => c.path === '/nodes/pve1/qemu/100/snapshot/avant-travaux/rollback'), 'retour à l\'instantané (avec ton accord)', back.text);
    t.match((await act('revenir', { vmid: 100, nom: 'inconnu' })).text, /does not exist|HTTP 500/, 'instantané inconnu : l\'erreur du serveur est rapportée');
    t.match((await act('demarrer', { vmid: 999 })).text, /aucune machine n° 999/, 'numéro inconnu : message clair');

    // Surveillance : une machine tombe, un nœud disparaît.
    await ymir.watch!.run(ctx);
    a.guests.find((g) => g.vmid === 102)!.status = 'stopped';
    await ymir.watch!.run(ctx);
    t.ok(alerts.some((x) => x.level === 'haute' && /La machine venus s'est arrêtée/.test(x.title)), 'alerte haute : « La machine venus s\'est arrêtée »', JSON.stringify(alerts.map((x) => x.title)));
    t.ok(events.some((e) => e.type === 'vm_arretee' && e.data.vmid === 102), 'événement « machine arrêtée » émis');
    a.nodes[1].status = 'offline';
    await ymir.watch!.run(ctx);
    t.ok(alerts.some((x) => x.level === 'critique' && /Nœud pve2 injoignable/.test(x.title)), 'alerte critique : nœud injoignable');
    a.nodes[0].mem = a.nodes[0].maxmem * 0.97;
    await ymir.watch!.run(ctx);
    t.ok(alerts.some((x) => /Nœud pve1 : mémoire saturée/.test(x.title)), 'alerte : mémoire d\'un nœud saturée');
    // Arrêt demandé par toi : pas d'alerte ensuite.
    const n = alerts.length;
    await act('arreter', { vmid: 101 });
    await ymir.watch!.run(ctx);
    t.ok(!alerts.slice(n).some((x) => /odin s'est arrêtée/.test(x.title)), 'pas de fausse alerte quand c\'est toi qui arrêtes la machine', JSON.stringify(alerts.slice(n).map((x) => x.title)));

    await a.close();
    const down = await act('machines');
    t.match(down.text, /principal : Proxmox injoignable/, 'serveur éteint : signalé, l\'autre serveur reste lisible');
    t.match(down.text, /200 sauvegardes/, '(l\'autre serveur répond toujours)');
  },
};
