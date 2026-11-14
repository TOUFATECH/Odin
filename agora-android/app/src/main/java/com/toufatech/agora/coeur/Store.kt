package com.toufatech.agora.coeur

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * Le store d'Odin sur le téléphone : ce qu'Odin propose ou impose (« mon store »), les ordres reçus par le flux, et ce
 * que le téléphone en fait. Logique pure (aucune classe d'Android) : elle tourne telle quelle dans les essais JVM.
 *
 * Ce qu'Android permet (vérifié dans la documentation d'Android, PackageInstaller) :
 *  - une appli ordinaire prépare l'installation, la personne la CONFIRME d'un toucher (STATUS_PENDING_USER_ACTION) ;
 *  - sans toucher seulement si Agora est « propriétaire de l'appareil » (device owner, Android Enterprise) :
 *    voir [Plan.silencieux] et appli/Gestion.kt.
 */
enum class Mode { PROPOSEE, OFFICE, RETIREE }

data class Paquet(val format: String, val version: String, val sha256: String, val taille: Long, val nomFichier: String, val ident: String?, val telecharger: String)

data class Article(
    val id: String, val nom: String, val desc: String, val mode: Mode, val par: String,
    val web: String?, val paquet: Paquet?, val force: String?, val etat: String?, val version: String?,
) {
    /** Imposée (installée d'office ou forcée par l'admin) : la personne ne peut pas l'enlever. */
    val impose: Boolean get() = mode == Mode.OFFICE || force == "installee"
    val pourAndroid: Boolean get() = paquet?.format == "apk"
}

data class Ordre(val id: String, val element: String, val nom: String, val action: String, val version: String?, val par: String, val qui: String)

object Store {
    fun mode(x: String?): Mode = when (x) { "office" -> Mode.OFFICE; "retiree" -> Mode.RETIREE; else -> Mode.PROPOSEE }

    @Suppress("UNCHECKED_CAST")
    fun articles(json: Map<String, Any?>): List<Article> = (json.liste("store") ?: emptyList()).objets().mapNotNull { a ->
        val id = a.texte("id") ?: return@mapNotNull null
        val p = a.objet("paquet")
        Article(
            id = id, nom = a.texte("nom") ?: id, desc = a.texte("desc") ?: "", mode = mode(a.texte("mode")), par = a.texte("par") ?: "",
            web = a.texte("web"), force = a.texte("force"), etat = a.texte("etat"), version = a.texte("version"),
            paquet = p?.let { Paquet(it.texte("format") ?: "", it.texte("version") ?: "", (it.texte("sha256") ?: "").lowercase(), it.entier("taille") ?: 0, it.texte("nomFichier") ?: "", it.texte("ident"), it.texte("telecharger") ?: "") },
        )
    }

    fun ordre(json: Map<String, Any?>): Ordre? {
        val id = json.texte("id") ?: return null
        val action = json.texte("action")?.takeIf { it in setOf("installer", "desinstaller", "mettre_a_jour") } ?: return null
        return Ordre(id, json.texte("element") ?: return null, json.texte("nom") ?: "", action, json.texte("version"), json.texte("par") ?: "mode", json.texte("qui") ?: "")
    }

    /** Compare deux versions (« 1.2.10 » > « 1.2.9 ») comme Odin. */
    fun compareVersions(a: String, b: String): Int {
        val pa = a.removePrefix("v").split('.', '+', '-'); val pb = b.removePrefix("v").split('.', '+', '-')
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val x = pa.getOrElse(i) { "0" }; val y = pb.getOrElse(i) { "0" }
            val nx = x.toLongOrNull(); val ny = y.toLongOrNull()
            val c = if (nx != null && ny != null) nx.compareTo(ny) else x.compareTo(y)
            if (c != 0) return if (c < 0) -1 else 1
        }
        return 0
    }
}

/** Ce que le téléphone fait d'un ordre. */
sealed class Plan {
    /** Télécharger, vérifier l'empreinte, puis installer : [silencieux] si Agora est propriétaire de l'appareil, sinon la personne confirme. */
    data class Installer(val paquet: Paquet, val silencieux: Boolean) : Plan()
    data class Desinstaller(val paquetAndroid: String, val silencieux: Boolean) : Plan()
    /** Rien à faire (déjà fait) : on le dit à Odin. */
    data class DejaFait(val etat: String, val version: String?) : Plan()
    /** Impossible ici : le message part à Odin comme une erreur. */
    data class Impossible(val raison: String) : Plan()
}

/** Une appli installée sur le téléphone (lue par PackageManager), vue par son identifiant Android (com.exemple.appli). */
data class Installee(val paquetAndroid: String, val version: String)

object Decision {
    /**
     * L'ordre [o] pour l'élément [a] (du store), sachant ce qui est installé ([installee], null si absente) et si Agora est
     * propriétaire de l'appareil ([gere]).
     */
    fun plan(o: Ordre, a: Article?, installee: Installee?, gere: Boolean): Plan {
        if (o.action == "desinstaller") {
            val id = installee?.paquetAndroid ?: a?.paquet?.ident ?: return Plan.DejaFait("absente", null)
            if (installee == null) return Plan.DejaFait("absente", null)
            return Plan.Desinstaller(id, gere)
        }
        val p = a?.paquet ?: return Plan.Impossible("Pas d'installateur pour ce téléphone dans le store.")
        if (p.format != "apk") return Plan.Impossible("${a.nom} n'existe pas pour Android (${p.format}).")
        if (!Regles.empreinteValide(p.sha256)) return Plan.Impossible("Odin n'a pas donné d'empreinte valable : installation refusée.")
        if (installee != null && Store.compareVersions(installee.version, p.version) >= 0) return Plan.DejaFait("installee", installee.version)
        return Plan.Installer(p, gere)
    }

    /** Le texte de la carte (maquette StoreTel). */
    fun texte(a: Article, installee: Installee?, attente: Boolean): String = when {
        attente -> if (a.impose) "Installation demandée${if (a.par.isNotEmpty()) " par ${a.par}" else ""}" else "Touche « Installer » dans la fenêtre d'Android"
        a.mode == Mode.RETIREE -> "Retirée${if (a.par.isNotEmpty()) " par ${a.par}" else ""}"
        installee != null -> "Installée${if (a.impose) " · imposée" else ""}"
        a.paquet == null && a.web != null -> "Dans ton espace Odin"
        !a.pourAndroid -> "Pour ordinateur seulement"
        a.mode == Mode.OFFICE -> "Imposée${if (a.par.isNotEmpty()) " par ${a.par}" else ""}"
        else -> "Proposée${if (a.par.isNotEmpty()) " par ${a.par}" else ""}"
    }
}

class EmpreinteFausse(message: String) : Exception(message)

object Regles {
    fun empreinteValide(x: String): Boolean = Regex("^[a-f0-9]{64}$").matches(x)

    /**
     * Copie [entree] dans [dest] en calculant son SHA-256 ; si l'empreinte n'est pas [attendue], le fichier est effacé et
     * [EmpreinteFausse] levée : rien n'est installé. [progression] reçoit 0 à 100 si [taille] est connue.
     */
    fun copierVerifie(entree: InputStream, dest: File, attendue: String, taille: Long = 0, progression: (Int) -> Unit = {}): File {
        if (!empreinteValide(attendue)) throw EmpreinteFausse("Odin n'a pas donné d'empreinte valable : installation refusée.")
        val md = MessageDigest.getInstance("SHA-256")
        var n = 0L; var dernier = -1
        dest.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val k = entree.read(buf); if (k < 0) break
                md.update(buf, 0, k); out.write(buf, 0, k); n += k
                if (taille > 0) { val pc = ((n * 100) / taille).toInt().coerceIn(0, 100); if (pc != dernier) { dernier = pc; progression(pc) } }
            }
        }
        val vu = md.digest().joinToString("") { "%02x".format(it) }
        if (vu != attendue) { dest.delete(); throw EmpreinteFausse("Empreinte différente : installation refusée (attendue ${attendue.take(12)}…, reçue ${vu.take(12)}…).") }
        return dest
    }
}
