package com.toufatech.pegase.moteur

import android.content.Context
import android.util.Log
import com.toufatech.pegase.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.ContentBlocking
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.WebExtension
import java.net.URL
import java.security.KeyStore
import java.util.Base64
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

/**
 * Le moteur de Firefox (GeckoView, licence MPL 2.0, utilisé comme bibliothèque) : un seul GeckoRuntime par processus,
 * le bloqueur intégré (extension embarquée) et le DNS chiffré (Sphinx d'Odin, sinon un DNS chiffré public).
 */
object Moteur {
    /** DNS chiffré public de secours (réglable) : Quad9, fondation suisse, sans journal des adresses. */
    const val DOH_SECOURS = "https://dns.quad9.net/dns-query"
    const val ID_BLOQUEUR = "bloqueur@pegase.toufatech"
    const val APPLI_NATIVE = "pegase"

    @Volatile
    private var runtime: GeckoRuntime? = null

    @Volatile
    var bloqueur: WebExtension? = null
        private set
    private val enAttente = ArrayList<(WebExtension) -> Unit>()

    /** Le port du fond de l'extension : Pégase lui dit où le Bouclier est coupé. */
    @Volatile
    var portFond: WebExtension.Port? = null
        private set
    private var messagesFond = ArrayList<JSONObject>()

    fun runtime(ctx: Context): GeckoRuntime {
        runtime?.let { return it }
        synchronized(this) {
            runtime?.let { return it }
            val reglages = GeckoRuntimeSettings.Builder()
                .javaScriptEnabled(true)
                .consoleOutput(BuildConfig.DEBUG)
                .remoteDebuggingEnabled(BuildConfig.DEBUG)
                .aboutConfigEnabled(BuildConfig.DEBUG)
                .contentBlocking(
                    ContentBlocking.Settings.Builder()
                        .antiTracking(ContentBlocking.AntiTracking.DEFAULT)
                        .enhancedTrackingProtectionLevel(ContentBlocking.EtpLevel.STRICT)
                        .cookieBehavior(ContentBlocking.CookieBehavior.ACCEPT_FIRST_PARTY_AND_ISOLATE_OTHERS)
                        .build(),
                )
                .build()
            val rt = GeckoRuntime.create(ctx.applicationContext, reglages)
            rt.settings.setPreferredColorScheme(GeckoRuntimeSettings.COLOR_SCHEME_SYSTEM)
            // Les autorités installées par l'utilisateur (celle d'Odin) sont reconnues : utile pour Sphinx et les pages d'Odin.
            rt.settings.setEnterpriseRootsEnabled(true)
            rt.settings.setGlobalPrivacyControl(true)
            rt.settings.setTrustedRecursiveResolverUri(DOH_SECOURS)
            rt.settings.setTrustedRecursiveResolverMode(GeckoRuntimeSettings.TRR_MODE_FIRST)
            runtime = rt
            installerBloqueur(rt)
            return rt
        }
    }

    private fun installerBloqueur(rt: GeckoRuntime) {
        rt.webExtensionController
            .ensureBuiltIn("resource://android/assets/extensions/bloqueur/", ID_BLOQUEUR)
            .accept({ ext ->
                if (ext == null) return@accept
                ext.setMessageDelegate(object : WebExtension.MessageDelegate {
                    override fun onConnect(port: WebExtension.Port) {
                        portFond = port
                        val l = synchronized(this@Moteur) { ArrayList(messagesFond) }
                        for (m in l) port.postMessage(m)
                        port.setDelegate(object : WebExtension.PortDelegate {
                            override fun onDisconnect(port: WebExtension.Port) {
                                if (portFond === port) portFond = null
                            }
                        })
                    }
                }, APPLI_NATIVE)
                bloqueur = ext
                val l = synchronized(this) { ArrayList(enAttente).also { enAttente.clear() } }
                for (f in l) f(ext)
            }, { e -> Log.w("Pegase", "Bloqueur non installé", e) })
    }

    /** Appelle [f] dès que le bloqueur est prêt (tout de suite s'il l'est déjà). */
    fun quandBloqueurPret(f: (WebExtension) -> Unit) {
        val b = bloqueur
        if (b != null) f(b) else synchronized(this) { enAttente += f }
    }

    /** Envoie un message au fond de l'extension (gardé : il est renvoyé si l'extension redémarre). */
    private fun versFond(type: String, m: JSONObject) {
        synchronized(this) {
            messagesFond.removeAll { it.optString("type") == type }
            messagesFond += m
        }
        portFond?.postMessage(m)
    }

    fun bloqueurActif(actif: Boolean) = versFond("actif", JSONObject().put("type", "actif").put("actif", actif))

    fun sitesSansBouclier(hotes: List<String>) = versFond("pauses", JSONObject().put("type", "pauses").put("hotes", JSONArray(hotes)))

    /**
     * Le DNS chiffré des pages : Sphinx seul (mode « uniquement ») quand il est utilisable,
     * sinon un DNS chiffré public, avec repli sur celui du réseau si celui-ci ne répond pas.
     */
    fun reglerDns(ctx: Context, sphinx: String?, secours: String) {
        val s = runtime(ctx).settings
        if (sphinx != null) {
            s.setTrustedRecursiveResolverUri(sphinx)
            s.setTrustedRecursiveResolverMode(GeckoRuntimeSettings.TRR_MODE_ONLY)
        } else {
            s.setTrustedRecursiveResolverUri(secours)
            s.setTrustedRecursiveResolverMode(GeckoRuntimeSettings.TRR_MODE_FIRST)
        }
    }

    /**
     * Sphinx n'est utilisable par le moteur que si son certificat est reconnu par le téléphone (le moteur ne connaît pas
     * l'empreinte épinglée par Pégase). On essaie une vraie question DNS (example.com, type A) avec les autorités
     * du téléphone, celles installées par l'utilisateur comprises.
     */
    fun sphinxUtilisable(url: String): Boolean = try {
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        tmf.init(KeyStore.getInstance("AndroidCAStore").apply { load(null) })
        val ssl = SSLContext.getInstance("TLS").apply { init(null, tmf.trustManagers, null) }
        val q = Base64.getUrlEncoder().withoutPadding().encodeToString(questionDns("example.com"))
        val c = URL("$url?dns=$q").openConnection() as HttpsURLConnection
        c.sslSocketFactory = ssl.socketFactory
        c.connectTimeout = 3000
        c.readTimeout = 3000
        c.setRequestProperty("accept", "application/dns-message")
        val ok = c.responseCode == 200 && c.contentType?.startsWith("application/dns-message") == true
        c.disconnect()
        ok
    } catch (e: Exception) {
        false
    }

    /** Une question DNS minimale (RFC 1035) : en-tête, un nom, type A, classe IN. */
    fun questionDns(nom: String): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        out.write(byteArrayOf(0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0))
        for (morceau in nom.split('.')) {
            val b = morceau.toByteArray(Charsets.US_ASCII)
            out.write(b.size)
            out.write(b)
        }
        out.write(byteArrayOf(0, 0, 1, 0, 1))
        return out.toByteArray()
    }
}
