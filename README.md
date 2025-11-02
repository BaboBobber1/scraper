# CoinMarketCap Link Scraper

Dieses Projekt stellt eine einfache Express-Anwendung bereit, die ausgewählte Informationen von CoinMarketCap-Projektseiten
extrahiert. Im Fokus stehen ausschließlich fünf Felder: Projektwebsite, Whitepaper-Link, Whitepaper-Volltext, sowie Links zu
CoinGecko und DexTools. Das Frontend im Ordner `public` ermöglicht eine schnelle Abfrage über den Browser.

## Voraussetzungen

- Node.js (>= 18)
- npm

## Nutzung

```bash
# Abhängigkeiten installieren
yarn install || npm install

# Server starten
npm run dev

# Anwendung im Browser öffnen
http://localhost:3000
```

## API

- **Route:** `GET /scrape?url=<CMC-URL>`
- **Antwort:**
  ```json
  {
    "ok": true,
    "inputUrl": "<CMC-URL>",
    "scrapedAt": "<ISO-Zeitstempel>",
    "result": {
      "website": "<URL oder null>",
      "whitepaperUrl": "<URL oder null>",
      "whitepaperText": "<kompletter Text oder null>",
      "coingecko": "<URL oder null>",
      "dextools": "<URL oder null>"
    }
  }
  ```
- Sollte Website oder Whitepaper fehlen, antwortet der Server mit HTTP 422 und `ok: false`.

## Tests

Ein manueller Test kann mit der Ethereum-Seite von CoinMarketCap durchgeführt werden:

1. Server starten (`npm run dev`).
2. Im Browser `http://localhost:3000` öffnen.
3. URL `https://coinmarketcap.com/currencies/ethereum/` abfragen.
4. Erwartung: `website`, `whitepaperUrl` und `whitepaperText` sind alle ungleich `null`.
