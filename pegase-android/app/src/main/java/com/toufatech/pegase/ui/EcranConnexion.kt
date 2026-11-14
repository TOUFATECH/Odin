package com.toufatech.pegase.ui

import android.annotation.SuppressLint
import android.net.http.SslCertificate
import android.net.http.SslError
import android.os.Build
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.toufatech.pegase.R
import com.toufatech.pegase.appli.ConnexionOdin
import com.toufatech.pegase.appli.DemandeSso
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Oidc
import com.toufatech.pegase.coeur.Palettes
import com.toufatech.pegase.odin.Epinglage
import java.io.ByteArrayInputStream
import java.net.URI
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

// ------------------------------------------------------------------ écran 15 : le lancement

@Composable
fun EcranDemarrage(pegase: Pegase) {
    val ctx = LocalContext.current
    val sansAnimation = remember {
        Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    Column(Modifier.fillMaxSize().statusBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier.weight(1f).fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(26.dp, Alignment.CenterVertically),
        ) {
            Image(
                painterResource(R.drawable.logo_pegase), "Pégase",
                Modifier.size(120.dp).shadow(30.dp, RoundedCornerShape(28.dp), ambientColor = Color(0x7346008C), spotColor = Color(0x7346008C)).clip(RoundedCornerShape(28.dp)),
            )
            T("Pégase", taille = 36.sp, titre = true, modifier = Modifier.semantics { heading() })
            TroisPoints(sansAnimation)
            T(pegase.texteDemarrage, taille = 14.sp, doux = true)
        }
        T("Le navigateur d'Odin", taille = 12.sp, doux = true, modifier = Modifier.padding(18.dp))
    }
}

/** Les 3 points qui sautent (immobiles si le téléphone demande moins d'animations). */
@Composable
private fun TroisPoints(sansAnimation: Boolean) {
    val p = LocalPalette.current
    val transition = rememberInfiniteTransition(label = "points")
    Row(
        Modifier.height(24.dp).semantics { contentDescription = "Chargement" },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        for (i in 0 until 3) {
            val t by transition.animateFloat(
                0f, 1f,
                infiniteRepeatable(
                    keyframes {
                        durationMillis = 1200
                        delayMillis = i * 150
                        0f at 0
                        1f at 480 using FastOutSlowInEasing
                        0f at 960
                    },
                    RepeatMode.Restart,
                ),
                label = "point$i",
            )
            val v = if (sansAnimation) 0f else t
            Box(
                Modifier.size(12.dp)
                    .graphicsLayer { translationY = -8.dp.toPx() * v }
                    .alpha(if (sansAnimation) 0.8f else 0.35f + 0.65f * v)
                    .clip(CircleShape).background(p.texte.c()),
            )
        }
    }
}

// ------------------------------------------------------------------ écran 16 : se connecter à Odin

@Composable
fun EcranConnexion(pegase: Pegase) {
    val p = LocalPalette.current
    val cx = remember { ConnexionOdin(pegase) }
    val trouve = pegase.odinTrouve
    var ip by remember(trouve) { mutableStateOf(trouve?.base?.let { hoteDe(it) } ?: "") }
    var port by remember(trouve) { mutableStateOf(trouve?.base?.let { portDe(it) } ?: "7777") }
    var email by remember { mutableStateOf("") }
    var mdp by remember { mutableStateOf("") }
    var voir by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var demandeCode by remember { mutableStateOf(false) }
    var occupe by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var demande by remember { mutableStateOf<DemandeSso?>(null) }
    var essaiAuto by remember(trouve) { mutableStateOf<DemandeSso?>(null) }

    // Une session Odin existe déjà dans Pégase ? Connexion automatique, sans écran.
    LaunchedEffect(trouve) {
        if (trouve != null && pegase.session == null) {
            pegase.enFond {
                val d = try { cx.preparer(trouve, silencieuse = true) } catch (e: Exception) { null }
                pegase.surUi { essaiAuto = d }
            }
        }
    }
    // Retour par un autre navigateur (pegase://sso/retour).
    LaunchedEffect(pegase.retourSso) {
        val u = pegase.retourSso ?: return@LaunchedEffect
        pegase.retourSso = null
        val d = demande ?: return@LaunchedEffect
        cx.retour(d, u) { m -> erreur = m; demande = null }
    }

    essaiAuto?.let { d ->
        // Page d'Odin invisible : elle rend tout de suite un code si une session existe, sinon « login_required ».
        Box(Modifier.size(1.dp).alpha(0f)) {
            PageOdin(d) { url ->
                essaiAuto = null
                cx.retour(d, url) { m -> if (m != null) erreur = m }
            }
        }
    }

    Column(Modifier.fillMaxSize().statusBarsPadding(), verticalArrangement = Arrangement.Bottom) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)).background(p.feuille.c())
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Image(painterResource(R.drawable.logo_pegase), null, Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)))
                Column {
                    T("Retrouver ton profil", taille = 22.sp, titre = true, modifier = Modifier.semantics { heading() })
                    T("Pégase se connecte à Odin pour tout remettre comme avant.", taille = 14.sp, doux = true)
                }
            }
            Etapes(if (trouve == null) 0 else 1)

            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(p.tuile.c()).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(26.dp).clip(CircleShape).background(if (trouve != null) Palettes.VERT.c() else Color(0x33FFFFFF)), contentAlignment = Alignment.Center) {
                        if (trouve != null) Icone(Icones.coche, null, Color(0xFF06210F), 14.dp)
                    }
                    T(if (trouve != null) "Odin trouvé sur ton réseau" else "Odin pas trouvé : tape son adresse", poids = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    if (trouve != null) T("rempli tout seul", taille = 12.sp, couleur = Palettes.VERT_TEXTE.c())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Champ(ip, { ip = it }, "Adresse IP d'Odin", "192.168.1.10", Modifier.weight(1f), clavier = KeyboardType.Uri)
                    Champ(port, { port = it.filter { c -> c.isDigit() }.take(5) }, "Port", "7777", Modifier.width(96.dp), clavier = KeyboardType.Number)
                }
                if (trouve != null) {
                    T(
                        "Connecté · ${trouve.nom} ${trouve.version} · le service de synchro répond. Empreinte du certificat : ${Epinglage.courte(trouve.empreinte)}.",
                        taille = 12.sp, doux = true,
                    )
                }
                if (trouve == null || hoteDe(trouve.base) != ip.trim() || portDe(trouve.base) != port.trim()) {
                    BoutonContour("Chercher cet Odin", {
                        erreur = null
                        occupe = true
                        cx.essayer(ip, port) { b ->
                            occupe = false
                            if (b != null) pegase.odinTrouve = b else erreur = "Aucun Odin ne répond à $ip:$port. Vérifie l'adresse et que le téléphone est sur le même réseau."
                        }
                    }, Modifier.fillMaxWidth())
                }
            }

            Champ(email, { email = it }, "Adresse e-mail", "ton adresse e-mail", clavier = KeyboardType.Email)
            Champ(
                mdp, { mdp = it }, "Mot de passe", "", motDePasse = true, visible = voir,
                action = if (demandeCode) ImeAction.Next else ImeAction.Done,
                apres = { BoutonIcone(Icones.oeil, if (voir) "Cacher le mot de passe" else "Afficher le mot de passe", { voir = !voir }, p.texteDoux.c()) },
            )
            if (demandeCode) Champ(code, { code = it.filter { c -> c.isDigit() }.take(6) }, "Code à 6 chiffres", "123456", clavier = KeyboardType.Number, action = ImeAction.Done)
            erreur?.let { T(it, taille = 13.sp, couleur = Palettes.ROUGE_TEXTE.c()) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BoutonPrincipal(if (occupe) "Connexion…" else "Restaurer mon profil", {
                    val b = trouve
                    if (b == null) {
                        erreur = "Trouve d'abord ton Odin (adresse IP et port)."
                        return@BoutonPrincipal
                    }
                    if (email.isBlank() || mdp.isEmpty()) {
                        erreur = "Tape ton adresse e-mail et ton mot de passe d'Odin."
                        return@BoutonPrincipal
                    }
                    occupe = true
                    erreur = null
                    cx.directe(b, email, mdp, code.ifBlank { null }) { e ->
                        occupe = false
                        if (e == null) {
                            mdp = ""
                        } else if (e.code == "code_requis") {
                            demandeCode = true
                            erreur = e.message
                        } else {
                            if (e.code == "code_faux") code = ""
                            erreur = e.message
                        }
                    }
                }, Modifier.weight(1f), actif = !occupe)
                BoutonContour("Ignorer", { pegase.ignorerOdin() }, Modifier.width(120.dp))
            }
            if (trouve != null) {
                T(
                    "Se connecter avec la page d'Odin",
                    taille = 14.sp, poids = FontWeight.Medium, couleur = Color(0xFFC9D0FF),
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button) {
                        erreur = null
                        pegase.enFond {
                            val d = cx.preparer(trouve, silencieuse = false)
                            pegase.surUi { demande = d }
                        }
                    }.padding(vertical = 8.dp),
                )
            }
            T("Reviennent : profil, favoris, onglets, historique, agenda, réglages. Les cookies restent sur le téléphone.", taille = 12.sp, doux = true)
        }
    }

    demande?.let { d ->
        // La page de connexion d'Odin (portail Persona), dans un écran intégré.
        Column(Modifier.fillMaxSize().background(Color(0xFF14151E)).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                BoutonIcone(Icones.fermer, "Annuler la connexion", { demande = null }, Color(0xFFF2F3FA))
                T("Connexion à Odin", poids = FontWeight.SemiBold, couleur = Color(0xFFF2F3FA))
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                PageOdin(d) { url ->
                    demande = null
                    cx.retour(d, url) { m -> erreur = m }
                }
            }
        }
    }
}

@Composable
private fun Etapes(fait: Int) {
    val p = LocalPalette.current
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.semantics { contentDescription = "Étape ${fait + 1} sur 3" }) {
        listOf("1 · Odin", "2 · Ton compte", "3 · C'est prêt").forEachIndexed { i, nom ->
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(if (i <= fait) Color(0xFFB98CFF) else p.tuileForte.c()))
                T(nom, taille = 12.sp, poids = if (i <= fait) FontWeight.SemiBold else FontWeight.Normal, doux = i > fait)
            }
        }
    }
}

private fun hoteDe(base: String) = try { URI(base).host ?: "" } catch (e: Exception) { "" }
private fun portDe(base: String) = try { URI(base).port.takeIf { it > 0 }?.toString() ?: "7777" } catch (e: Exception) { "7777" }

/**
 * La page d'Odin dans un WebView (écran intégré) : seulement l'adresse d'Odin, avec son certificat épinglé ;
 * le retour `pegase://sso/retour?…` est attrapé et jamais ouvert. Les cookies d'Odin restent dans ce WebView :
 * la prochaine connexion est automatique.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PageOdin(d: DemandeSso, retour: (String) -> Unit) {
    val base = d.bonjour.base
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                CookieManager.getInstance().setAcceptCookie(true)
                webViewClient = object : WebViewClient() {
                    private var fini = false

                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val u = request.url.toString()
                        if (Oidc.estRetour(u)) {
                            if (!fini) {
                                fini = true
                                CookieManager.getInstance().flush()
                                retour(u)
                            }
                            return true
                        }
                        // On ne quitte pas Odin depuis cet écran.
                        return !u.startsWith(base)
                    }

                    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                        val attendue = d.bonjour.empreinte
                        val vue = certificat(error.certificate)?.let { Epinglage.empreinte(it) }
                        if (attendue != null && vue != null && vue.equals(attendue, ignoreCase = true) && error.url.startsWith(base)) {
                            handler.proceed()
                        } else {
                            handler.cancel()
                        }
                    }
                }
                loadUrl(d.url)
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

/** Le certificat X.509 d'une erreur TLS du WebView (API 29+ directement, avant par l'état sauvegardé). */
private fun certificat(c: SslCertificate?): X509Certificate? {
    if (c == null) return null
    if (Build.VERSION.SDK_INT >= 29) return c.x509Certificate
    val octets = SslCertificate.saveState(c)?.getByteArray("x509-certificate") ?: return null
    return try {
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(octets)) as X509Certificate
    } catch (e: Exception) {
        null
    }
}
