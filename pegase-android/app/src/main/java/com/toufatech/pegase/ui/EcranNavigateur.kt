package com.toufatech.pegase.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.toufatech.pegase.R
import com.toufatech.pegase.appli.Feuille
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Adresse
import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.coeur.texte
import com.toufatech.pegase.moteur.Etape
import com.toufatech.pegase.moteur.Telechargement
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

// ------------------------------------------------------------------ écrans 9 et 13 : le site, la barre du bas, les pages partagées

@Composable
fun EcranNavigateur(pegase: Pegase) {
    val nav = pegase.navigateur
    val actif = nav.actif
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth().statusBarsPadding()) {
            when {
                nav.groupe.size >= 2 -> PagesPartagees(pegase)
                actif == null -> Accueil(pegase)
                nav.vivants[actif]?.url.isNullOrEmpty() && pegase.onglets().firstOrNull { it.id == actif }?.url.isNullOrEmpty() -> Accueil(pegase)
                else -> VuePage(pegase, actif, Modifier.fillMaxSize())
            }
            nav.ongletActif()?.let { o ->
                if (o.progression in 1..99) {
                    Box(Modifier.fillMaxWidth(o.progression / 100f).height(2.dp).background(Color(0xFFB98CFF)))
                }
            }
        }
        BarreDuBas(pegase)
    }
    VideosQuiSuivent(pegase)
}

/** Une page GeckoView (une page ne peut s'afficher qu'à un seul endroit à la fois). */
@Composable
fun VuePage(pegase: Pegase, id: String, modifier: Modifier) {
    val nav = pegase.navigateur
    key(id) {
        AndroidView(
            factory = { ctx -> GeckoView(ctx) },
            modifier = modifier,
            update = { v ->
                val s = nav.session(id)
                if (v.session !== s) {
                    Affichages.liberer(s)
                    v.releaseSession()
                    v.setSession(s)
                    Affichages.vues[s] = v
                }
                s.setActive(true)
            },
            onRelease = { v ->
                v.session?.let { if (Affichages.vues[it] === v) Affichages.vues.remove(it) }
                v.releaseSession()
            },
        )
        DisposableEffect(id) {
            onDispose {
                if (id != nav.actif && id !in nav.groupe && id !in nav.suivent) nav.vivants[id]?.session?.setActive(false)
            }
        }
    }
}

/** Où chaque page est affichée, pour la détacher avant de la montrer ailleurs (petite fenêtre ↔ grand). */
private object Affichages {
    val vues = HashMap<GeckoSession, GeckoView>()

    fun liberer(s: GeckoSession) {
        vues.remove(s)?.let { if (it.session === s) it.releaseSession() }
    }
}

@Composable
private fun BarreDuBas(pegase: Pegase) {
    val nav = pegase.navigateur
    val p = LocalPalette.current
    val o = nav.ongletActif()
    val partage = nav.groupe.size >= 2
    val nbOnglets = pegase.onglets().count { !it.range } + nav.prives.size
    val hote = Adresse.pourAffichage(o?.url)
    val sansBouclier = hote in pegase.reglageListe("sans-bouclier") || !pegase.reglageBool("bloqueur", true)
    val _r = pegase.revision
    Column(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(14.dp)).background(p.tuileForte.c())
                .clickable(role = Role.Button) { pegase.feuille = Feuille.ADRESSE }
                .semantics { contentDescription = if (hote.isEmpty()) "Chercher ou saisir une adresse" else "Adresse : $hote. Toucher pour la changer" }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (partage) {
                Icone(Icones.partage, null, p.texte.c(), 18.dp)
                T("${nav.groupe.size} pages · " + nav.groupe.joinToString(" + ") { Adresse.pourAffichage(nav.vivants[it]?.url).substringBefore('.') }, Modifier.weight(1f), lignes = 1)
            } else {
                Icone(if (sansBouclier) Icones.bouclierVide else Icones.bouclier, null, if (sansBouclier) p.texteDoux.c() else Palettes.VERT_TEXTE.c(), 16.dp)
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { T(hote.ifEmpty { "Chercher ou saisir une adresse" }, taille = 16.sp, poids = FontWeight.Medium, lignes = 1, doux = hote.isEmpty()) }
                if ((o?.bloques ?: 0) > 0) {
                    Box(Modifier.clip(RoundedCornerShape(999.dp)).background(Palettes.VERT.c().copy(alpha = 0.25f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                        T("${o?.bloques} bloqués", taille = 12.sp, poids = FontWeight.SemiBold, couleur = if (p.texte == 0xFF1C1F2BL) Color(0xFF0F6B3A) else Color(0xFFDFFBEA))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BoutonIcone(Icones.recul, "Page précédente", { o?.session?.goBack() }, actif = o?.peutReculer == true)
            if (partage) {
                BoutonIcone(Icones.partagePlus, "Ajouter une page à l'écran partagé", { pegase.choixPartage = true; pegase.feuille = Feuille.ONGLETS })
            } else {
                BoutonIcone(Icones.avance, "Page suivante", { o?.session?.goForward() }, actif = o?.peutAvancer == true)
                BoutonIcone(Icones.plus, "Nouvel onglet", { nav.ouvrir() })
            }
            Box(
                Modifier.size(48.dp, 44.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button) { pegase.choixPartage = false; pegase.feuille = Feuille.ONGLETS }
                    .semantics { contentDescription = "Onglets et espaces, $nbOnglets onglets" },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(22.dp).border(2.dp, p.texte.c(), RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                    T(if (nbOnglets > 99) "∞" else nbOnglets.toString(), taille = 11.sp, poids = FontWeight.Bold)
                }
            }
            if (partage) {
                BoutonIcone(Icones.video, "${nav.suivent.size} vidéos en petite fenêtre", { nav.ongletActif()?.let { if (it.enLecture) nav.suivre(it.id) } })
            }
            Box(
                Modifier.size(48.dp, 44.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button) { pegase.feuille = Feuille.TELECHARGEMENTS }
                    .semantics { contentDescription = "Asclépios : protégé. Téléchargements" },
                contentAlignment = Alignment.Center,
            ) { Image(painterResource(R.drawable.icone_ullr), null, Modifier.size(24.dp).clip(RoundedCornerShape(7.dp))) }
            Box(
                Modifier.size(48.dp, 44.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button) { pegase.feuille = Feuille.MENU }
                    .semantics { contentDescription = "Ton profil et le menu" },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(26.dp).clip(CircleShape).background(Palettes.OR.c()), contentAlignment = Alignment.Center) {
                    val nom = pegase.session?.nom
                    if (nom != null) T(nom.take(1).uppercase(), taille = 13.sp, poids = FontWeight.Bold, couleur = Color(0xFF14100A))
                    else Icone(Icones.profil, null, Color(0xFF14100A), 15.dp)
                }
            }
        }
    }
}

/** 2 pages l'une sur l'autre (4 sur tablette), la séparation se glisse pour changer les hauteurs. */
@Composable
private fun PagesPartagees(pegase: Pegase) {
    val nav = pegase.navigateur
    val ids = nav.groupe.toList()
    val poids = remember(ids.size) { mutableStateOf(List(ids.size) { 1f }) }
    BoxWithConstraints(Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 6.dp)) {
        val hauteur = constraints.maxHeight.toFloat().coerceAtLeast(1f)
        Column(Modifier.fillMaxSize()) {
            ids.forEachIndexed { i, id ->
                val v = nav.vivants[id]
                val enCours = id == nav.actif
                Column(
                    Modifier.weight(poids.value.getOrElse(i) { 1f }).fillMaxWidth().clip(RoundedCornerShape(14.dp))
                        .then(if (enCours) Modifier.border(2.dp, Color(0xFFA9B4FF), RoundedCornerShape(14.dp)) else Modifier)
                        .background(Color(0xFFF5F2EC)),
                ) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).background(Color(0xFFF5F2EC)).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        BoutonIcone(Icones.recul, "Page précédente", { v?.session?.goBack() }, Color(0xFF1C2430), actif = v?.peutReculer == true, modifier = Modifier.size(40.dp))
                        Box(Modifier.weight(1f).clickable { nav.montrer(id) }, contentAlignment = Alignment.Center) {
                            T(Adresse.pourAffichage(v?.url).ifEmpty { "Nouvel onglet" }, taille = 14.sp, poids = FontWeight.Medium, couleur = Color(0xFF1C2430), lignes = 1)
                        }
                        BoutonIcone(Icones.fermer, "Retirer cette page", { nav.retirerDuGroupe(id) }, Color(0xFF1C2430), modifier = Modifier.size(40.dp))
                    }
                    VuePage(pegase, id, Modifier.fillMaxSize())
                }
                if (i < ids.size - 1) {
                    Box(
                        Modifier.fillMaxWidth().height(14.dp)
                            .semantics { contentDescription = "Glisser pour changer la hauteur" }
                            .pointerInput(i, ids.size) {
                                detectVerticalDragGestures { change, dy ->
                                    change.consume()
                                    val total = poids.value.sum()
                                    val part = dy / hauteur * total
                                    val l = poids.value.toMutableList()
                                    if (l[i] + part > 0.25f && l[i + 1] - part > 0.25f) {
                                        l[i] += part
                                        l[i + 1] -= part
                                        poids.value = l
                                    }
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) { Box(Modifier.size(48.dp, 5.dp).clip(RoundedCornerShape(3.dp)).background(Color.White.copy(alpha = 0.8f))) }
                }
            }
        }
    }
}

/** Les vidéos qui te suivent : petites fenêtres à droite (2 sur téléphone, 4 sur tablette). */
@Composable
private fun VideosQuiSuivent(pegase: Pegase) {
    val nav = pegase.navigateur
    if (nav.suivent.isEmpty()) return
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(end = 14.dp, bottom = 108.dp), contentAlignment = Alignment.BottomEnd) {
        Column(Modifier.width(if (pegase.tablette) 240.dp else 172.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (id in nav.suivent.toList()) {
                val v = nav.vivants[id] ?: continue
                Box(
                    Modifier.fillMaxWidth().height(if (pegase.tablette) 135.dp else 98.dp).clip(RoundedCornerShape(12.dp))
                        .background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(12.dp))
                        .semantics { contentDescription = (v.titreMedia ?: v.titre) + if (v.enLecture) "" else ", en pause" },
                ) {
                    VuePage(pegase, id, Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0x73000000), Color.Transparent, Color(0x99000000)))))
                    PetitBouton(Icones.retourOnglet, "Retourner à l'onglet", Modifier.align(Alignment.TopStart).padding(4.dp)) { nav.montrer(id) }
                    PetitBouton(Icones.fermer, "Fermer la vidéo", Modifier.align(Alignment.TopEnd).padding(4.dp)) { nav.nePlusSuivre(id, pause = true) }
                    Box(
                        Modifier.align(Alignment.Center).size(36.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.92f))
                            .clickable(role = Role.Button) { if (v.enLecture) v.media?.pause() else v.media?.play() }
                            .semantics { contentDescription = if (v.enLecture) "Pause" else "Lecture" },
                        contentAlignment = Alignment.Center,
                    ) { Icone(if (v.enLecture) Icones.pause else Icones.lecture, null, Color(0xFF111111), 16.dp) }
                    Box(Modifier.align(Alignment.BottomCenter).padding(6.dp).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.35f))) {
                        Box(Modifier.fillMaxWidth(v.position.coerceIn(0f, 1f)).fillMaxHeight().background(Color.White))
                    }
                }
            }
        }
    }
}

@Composable
private fun PetitBouton(icone: androidx.compose.ui.graphics.vector.ImageVector, description: String, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(Color(0x73000000))
            .clickable(role = Role.Button, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Icone(icone, null, Color.White, 16.dp) }
}

// ------------------------------------------------------------------ la page d'accueil d'un nouvel onglet

@Composable
private fun Accueil(pegase: Pegase) {
    val _r = pegase.revision
    var idees by remember { mutableStateOf<List<Map<String, Any?>>>(emptyList()) }
    LaunchedEffect(pegase.session) {
        val api = pegase.apiOdin() ?: return@LaunchedEffect
        pegase.enFond {
            val l = api.propositions()
            pegase.surUi { idees = l }
        }
    }
    val favoris = pegase.favoris().take(8)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Image(painterResource(R.drawable.logo_pegase), null, Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)))
            T(pegase.session?.nom?.let { "Bonjour $it" } ?: "Pégase", taille = 22.sp, titre = true)
        }
        if (favoris.isNotEmpty()) GrilleFavoris(pegase, favoris)
        if (idees.isNotEmpty()) {
            T("Odin te propose", poids = FontWeight.SemiBold)
            for (i in idees) {
                Tuile(Modifier.fillMaxWidth(), onClick = { i.texte("url")?.let { pegase.navigateur.aller(it) } }) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        T(i.texte("titre") ?: "", poids = FontWeight.SemiBold)
                        i.texte("texte")?.let { T(it, taille = 13.sp, doux = true) }
                    }
                }
            }
        }
        if (favoris.isEmpty() && idees.isEmpty()) {
            T("Tape une adresse ou une recherche en bas. Tes favoris et les idées d'Odin s'afficheront ici.", doux = true)
        }
    }
}

/** Les favoris en tuiles, 4 par ligne (écran 10). */
@Composable
fun GrilleFavoris(pegase: Pegase, favoris: List<com.toufatech.pegase.appli.Favori>) {
    LazyVerticalGrid(
        GridCells.Fixed(4),
        Modifier.fillMaxWidth().heightIn(max = 220.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        userScrollEnabled = false,
    ) {
        items(favoris, key = { it.id }) { f ->
            Tuile(Modifier.fillMaxWidth(), onClick = {
                val nav = pegase.navigateur
                if (nav.actif == null) nav.ouvrir(f.url) else nav.aller(f.url)
            }) {
                Column(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 8.dp, start = 2.dp, end = 2.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Lettre(Adresse.pourAffichage(f.url).ifEmpty { f.titre }, Palettes.teintePour(Adresse.pourAffichage(f.url)).c(), 32.dp, 9.dp, 15.sp)
                    T(f.titre, taille = 11.sp, lignes = 1)
                }
            }
        }
    }
}

// ------------------------------------------------------------------ la barre d'adresse

@Composable
fun FeuilleAdresse(pegase: Pegase) {
    val nav = pegase.navigateur
    val o = nav.ongletActif()
    var saisie by remember { mutableStateOf(o?.url?.takeIf { it.startsWith("http") } ?: "") }
    val _r = pegase.revision
    val q = saisie.trim().lowercase()
    val suggestions = remember(q, pegase.revision) {
        if (q.length < 2) emptyList() else {
            val fav = pegase.favoris().filter { it.url.lowercase().contains(q) || it.titre.lowercase().contains(q) }.map { it.titre to it.url }
            val hist = (pegase.profil?.donnees?.actifs(Cols.HISTORIQUE) ?: emptyList())
                .sortedByDescending { it.maj }
                .mapNotNull { e -> e.data.texte("url")?.let { (e.data.texte("titre") ?: it) to it } }
                .filter { it.second.lowercase().contains(q) || it.first.lowercase().contains(q) }
            (fav + hist).distinctBy { it.second }.take(6)
        }
    }
    val parler = rememberParole { texte -> nav.aller(texte) }
    FeuilleDuBas({ pegase.feuille = null }) {
        Row(
            Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(16.dp)).background(LocalPalette.current.tuileForte.c()).padding(start = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icone(Icones.loupe, null, taille = 18.dp)
            Box(Modifier.weight(1f)) {
                Champ(saisie, { saisie = it }, null, "Chercher ou saisir une adresse…", clavier = KeyboardType.Uri, action = ImeAction.Go, surAction = { if (saisie.isNotBlank()) nav.aller(saisie) })
            }
            BoutonIcone(Icones.micro, "Parler", { parler() })
        }
        for ((titre, url) in suggestions) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(10.dp)).clickable { nav.aller(url) }.padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Lettre(Adresse.pourAffichage(url), Palettes.teintePour(Adresse.pourAffichage(url)).c())
                Column(Modifier.weight(1f)) {
                    T(titre, lignes = 1)
                    T(url, taille = 12.sp, doux = true, lignes = 1)
                }
            }
        }
        if (o != null && o.url.startsWith("http")) {
            val hote = Adresse.pourAffichage(o.url)
            val sans = hote in pegase.reglageListe("sans-bouclier")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BoutonContour("☆ Favori", { pegase.ajouterFavori(o.url, o.titre.ifBlank { hote }) }, Modifier.weight(1f))
                BoutonContour(if (sans) "Remettre le Bouclier" else "Couper le Bouclier ici", { nav.basculerBouclier(hote) }, Modifier.weight(1.4f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BoutonContour("Recharger", { o.session?.reload(); pegase.feuille = null }, Modifier.weight(1f))
                BoutonContour("Partager le lien", { pegase.partagerTexte(o.url) }, Modifier.weight(1f))
            }
            T(if (o.securise) "Connexion chiffrée avec $hote." else "Attention : la connexion avec $hote n'est pas chiffrée.", taille = 12.sp, doux = o.securise, couleur = if (o.securise) null else Palettes.ROUGE_TEXTE.c())
        }
    }
}

// ------------------------------------------------------------------ téléchargements (écran 9)

@Composable
fun FeuilleTelechargement(pegase: Pegase, t: Telechargement) {
    val tl = pegase.telechargements
    FeuilleDuBas({ tl.montre = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Image(painterResource(R.drawable.icone_ullr), null, Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)))
            Column(Modifier.weight(1f)) {
                T(t.nom, taille = 16.sp, poids = FontWeight.SemiBold, lignes = 2)
                T(t.texte, taille = 13.sp, doux = true)
            }
        }
        LigneEtape(t.antivirus, when (t.antivirus) {
            Etape.OK -> "Antivirus : rien trouvé"
            Etape.BLOQUE -> "Antivirus : fichier malveillant connu"
            Etape.SAUTEE -> "Antivirus : pas encore de liste d'Asclépios (connecte Odin)"
            else -> "Antivirus : analyse…"
        })
        LigneEtape(t.odin, when (t.odin) {
            Etape.OK -> "Anti-malware : rien trouvé"
            Etape.ALERTE -> "Anti-malware : fichier douteux"
            Etape.BLOQUE -> "Anti-malware : menace trouvée"
            Etape.SAUTEE -> "Anti-malware : pas envoyé à Odin (à permettre dans les réglages)"
            Etape.EN_COURS -> "Anti-malware : Odin analyse…"
            else -> "Anti-malware : en attente"
        })
        LigneEtape(t.enregistrement, when (t.enregistrement) {
            Etape.OK -> "Enregistré dans Téléchargements"
            Etape.BLOQUE -> "Effacé (rien n'a été ouvert)"
            Etape.EN_COURS -> "Enregistrement dans Téléchargements…"
            else -> "Enregistrement : en attente du verdict"
        })
        if (t.question) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BoutonContour("Effacer", { tl.decider(t, false) }, Modifier.weight(1f))
                BoutonContour("Garder quand même", { tl.decider(t, true) }, Modifier.weight(1f), Palettes.ROUGE_TEXTE.c())
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(12.dp)).background(if (t.uri != null) Palettes.ACCENT.c() else Palettes.ACCENT.c().copy(alpha = 0.4f))
                        .clickable(enabled = t.uri != null, role = Role.Button) { tl.ouvrir(t) },
                    contentAlignment = Alignment.Center,
                ) { T("Ouvrir", poids = FontWeight.SemiBold, couleur = Color.White) }
                BoutonContour("Partager…", { tl.partager(t) }, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun LigneEtape(e: Etape, texte: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val (fond, signe) = when (e) {
            Etape.OK -> Palettes.VERT.c() to Icones.coche
            Etape.BLOQUE -> Color(0xFFFF5A4E) to Icones.fermer
            Etape.ALERTE -> Color(0xFFF2C366) to Icones.haut
            else -> Color.Transparent to null
        }
        Box(
            Modifier.size(22.dp).clip(CircleShape).background(fond)
                .then(if (signe == null) Modifier.border(2.dp, Color(0xFF7FB2FF), CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) { if (signe != null) Icone(signe, null, Color(0xFF06210F), 13.dp) }
        T(texte, taille = 14.sp, modifier = Modifier.weight(1f))
    }
}

@Composable
fun FeuilleTelechargements(pegase: Pegase) {
    val tl = pegase.telechargements
    val _r = pegase.revision
    val journal = (pegase.profil?.donnees?.actifs(Cols.TELECHARGEMENTS) ?: emptyList()).sortedByDescending { it.maj }.take(30)
    FeuilleDuBas({ pegase.feuille = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Image(painterResource(R.drawable.icone_ullr), null, Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)))
            T("Téléchargements · Asclépios", taille = 18.sp, titre = true)
        }
        T("Chaque fichier reste en quarantaine jusqu'au verdict. « Rien trouvé » n'est jamais une garantie.", taille = 12.sp, doux = true)
        Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (t in tl.liste) {
                Tuile(Modifier.fillMaxWidth(), onClick = { tl.montre = t }) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            T(t.nom, poids = FontWeight.SemiBold, lignes = 1)
                            T(t.texte, taille = 12.sp, doux = true, lignes = 2)
                        }
                    }
                }
            }
            val ici = tl.liste.map { it.id }.toSet()
            for (e in journal.filter { it.id !in ici }) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp)) {
                    Column(Modifier.weight(1f)) {
                        T(e.data.texte("nom") ?: "fichier", lignes = 1)
                        T(
                            when (e.data.texte("verdict")) {
                                "bloque" -> "bloqué"
                                "sain" -> "rien trouvé"
                                "douteux" -> "gardé, douteux"
                                else -> "rien de connu"
                            } + " · " + Adresse.pourAffichage(e.data.texte("url")),
                            taille = 12.sp, doux = true, lignes = 1,
                        )
                    }
                }
            }
            if (tl.liste.isEmpty() && journal.isEmpty()) T("Aucun téléchargement pour l'instant.", doux = true)
        }
    }
}
