// Pégase pour Android : le navigateur d'Odin (Kotlin, Jetpack Compose, GeckoView).
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
        // GeckoView (moteur de Firefox, licence MPL 2.0) : utilisé comme dépendance, jamais recopié.
        maven {
            url = uri("https://maven.mozilla.org/maven2/")
            content { includeGroup("org.mozilla.geckoview") }
        }
    }
}

rootProject.name = "pegase-android"
include(":app")
