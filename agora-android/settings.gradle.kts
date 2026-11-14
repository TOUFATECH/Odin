// Agora pour Android : le store d'Odin sur le téléphone (Kotlin, Jetpack Compose).
// Projet Gradle à part dans le dépôt d'Odin : il se construit depuis ce dossier (./gradlew assembleDebug).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "agora-android"
include(":app")
