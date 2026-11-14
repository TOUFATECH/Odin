package com.toufatech.agora.coeur

import org.junit.Assert.assertEquals
import org.junit.Test

class TexteTest {
    @Test
    fun aucunCheminDeDossierNeSeVoit() {
        assertEquals("plus de place sur le téléphone", Texte.sansChemin("/data/user/0/com.toufatech.agora/cache/x.apk: open failed: ENOSPC (No space left on device)"))
        assertEquals("… (Is a directory)", Texte.sansChemin("/data/user/0/com.toufatech.agora/files/profils/p1/x.json (Is a directory)"))
        assertEquals("copie impossible vers …", Texte.sansChemin("copie impossible vers /storage/emulated/0/Download/x.pdf"))
    }

    @Test
    fun lesAdressesWebRestent() {
        assertEquals("erreur https://192.168.1.10:7777/api/x 500", Texte.sansChemin("erreur https://192.168.1.10:7777/api/x 500"))
        assertEquals("erreur inattendue", Texte.sansChemin(null))
    }
}
