# Wassertemperaturen Bayern

Karte mit den aktuellen Wassertemperaturen bayerischer Seen und Flüsse (rund 60 Messstellen in Südbayern), mit Verlauf der letzten 7 bzw. 30 Tage pro Messstelle.

**Live: https://akkl.github.io/wassertemperaturen-bayern/**

## Was ist in diesem Repository?

| Branch | Inhalt |
|---|---|
| `main` | Nur diese README. |
| `gh-pages` | Die fertig gebaute Webseite (HTML, CSS, JavaScript, Leaflet, uPlot) und die Messdaten als JSON (`data/latest.json`, `data/history/<Messstelle>.json`). Wird von GitHub Pages ausgeliefert. |

Der Inhalt von `gh-pages` wird **automatisch stündlich** von einem Heimserver erzeugt und komplett ersetzt (immer genau ein Commit, daher keine Historie). Bitte dort nichts von Hand ändern, es wird beim nächsten Lauf überschrieben. Der Quellcode für Datenerfassung und Seite liegt in einem privaten Repository.

## So funktioniert es

1. Ein kleiner Dienst liest alle 30 Minuten die aktuellen Wassertemperaturen vom Gewässerkundlichen Dienst Bayern und speichert sie.
2. Einmal pro Stunde wird daraus der aktuelle Stand plus 30 Tage Verlauf (Stundenmittel) als JSON exportiert und zusammen mit der Webseite hierher veröffentlicht.
3. Die Seite lädt diese JSON-Dateien und zeigt sie auf einer OpenStreetMap-Karte. Messwerte, die älter als 24 Stunden sind, werden grau als „veraltet“ markiert. Ist der Export selbst älter als 3 Stunden, erscheint ein Hinweis.

Alle Zeiten werden in Europe/Berlin angezeigt.

## Daten und Lizenz

Datenquelle: Bayerisches Landesamt für Umwelt, [www.lfu.bayern.de](https://www.lfu.bayern.de) ([Gewässerkundlicher Dienst Bayern](https://www.gkd.bayern.de/), Daten unter [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de)). Kartendaten © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende.

Privates, nicht-kommerzielles Hobbyprojekt, **ohne Gewähr** für Aktualität und Richtigkeit der Werte.
