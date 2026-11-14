package com.toufatech.pegase.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.toufatech.pegase.MainActivity
import com.toufatech.pegase.appli.Ecran
import com.toufatech.pegase.appli.Feuille
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.moteur.Invite
import kotlinx.coroutines.delay

/** L'interface de Pégase : l'écran du moment, les feuilles du bas par-dessus, les questions des pages et les messages. */
@Composable
fun Racine(pegase: Pegase, activite: MainActivity) {
    val palette = Palettes.de(pegase.theme, isSystemInDarkTheme())
    LaunchedEffect(palette.vitre, palette.base) { activite.reglerVitre(palette.vitre) }
    val schema = if (pegase.theme.resolu(isSystemInDarkTheme()).clair) {
        lightColorScheme(primary = Palettes.ACCENT.c(), surface = Color(0xFFF7F8FB), onSurface = Color(0xFF1C1F2B))
    } else {
        darkColorScheme(primary = Color(0xFFB49CFF), surface = Color(0xFF1E1F2A), onSurface = Color(0xFFF2F3FA))
    }
    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme(colorScheme = schema) {
            Box(Modifier.fillMaxSize().fondPegase(palette)) {
                if (activite.imageDansImage) {
                    pegase.navigateur.actif?.let { VuePage(pegase, it, Modifier.fillMaxSize()) }
                    return@Box
                }
                when (pegase.ecran) {
                    Ecran.DEMARRAGE -> EcranDemarrage(pegase)
                    Ecran.CONNEXION -> EcranConnexion(pegase)
                    Ecran.NAVIGATEUR -> EcranNavigateur(pegase)
                }
                when (pegase.feuille) {
                    Feuille.ONGLETS -> FeuilleOnglets(pegase)
                    Feuille.MENU -> FeuilleMenu(pegase)
                    Feuille.ADRESSE -> FeuilleAdresse(pegase)
                    Feuille.PROFIL -> EcranProfil(pegase)
                    Feuille.FAVORIS -> EcranFavoris(pegase)
                    Feuille.AGENDA -> EcranAgenda(pegase)
                    Feuille.REGLAGES -> EcranReglages(pegase)
                    Feuille.ODIN -> PanneauOdin(pegase)
                    Feuille.TELECHARGEMENTS -> FeuilleTelechargements(pegase)
                    Feuille.RANGES -> FeuilleRanges(pegase)
                    Feuille.ESPACES -> FeuilleEspaces(pegase)
                    null -> Unit
                }
                pegase.telechargements.montre?.let { FeuilleTelechargement(pegase, it) }
                Questions(pegase)
                Message(pegase)
            }
        }
    }
    BackHandler(enabled = pegase.ecran == Ecran.NAVIGATEUR || pegase.feuille != null) {
        val nav = pegase.navigateur
        when {
            pegase.telechargements.montre != null -> pegase.telechargements.montre = null
            pegase.feuille != null -> pegase.feuille = null
            nav.ongletActif()?.peutReculer == true -> nav.ongletActif()?.session?.goBack()
            else -> activite.moveTaskToBack(true)
        }
    }
    LaunchedEffect(pegase.ecran) {
        if (pegase.ecran == Ecran.NAVIGATEUR) {
            pegase.lienEnAttente?.let { pegase.navigateur.ouvrir(it) }
            pegase.lienEnAttente = null
        }
    }
}

/** Les messages de Pégase et d'Odin, en bas de l'écran, quelques secondes. */
@Composable
private fun Message(pegase: Pegase) {
    val m = pegase.message ?: return
    LaunchedEffect(m) {
        delay(4500)
        if (pegase.message == m) pegase.message = null
    }
    Box(Modifier.fillMaxSize().navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 140.dp), contentAlignment = Alignment.BottomCenter) {
        Box(
            Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0xF22A2C38)).clickable { pegase.message = null }
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
        ) { Text(m, style = style(14.sp, couleur = Color(0xFFF2F3FA))) }
    }
}

/** Les questions des pages : alerte, confirmation, texte, liste déroulante, fichier à envoyer. */
@Composable
private fun Questions(pegase: Pegase) {
    val fichiers = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        (pegase.invite as? Invite.Fichier)?.let { f -> f.repondre(if (f.plusieurs) uris else uris.take(1)) }
    }
    when (val q = pegase.invite) {
        null -> Unit
        is Invite.Fichier -> LaunchedEffect(q) {
            fichiers.launch(q.types.filter { it.contains('/') }.ifEmpty { listOf("*/*") }.toTypedArray())
        }
        is Invite.Alerte -> AlertDialog(
            onDismissRequest = q.ok,
            title = q.titre?.let { { Text(it) } },
            text = { Text(q.message) },
            confirmButton = { TextButton(onClick = q.ok) { Text("OK") } },
        )
        is Invite.Confirmer -> AlertDialog(
            onDismissRequest = { q.repondre(false) },
            title = q.titre?.let { { Text(it) } },
            text = { Text(q.message) },
            confirmButton = { TextButton(onClick = { q.repondre(true) }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { q.repondre(false) }) { Text("Annuler") } },
        )
        is Invite.Texte -> {
            var t by remember(q) { mutableStateOf(q.defaut) }
            AlertDialog(
                onDismissRequest = { q.repondre(null) },
                title = q.titre?.let { { Text(it) } },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(q.message)
                        Champ(t, { t = it })
                    }
                },
                confirmButton = { TextButton(onClick = { q.repondre(t) }) { Text("OK") } },
                dismissButton = { TextButton(onClick = { q.repondre(null) }) { Text("Annuler") } },
            )
        }
        is Invite.Choix -> {
            var choisis by remember(q) { mutableStateOf(q.options.filter { it.choisie }.map { it.id }.toSet()) }
            AlertDialog(
                onDismissRequest = { q.repondre(null) },
                title = q.titre?.let { { Text(it) } },
                text = {
                    LazyColumn(Modifier.heightIn(max = 420.dp)) {
                        items(q.options) { o ->
                            Row(
                                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = !o.desactivee) {
                                    if (q.plusieurs) {
                                        choisis = if (o.id in choisis) choisis - o.id else choisis + o.id
                                    } else {
                                        q.repondre(listOf(o.id))
                                    }
                                }.padding(horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Box(Modifier.size(20.dp)) { if (o.id in choisis) Icone(Icones.coche, "choisi", MaterialTheme.colorScheme.primary, 18.dp) }
                                Text(o.texte, color = if (o.desactivee) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f) else MaterialTheme.colorScheme.onSurface)
                            }
                        }
                    }
                },
                confirmButton = { if (q.plusieurs) TextButton(onClick = { q.repondre(choisis.toList()) }) { Text("OK") } },
                dismissButton = { TextButton(onClick = { q.repondre(null) }) { Text("Annuler") } },
            )
        }
    }
}
