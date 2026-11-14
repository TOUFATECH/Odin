package com.toufatech.pegase.moteur

import android.net.Uri
import com.toufatech.pegase.appli.Pegase
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PromptDelegate
import org.mozilla.geckoview.GeckoSession.PromptDelegate.PromptResponse

/** Une question posée par une page (alerte, confirmation, liste déroulante, fichier à envoyer), montrée par Pégase. */
sealed class Invite {
    data class Alerte(val titre: String?, val message: String, val ok: () -> Unit) : Invite()
    data class Confirmer(val titre: String?, val message: String, val repondre: (Boolean) -> Unit) : Invite()
    data class Texte(val titre: String?, val message: String, val defaut: String, val repondre: (String?) -> Unit) : Invite()
    data class Option(val id: String, val texte: String, val choisie: Boolean, val desactivee: Boolean)
    data class Choix(val titre: String?, val options: List<Option>, val plusieurs: Boolean, val repondre: (List<String>?) -> Unit) : Invite()
    data class Fichier(val types: List<String>, val plusieurs: Boolean, val repondre: (List<Uri>?) -> Unit) : Invite()
}

/**
 * Les questions des pages (sans elles, une liste déroulante ou un « choisir un fichier » ne marchent pas dans GeckoView).
 * Le texte vient de la page : il est montré tel quel, jamais suivi comme un ordre par Pégase.
 */
class Invites(private val pegase: Pegase) : PromptDelegate {
    private fun poser(fabrique: (GeckoResult<PromptResponse>) -> Invite): GeckoResult<PromptResponse> {
        val r = GeckoResult<PromptResponse>()
        pegase.invite = fabrique(r)
        return r
    }

    private fun fin(r: GeckoResult<PromptResponse>, rep: PromptResponse) {
        pegase.invite = null
        r.complete(rep)
    }

    override fun onAlertPrompt(session: GeckoSession, prompt: PromptDelegate.AlertPrompt): GeckoResult<PromptResponse> =
        poser { r -> Invite.Alerte(prompt.title, prompt.message ?: "", ok = { fin(r, prompt.dismiss()) }) }

    override fun onButtonPrompt(session: GeckoSession, prompt: PromptDelegate.ButtonPrompt): GeckoResult<PromptResponse> =
        poser { r ->
            Invite.Confirmer(prompt.title, prompt.message ?: "") { oui ->
                fin(r, prompt.confirm(if (oui) PromptDelegate.ButtonPrompt.Type.POSITIVE else PromptDelegate.ButtonPrompt.Type.NEGATIVE))
            }
        }

    override fun onTextPrompt(session: GeckoSession, prompt: PromptDelegate.TextPrompt): GeckoResult<PromptResponse> =
        poser { r ->
            Invite.Texte(prompt.title, prompt.message ?: "", prompt.defaultValue ?: "") { t ->
                fin(r, if (t == null) prompt.dismiss() else prompt.confirm(t))
            }
        }

    override fun onChoicePrompt(session: GeckoSession, prompt: PromptDelegate.ChoicePrompt): GeckoResult<PromptResponse> {
        val options = ArrayList<Invite.Option>()
        fun ajouter(choix: Array<PromptDelegate.ChoicePrompt.Choice>) {
            for (c in choix) {
                val sous = c.items
                if (sous != null) ajouter(sous)
                else if (!c.separator) options += Invite.Option(c.id, c.label, c.selected, c.disabled)
            }
        }
        ajouter(prompt.choices)
        return poser { r ->
            Invite.Choix(prompt.title, options, prompt.type == PromptDelegate.ChoicePrompt.Type.MULTIPLE) { ids ->
                fin(r, if (ids == null) prompt.dismiss() else if (ids.size == 1) prompt.confirm(ids[0]) else prompt.confirm(ids.toTypedArray()))
            }
        }
    }

    override fun onFilePrompt(session: GeckoSession, prompt: PromptDelegate.FilePrompt): GeckoResult<PromptResponse> =
        poser { r ->
            Invite.Fichier(prompt.mimeTypes?.toList() ?: emptyList(), prompt.type == PromptDelegate.FilePrompt.Type.MULTIPLE) { uris ->
                fin(
                    r,
                    when {
                        uris.isNullOrEmpty() -> prompt.dismiss()
                        uris.size == 1 -> prompt.confirm(pegase.app, uris[0])
                        else -> prompt.confirm(pegase.app, uris.toTypedArray())
                    },
                )
            }
        }
}
