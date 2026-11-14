package com.toufatech.agora

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.toufatech.agora.appli.Agora
import com.toufatech.agora.appli.EtatStore
import com.toufatech.agora.appli.ServiceStore
import com.toufatech.agora.coeur.Article
import com.toufatech.agora.coeur.Decision
import com.toufatech.agora.coeur.Mode
import com.toufatech.agora.coeur.Ordre
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Les couleurs de la maquette validée (StoreTel).
private val Fond = Color(0xFFEEF8F9); private val Bord = Color(0xFFC2DFE1); private val Texte = Color(0xFF10363A)
private val Doux = Color(0xFF3E5B5E); private val Sarcelle = Color(0xFF0B7F7C); private val VertFonce = Color(0xFF14532D)
private val Jaune = Color(0xFFFFF8E1); private val JauneBord = Color(0xFFF3D27A); private val Rouge = Color(0xFFB42318)

/** L'écran du store sur le téléphone (maquette « StoreTel ») : Mon store, Mises à jour, Historique ; ou la connexion à Odin. */
class MainActivity : ComponentActivity() {
    companion object { @Volatile var auPremierPlan = false }
    override fun onResume() { super.onResume(); auPremierPlan = true }
    override fun onPause() { auPremierPlan = false; super.onPause() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Agora.prefs(this).getString("session", null) != null) ServiceStore.demarrer(this)
        setContent {
            val e by Agora.etat.collectAsState()
            val connexion = e.connexion == "aucune" && Agora.client == null
            LaunchedEffect(connexion) { barres(connexion) }
            if (connexion) {
                // L'écran de connexion sur le ciel noir étoilé (comme Pégase et Agora sur l'ordinateur).
                Box(Modifier.fillMaxSize()) {
                    Ciel(Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().safeDrawingPadding()) { EcranConnexion(e) }
                }
            } else {
                Box(Modifier.fillMaxSize().background(Fond).safeDrawingPadding()) { EcranStore(e) }
            }
        }
    }

    /** Sur le ciel étoilé : icônes claires dans les barres du téléphone ; sur le store (fond clair) : icônes sombres. */
    private fun barres(surNoir: Boolean) {
        val t = android.graphics.Color.TRANSPARENT
        if (surNoir) enableEdgeToEdge(SystemBarStyle.dark(t), SystemBarStyle.dark(t)) else enableEdgeToEdge(SystemBarStyle.light(t, t), SystemBarStyle.light(t, t))
    }

    /** Le vrai logo d'Agora : les deux calques de l'icône du lanceur, coupés comme sur l'écran d'accueil du téléphone. */
    @Composable
    private fun LogoAgora(taille: Dp) {
        Box(Modifier.size(taille).clip(RoundedCornerShape(taille * 0.23f)), contentAlignment = Alignment.Center) {
            // Les calques font 108 dp, dont 72 visibles : on les agrandit d'une fois et demie.
            Image(painterResource(R.drawable.ic_launcher_fond), null, Modifier.requiredSize(taille * 1.5f))
            Image(painterResource(R.drawable.ic_launcher_avant), null, Modifier.requiredSize(taille * 1.5f))
        }
    }

    @Composable
    private fun EcranConnexion(e: EtatStore) {
        var adresse by remember { mutableStateOf(Agora.prefs(this).getString("adresse", "") ?: "") }
        var ident by remember { mutableStateOf("") }; var mdp by remember { mutableStateOf("") }; var code by remember { mutableStateOf("") }
        var occupe by remember { mutableStateOf(false) }; val portee = rememberCoroutineScope()
        var avis by remember { mutableStateOf<String?>(null) }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).padding(22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    LogoAgora(52.dp)
                    Text("Agora", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Texte)
                }
                Text("Le store d'Odin : connecte-toi avec ton compte Odin, et retrouve ici les applis auxquelles tu as droit.", color = Doux)
                OutlinedTextField(adresse, { adresse = it }, label = { Text("Adresse d'Odin") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                OutlinedTextField(ident, { ident = it }, label = { Text("Identifiant ou e-mail") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(mdp, { mdp = it }, label = { Text("Mot de passe") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                if (e.codeRequis) OutlinedTextField(code, { code = it }, label = { Text("Code de vérification") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                (avis ?: e.erreur)?.let { Text(it, color = Rouge) }
                Button(onClick = {
                    // Nos propres messages, en français, pour chaque champ oublié.
                    avis = when {
                        adresse.isBlank() -> "Indique l'adresse d'Odin."
                        ident.isBlank() -> "Remplis « Identifiant ou e-mail »."
                        mdp.isEmpty() -> "Remplis « Mot de passe »."
                        e.codeRequis && code.isBlank() -> "Remplis « Code de vérification »."
                        else -> null
                    }
                    if (avis != null) return@Button
                    occupe = true
                    portee.launch {
                        val ok = withContext(Dispatchers.IO) { Agora.connecter(this@MainActivity, adresse.trim(), ident.trim(), mdp, code.trim().ifEmpty { null }) }
                        mdp = ""; occupe = false
                        if (ok) ServiceStore.demarrer(this@MainActivity)
                    }
                }, enabled = !occupe, colors = ButtonDefaults.buttonColors(containerColor = Sarcelle), modifier = Modifier.fillMaxWidth()) { Text(if (occupe) "Connexion…" else "Se connecter") }
                Text("Ton mot de passe n'est jamais gardé sur ce téléphone : seule la session, chiffrée par le téléphone.", color = Doux, fontSize = 13.sp)
            }
        }
    }

    @Composable
    private fun EcranStore(e: EtatStore) {
        var onglet by remember { mutableStateOf(0) }
        val maj = e.articles.filter { a -> val i = e.installees[a.id]; i != null && a.paquet != null && com.toufatech.agora.coeur.Store.compareVersions(a.paquet.version, i.version) > 0 }
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                LogoAgora(36.dp)
                Column(Modifier.weight(1f)) { Text("Agora", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Texte); Text("${e.personne}${if (e.groupes.isNotEmpty()) " · ${e.groupes.joinToString(", ")}" else ""}", color = Doux, fontSize = 13.sp) }
                Box(Modifier.size(34.dp).background(Color(0xFFF59E0B), CircleShape), contentAlignment = Alignment.Center) { Text(e.personne.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold) }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("Mon store", "Mises à jour${if (maj.isNotEmpty()) " (${maj.size})" else ""}", "Historique").forEachIndexed { i, t ->
                    val choisi = onglet == i
                    Box(Modifier.weight(1f).height(40.dp).background(if (choisi) Color(0xFFD2E9E9) else Color.Transparent, RoundedCornerShape(10.dp)).border(1.dp, if (choisi) Sarcelle else Bord, RoundedCornerShape(10.dp)).padding(4.dp).semantics { contentDescription = t }, contentAlignment = Alignment.Center) {
                        androidx.compose.material3.TextButton(onClick = { onglet = i }) { Text(t, color = Texte, fontSize = 13.sp, fontWeight = if (choisi) FontWeight.SemiBold else FontWeight.Normal) }
                    }
                }
            }
            e.message?.let { m -> Row(Modifier.fillMaxWidth().padding(12.dp).background(Jaune, RoundedCornerShape(12.dp)).border(1.dp, JauneBord, RoundedCornerShape(12.dp)).padding(10.dp)) { Text(m, fontSize = 14.sp, color = Texte) } }
            if (e.connexion == "horsligne") Text(e.erreur ?: "Odin injoignable : nouvel essai bientôt.", color = Doux, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp))
            when (onglet) {
                0 -> LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(e.articles.filter { it.mode != Mode.RETIREE || e.installees.containsKey(it.id) }, key = { it.id }) { a -> Carte(a, e) }
                    item { Text("Sur Android, une installation imposée te demande un toucher, sauf si ce téléphone est géré par Odin.", color = Doux, fontSize = 12.5.sp, modifier = Modifier.padding(vertical = 8.dp)) }
                }
                1 -> LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { if (maj.isEmpty()) item { Text("Tout est à jour.", color = Doux) } else items(maj, key = { it.id }) { a -> Carte(a, e) } }
                else -> LazyColumn(Modifier.weight(1f).padding(horizontal = 16.dp)) { if (e.historique.isEmpty()) item { Text("Rien pour l'instant.", color = Doux) } else items(e.historique) { h -> Text(h, color = Texte, fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp)) } }
            }
        }
    }

    @Composable
    private fun Carte(a: Article, e: EtatStore) {
        val inst = e.installees[a.id]; val attente = a.id in e.attente; val prog = e.enCours[a.id]
        Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(14.dp)).border(1.dp, Bord, RoundedCornerShape(14.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(36.dp).background(Brush.linearGradient(listOf(Color(0xFF0EA5A4), Sarcelle)), RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) { Text(a.nom.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold) }
                Column(Modifier.weight(1f)) { Text(a.nom, fontWeight = FontWeight.SemiBold, color = Texte); Text(e.erreurs[a.id] ?: Decision.texte(a, inst, attente), color = if (e.erreurs[a.id] != null) Rouge else Doux, fontSize = 13.sp) }
                when {
                    prog != null -> LinearProgressIndicator(progress = { prog / 100f }, modifier = Modifier.size(width = 80.dp, height = 6.dp), color = Color(0xFF0284C7))
                    inst != null -> OutlinedButton(onClick = { packageManager.getLaunchIntentForPackage(inst.paquetAndroid)?.let { startActivity(it) } }) { Text("Ouvrir") }
                    a.paquet == null && a.web != null -> OutlinedButton(onClick = { Agora.client?.let { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${it.adresse}/#app=${a.web}"))) } }) { Text("Ouvrir") }
                    a.pourAndroid && a.mode != Mode.RETIREE && !attente -> Button(onClick = { ServiceStore.file.trySend(Ordre("", a.id, a.nom, "installer", a.paquet?.version, "personne", "") to "personne") }, colors = ButtonDefaults.buttonColors(containerColor = Sarcelle)) { Text("Installer") }
                }
            }
            if (a.impose && a.mode != Mode.RETIREE) Text("🔒 Imposée${if (a.par.isNotEmpty()) " par ${a.par}" else ""}", color = VertFonce, fontSize = 12.5.sp)
            if (inst != null && !a.impose) Row { Spacer(Modifier.weight(1f)); androidx.compose.material3.TextButton(onClick = { ServiceStore.file.trySend(Ordre("", a.id, a.nom, "desinstaller", null, "personne", "") to "personne") }) { Text("Désinstaller", color = Doux) } }
        }
    }
}
