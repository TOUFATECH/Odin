package com.toufatech.pegase.stockage

import com.toufatech.pegase.coeur.Cols
import com.toufatech.pegase.coeur.Donnees
import com.toufatech.pegase.coeur.Enregistrement
import com.toufatech.pegase.coeur.FileAttente
import com.toufatech.pegase.coeur.Json
import com.toufatech.pegase.odin.Persistance
import java.io.File
import java.io.FileOutputStream
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Chiffre et déchiffre ce que Pégase écrit sur le téléphone. */
interface Chiffreur {
    fun chiffrer(clair: ByteArray): ByteArray
    fun dechiffrer(chiffre: ByteArray): ByteArray
}

/**
 * AES-256-GCM. Sur le téléphone, la clé vit dans l'Android Keystore (elle ne sort jamais de la puce de sécurité) ;
 * l'IV est tiré par le chiffreur lui-même (obligatoire avec le Keystore) et rangé devant le texte chiffré.
 * Forme : [1 octet version = 1][1 octet taille de l'IV][IV][texte chiffré + étiquette GCM].
 */
class ChiffreurAes(private val cle: () -> SecretKey) : Chiffreur {
    override fun chiffrer(clair: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, cle())
        val iv = c.iv
        val corps = c.doFinal(clair)
        return byteArrayOf(1, iv.size.toByte()) + iv + corps
    }

    override fun dechiffrer(chiffre: ByteArray): ByteArray {
        require(chiffre.size > 2 && chiffre[0] == 1.toByte()) { "Format de fichier inconnu" }
        val n = chiffre[1].toInt()
        val iv = chiffre.copyOfRange(2, 2 + n)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, cle(), GCMParameterSpec(128, iv))
        return c.doFinal(chiffre, 2 + n, chiffre.size - 2 - n)
    }
}

/**
 * Les fichiers d'un profil Pégase (zéro SQLite) : une collection = un fichier JSON chiffré,
 * plus la file d'attente de la synchro et les secrets (jetons). Écritures atomiques (fichier temporaire, sync, rename).
 */
class Magasin(val dossier: File, private val chiffreur: Chiffreur) : Persistance {
    init {
        dossier.mkdirs()
    }

    private fun fichier(nom: String) = File(dossier, "$nom.chiffre")

    @Synchronized
    fun lire(nom: String): String? {
        val f = fichier(nom)
        if (!f.exists()) return null
        return try {
            String(chiffreur.dechiffrer(f.readBytes()), Charsets.UTF_8)
        } catch (e: Exception) {
            // Fichier abîmé ou clé perdue (téléphone restauré) : on le met de côté, les données reviendront d'Odin.
            f.renameTo(File(dossier, "$nom.illisible"))
            null
        }
    }

    @Synchronized
    fun ecrire(nom: String, texte: String) {
        val octets = chiffreur.chiffrer(texte.toByteArray(Charsets.UTF_8))
        val tmp = File(dossier, "$nom.tmp")
        FileOutputStream(tmp).use {
            it.write(octets)
            it.fd.sync()
        }
        if (!tmp.renameTo(fichier(nom))) {
            fichier(nom).delete()
            if (!tmp.renameTo(fichier(nom))) throw java.io.IOException("Impossible d'écrire $nom")
        }
    }

    @Synchronized
    fun effacer(nom: String) {
        fichier(nom).delete()
    }

    override fun sauverCollection(col: String, liste: List<Enregistrement>) =
        ecrire("col-$col", Json.ecrire(liste.map { it.versJson() }))

    override fun sauverFile(texte: String) = ecrire("file", texte)

    fun charger(donnees: Donnees, file: FileAttente) {
        for (col in Cols.TOUTES) {
            val t = lire("col-$col") ?: continue
            val l = try {
                Json.lire(t) as? List<*>
            } catch (e: Json.Illisible) {
                null
            }
            @Suppress("UNCHECKED_CAST")
            donnees.remplacer(col, Enregistrement.listeDeJson(l as List<Any?>?))
        }
        file.charger(lire("file"))
    }

    /** Efface tout le profil du téléphone (« Quitter » ce profil). */
    fun toutEffacer() {
        dossier.listFiles()?.forEach { it.delete() }
    }
}
