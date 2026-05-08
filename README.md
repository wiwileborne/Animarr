<p align="right">
  <b>English 🇺🇸</b> | <a href="README_fr.md">Français 🇫🇷</a>
</p>

<p align="center">
  <img src="src/public/img/Icone256x256.png" alt="Animarr Logo" width="128">
</p>

# 🦾 Animarr - Smart Torznab Proxy for Anime

[![Status](https://img.shields.io/badge/Status-Beta-orange.svg)]()
[![Platform](https://img.shields.io/badge/Platform-YunoHost%20%7C%20Linux%20%7C%20Docker-blue.svg)]()
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)]()

**Animarr** is a smart proxy designed to solve the biggest problem for Anime fans using the *arr suite (Sonarr/Radarr): **poor title recognition by Torznab indexers.**

It acts as a bridge between your management applications (Sonarr/Radarr) and your indexer aggregator (Prowlarr), fixing titles on the fly using a combination of powerful Regex rules and lookups on official APIs (AniList, MyAnimeList, TMDB).

---

## 🔥 Why use Animarr?

Indexers (NekoBT, NorTorrent, etc.) often use Japanese names or title formats that Sonarr/Radarr don't directly recognize.

**Without Animarr:** Your searches fail because titles don't match.
**With Animarr:**
1. **Interception**: Sonarr sends a search for "Attack on Titan".
2. **Cleaning**: Animarr removes noise (years, tags, "The Movie").
3. **Translation**: Animarr asks APIs for alternative titles (e.g., "Shingeki no Kyojin").
4. **Relay**: Animarr asks Prowlarr for all these titles at once.
5. **Final Cleanup**: Results are sorted and cleaned before being sent back to Sonarr.

### 📝 Real-world Example: *A Silent Voice* (Koe no Katachi)

| State | Search Sent | Results Obtained |
| :--- | :--- | :--- |
| **Without Animarr** | `A Silent Voice : The Movie (2016)` | ❌ Soundtracks, raw Chinese versions, or nothing at all. |
| **With Animarr** | `A Silent Voice` OR `Koe no Katachi` | ✅ **High-quality releases** (Judas, DB, LYS1TH3A) found immediately. |

---

## 🚀 Deployment

### Scenario A: On the same server (Local)
*This is the recommended method for performance and security.*

1. **Install Animarr** on your server (via YunoHost or binary).
2. **Dashboard Configuration**:
   - Prowlarr URL: `http://127.0.0.1:9696/prowlarr`
   - Prowlarr API Key: *(your Prowlarr API key)*
3. **In Radarr/Sonarr**:
   - Indexer URL: `http://127.0.0.1:5000/[INDEXER_ID]`
   - API Key: *(same as in Prowlarr)*

### Scenario B: On a remote server (Remote)
*If your indexers and Animarr are not on the same machine.*

1. **Expose Animarr** via a domain (e.g., `https://animarr.mydomain.com`) or a tunnel.
2. **Dashboard Configuration**:
   - Prowlarr URL: `https://prowlarr.mydomain.com` (Prowlarr's public URL).
3. **In Radarr/Sonarr**:
   - Indexer URL: `https://animarr.mydomain.com/[INDEXER_ID]`

---

## 🛠️ Dashboard Configuration

Access the web interface (default on port `5000` or your YunoHost URL) to manage:

- **Regex Cleaner**: Remove annoying words (`The Movie`, `2024`, etc.) before searching.
- **Custom Dictionary**: Manually force matches between a title and IDs (TMDB, MAL, AniList).
- **Interception Logs**: See exactly how your searches were transformed in real-time.
- **Prowlarr Rules**: Clean result titles *before* they reach your download queue.

---

## 📦 Installation via YunoHost

If you are using YunoHost, installation is as simple as:

```bash
sudo yunohost app install https://github.com/wiwileborne/Animarr_ynh
```

The package automatically handles the Systemd service, Nginx configuration, and data isolation.

---

## 🤝 Credits

Developed by **wiwileborne** for the YunoHost community and media automation enthusiasts.

---
<p align="center">Made with ❤️ for the Anime Community</p>
