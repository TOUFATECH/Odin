package com.toufatech.pegase.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.toufatech.pegase.BuildConfig
import com.toufatech.pegase.appli.Ecran
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Adresse
import com.toufatech.pegase.coeur.Theme
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.liste
import com.toufatech.pegase.coeur.objet
import com.toufatech.pegase.coeur.objets
import com.toufatech.pegase.coeur.texte
import com.toufatech.pegase.moteur.Moteur
import com.toufatech.pegase.odin.Epinglage
import java.text.DateFormat
import java.util.Date

@Composable
private fun Section(titre: String, contenu: @Composable ColumnScope.() -> Unit) {
    Tuile(Modifier.fillMaxWidth(), coin = 16.dp) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            T(titre, poids = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            contenu()
        }
    }
}

@Composable
private fun LigneInterrupteur(texte: String, aide: String?, mis: Boolean, changer: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            T(texte)
            if (aide != null) T(aide, taille = 12.sp, doux = true)
        }
        Interrupteur(mis, changer, texte)
    }
}

// ------------------------------------------------------------------ réglages (dont « Synchro Odin »)

@Composable
fun EcranReglages(pegase: Pegase) {
    val _r = pegase.revision
    val s = pegase.session
    val api = pegase.apiOdin()
    var voir by remember { mutableStateOf<String?>(null) }
    var copies by remember { mutableStateOf<List<Map<String, Any?>>?>(null) }
    var restaurer by remember { mutableStateOf<Map<String, Any?>?>(null) }
    var secours by remember { mutableStateOf(pegase.reglageTexte("dns-secours") ?: Moteur.DOH_SECOURS) }
    LaunchedEffect(api) {
        if (api == null) return@LaunchedEffect
        pegase.enFond {
            val m = api.moi()
            if (m.ok) pegase.surUi { voir = m.corps.objet("profil")?.texte("voir") }
        }
    }
    PagePleine("Réglages", { pegase.feuille = null }) {
        Section("Synchro Odin") {
            if (s == null) {
                T("Pégase marche seul sur ce téléphone : rien n'est gardé sur Odin.", doux = true)
                BoutonPrincipal("Se connecter à Odin", { pegase.feuille = null; pegase.ecran = Ecran.CONNEXION }, Modifier.fillMaxWidth())
            } else {
                T(pegase.indicateur.texte, poids = FontWeight.SemiBold)
                T("Odin : ${s.odin}" + (pegase.odinTrouve?.let { " · version ${it.version}" } ?: ""), taille = 13.sp, doux = true)
                T("Certificat épinglé : ${Epinglage.courte(s.empreinte)}", taille = 13.sp, doux = true)
                T("Ce téléphone : ${s.appareilNom}", taille = 13.sp, doux = true)
                T("Synchronisés : profil, favoris, onglets, espaces, historique, agenda, réglages, journal des téléchargements. Jamais : cookies, cache, onglets privés, mots de passe.", taille = 12.sp, doux = true)
                BoutonContour("Synchroniser maintenant", { pegase.synchroniserMaintenant() }, Modifier.fillMaxWidth())
                T("Ce qu'Odin peut lire de ton profil (son IA, sa recherche)", taille = 13.sp)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((v, nom) in listOf("tout" to "Tout", "sans-historique" to "Sans l'historique", "rien" to "Rien")) {
                        Puce(nom, voir == v) {
                            pegase.enFond {
                                val r = api?.reglerVoir(v)
                                pegase.surUi { if (r?.ok == true) voir = v else pegase.message = r?.message ?: "Odin ne répond pas." }
                            }
                        }
                    }
                }
                T("La synchro marche toujours ; ce choix dit seulement ce qu'Odin a le droit de lire.", taille = 12.sp, doux = true)
                BoutonContour("Copies d'Odin (restaurer)", {
                    pegase.enFond {
                        val r = api?.copies()
                        pegase.surUi { if (r?.ok == true) copies = r.corps.liste("copies")?.objets() ?: emptyList() else pegase.message = r?.message }
                    }
                }, Modifier.fillMaxWidth())
                copies?.let { l ->
                    if (l.isEmpty()) T("Pas encore de copie.", doux = true)
                    for (c in l.take(12)) {
                        Tuile(Modifier.fillMaxWidth(), onClick = { restaurer = c }) {
                            Column(Modifier.padding(10.dp)) {
                                T((c.entier("date")?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)) } ?: c.texte("id") ?: "copie"), poids = FontWeight.SemiBold)
                                T(c.texte("raison") ?: "", taille = 12.sp, doux = true)
                            }
                        }
                    }
                }
                BoutonContour("Se déconnecter d'Odin", { pegase.deconnecter() }, Modifier.fillMaxWidth(), com.toufatech.pegase.coeur.Palettes.ROUGE_TEXTE.c())
            }
        }

        Section("Protection") {
            LigneInterrupteur("Bloqueur de pubs et pisteurs", "Dans toutes les pages (coupe-le site par site avec le Bouclier).", pegase.reglageBool("bloqueur", true)) { pegase.regler("bloqueur", it) }
            LigneInterrupteur("Adresses par Sphinx (DNS d'Odin)", pegase.etatDns, pegase.reglageBool("dns-sphinx", true)) { pegase.regler("dns-sphinx", it) }
            LigneInterrupteur(
                "Analyse des téléchargements par Odin",
                "Le fichier part vers Odin (Asclépios), puis il y est effacé. Sans ça, seule la liste des fichiers malveillants connus est vérifiée.",
                pegase.reglageBool("analyse-odin", false),
            ) { pegase.regler("analyse-odin", it) }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Champ(secours, { secours = it.trim() }, "DNS chiffré de secours (sans Odin)", Moteur.DOH_SECOURS, Modifier.weight(1f), clavier = KeyboardType.Uri, action = ImeAction.Done)
                BoutonContour("OK", {
                    if (secours.startsWith("https://")) {
                        pegase.regler("dns-secours", secours)
                        pegase.message = "DNS de secours changé : il servira quand Sphinx n'est pas là."
                    } else {
                        pegase.message = "L'adresse doit commencer par https://"
                    }
                })
            }
        }

        Section("Navigation") {
            T("Moteur de recherche", taille = 13.sp)
            val moteurs = listOf(
                "DuckDuckGo" to Adresse.RECHERCHE_DEFAUT,
                "Qwant" to "https://www.qwant.com/?q=%s",
                "Ecosia" to "https://www.ecosia.org/search?q=%s",
                "Startpage" to "https://www.startpage.com/do/search?q=%s",
                "Google" to "https://www.google.com/search?q=%s",
            )
            val actuel = pegase.navigateur.moteurRecherche()
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((nom, url) in moteurs) Puce(nom, actuel == url) { pegase.regler("moteur", url) }
            }
            T("Mettre en veille les onglets pas regardés depuis", taille = 13.sp)
            val veille = pegase.reglageNombre("veille-minutes", 10)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (m in listOf(5L, 10L, 30L, 60L)) Puce("$m min", veille == m) { pegase.regler("veille-minutes", m) }
            }
            T("Un onglet en veille ne prend plus de mémoire ; il se recharge quand tu y reviens.", taille = 12.sp, doux = true)
        }

        Section("Couleur du navigateur") {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (t in Theme.CHOIX) Puce(t.nom, pegase.theme == t) { pegase.choisirTheme(t) }
            }
            if (pegase.theme == Theme.TRANSPARENT) T("Transparent : le fond d'écran du téléphone se voit derrière Pégase.", taille = 12.sp, doux = true)
            if (pegase.theme == Theme.GLACE) T("Glace : un verre dépoli clair sur des taches de couleur.", taille = 12.sp, doux = true)
        }

        Section("À propos") {
            T("Pégase ${BuildConfig.VERSION_NAME} pour Android · le navigateur d'Odin (licence MIT).", taille = 13.sp)
            T("Moteur : GeckoView de Mozilla (licence MPL 2.0, utilisé tel quel). Polices : IBM Plex Sans et Bricolage Grotesque (licence OFL).", taille = 12.sp, doux = true)
        }
    }

    restaurer?.let { c ->
        AlertDialog(
            onDismissRequest = { restaurer = null },
            title = { Text("Remettre cette copie ?") },
            text = { Text("Tes favoris, onglets, agenda et réglages redeviennent comme dans cette copie, sur tous tes appareils. Odin garde d'abord une copie de maintenant : tu pourras revenir en arrière.") },
            confirmButton = {
                TextButton(onClick = {
                    val id = c.texte("id")
                    restaurer = null
                    if (id != null) {
                        pegase.enFond {
                            val r = api?.restaurer(id)
                            pegase.surUi { pegase.message = r?.corps?.texte("texte") ?: r?.message }
                        }
                    }
                }) { Text("Remettre") }
            },
            dismissButton = { TextButton(onClick = { restaurer = null }) { Text("Annuler") } },
        )
    }
}

// ------------------------------------------------------------------ demander à Odin

@Composable
fun PanneauOdin(pegase: Pegase) {
    val api = pegase.apiOdin()
    val nav = pegase.navigateur
    var question by remember { mutableStateOf("") }
    var reponse by remember { mutableStateOf<String?>(null) }
    var occupe by remember { mutableStateOf(false) }
    var idees by remember { mutableStateOf<List<Map<String, Any?>>>(emptyList()) }
    LaunchedEffect(api) {
        if (api == null) return@LaunchedEffect
        pegase.enFond {
            val l = api.propositions()
            pegase.surUi { idees = l }
        }
    }

    fun demander(texte: String, avecPage: Boolean) {
        if (api == null || texte.isBlank()) return
        occupe = true
        reponse = null
        val envoyer = { url: String?, titre: String?, extrait: String? ->
            pegase.enFond {
                val r = try { api.demander(texte, url, titre, extrait) } catch (e: com.toufatech.pegase.odin.ErreurOdin) { null }
                pegase.surUi {
                    occupe = false
                    reponse = when {
                        r == null -> "Odin ne répond pas : réessaie quand tu es sur le même réseau."
                        r.ok -> r.corps.texte("reponse") ?: "Odin n'a rien répondu."
                        else -> r.message
                    }
                }
            }
        }
        val id = nav.actif
        if (avecPage && id != null) {
            nav.extrait(id) { url, titre, extrait -> envoyer(url, titre, extrait) }
        } else {
            envoyer(null, null, null)
        }
    }

    FeuilleDuBas({ pegase.feuille = null }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icone(Icones.odin, null, taille = 22.dp)
            T("Demander à Odin", taille = 18.sp, titre = true)
        }
        if (api == null) {
            T("Connecte Pégase à Odin pour lui poser des questions.", doux = true)
            return@FeuilleDuBas
        }
        Champ(question, { question = it }, null, "Ta question…", action = ImeAction.Send, surAction = { demander(question, avecPage = false) })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BoutonPrincipal(if (occupe) "Odin réfléchit…" else "Demander", { demander(question, avecPage = false) }, Modifier.weight(1f), actif = !occupe)
        }
        val o = nav.ongletActif()
        if (o != null && o.url.startsWith("http")) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BoutonContour("Résumer cette page", { demander("Résume cette page en 3 points simples.", avecPage = true) }, Modifier.weight(1f))
                BoutonContour("Vérifie ce site", {
                    occupe = true
                    pegase.enFond {
                        val r = try { api.adresse(o.url) } catch (e: com.toufatech.pegase.odin.ErreurOdin) { null }
                        pegase.surUi {
                            occupe = false
                            reponse = when {
                                r == null -> "Odin ne répond pas."
                                r.ok -> (r.corps.texte("texte") ?: "") + when (r.corps.texte("verdict")) {
                                    "dangereux" -> "\nAsclépios : site dangereux."
                                    "douteux" -> "\nAsclépios : site douteux."
                                    else -> "\nAsclépios : rien de connu (ce n'est pas une garantie)."
                                }
                                else -> r.message
                            }
                        }
                    }
                }, Modifier.weight(1f))
            }
            T("Le texte de la page part comme une donnée : Odin ne suit jamais une consigne écrite dans une page.", taille = 12.sp, doux = true)
        }
        reponse?.let {
            Box(Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(14.dp)).background(LocalPalette.current.tuile.c()).padding(12.dp)) {
                SelectionContainer { T(it) }
            }
        }
        if (reponse == null && idees.isNotEmpty()) {
            T("Odin te propose", taille = 13.sp, poids = FontWeight.SemiBold)
            for (i in idees.take(4)) {
                Tuile(Modifier.fillMaxWidth(), onClick = { i.texte("url")?.let { nav.ouvrir(it) } }) {
                    Column(Modifier.padding(10.dp)) {
                        T(i.texte("titre") ?: "", poids = FontWeight.SemiBold, lignes = 1)
                        i.texte("texte")?.let { t -> T(t, taille = 12.sp, doux = true, lignes = 2) }
                    }
                }
            }
        }
    }
}
