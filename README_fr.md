<p align="right">
  <a href="README.md">English 🇺🇸</a> | <b>Français 🇫🇷</b>
</p>

<p align="center">
  <img src="src/public/img/Icone256x256.png" alt="Animarr Logo" width="128">
</p>

# 🦾 Animarr - Smart Torznab Proxy for Anime

[![Status](https://img.shields.io/badge/Status-Beta-orange.svg)]()
[![Platform](https://img.shields.io/badge/Platform-YunoHost%20%7C%20Linux%20%7C%20Docker-blue.svg)]()
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)]()

**Animarr** est un proxy intelligent conçu pour résoudre le plus gros problème des amateurs d'Anime utilisant la suite *arr (Sonarr/Radarr) : **la mauvaise reconnaissance des titres par les indexeurs Torznab.**

Il agit comme un pont entre vos applications de gestion (Sonarr/Radarr) et votre agrégateur d'indexeurs (Prowlarr), en corrigeant les titres à la volée grâce à une combinaison de règles Regex puissantes et de lookups sur les APIs officielles (AniList, MyAnimeList, TMDB).

---

## 🔥 Pourquoi utiliser Animarr ?

Les indexeurs (NekoBT, NorTorrent, etc.) utilisent souvent des noms japonais ou des formats de titres que Sonarr/Radarr ne reconnaissent pas directement. 

**Sans Animarr :** Vos recherches échouent car les titres ne correspondent pas.
**Avec Animarr :**
1. **Interception** : Sonarr envoie une recherche pour "Attack on Titan".
2. **Nettoyage** : Animarr retire les bruits (années, tags, "The Movie").
3. **Traduction** : Animarr demande aux APIs les titres alternatifs (ex: "Shingeki no Kyojin").
4. **Relais** : Animarr demande à Prowlarr tous ces titres en une seule fois.
5. **Nettoyage Final** : Les résultats sont triés et nettoyés avant d'être renvoyés à Sonarr.

### 📝 Exemple concret : *A Silent Voice* (Koe no Katachi)

| État | Recherche envoyée | Résultats obtenus |
| :--- | :--- | :--- |
| **Sans Animarr** | `A Silent Voice : The Movie (2016)` | ❌ Bandes originales, versions RAW chinoises ou rien du tout. |
| **Avec Animarr** | `A Silent Voice` OR `Koe no Katachi` | ✅ **Releases de qualité** (Judas, DB, LYS1TH3A) trouvées immédiatement. |

---

## 🚀 Déploiement

### Scenario A : Sur le même serveur (Local)
*C'est la méthode recommandée pour la performance et la sécurité.*

1. **Installez Animarr** sur votre serveur (via YunoHost ou binaire).
2. **Configuration Dashboard** :
   - URL Prowlarr : `http://127.0.0.1:9696/prowlarr`
   - Clé API Prowlarr : *(votre clé API Prowlarr)*
3. **Dans Radarr/Sonarr** :
   - URL de l'indexeur : `http://127.0.0.1:5000/[ID_INDEXEUR]`
   - Clé API : *(la même que dans Prowlarr)*

### Scenario B : Sur un serveur distant (Remote)
*Si vos indexeurs et Animarr ne sont pas sur la même machine.*

1. **Exposez Animarr** via un domaine (ex: `https://animarr.mondomaine.com`) ou un tunnel.
2. **Configuration Dashboard** :
   - URL Prowlarr : `https://prowlarr.mondomaine.com` (URL publique de Prowlarr).
3. **Dans Radarr/Sonarr** :
   - URL de l'indexeur : `https://animarr.mondomaine.com/[ID_INDEXEUR]`

---

## 🛠️ Configuration du Dashboard

Accédez à l'interface web (par défaut sur le port `5000` ou votre URL YunoHost) pour gérer :

- **Regex Cleaner** : Supprimez les mots gênants (`The Movie`, `2024`, etc.) avant la recherche.
- **Custom Dictionary** : Forcez manuellement des correspondances entre un titre et des IDs (TMDB, MAL, AniList).
- **Logs d'interception** : Voyez exactement comment vos recherches ont été transformées en temps réel.
- **Prowlarr Rules** : Nettoyez les titres des résultats *avant* qu'ils n'arrivent dans votre file d'attente de téléchargement.

---

## 📦 Installation via YunoHost

Si vous utilisez YunoHost, l'installation est simplifiée au maximum :

```bash
sudo yunohost app install https://github.com/wiwileborne/Animarr_ynh
```

Le package gère automatiquement le service Systemd, la configuration Nginx et l'isolation des données.

---

## 🤝 Crédits

Développé par **wiwileborne** pour la communauté YunoHost et les passionnés d'automatisation média.

---
<p align="center">Made with ❤️ for the Anime Community</p>
