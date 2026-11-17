package com.toufatech.pegase.appli

import android.app.Application

/** L'application : un seul état de Pégase pour toute la vie du processus. */
class PegaseApp : Application() {
    lateinit var pegase: Pegase
        private set

    override fun onCreate() {
        super.onCreate()
        pegase = Pegase(this)
        Rappels.creerCanal(this)
    }
}
