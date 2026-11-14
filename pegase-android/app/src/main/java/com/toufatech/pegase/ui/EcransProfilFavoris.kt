package com.toufatech.pegase.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.toufatech.pegase.R
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Adresse
import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.EtatSynchro
import com.toufatech.pegase.coeur.Palettes

/** Un écran plein (profil, favoris, agenda, réglages) : en-tête avec retour, contenu qui défile. */
@Composable
fun PagePleine(
    titre: String,
    fermer: () -> Unit,
    droite: @Composable () -> Unit = {},
    defile: Boolean = true,
    contenu: @Composable ColumnScope.() -> Unit,
) {
    val p = LocalPalette.current
    Column(Modifier.fillMaxSize().fondPegase(p).statusBarsPadding().navigationBarsPadding().imePadding().padding(horizontal = 14.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            BoutonIcone(Icones.recul, "Retour", fermer)
            T(titre, Modifier.weight(1f).semantics { heading() }, taille = 24.sp, titre = true)
            droite()
        }
        Column(
            (if (defile) Modifier.verticalScroll(rememberScrollState()) else Modifier).weight(1f, fill = false).padding(top = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = contenu,
        )
    }
}

// ------------------------------------------------------------------ écran 14 : ton profil, glisser-déposer

@Composable
fun EcranProfil(pegase: Pegase) {
    val p = LocalPalette.current
    val _r = pegase.revision
    val s = pegase.session
    var quitter by remember { mutableStateOf(false) }
    val chiffres = pegase.chiffresDuMois()
    PagePleine("Ton profil", { pegase.feuille = null }) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
                .background(Brush.radialGradient(listOf(Color(0x59F2C366), Color(0x00F2C366)), radius = 600f))
                .background(p.tuileForte.c()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(s?.nom ?: "Pégase", 64.dp)
                Column(Modifier.weight(1f)) {
                    T(s?.nom ?: "Sur ce téléphone", taille = 20.sp, titre = true, lignes = 1)
                    val quand = pegase.derniereSynchro?.let { ilYa(it) }
                    T(
                        when {
                            s == null -> "Sans Odin : rien n'est synchronisé"
                            pegase.indicateur.etat == EtatSynchro.SYNCHRONISE && quand != null -> "Synchronisé $quand · ${pegase.appareilsOdin.coerceAtLeast(1)} appareil" + if (pegase.appareilsOdin > 1) "s" else ""
                            else -> pegase.indicateur.texte
                        },
                        taille = 12.sp, doux = true,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier.weight(1f).height(42.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFF2F3FA))
                        .clickable(role = Role.Button) {
                            pegase.feuille = null
                            pegase.ecran = com.toufatech.pegase.appli.Ecran.CONNEXION
                        },
                    contentAlignment = Alignment.Center,
                ) { T("Changer de profil", poids = FontWeight.SemiBold, couleur = Color(0xFF14151E)) }
                BoutonContour("Quitter", { quitter = true })
            }
        }
        T("Appuie longtemps sur une carte, puis fais-la glisser", taille = 12.sp, doux = true, modifier = Modifier.align(Alignment.CenterHorizontally))

        val cartes = listOf(
            Carte("bloques", "%,d".format(chiffres["bloques"] ?: 0).replace(',', ' '), "pubs bloquées ce mois", R.drawable.icone_vidarr),
            Carte("analyses", "${chiffres["analyses"] ?: 0}", "téléchargements analysés", R.drawable.icone_ullr),
            Carte("favoris", "${chiffres["favoris"] ?: 0}", "favoris", R.drawable.icone_brisingamen),
            Carte("heures", "${chiffres["heures"] ?: 0} h", "de navigation", R.drawable.icone_frigg),
        )
        val ordreCartes = pegase.reglageListe("ordre-cartes-profil")
        ListeGlissable(
            cartes.sortedBy { c -> ordreCartes.indexOf(c.id).let { if (it < 0) 99 else it } }, { it.id }, 104.dp,
            { l -> pegase.regler("ordre-cartes-profil", l.map { it.id }) }, colonnes = 2, ecart = 8.dp,
        ) { c, _ ->
            Tuile(Modifier.fillMaxSize()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Image(painterResource(c.icone), null, Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)))
                    T(c.nombre, taille = 20.sp, titre = true)
                    T(c.texte, taille = 12.sp, doux = true, lignes = 1)
                }
            }
        }

        Tuile(Modifier.fillMaxWidth(), coin = 16.dp) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                T("Espaces de travail", poids = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
                val onglets = pegase.onglets()
                ListeGlissable(pegase.espaces(), { it.id }, 46.dp, { l ->
                    if (l.any { it.id != Pegase.ESPACE_DEFAUT }) pegase.reordonner(Cols.ESPACES, l.map { it.id })
                }) { e, _ ->
                    Row(
                        Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)).background(p.tuile.c()).padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        T("⋮⋮", doux = true)
                        Box(Modifier.size(22.dp).clip(RoundedCornerShape(7.dp)).background(e.couleur.c()))
                        T(e.nom, Modifier.weight(1f), poids = FontWeight.SemiBold)
                        val n = onglets.count { (it.espace ?: Pegase.ESPACE_DEFAUT) == e.id && !it.range }
                        T("$n onglet" + if (n > 1) "s" else "", taille = 12.sp, doux = true)
                    }
                }
            }
        }

        Tuile(Modifier.fillMaxWidth(), coin = 16.dp) {
            Column(Modifier.padding(12.dp)) {
                T("Protection", poids = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }.padding(bottom = 4.dp))
                val protections = listOf(
                    Protection("analyse", "Analyse des téléchargements par Odin", R.drawable.icone_ullr, "analyse-odin", false),
                    Protection("sphinx", "Adresses par Sphinx", R.drawable.icone_vidarr, "dns-sphinx", true),
                    Protection("bloqueur", "Bloqueur de pubs et pisteurs", R.drawable.icone_vidarr, "bloqueur", true),
                    Protection("thesauros", "Mots de passe par Thésauros (bientôt)", R.drawable.icone_brisingamen, null, false),
                )
                val ordre = pegase.reglageListe("ordre-protection")
                ListeGlissable(
                    protections.sortedBy { x -> ordre.indexOf(x.id).let { if (it < 0) 99 else it } }, { it.id }, 48.dp,
                    { l -> pegase.regler("ordre-protection", l.map { it.id }) }, ecart = 0.dp,
                ) { x, _ ->
                    Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Image(painterResource(x.icone), null, Modifier.size(24.dp).clip(RoundedCornerShape(7.dp)))
                        T(x.nom, Modifier.weight(1f))
                        if (x.cle != null) {
                            Interrupteur(pegase.reglageBool(x.cle, x.defaut), { pegase.regler(x.cle, it) }, x.nom)
                        } else {
                            Interrupteur(false, {}, x.nom, actif = false)
                        }
                    }
                }
            }
        }
    }
    if (quitter) {
        AlertDialog(
            onDismissRequest = { quitter = false },
            title = { Text("Quitter ce profil ?") },
            text = { Text("Ses données sont effacées de ce téléphone. Elles restent sur Odin : tu les retrouveras en te reconnectant.") },
            confirmButton = { TextButton(onClick = { quitter = false; pegase.quitterProfil() }) { Text("Quitter") } },
            dismissButton = { TextButton(onClick = { quitter = false }) { Text("Annuler") } },
        )
    }
}

private class Carte(val id: String, val nombre: String, val texte: String, val icone: Int)

private class Protection(val id: String, val nom: String, val icone: Int, val cle: String?, val defaut: Boolean)

private fun ilYa(ms: Long): String {
    val s = (System.currentTimeMillis() - ms) / 1000
    return when {
        s < 60 -> "à l'instant"
        s < 3600 -> "il y a ${s / 60} min"
        s < 86400 -> "il y a ${s / 3600} h"
        else -> "il y a ${s / 86400} j"
    }
}

// ------------------------------------------------------------------ écran 17 : favoris

@Composable
fun EcranFavoris(pegase: Pegase) {
    val p = LocalPalette.current
    val _r = pegase.revision
    var recherche by remember { mutableStateOf("") }
    var dossier by remember { mutableStateOf<String?>(null) }
    var nouveauDossier by remember { mutableStateOf<String?>(null) }
    val tous = pegase.favoris()
    val dossiers = pegase.dossiersFavoris()
    val q = recherche.trim().lowercase()
    val liste = tous.filter { (dossier == null || it.dossier == dossier) && (q.isEmpty() || it.titre.lowercase().contains(q) || it.url.lowercase().contains(q)) }
    PagePleine("Favoris", { pegase.feuille = null }, droite = {
        PastilleOdin(pegase.session != null && pegase.indicateur.etat != EtatSynchro.HORS_LIGNE)
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(p.tuileForte.c())) {
            BoutonIcone(Icones.dossierPlus, "Nouveau dossier", { nouveauDossier = "" }, modifier = Modifier.size(44.dp))
        }
    }) {
        Row(
            Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(14.dp)).background(p.tuileForte.c()).padding(start = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icone(Icones.loupe, null, p.texteDoux.c(), 18.dp)
            Box(Modifier.weight(1f)) { Champ(recherche, { recherche = it }, null, "Chercher dans les favoris", action = ImeAction.Search) }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Puce("Tous · ${tous.size}", dossier == null) { dossier = null }
            for (d in dossiers) Puce("$d · ${tous.count { it.dossier == d }}", dossier == d) { dossier = d }
        }
        val o = pegase.navigateur.ongletActif()
        if (o != null && o.url.startsWith("http") && tous.none { it.url == o.url }) {
            BoutonContour("☆ Ajouter « ${o.titre.ifBlank { Adresse.pourAffichage(o.url) }.take(30)} »", { pegase.ajouterFavori(o.url, o.titre, dossier) }, Modifier.fillMaxWidth())
        }
        if (liste.isEmpty()) T(if (tous.isEmpty()) "Pas encore de favori. Ajoute la page ouverte avec ☆ dans la barre d'adresse." else "Rien ne correspond.", doux = true)
        ListeGlissable(liste, { it.id }, 56.dp, { l -> pegase.reordonner(Cols.FAVORIS, (l.map { it.id } + tous.map { it.id }).distinct()) }) { f, _ ->
            val hote = Adresse.pourAffichage(f.url)
            Row(
                Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)).background(p.tuile.c())
                    .clickable { pegase.navigateur.ouvrir(f.url) }.padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Lettre(hote.ifEmpty { f.titre }, Palettes.teintePour(hote).c(), 36.dp, 10.dp, 15.sp)
                Column(Modifier.weight(1f)) {
                    T(f.titre, poids = FontWeight.SemiBold, lignes = 1)
                    T(f.url.removePrefix("https://").removePrefix("http://").removePrefix("www.").trimEnd('/'), taille = 12.sp, doux = true, lignes = 1)
                }
                T("⋮⋮", doux = true)
            }
        }
        T("Appuie longtemps sur un favori pour le déplacer. Les mêmes favoris que sur ton PC, grâce à Odin.", taille = 12.sp, doux = true, modifier = Modifier.align(Alignment.CenterHorizontally))
    }
    nouveauDossier?.let { n ->
        AlertDialog(
            onDismissRequest = { nouveauDossier = null },
            title = { Text("Nouveau dossier") },
            text = { Champ(n, { nouveauDossier = it.take(30) }, null, "Clients, Travail…", action = ImeAction.Done) },
            confirmButton = {
                TextButton(onClick = {
                    val nom = n.trim()
                    if (nom.isNotEmpty()) pegase.regler("dossiers-favoris", (pegase.reglageListe("dossiers-favoris") + nom).distinct())
                    nouveauDossier = null
                    dossier = nom.ifEmpty { null }
                }) { Text("Créer") }
            },
            dismissButton = { TextButton(onClick = { nouveauDossier = null }) { Text("Annuler") } },
        )
    }
}

@Composable
fun Puce(texte: String, choisi: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.height(38.dp).clip(RoundedCornerShape(19.dp))
            .background(if (choisi) Color(0x73B98CFF) else p.tuile.c())
            .then(if (p.givre) Modifier.border(1.dp, p.bordure.c(), RoundedCornerShape(19.dp)) else Modifier)
            .clickable(role = Role.Tab, onClick = onClick).semantics { selected = choisi }
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) { T(texte, taille = 14.sp) }
}
