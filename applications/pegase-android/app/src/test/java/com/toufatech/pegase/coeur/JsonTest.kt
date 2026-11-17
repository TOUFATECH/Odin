package com.toufatech.pegase.coeur

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class JsonTest {
    @Test
    fun litEtReecritUnObjet() {
        val texte = """{"id":"f-1","n":12,"x":1.5,"ok":true,"rien":null,"l":[1,"a",{"b":false}],"t":"é \"guillemets\" \\ \n fin"}"""
        val m = Json.objet(texte)
        assertEquals("f-1", m.texte("id"))
        assertEquals(12L, m.entier("n"))
        assertEquals(1.5, m.decimal("x"))
        assertEquals(true, m.booleen("ok"))
        assertNull(m["rien"])
        assertEquals(3, m.liste("l")!!.size)
        assertEquals("é \"guillemets\" \\ \n fin", m.texte("t"))
        assertEquals(m, Json.objet(Json.ecrire(m)))
    }

    @Test
    fun grandsNombresEtUnicode() {
        val m = Json.objet("""{"maj":1763112000123,"e":"é😀","neg":-3,"exp":1e3}""")
        assertEquals(1763112000123L, m.entier("maj"))
        assertEquals("é😀", m.texte("e"))
        assertEquals(-3L, m.entier("neg"))
        assertEquals(1000L, m.entier("exp"))
        assertEquals("""{"a":1763112000123,"b":2.5,"c":3}""", Json.ecrire(linkedMapOf("a" to 1763112000123L, "b" to 2.5, "c" to 3.0)))
    }

    @Test
    fun echappeLesCaracteresDeControle() {
        assertEquals("\"a\\u0001\\tb\"", Json.ecrire("a\u0001\tb"))
        assertEquals("a\u0001\tb", Json.lire(Json.ecrire("a\u0001\tb")))
    }

    @Test
    fun refuseUnJsonCasse() {
        assertFailsWith<Json.Illisible> { Json.lire("{\"a\":") }
        assertFailsWith<Json.Illisible> { Json.lire("{\"a\":1} en trop") }
        assertFailsWith<Json.Illisible> { Json.lire("[1,]") }
        assertFailsWith<Json.Illisible> { Json.lire("\"pas fini") }
    }
}
