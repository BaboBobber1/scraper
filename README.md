# CoinMarketCap Link Scraper

Ein kleines Node.js-Projekt zum Auslesen sämtlicher Projektlinks von CoinMarketCap-Seiten. Das Backend nutzt Express, Axios und Cheerio, das Frontend ist eine minimalistische HTML-Seite im Ordner `public`.

## Voraussetzungen
- Node.js (>= 18)
- npm

## Nutzung

```bash
# 1) Abhängigkeiten installieren
npm i
# 2) Starten
npm run dev
# 3) Öffnen
http://localhost:3000
```

## Funktionsweise
- `/scrape?url=` ruft die angegebene CoinMarketCap-Projektseite ab und klassifiziert externe Links (Website, Whitepaper, Explorer, Socials, Repository, weitere).
- Sollte Website oder Whitepaper fehlen, gibt der Server einen HTTP-Status 422 mit einer Fehlermeldung (`Abbruch: Pflichtlinks fehlen`) zurück.
- Das Frontend zeigt Ergebnisse im JSON-Format an und enthält eine Beispiel-Schaltfläche für Ethereum.
