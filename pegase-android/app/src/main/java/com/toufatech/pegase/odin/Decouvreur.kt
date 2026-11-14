package com.toufatech.pegase.odin

import com.toufatech.pegase.coeur.Decouverte
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Trouver Odin tout seul (protocole § 1) : 127.0.0.1:7777, puis le /24 du Wi-Fi sur 7777 et 7443,
 * 32 requêtes en parallèle, 1,5 s au plus chacune, https d'abord puis http.
 */
object Decouvreur {
    /** Les adresses IPv4 du téléphone (Wi-Fi, VPN…), sans la boucle locale. */
    fun adressesLocales(): List<String> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .mapNotNull { it.hostAddress }
    } catch (e: Exception) {
        emptyList()
    }

    /** Essaie une adresse : https puis http. */
    fun essayer(c: Decouverte.Candidat, delaiMs: Int = Decouverte.DELAI_MS): Bonjour? {
        for (https in listOf(true, false)) {
            val client = ClientOdin(c.base(https), Epinglage(null))
            ApiPegase.bonjour(client, delaiMs)?.let { return it }
        }
        return null
    }

    /**
     * Cherche sur le réseau ; rend les Odin trouvés (le plus souvent un seul), dans l'ordre des candidats.
     * [candidats] est remplaçable pour les essais.
     */
    fun chercher(
        candidats: List<Decouverte.Candidat> = Decouverte.candidats(Decouverte.choisirIp(adressesLocales())),
        delaiMs: Int = Decouverte.DELAI_MS,
        arreterAuPremier: Boolean = true,
    ): List<Bonjour> {
        // La machine elle-même d'abord (rien à taper si Odin tourne ici).
        val premier = candidats.firstOrNull()
        if (premier != null && arreterAuPremier) essayer(premier, delaiMs)?.let { return listOf(it) }
        val reste = if (arreterAuPremier) candidats.drop(1) else candidats
        val pool = Executors.newFixedThreadPool(Decouverte.PARALLELE) { r -> Thread(r, "pegase-cherche").apply { isDaemon = true } }
        try {
            val futurs = reste.map { c -> pool.submit(Callable { essayer(c, delaiMs) }) }
            val trouves = ArrayList<Bonjour>()
            for (f in futurs) {
                val b = try {
                    f.get((delaiMs * 2L + 2000L) * (reste.size / Decouverte.PARALLELE + 1), TimeUnit.MILLISECONDS)
                } catch (e: Exception) {
                    null
                }
                if (b != null && trouves.none { it.base == b.base }) {
                    trouves += b
                    if (arreterAuPremier) break
                }
            }
            return trouves
        } finally {
            pool.shutdownNow()
        }
    }
}
