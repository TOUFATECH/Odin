package com.toufatech.pegase.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.EtatSynchro
import com.toufatech.pegase.coeur.Ics
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.coeur.RendezVous
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.texte
import com.toufatech.pegase.coeur.dureeLisible
import java.io.File
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters

private const val PREMIERE_HEURE = 7
private const val DERNIERE_HEURE = 21
private val HAUTEUR_HEURE = 52.dp
private val JOURS = listOf("Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim")

// ------------------------------------------------------------------ écran 18 : agenda

@Composable
fun EcranAgenda(pegase: Pegase) {
    val p = LocalPalette.current
    val _r = pegase.revision
    val zone = ZoneId.systemDefault()
    var jour by remember { mutableStateOf(LocalDate.now()) }
    var edite by remember { mutableStateOf<RendezVous?>(null) }
    var nouveau by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val lundi = jour.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    val rdvs = pegase.rdvs()
    val duJour = rdvs.filter { r -> chevauche(r, jour, zone) }.sortedBy { Ics.instant(it.debut, zone) }
    val aPoser = pegase.aPoser()

    // Les rappels ont besoin des notifications (Android 13 et plus).
    val notif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33) notif.launch(Manifest.permission.POST_NOTIFICATIONS) }

    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        pegase.enFond {
            val texte = pegase.app.contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""
            val l = Ics.importer(texte, zone)
            pegase.surUi {
                for (r in l) pegase.modifier(Cols.AGENDA, r.id, r.versData())
                pegase.message = if (l.isEmpty()) "Aucun rendez-vous lisible dans ce fichier." else "${l.size} rendez-vous importés (les répétitions gardent leur 1re date)."
            }
        }
    }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/calendar")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val texte = Ics.exporter(pegase.rdvs(), System.currentTimeMillis(), "Agenda de ${pegase.session?.nom ?: "Pégase"}")
        pegase.enFond {
            pegase.app.contentResolver.openOutputStream(uri)?.use { it.write(texte.toByteArray(Charsets.UTF_8)) }
            pegase.surUi { pegase.message = "Agenda exporté (.ics)." }
        }
    }

    // Glisser une tâche « à poser » sur une heure.
    var hautGrille by remember { mutableFloatStateOf(0f) }
    var tenue by remember { mutableStateOf<String?>(null) }
    var depart by remember { mutableStateOf(Offset.Zero) }
    var deplacement by remember { mutableStateOf(Offset.Zero) }
    val pasHeure = with(LocalDensity.current) { HAUTEUR_HEURE.toPx() }

    fun poser(id: String, data: Map<String, Any?>, heure: Int) {
        val duree = (data.entier("duree") ?: 60L).coerceAtLeast(15)
        val debut = ZonedDateTime.of(jour, LocalTime.of(heure.coerceIn(0, 23), 0), zone)
        val r = RendezVous(id, data.texte("titre") ?: "Sans titre", Ics.isoDe(debut.toInstant(), zone), Ics.isoDe(debut.plusMinutes(duree).toInstant(), zone),
            agenda = data.texte("agenda"), couleur = data.texte("couleur"), notes = data.texte("notes"))
        pegase.modifier(Cols.AGENDA, id, r.versData())
    }

    PagePleine("Agenda", { pegase.feuille = null }, droite = {
        PastilleOdin(pegase.session != null && pegase.indicateur.etat != EtatSynchro.HORS_LIGNE)
        Box {
            BoutonIcone(Icones.menu, "Importer, exporter, s'abonner", { menu = true })
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Importer un fichier .ics") }, onClick = { menu = false; importer.launch(arrayOf("text/calendar", "text/x-vcalendar", "application/octet-stream")) })
                DropdownMenuItem(text = { Text("Exporter en .ics") }, onClick = { menu = false; exporter.launch("agenda-pegase.ics") })
                DropdownMenuItem(text = { Text("Partager l'agenda en .ics") }, onClick = { menu = false; partagerIcs(pegase) })
                if (pegase.apiOdin() != null) {
                    DropdownMenuItem(text = { Text("Lien d'abonnement (agenda Windows, téléphone)") }, onClick = { menu = false; lienAbonnement(pegase) })
                }
            }
        }
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(Brush.linearGradient(listOf(Palettes.VIOLET_1.c(), Palettes.VIOLET_2.c())))
                .clickable(role = Role.Button) { nouveau = true }.semantics { contentDescription = "Nouveau rendez-vous" },
            contentAlignment = Alignment.Center,
        ) { Icone(Icones.plus, null, Color.White, 22.dp) }
    }) {
        Row(
            Modifier.fillMaxWidth().pointerInput(Unit) {
                var cumul = 0f
                detectHorizontalDragGestures(onDragEnd = {
                    if (cumul < -80) jour = jour.plusWeeks(1) else if (cumul > 80) jour = jour.minusWeeks(1)
                    cumul = 0f
                }) { _, d -> cumul += d }
            }.semantics { contentDescription = "Jours de la semaine. Glisser pour changer de semaine" },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (i in 0 until 7) {
                val j = lundi.plusDays(i.toLong())
                val choisi = j == jour
                Column(
                    Modifier.weight(1f).height(54.dp).clip(RoundedCornerShape(12.dp))
                        .background(if (choisi) Color(0x8CB98CFF) else p.tuile.c())
                        .clickable(role = Role.Tab) { jour = j }.semantics { selected = choisi },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    T(JOURS[i], taille = 11.sp, doux = !choisi)
                    T(j.dayOfMonth.toString(), poids = FontWeight.Bold, couleur = if (j == LocalDate.now() && !choisi) Color(0xFFF2C366) else null)
                }
            }
        }

        // Les heures de la journée : les rendez-vous y sont posés, on y dépose les tâches.
        Column(Modifier.onGloballyPositioned { hautGrille = it.boundsInRoot().top }) {
            val journee = duJour.filter { it.journee }
            for (r in journee) CarteRdv(r, "journée") { edite = r }
            for (h in PREMIERE_HEURE..DERNIERE_HEURE) {
                val ici = duJour.filter { !it.journee && heureDe(it, zone) == h }
                val survol = tenue != null && heureSous(depart.y + deplacement.y, hautGrille, pasHeure) == h
                Row(Modifier.fillMaxWidth().heightIn(min = HAUTEUR_HEURE).background(if (survol) Color(0x33B98CFF) else Color.Transparent), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    T("$h h", taille = 13.sp, doux = true, modifier = Modifier.width(46.dp).padding(top = 10.dp))
                    Column(Modifier.weight(1f).padding(vertical = 3.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (r in ici) CarteRdv(r, plage(r, zone)) { edite = r }
                        if (ici.isEmpty()) Box(Modifier.fillMaxWidth().height(1.dp).padding(top = 24.dp).background(p.texte.c().copy(alpha = 0.08f)))
                    }
                }
            }
        }

        Tuile(Modifier.fillMaxWidth(), coin = 16.dp) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                T("À poser", poids = FontWeight.SemiBold)
                if (aPoser.isEmpty()) T("Ajoute une tâche sans heure avec « + » : tu la glisseras sur une heure.", taille = 12.sp, doux = true)
                for ((id, data) in aPoser) {
                    val tenueIci = tenue == id
                    Box(
                        Modifier.fillMaxWidth()
                            .onGloballyPositioned { if (!tenueIci) depart = it.boundsInRoot().center }
                            .graphicsLayer { if (tenueIci) { translationX = deplacement.x; translationY = deplacement.y; shadowElevation = 12f } }
                            .clip(RoundedCornerShape(12.dp))
                            .background((data.texte("couleur")?.let { Pegase.couleurDe(it) } ?: Palettes.OR).c())
                            .semantics {
                                customActions = (PREMIERE_HEURE..DERNIERE_HEURE).map { h -> CustomAccessibilityAction("Poser à $h h") { poser(id, data, h); true } }
                            }
                            .pointerInput(id) {
                                detectDragGesturesAfterLongPress(
                                    onDragStart = { tenue = id; deplacement = Offset.Zero },
                                    onDrag = { c, d -> c.consume(); deplacement += d },
                                    onDragEnd = {
                                        val h = heureSous(depart.y + deplacement.y, hautGrille, pasHeure)
                                        if (h != null) poser(id, data, h)
                                        tenue = null
                                        deplacement = Offset.Zero
                                    },
                                    onDragCancel = { tenue = null; deplacement = Offset.Zero },
                                )
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    ) {
                        val duree = data.entier("duree") ?: 60L
                        T("${data.texte("titre") ?: "Tâche"} · ${dureeLisible(duree)}", poids = FontWeight.SemiBold, couleur = Color(0xFF14151E))
                    }
                }
                T("Appuie longtemps, puis glisse sur une heure.", taille = 12.sp, doux = true)
            }
        }
        T("Le même agenda que sur ton PC et dans l'agenda Windows, gardé sur Odin.", taille = 12.sp, doux = true, modifier = Modifier.align(Alignment.CenterHorizontally))
    }

    if (nouveau || edite != null) {
        EditeurRdv(pegase, edite, jour, zone) {
            nouveau = false
            edite = null
        }
    }
}

private fun heureSous(y: Float, haut: Float, pas: Float): Int? {
    if (y < haut) return null
    val h = PREMIERE_HEURE + ((y - haut) / pas).toInt()
    return if (h in PREMIERE_HEURE..DERNIERE_HEURE) h else null
}

private fun heureDe(r: RendezVous, zone: ZoneId): Int? = Ics.instant(r.debut, zone)?.atZone(zone)?.hour?.coerceIn(PREMIERE_HEURE, DERNIERE_HEURE)

private fun chevauche(r: RendezVous, jour: LocalDate, zone: ZoneId): Boolean {
    val d = Ics.instant(r.debut, zone) ?: return false
    val f = Ics.instant(r.fin, zone) ?: d
    val debutJour = jour.atStartOfDay(zone).toInstant()
    val finJour = jour.plusDays(1).atStartOfDay(zone).toInstant()
    return d < finJour && (f > debutJour || d >= debutJour)
}

private fun plage(r: RendezVous, zone: ZoneId): String {
    fun h(iso: String) = Ics.instant(iso, zone)?.atZone(zone)?.toLocalTime()?.let { if (it.minute == 0) "${it.hour} h" else "${it.hour} h ${"%02d".format(it.minute)}" } ?: ""
    return "${h(r.debut)} – ${h(r.fin)}" + (r.agenda?.let { " · $it" } ?: "") + (r.lieu?.let { " · $it" } ?: "")
}

@Composable
private fun CarteRdv(r: RendezVous, detail: String, onClick: () -> Unit) {
    val fond = r.couleur?.let { Pegase.couleurDe(it) } ?: Palettes.teintePour(r.agenda ?: r.titre)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(fond.c()).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        T(r.titre, poids = FontWeight.SemiBold, couleur = Color(0xFF14151E), lignes = 1)
        T(detail, taille = 12.sp, couleur = Color(0xD914151E), lignes = 1)
    }
}

/** Nouveau rendez-vous, ou modifier / supprimer un rendez-vous. */
@Composable
private fun EditeurRdv(pegase: Pegase, r: RendezVous?, jour: LocalDate, zone: ZoneId, fermer: () -> Unit) {
    val debut0 = r?.let { Ics.instant(it.debut, zone)?.atZone(zone) }
    var titre by remember { mutableStateOf(r?.titre ?: "") }
    var heure by remember { mutableStateOf(debut0?.let { "%d:%02d".format(it.hour, it.minute) } ?: "9:00") }
    var duree by remember {
        mutableStateOf(
            r?.let { x ->
                val d = Ics.instant(x.debut, zone)
                val f = Ics.instant(x.fin, zone)
                if (d != null && f != null) ((f.toEpochMilli() - d.toEpochMilli()) / 60000).toString() else null
            } ?: "60",
        )
    }
    var lieu by remember { mutableStateOf(r?.lieu ?: "") }
    var rappel by remember { mutableStateOf(r?.rappel?.toString() ?: "") }
    var aPoser by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = fermer,
        title = { Text(if (r == null) "Nouveau rendez-vous" else "Rendez-vous") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Champ(titre, { titre = it.take(120) }, "Titre", "Rappeler le client…")
                if (r == null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Interrupteur(aPoser, { aPoser = it }, "À poser plus tard")
                        Text("À poser plus tard (sans heure)")
                    }
                }
                if (!aPoser) Champ(heure, { heure = it.take(5) }, "Heure (le ${jour.dayOfMonth}/${jour.monthValue})", "9:00", clavier = KeyboardType.Number)
                Champ(duree, { duree = it.filter { c -> c.isDigit() }.take(4) }, "Durée (minutes)", "60", clavier = KeyboardType.Number)
                if (!aPoser) {
                    Champ(lieu, { lieu = it.take(120) }, "Lieu", "Mamoudzou…")
                    Champ(rappel, { rappel = it.filter { c -> c.isDigit() }.take(4) }, "Rappel (minutes avant, vide = aucun)", "15", clavier = KeyboardType.Number, action = ImeAction.Done)
                }
                erreur?.let { Text(it, color = Palettes.ROUGE_TEXTE.c()) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val t = titre.trim().ifEmpty { "Sans titre" }
                val minutes = duree.toLongOrNull()?.coerceIn(5, 24 * 60) ?: 60
                if (aPoser) {
                    pegase.modifier(Cols.AGENDA, pegase.nouvelId("rdv"), mapOf("titre" to t, "duree" to minutes))
                    fermer()
                    return@TextButton
                }
                val hm = Regex("^(\\d{1,2})(?:[:h ](\\d{2}))?$").matchEntire(heure.trim())
                val hh = hm?.groupValues?.get(1)?.toIntOrNull()
                val mm = hm?.groupValues?.get(2)?.toIntOrNull() ?: 0
                if (hh == null || hh > 23 || mm > 59) {
                    erreur = "Heure à écrire comme 9:00 ou 14:30."
                    return@TextButton
                }
                val d = ZonedDateTime.of(jour, LocalTime.of(hh, mm), zone)
                val nouveau = RendezVous(
                    id = r?.id ?: pegase.nouvelId("rdv"),
                    titre = t,
                    debut = Ics.isoDe(d.toInstant(), zone),
                    fin = Ics.isoDe(d.plusMinutes(minutes).toInstant(), zone),
                    lieu = lieu.trim().ifEmpty { null },
                    agenda = r?.agenda,
                    rappel = rappel.toIntOrNull(),
                    couleur = r?.couleur,
                    notes = r?.notes,
                )
                pegase.modifier(Cols.AGENDA, nouveau.id, nouveau.versData())
                fermer()
            }) { Text("Enregistrer") }
        },
        dismissButton = {
            Row {
                if (r != null) TextButton(onClick = { pegase.supprimer(Cols.AGENDA, r.id); fermer() }) { Text("Supprimer", color = Palettes.ROUGE_TEXTE.c()) }
                TextButton(onClick = fermer) { Text("Annuler") }
            }
        },
    )
}

private fun partagerIcs(pegase: Pegase) {
    pegase.enFond {
        val texte = Ics.exporter(pegase.rdvs(), System.currentTimeMillis(), "Agenda de ${pegase.session?.nom ?: "Pégase"}")
        val dossier = File(pegase.app.cacheDir, "exports").apply { mkdirs() }
        val f = File(dossier, "agenda-pegase.ics")
        f.writeText(texte)
        val uri = FileProvider.getUriForFile(pegase.app, pegase.app.packageName + ".fichiers", f)
        val i = Intent(Intent.ACTION_SEND).setType("text/calendar").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        pegase.surUi { pegase.app.startActivity(Intent.createChooser(i, "Partager l'agenda").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}

/** Le lien d'abonnement d'Odin (lecture seule de l'agenda) : copié pour l'agenda Windows ou un autre téléphone. */
private fun lienAbonnement(pegase: Pegase) {
    val api = pegase.apiOdin() ?: return
    pegase.enFond {
        val r = api.agendaLien()
        val url = r.corps.texte("url")
        pegase.surUi {
            if (r.ok && url != null) {
                val cb = pegase.app.getSystemService(android.content.ClipboardManager::class.java)
                cb?.setPrimaryClip(android.content.ClipData.newPlainText("Agenda Odin", url))
                pegase.message = "Lien d'abonnement copié : colle-le dans l'agenda Windows (« S'abonner depuis le web »)."
            } else {
                pegase.message = r.message
            }
        }
    }
}
