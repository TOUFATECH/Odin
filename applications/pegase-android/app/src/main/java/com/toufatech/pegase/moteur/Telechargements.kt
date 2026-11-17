package com.toufatech.pegase.moteur

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import com.toufatech.pegase.appli.Pegase
import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Empreintes
import com.toufatech.pegase.coeur.Json
import com.toufatech.pegase.coeur.booleen
import com.toufatech.pegase.coeur.entier
import com.toufatech.pegase.coeur.liste
import com.toufatech.pegase.coeur.texte
import com.toufatech.pegase.odin.ErreurOdin
import org.mozilla.geckoview.WebResponse
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.URLDecoder
import java.security.DigestInputStream
import java.security.MessageDigest

enum class Etape { ATTENTE, EN_COURS, OK, ALERTE, BLOQUE, SAUTEE }

class Telechargement(val id: String, val nom: String, val url: String, val type: String) {
    var taille by mutableLongStateOf(0L)
    var antivirus by mutableStateOf(Etape.EN_COURS)
    var odin by mutableStateOf(Etape.ATTENTE)
    var enregistrement by mutableStateOf(Etape.ATTENTE)
    var texte by mutableStateOf("Asclépios analyse avant d'enregistrer")
    var verdict by mutableStateOf<String?>(null)
    var uri by mutableStateOf<Uri?>(null)
    var sha256: String? = null

    /** Attend ta réponse (« douteux » : garder quand même ou effacer). */
    var question by mutableStateOf(false)
    internal var quarantaine: File? = null
}

/**
 * Les téléchargements : chaque fichier reste en quarantaine (dossier privé de Pégase) jusqu'au verdict.
 * 1. son empreinte SHA-256 est comparée aux signatures d'Asclépios (récupérées d'Odin) ;
 * 2. il part vers Odin pour analyse **seulement si tu l'as permis** (réglage « Analyse des téléchargements par Odin ») ;
 * 3. sain ou inconnu → rangé dans Téléchargements ; douteux → tu choisis ; bloqué → effacé.
 * « Rien trouvé » ne garantit jamais qu'un fichier est sain.
 */
class Telechargements(private val pegase: Pegase) {
    val liste = mutableStateListOf<Telechargement>()
    var montre by mutableStateOf<Telechargement?>(null)

    private val dossierQuarantaine get() = File(pegase.app.filesDir, "quarantaine").apply { mkdirs() }
    private val dossierGarde get() = File(pegase.app.filesDir, "garde").apply { mkdirs() }

    fun recevoir(r: WebResponse) {
        val nom = nomDe(r)
        val type = r.headers["Content-Type"] ?: r.headers["content-type"]
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(nom.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"
        val t = Telechargement(pegase.nouvelId("t"), nom, r.uri, type.substringBefore(';').trim())
        liste.add(0, t)
        montre = t
        val corps = r.body
        if (corps == null) {
            t.antivirus = Etape.SAUTEE
            t.texte = "La page n'a rien envoyé : réessaie le téléchargement."
            return
        }
        pegase.enFond {
            val q = File(dossierQuarantaine, t.id + ".part")
            t.quarantaine = q
            val md = MessageDigest.getInstance("SHA-256")
            var n = 0L
            DigestInputStream(corps, md).use { entree ->
                FileOutputStream(q).use { sortie ->
                    val tampon = ByteArray(64 * 1024)
                    while (true) {
                        val lu = entree.read(tampon)
                        if (lu < 0) break
                        sortie.write(tampon, 0, lu)
                        n += lu
                        if (n % (1024 * 1024) < 64 * 1024) pegase.surUi { t.taille = n }
                    }
                }
            }
            val sha = Empreintes.hex(md.digest())
            t.sha256 = sha
            pegase.surUi { t.taille = n }
            analyser(t, q, sha, n)
        }
    }

    private fun analyser(t: Telechargement, q: File, sha: String, taille: Long) {
        // 1. Signatures d'Asclépios (liste gardée sur le téléphone, mise à jour depuis Odin toutes les 6 heures).
        val signatures = signatures()
        if (signatures == null) {
            pegase.surUi { t.antivirus = Etape.SAUTEE }
        } else if (sha in signatures) {
            bloquer(t, q, "Asclépios connaît ce fichier : il est malveillant. Il a été effacé sans être ouvert.")
            return
        } else {
            pegase.surUi { t.antivirus = Etape.OK }
        }
        // 2. Analyse par Odin, seulement si tu l'as permis.
        val api = pegase.apiOdin()
        val permis = pegase.reglageBool("analyse-odin", false)
        if (!permis || api == null || taille > 200L * 1024 * 1024) {
            pegase.surUi { t.odin = Etape.SAUTEE }
            garder(t, q, "inconnu")
            return
        }
        pegase.surUi { t.odin = Etape.EN_COURS }
        val r = try {
            api.analyser(q, t.nom)
        } catch (e: ErreurOdin) {
            null
        }
        val verdict = if (r != null && r.ok) r.corps.texte("verdict") else null
        val texte = r?.corps?.texte("texte")
        when (verdict) {
            "bloque" -> bloquer(t, q, texte ?: "Odin a trouvé une menace : le fichier a été effacé sans être ouvert.")
            "douteux" -> pegase.surUi {
                t.odin = Etape.ALERTE
                t.verdict = "douteux"
                t.texte = texte ?: "Odin trouve ce fichier douteux. Garde-le seulement si tu sais d'où il vient."
                t.question = true
            }
            "sain" -> {
                pegase.surUi { t.odin = Etape.OK }
                garder(t, q, "sain")
            }
            else -> {
                pegase.surUi { t.odin = Etape.SAUTEE }
                garder(t, q, "inconnu")
            }
        }
    }

    /** Réponse à la question « douteux » : garder quand même, ou effacer. */
    fun decider(t: Telechargement, garderQuandMeme: Boolean) {
        val q = t.quarantaine ?: return
        t.question = false
        pegase.enFond {
            if (garderQuandMeme) garder(t, q, "douteux") else bloquer(t, q, "Effacé à ta demande.")
        }
    }

    private fun bloquer(t: Telechargement, q: File, texte: String) {
        q.delete()
        pegase.surUi {
            t.antivirus = if (t.antivirus == Etape.EN_COURS) Etape.BLOQUE else t.antivirus
            if (t.odin == Etape.EN_COURS || t.odin == Etape.ALERTE) t.odin = Etape.BLOQUE
            t.enregistrement = Etape.BLOQUE
            t.verdict = "bloque"
            t.texte = texte
            journal(t)
        }
    }

    private fun garder(t: Telechargement, q: File, verdict: String) {
        pegase.surUi { t.enregistrement = Etape.EN_COURS }
        val uri: Uri = if (Build.VERSION.SDK_INT >= 29) {
            val res = pegase.app.contentResolver
            val v = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, t.nom)
                put(MediaStore.Downloads.MIME_TYPE, t.type)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val u = res.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: throw IllegalStateException("Téléchargements inaccessibles")
            res.openOutputStream(u)!!.use { s -> FileInputStream(q).use { it.copyTo(s) } }
            v.clear()
            v.put(MediaStore.Downloads.IS_PENDING, 0)
            res.update(u, v, null, null)
            u
        } else {
            val f = unique(File(dossierGarde, t.nom))
            q.copyTo(f)
            FileProvider.getUriForFile(pegase.app, pegase.app.packageName + ".fichiers", f)
        }
        q.delete()
        pegase.surUi {
            t.uri = uri
            t.verdict = verdict
            t.enregistrement = Etape.OK
            t.texte = when (verdict) {
                "sain" -> "Rien trouvé par Asclépios ni par Odin (ce n'est jamais une garantie)."
                "douteux" -> "Gardé à ta demande, alors qu'Odin le trouvait douteux."
                else -> "Rien de connu par Asclépios (ce n'est jamais une garantie)."
            }
            journal(t)
        }
    }

    private fun unique(f: File): File {
        if (!f.exists()) return f
        val base = f.nameWithoutExtension
        val ext = f.extension.let { if (it.isEmpty()) "" else ".$it" }
        var i = 2
        while (true) {
            val g = File(f.parentFile, "$base ($i)$ext")
            if (!g.exists()) return g
            i++
        }
    }

    /** Le journal des téléchargements (collection synchronisée `telechargements`). */
    private fun journal(t: Telechargement) {
        pegase.modifier(
            Cols.TELECHARGEMENTS, t.id,
            linkedMapOf("nom" to t.nom, "url" to t.url, "taille" to t.taille, "sha256" to (t.sha256 ?: ""), "date" to System.currentTimeMillis(), "verdict" to (t.verdict ?: "inconnu")),
        )
    }

    fun ouvrir(t: Telechargement) {
        val u = t.uri ?: return
        try {
            pegase.app.startActivity(
                Intent(Intent.ACTION_VIEW).setDataAndType(u, t.type)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (e: Exception) {
            pegase.message = "Aucune appli du téléphone ne sait ouvrir ce fichier."
        }
    }

    fun partager(t: Telechargement) {
        val u = t.uri ?: return
        val i = Intent(Intent.ACTION_SEND).setType(t.type).putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        pegase.app.startActivity(Intent.createChooser(i, "Partager ${t.nom}").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Les empreintes connues d'Asclépios ; null si on n'en a aucune (jamais eu Odin). */
    private fun signatures(): Set<String>? {
        val cache = pegase.general.lire("signatures")?.let { try { Json.objet(it) } catch (e: Exception) { null } }
        val version = cache?.entier("version")
        val vieux = (cache?.entier("le") ?: 0) < System.currentTimeMillis() - 6 * 3600_000L
        val api = pegase.apiOdin()
        if (api != null && (cache == null || vieux)) {
            try {
                val r = api.signatures(version)
                if (r.ok) {
                    if (r.corps.booleen("inchange") == true && cache != null) {
                        pegase.general.ecrire("signatures", Json.ecrire(cache + ("le" to System.currentTimeMillis())))
                    } else {
                        val l = r.corps.liste("empreintes")?.mapNotNull { it as? String } ?: emptyList()
                        val m = mapOf("version" to r.corps.entier("version"), "le" to System.currentTimeMillis(), "empreintes" to l)
                        pegase.general.ecrire("signatures", Json.ecrire(m))
                        return l.toSet()
                    }
                }
            } catch (e: ErreurOdin) {
                // hors ligne : on garde la liste qu'on a
            }
        }
        return cache?.liste("empreintes")?.mapNotNull { it as? String }?.toSet()
    }

    companion object {
        /** Le nom du fichier : Content-Disposition (filename*=UTF-8''… ou filename="…"), sinon la fin de l'adresse. */
        fun nomDe(r: WebResponse): String {
            val cd = r.headers["Content-Disposition"] ?: r.headers["content-disposition"] ?: ""
            val etoile = Regex("filename\\*\\s*=\\s*(?:UTF-8|utf-8)''([^;]+)").find(cd)?.groupValues?.get(1)
            val simple = Regex("filename\\s*=\\s*\"?([^\";]+)\"?").find(cd)?.groupValues?.get(1)
            val brut = etoile?.let { try { URLDecoder.decode(it, "UTF-8") } catch (e: Exception) { it } }
                ?: simple
                ?: Uri.parse(r.uri).lastPathSegment
                ?: "fichier"
            return nettoyer(brut)
        }

        fun nettoyer(nom: String): String {
            val n = nom.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\u0000-\\u001f<>:\"|?*]"), "_").trim().trimStart('.')
            return n.ifBlank { "fichier" }.take(120)
        }
    }
}
