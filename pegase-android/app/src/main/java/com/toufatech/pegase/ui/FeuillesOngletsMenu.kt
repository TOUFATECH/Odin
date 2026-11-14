package com.toufatech.pegase.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.toufatech.pegase.appli.Feuille
import com.toufatech.pegase.appli.OngletInfo
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Adresse
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.coeur.Theme

// ------------------------------------------------------------------ écran 10 : espaces, favoris, onglets et pages partagées

@Composable
fun FeuilleOnglets(pegase: Pegase) {
    val nav = pegase.navigateur
    val p = LocalPalette.current
    val _r = pegase.revision
    val espaces = pegase.espaces()
    val espace = espaces.firstOrNull { it.id == pegase.espaceActif } ?: espaces.first()
    val tous = pegase.onglets().filter { !it.range }
    // Un onglet sans espace (venu d'un appareil qui n'en a pas) est montré dans le premier espace.
    val onglets = tous.filter { (it.espace ?: espaces.first().id) == espace.id || (it.espace != null && espaces.none { e -> e.id == it.espace } && espace == espaces.first()) }
    val epingles = onglets.filter { it.epingle }
    val duJour = onglets.filter { !it.epingle }
    var saisie by remember { mutableStateOf("") }
    val parler = rememberParole { nav.ouvrir(it) }
    val choix = pegase.choixPartage

    Column(Modifier.fillMaxSize().fondPegase(p).statusBarsPadding().navigationBarsPadding().imePadding().padding(start = 14.dp, end = 14.dp, top = 20.dp)) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(18.dp).clip(CircleShape).background(Brush.radialGradient(listOf(Color(0xFF9BE7FF), Color(0xFF3E7BFA), Color(0xFF2BC48A)))))
                T(if (choix) "Choisis la page à ajouter" else espace.nom, Modifier.weight(1f), taille = 20.sp, poids = FontWeight.Bold)
                BoutonIcone(Icones.fermer, "Fermer", { pegase.feuille = null; pegase.choixPartage = false })
            }
            val favoris = pegase.favoris().take(8)
            if (favoris.isNotEmpty() && !choix) GrilleFavoris(pegase, favoris)

            if (epingles.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (o in epingles) LigneEpinglee(pegase, o, choix)
                }
            }

            Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                T("Aujourd'hui", taille = 13.sp, poids = FontWeight.SemiBold, doux = true)
                Box(Modifier.weight(1f).height(1.dp).background(p.texte.c().copy(alpha = 0.22f)))
                if (!choix) {
                    Row(
                        Modifier.height(36.dp).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button) { nav.ranger() }.padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icone(Icones.ranger, null, p.texteDoux.c(), 16.dp)
                        T("Ranger", taille = 13.sp, poids = FontWeight.Medium, doux = true)
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (o in duJour) LigneOnglet(pegase, o, choix)
                for (id in nav.prives) {
                    val v = nav.vivants[id] ?: continue
                    LigneOnglet(pegase, OngletInfo(id, v.url, v.titre.ifBlank { "Onglet privé" }, null, false, false, 0.0, 0), choix, prive = true)
                }
                if (nav.groupe.size >= 2 && !choix) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).background(p.tuile.c())
                            .clickable { nav.montrer(nav.groupe.first()) }
                            .semantics { contentDescription = "${nav.groupe.size} pages l'une sur l'autre" }
                            .padding(horizontal = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        nav.groupe.forEachIndexed { i, id ->
                            if (i > 0) Box(Modifier.width(1.dp).height(22.dp).background(p.texte.c().copy(alpha = 0.3f)))
                            val u = Adresse.pourAffichage(nav.vivants[id]?.url)
                            Row(Modifier.weight(1f).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Lettre(u, Palettes.teintePour(u).c())
                                T(u.ifEmpty { "Nouvel onglet" }, lignes = 1)
                            }
                        }
                    }
                }
                T(
                    if (pegase.tablette) "Sur tablette, un groupe s'ouvre en 4 pages l'une sur l'autre." else "Sur téléphone, un groupe s'ouvre en 2 pages l'une sur l'autre (4 sur tablette).",
                    taille = 12.sp, doux = true, modifier = Modifier.padding(horizontal = 6.dp),
                )
            }
        }

        Column(Modifier.padding(top = 10.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                for (e in espaces) {
                    val choisi = e.id == espace.id
                    Row(
                        Modifier.height(34.dp).clip(RoundedCornerShape(17.dp)).background(if (choisi) p.tuileForte.c() else Color.Transparent)
                            .clickable(role = Role.Tab) { pegase.espaceActif = e.id }
                            .semantics { selected = choisi }
                            .padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(e.couleur.c()))
                        T(e.nom, taille = 13.sp, poids = if (choisi) FontWeight.SemiBold else FontWeight.Medium, doux = !choisi)
                    }
                }
                BoutonIcone(Icones.plus, "Nouvel espace", { pegase.feuille = Feuille.ESPACES }, taille = 18.dp)
            }
            Row(
                Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(16.dp)).background(p.tuileForte.c()).padding(start = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icone(Icones.loupe, null, taille = 18.dp)
                Box(Modifier.weight(1f)) {
                    Champ(saisie, { saisie = it }, null, "Chercher ou saisir une adresse…", clavier = KeyboardType.Uri, action = ImeAction.Go, surAction = {
                        if (saisie.isNotBlank()) nav.ouvrir(saisie)
                    })
                }
                BoutonIcone(Icones.micro, "Parler", { parler() })
            }
        }
    }
}

@Composable
private fun LigneOnglet(pegase: Pegase, o: OngletInfo, choix: Boolean, prive: Boolean = false) {
    val nav = pegase.navigateur
    val p = LocalPalette.current
    val montre = o.id == nav.actif
    val hote = Adresse.pourAffichage(o.url)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
            .background(if (montre) p.tuileForte.c() else p.tuile.c())
            .clickable { if (choix) { nav.partager(o.id); pegase.choixPartage = false } else nav.montrer(o.id) }
            .padding(start = 12.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (prive) Icone(Icones.prive, "Privé", taille = 20.dp) else Lettre(hote.ifEmpty { o.titre }, Palettes.teintePour(hote).c())
        T(o.titre.ifBlank { hote.ifBlank { "Nouvel onglet" } }, Modifier.weight(1f), lignes = 1)
        if (!choix) BoutonIcone(Icones.fermerRond, "Fermer ${o.titre.ifBlank { hote }}", { nav.fermer(o.id) }, p.texteDoux.c(), taille = 20.dp, modifier = Modifier.size(36.dp))
    }
}

@Composable
private fun LigneEpinglee(pegase: Pegase, o: OngletInfo, choix: Boolean) {
    val nav = pegase.navigateur
    val hote = Adresse.pourAffichage(o.url)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp))
            .clickable { if (choix) { nav.partager(o.id); pegase.choixPartage = false } else nav.montrer(o.id) }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Lettre(hote, Color(0xFFF2F3FA))
        T(o.titre.ifBlank { hote }, Modifier.weight(1f), lignes = 1)
        if (!choix) BoutonIcone(Icones.fermer, "Ne plus épingler", { nav.epingler(o.id, false) }, LocalPalette.current.texteDoux.c(), taille = 14.dp, modifier = Modifier.size(36.dp))
    }
}

// ------------------------------------------------------------------ écran 12 : le menu de Pégase et la couleur

@Composable
fun FeuilleMenu(pegase: Pegase) {
    val nav = pegase.navigateur
    val p = LocalPalette.current
    val s = pegase.session
    FeuilleDuBas({ pegase.feuille = null }) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                .background(Brush.radialGradient(listOf(Color(0x52F2C366), Color(0x00F2C366)), radius = 500f))
                .background(p.tuile.c()).padding(10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(s?.nom ?: "Pégase", 44.dp)
            Column(Modifier.weight(1f).clickable { pegase.feuille = Feuille.PROFIL }) {
                T(s?.nom ?: "Sur ce téléphone", poids = FontWeight.SemiBold, lignes = 1)
                T(if (s != null) "Compte Odin · ${pegase.indicateur.texte}" else "Sans Odin · rien n'est synchronisé", taille = 12.sp, doux = true, lignes = 1)
            }
            Box(
                Modifier.height(40.dp).clip(RoundedCornerShape(10.dp)).background(p.tuile.c()).clickable(role = Role.Button) {
                    pegase.feuille = Feuille.PROFIL
                }.padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) { T("Changer", taille = 13.sp, poids = FontWeight.SemiBold) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TuileMenu("Onglet", Icones.plus, Modifier.weight(1f)) { nav.ouvrir() }
            TuileMenu("Privé", Icones.prive, Modifier.weight(1f)) { nav.ouvrir(prive = true) }
            TuileMenu("Partager", Icones.partage, Modifier.weight(1f)) {
                pegase.choixPartage = true
                pegase.feuille = Feuille.ONGLETS
            }
            TuileMenu("Vidéo", Icones.video, Modifier.weight(1f)) {
                val o = nav.ongletActif()
                if (o?.media != null) {
                    nav.suivre(o.id)
                    // La vidéo te suit : on revient à l'onglet précédent.
                    pegase.onglets().lastOrNull { it.id != o.id && !it.range }?.let { nav.montrer(it.id) } ?: nav.ouvrir()
                } else {
                    pegase.message = "Lance d'abord une vidéo dans la page : elle te suivra en petite fenêtre."
                    pegase.feuille = null
                }
            }
        }
        Column(Modifier.clip(RoundedCornerShape(14.dp)).background(p.tuile.c().copy(alpha = 0.5f)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            T("Couleur du navigateur · ${pegase.theme.nom}", taille = 12.sp, poids = FontWeight.SemiBold, doux = true)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                for (t in Theme.CHOIX) Pastille(t, t == pegase.theme) { pegase.choisirTheme(t) }
            }
        }
        Column {
            LigneMenu("Espaces de travail", Icones.espaces) { pegase.feuille = Feuille.ESPACES }
            LigneMenu("Favoris", Icones.etoile) { pegase.feuille = Feuille.FAVORIS }
            LigneMenu("Agenda", Icones.agenda) { pegase.feuille = Feuille.AGENDA }
            LigneMenu("Demander à Odin", Icones.odin) { pegase.feuille = Feuille.ODIN }
            LigneMenu("Téléchargements · Asclépios", Icones.telecharger) { pegase.feuille = Feuille.TELECHARGEMENTS }
            LigneMenu("Onglets rangés", Icones.ranges) { pegase.feuille = Feuille.RANGES }
            LigneMenu("Réglages", Icones.reglages) { pegase.feuille = Feuille.REGLAGES }
            if (s != null) {
                LigneMenu("Se déconnecter", Icones.sortie, Palettes.ROUGE_TEXTE.c(), fleche = false) { pegase.deconnecter() }
            } else {
                LigneMenu("Se connecter à Odin", Icones.profil, fleche = false) {
                    pegase.feuille = null
                    pegase.ecran = com.toufatech.pegase.appli.Ecran.CONNEXION
                }
            }
        }
    }
}

@Composable
private fun TuileMenu(nom: String, icone: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Tuile(modifier.heightIn(min = 64.dp), onClick = onClick) {
        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp, horizontal = 2.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Icone(icone, null, taille = 22.dp)
            T(nom, taille = 12.sp)
        }
    }
}

@Composable
private fun LigneMenu(nom: String, icone: ImageVector, couleur: Color? = null, fleche: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 46.dp).clip(RoundedCornerShape(10.dp)).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(p.tuile.c()), contentAlignment = Alignment.Center) {
            Icone(icone, null, couleur ?: p.texte.c(), 18.dp)
        }
        T(nom, Modifier.weight(1f), couleur = couleur)
        if (fleche) T("›", doux = true)
    }
}

/** Une pastille de couleur du menu (entourée quand elle est choisie). */
@Composable
private fun Pastille(t: Theme, choisi: Boolean, onClick: () -> Unit) {
    val pal = com.toufatech.pegase.coeur.Palettes
    val fond: Brush = if (t == Theme.AUTO) {
        Brush.sweepGradient(listOf(Color(0xFF0D0E12), Color(0xFFFFFFFF), Color(0xFF1F3BB0), Color(0xFFB3263A), Color(0xFF7FB2FF)))
    } else {
        val l = pal.de(t).pastille.map { it.c() }
        if (l.size == 1) Brush.linearGradient(listOf(l[0], l[0])) else Brush.linearGradient(l)
    }
    Column(
        Modifier.width(44.dp).heightIn(min = 56.dp).clip(RoundedCornerShape(10.dp))
            .clickable(role = Role.RadioButton, onClick = onClick)
            .semantics { selected = choisi; contentDescription = "Couleur ${t.nom}" },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(
            Modifier.padding(top = 2.dp).size(36.dp)
                .then(if (choisi) Modifier.border(2.dp, LocalPalette.current.texte.c(), RoundedCornerShape(12.dp)) else Modifier)
                .padding(if (choisi) 3.dp else 2.dp)
                .clip(RoundedCornerShape(10.dp)).background(fond)
                .border(1.dp, Color.White.copy(alpha = 0.3f), RoundedCornerShape(10.dp)),
        )
        T(t.nomCourt, taille = 10.sp)
    }
}

// ------------------------------------------------------------------ onglets rangés, espaces de travail

@Composable
fun FeuilleRanges(pegase: Pegase) {
    val _r = pegase.revision
    val ranges = pegase.onglets().filter { it.range }.sortedByDescending { it.maj }
    FeuilleDuBas({ pegase.feuille = null }) {
        T("Onglets rangés", taille = 18.sp, titre = true)
        Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (ranges.isEmpty()) T("Rien de rangé. « Ranger » met de côté les onglets du jour non épinglés.", doux = true)
            for (o in ranges) {
                val hote = Adresse.pourAffichage(o.url)
                Tuile(Modifier.fillMaxWidth(), onClick = { pegase.navigateur.ressortir(o.id) }) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Lettre(hote, Palettes.teintePour(hote).c())
                        Column(Modifier.weight(1f)) {
                            T(o.titre.ifBlank { hote }, lignes = 1)
                            T(hote, taille = 12.sp, doux = true, lignes = 1)
                        }
                        BoutonIcone(Icones.fermerRond, "Supprimer", { pegase.navigateur.fermer(o.id) }, taille = 18.dp, modifier = Modifier.size(36.dp))
                    }
                }
            }
        }
    }
}

@Composable
fun FeuilleEspaces(pegase: Pegase) {
    val _r = pegase.revision
    var nom by remember { mutableStateOf("") }
    val onglets = pegase.onglets()
    FeuilleDuBas({ pegase.feuille = null }) {
        T("Espaces de travail", taille = 18.sp, titre = true)
        for (e in pegase.espaces()) {
            val n = onglets.count { (it.espace ?: com.toufatech.pegase.appli.Pegase.ESPACE_DEFAUT) == e.id && !it.range }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 46.dp).clip(RoundedCornerShape(10.dp)).clickable {
                    pegase.espaceActif = e.id
                    pegase.feuille = Feuille.ONGLETS
                }.padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(Modifier.size(22.dp).clip(RoundedCornerShape(7.dp)).background(e.couleur.c()))
                T(e.nom, Modifier.weight(1f), poids = FontWeight.SemiBold)
                T("$n onglet" + if (n > 1) "s" else "", taille = 12.sp, doux = true)
            }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Champ(nom, { nom = it.take(40) }, "Nouvel espace", "Clients, Maison…", Modifier.weight(1f), action = ImeAction.Done)
            BoutonPrincipal("Créer", {
                if (nom.isNotBlank()) {
                    pegase.creerEspace(nom)
                    nom = ""
                }
            }, Modifier.width(96.dp))
        }
    }
}
