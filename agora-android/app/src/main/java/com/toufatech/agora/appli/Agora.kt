package com.toufatech.agora.appli

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.toufatech.agora.coeur.Article
import com.toufatech.agora.coeur.Installee
import com.toufatech.agora.coeur.Store
import com.toufatech.agora.coeur.Texte
import com.toufatech.agora.odin.ClientAgora
import com.toufatech.agora.odin.Session
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Ce que l'écran montre (maquette « StoreTel ») : une seule forme, mise à jour par le service et par l'écran. */
data class EtatStore(
    val connexion: String = "aucune", // aucune, connexion, ok, horsligne
    val personne: String = "", val groupes: List<String> = emptyList(),
    val articles: List<Article> = emptyList(),
    val installees: Map<String, Installee> = emptyMap(),
    /** éléments dont l'installation attend le toucher de la personne */ val attente: Set<String> = emptySet(),
    val enCours: Map<String, Int> = emptyMap(),
    val erreurs: Map<String, String> = emptyMap(),
    val message: String? = null, val erreur: String? = null, val codeRequis: Boolean = false,
    val historique: List<String> = emptyList(),
    /** Agora est propriétaire de l'appareil (Android Enterprise) : installe sans toucher */ val gere: Boolean = false,
    val enLigne: Boolean = false,
)

/**
 * Le store sur le téléphone : la connexion à Odin, la session gardée (chiffrée par l'Android Keystore : le mot de passe
 * n'est jamais gardé), l'état de l'écran. Une seule instance pour l'appli (l'écran et le service la partagent).
 */
object Agora {
    val etat = MutableStateFlow(EtatStore())
    @Volatile var client: ClientAgora? = null
    private const val PREFS = "agora"

    fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    /** L'identifiant de ce téléphone pour le store (tiré au hasard une fois). */
    fun appareil(c: Context): String = prefs(c).getString("appareil", null) ?: ByteArray(18).also { SecureRandom().nextBytes(it) }
        .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }.also { prefs(c).edit().putString("appareil", it).apply() }

    fun garder(c: Context, s: Session?) {
        val e = prefs(c).edit()
        if (s == null) e.remove("session") else { e.putString("adresse", s.adresse); e.putString("empreinte", s.empreinte); e.putString("session", Coffre.chiffrer(s.refresh)) }
        e.apply()
    }
    /** Le client relié à Odin, depuis la session gardée (ou null : il faut se connecter). */
    fun reprendre(c: Context): ClientAgora? {
        client?.let { return it }
        val p = prefs(c); val adresse = p.getString("adresse", null) ?: return null; val chiffre = p.getString("session", null) ?: return null
        val refresh = try { Coffre.dechiffrer(chiffre) } catch (_: Exception) { return null }
        val cl = ClientAgora(adresse, p.getString("empreinte", null), appareil(c)) { s -> garder(c, s) }
        return if (try { cl.reprendre(Session(adresse, p.getString("empreinte", null), refresh, appareil(c))) } catch (_: Exception) { true /* hors ligne : on garde la session */ }) cl.also { client = it } else null
    }
    fun connecter(c: Context, adresse: String, identifiant: String, motdepasse: String, code: String?): Boolean {
        val cl = ClientAgora(adresse, if (adresse.trimEnd('/') == prefs(c).getString("adresse", null)) prefs(c).getString("empreinte", null) else null, appareil(c)) { s -> garder(c, s) }
        val r = try { cl.connecter(identifiant, motdepasse, code, Build.MODEL ?: "Téléphone") } catch (e: Exception) { etat.update { it.copy(connexion = "aucune", erreur = Texte.sansChemin(e.message)) }; return false }
        if (!r.ok) { etat.update { it.copy(connexion = "aucune", erreur = r.message, codeRequis = r.code == "code_requis") }; return false }
        client = cl; etat.update { it.copy(connexion = "ok", erreur = null, codeRequis = false) }; return true
    }
    fun oublier(c: Context) { client = null; garder(c, null); etat.value = EtatStore() }

    /** L'élément du store → l'identifiant Android de l'appli (donné par l'admin, ou appris à la première installation). */
    fun paquetAndroid(c: Context, a: Article): String? = a.paquet?.ident ?: prefs(c).getString("paquet:${a.id}", null)
    fun retenirPaquet(c: Context, element: String, paquet: String) { prefs(c).edit().putString("paquet:$element", paquet).apply() }
    /** Ce qui est vraiment installé sur le téléphone pour cet élément. */
    fun installee(c: Context, a: Article): Installee? {
        val id = paquetAndroid(c, a) ?: return null
        return try { val i = c.packageManager.getPackageInfo(id, 0); Installee(id, i.versionName ?: "0") } catch (_: PackageManager.NameNotFoundException) { null }
    }
    fun noter(texte: String) = etat.update { it.copy(historique = (listOf(texte) + it.historique).take(200)) }
    fun prendreStore(c: Context, json: Map<String, Any?>) {
        val l = Store.articles(json)
        etat.update { e -> e.copy(articles = l, installees = l.mapNotNull { a -> installee(c, a)?.let { a.id to it } }.toMap()) }
    }
}

/** La clé d'Agora dans l'Android Keystore (AES-256-GCM, ne quitte jamais le téléphone) : elle chiffre la session d'Odin. */
object Coffre {
    private const val NOM = "agora-session-v1"
    private fun cle(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(NOM, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(NOM, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
            generateKey()
        }
    }
    fun chiffrer(t: String): String { val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, cle()) }; return Base64.encodeToString(c.iv + c.doFinal(t.toByteArray()), Base64.NO_WRAP) }
    fun dechiffrer(b: String): String { val x = Base64.decode(b, Base64.NO_WRAP); val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, cle(), GCMParameterSpec(128, x, 0, 12)) }; return String(c.doFinal(x, 12, x.size - 12)) }
}
