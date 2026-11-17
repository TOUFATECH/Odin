package com.toufatech.pegase.coeur

import org.junit.Test
import kotlin.test.assertEquals

class SseTest {
    @Test
    fun litLesEvenementsDOdin() {
        val vus = ArrayList<EvenementSse>()
        val l = LecteurSse { vus += it }
        val flux = "event: bonjour\ndata: {\"profil\":\"p_1\"}\n\n: signe de vie\n\nevent: changements\ndata: ligne1\ndata:ligne2\n\ndata: sans type\n\n"
        flux.split("\n").forEach { l.ligne(it) }
        assertEquals(3, vus.size)
        assertEquals("bonjour", vus[0].type)
        assertEquals("{\"profil\":\"p_1\"}", vus[0].data)
        assertEquals("ligne1\nligne2", vus[1].data)
        assertEquals("message", vus[2].type)
    }
}
