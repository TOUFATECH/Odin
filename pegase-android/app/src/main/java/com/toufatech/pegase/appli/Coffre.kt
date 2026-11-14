package com.toufatech.pegase.appli

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.toufatech.pegase.stockage.Chiffreur
import com.toufatech.pegase.stockage.ChiffreurAes
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * La clé de Pégase dans l'Android Keystore : AES-256-GCM, créée une fois, elle ne quitte jamais le téléphone.
 * Elle chiffre les jetons d'Odin et toutes les données des profils (jamais de mot de passe gardé).
 */
object Coffre {
    private const val NOM = "pegase-donnees-v1"

    @Volatile
    private var cle: SecretKey? = null

    @Synchronized
    fun cle(): SecretKey {
        cle?.let { return it }
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existante = ks.getKey(NOM, null) as? SecretKey
        val k = existante ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(NOM, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
        cle = k
        return k
    }

    val chiffreur: Chiffreur = ChiffreurAes { cle() }
}
