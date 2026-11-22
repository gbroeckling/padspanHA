# Anhang D. Für Entwickler

[Inhalt](README.md)

Wie PadSpan aufgebaut ist, welche Regeln sein Code einhält, und jeder WebSocket-Befehl, den es
registriert. Zum Mitmachen: der Abschnitt [Development](../../../README.md#development) im README.
Die längeren Design-Notizen liegen in `docs/` und sind in jedem Teil verlinkt.

## So ist es aufgebaut

PadSpan HA ist eine einzige Custom Integration für Home Assistant, `custom_components/padspan_ha/`:

- **Das Backend** (Python): liest die Bluetooth-Daten von Home Assistant, ESPresense und Tasmota über
  MQTT und die Registries für Bereiche, Etagen, Geräte und Entitäten; ermittelt bei jeder Abfrage
  Räume und Positionen (`presence_coordinator.py`); hält seine Daten in den Stores
  `.storage/padspan_ha.*`; legt die Entitäten in `sensor.py`, `binary_sensor.py`, `device_tracker.py`
  und `light.py` an; und antwortet dem Panel über den WebSocket von Home Assistant.
- **Das Panel** (schlichte JavaScript-Module, ohne Build-Schritt): `www/padspan-ha/`, mit `panel.js`
  als Hülle und einem Modul pro Bildschirm unter `views/`. Der Atlas in der Seitenleiste ist
  `lights_panel.js`.
- **PadSpan Bright** entsteht aus demselben Quellcode (`scripts/bright_build.py`), ohne die
  Anwesenheitserkennung.

Eine Abfrage, kurz: Bluetooth-Messwerte von jedem Empfänger → Glättung über die Zeit, pro Gerät →
eine Abstimmung über den Raum und, mit drei oder mehr platzierten Empfängern, eine Position auf dem
Grundriss in Metern → die Entitäten und das Live-Bild, das jedes offene Panel abfragt.

## Das Fabric

**Das metrische Fabric ist die Wahrheit.** Raumformen, Positionen der Empfänger, Signalwände,
Beacon-Pins und Positionen der Lichter liegen in **Metern** im FabricStore
(`.storage/padspan_ha.fabric`). Ein Grundrissbild dient dazu, ein Gebäude einmal nachzuzeichnen, und
danach zum Ansehen. Kein laufender Code darf eine Position ableiten aus einem Bild, seiner
Pixelgröße, dem 0–1-Bruchteilraum einer Karte, einer Karten-ID oder einer Transformation pro Bild.
`tests/test_photo_divorce.py` sichert das ab; drei Dateien bleiben in Quarantäne (`calibration.js`,
`traceback.js`, `radio_map.js`), und der Wächter schlägt fehl, wenn diese Liste in die eine oder
andere Richtung veraltet.

| Store | Datei | Zuständig für |
|---|---|---|
| FabricStore | `padspan_ha.fabric` | Raumgeometrie, Positionen von Empfängern, Beacons und Lichtern, Signalwände (alles in Metern) |
| ModelStore | `padspan_ha.model` | Etagen, Raum-Metadaten, Nachbarschaft, Raum und Etage der Empfänger, Karten-Transformationen |
| MapsStore | `padspan_ha.maps` | Die Grundrissbilder und ihre Metadaten |

Jeder Schreibzugriff läuft über eine Methode des Stores (`ModelStore.async_remove_room`,
`FabricStore.async_remove_room` …), nie über den gespeicherten Blob: Ein Handler, der die Daten
direkt bearbeitet, verpasst alles, was seitdem ins Fabric gewandert ist. Die Höhe eines Empfängers
(`z_m`) wird von seiner eigenen Etage aus gemessen, nie absolut.
Mehr: [The mapping suite](../../03_MAPPING_SUITE.md).

## Cache-Busting

Home Assistant liefert die Dateien eines Custom Panels mit aggressivem Browser-Caching aus, deshalb
trägt die Adresse jeder Panel-Datei einen Stempel. Ein falscher Stempel sieht nicht nach Caching aus;
er sieht aus, als funktioniere dein Code nicht.

| Symbol | Wo | Bedeutung |
|---|---|---|
| `BUILD_VERSION` | `build_info.py` | Die Version, angezeigt in der Seitenleiste und in der Diagnose |
| `BUILD_ID` | `build_info.py` | Der Release-Stempel, neu geschrieben von `scripts/release.py` |
| `ASSET_ID` | `build_info.py` | `BUILD_ID` plus ein Digest der Frontend-Dateien: das, was die Adressen tragen |

`build_info._frontend_digest()` bildet einen Hash aus Pfad, Größe und Zeit jeder `.js`-, `.css`- und
`.html`-Datei unter `www/`; `panel.py` registriert das Panel mit `?v=<VERSION>&b=<ASSET_ID>`;
`panel.js` liest `b` aus seiner eigenen `import.meta.url` und nimmt es für jede View, die es
importiert. So fließt ein einziger Stempel von den Dateien auf der Platte bis in jede View, und er
ändert sich, sobald sich irgendeine Frontend-Datei ändert. Eine View importiert eine andere als
`` await import(`./x.js${new URL(import.meta.url).search}`) ``. Mehr:
[UI cache busting](../../06_UI_CACHE_BUSTING.md).

## RSSI-Aufzeichnung

Die Aufzeichnung hält fest, was die Positionsbestimmung tatsächlich als Eingabe bekam (den
vollständigen Messwert `{receiver: rssi}` pro verfolgtem Gerät und Abfrage), neben der Antwort, die
sie gab. So lässt sich derselbe Rundgang offline gegen geänderten Code noch einmal durchspielen und
der Unterschied als Zahl angeben. Ab Werk aus:
**Einstellungen → Funktionen → RSSI Vector Capture**, dann **Zustand → ⏺ Aufnehmen**,
**Raum markieren** in jedem Raum, **⏹ Stopp** und **.jsonl exportieren**.

- Aufgezeichnet werden nur benannte Geräte und solche, denen du folgst.
- Eine Sitzung stoppt von selbst nach ihrer Dauer (1 bis 60 Minuten), bei 25 MB oder wenn die
  Integration entladen wird.
- `tests/test_capture_replay.py` hat `load_capture()` und `replay()`: eine Golden-Regression (der
  nachgespielte Raum gleicht dem aufgezeichneten) und eine Genauigkeitsbewertung gegen die Räume, die
  du markiert hast.
- Die Werkzeuge des Genauigkeits-Benchmarks lesen dieselben Dateien: [Anhang C](C-accuracy-benchmark.md).

Mehr: [RSSI vector capture](../../08_RSSI_VECTOR_CAPTURE.md).

## Hart erkämpfte Regeln

Jede kam aus einem echten Fehler; den vollen Text mit der Geschichte dazu findest du in
[Hard-won rules](../../09_HARD_WON_RULES.md).

1. Eine Frontend-Änderung, die du nicht sehen kannst, ist keine Frontend-Änderung.
2. `node --check` führt den Code nicht aus.
3. Sieh es dir gerendert an.
4. Das Fabric ist die Wahrheit, und jeder Schreibzugriff läuft über seinen Store.
5. Ein Sidecar, das nichts füllt, ist schlimmer als gar kein Sidecar.
6. Ein Unterschied zwischen Indizes, der etwas bedeutet, muss auch so berechnet werden.
7. Wächter, die ihre Ziele von Hand auflisten, veralten.
8. Eine Fixture, die nicht fehlschlagen kann, ist schlimmer als gar keine Fixture.
9. Zeichne auf, was die Pipeline benutzt hat, nicht was sie herausgegeben hat.
10. Teste es an dem Ort, an dem es laufen wird.
11. Deployen, neu starten und den Knopf drücken.
12. Zwei Views, die dasselbe zeichnen, müssen sich einen Vertrag teilen, keine Vermutung.
13. Wenn etwas „nicht mehr funktioniert“, prüf, was es noch liest.

## Im Repository arbeiten

- Oft arbeiten mehrere Sitzungen gleichzeitig: jede in ihrem eigenen Worktree und Branch. Release
  Notes sind Dateien in `changelog.d/`, nie ein Abschnitt, der von Hand in `CHANGELOG.md` geschrieben
  wird. Releases laufen nur über `scripts/release.py`. Die Regeln stehen in der `CLAUDE.md` des
  Repositorys.
- Ein neuer Import eines Drittanbieters kommt im selben Commit in `requirements_test.txt`
  (`tests/test_requirements_declared.py`).
- Namen von Geräten, Empfängern und Räumen werden immer als Text gesetzt, nie als Markup
  (`tests/test_hostile_names.py`).
- PadSpan ändert nie von sich aus die Geräte oder Entitäten einer anderen Integration; ein Test
  schlägt fehl, wenn neuer Code das versucht.
- Die Referenztabellen des Handbuchs (Kapitel 12, 14, 20 und die Tabelle unten) erzeugt
  `scripts/build_manual_reference.py`, und `tests/test_manual_reference.py` hält sie fest. Schlägt
  dieser Test fehl, führ das Skript aus und committe, was es geschrieben hat.

## WebSocket-Befehle

Jeder Befehl, den die Integration registriert, aus dem Code gelesen: jeder Handler mit
`@websocket_command`, den die Integration registriert. In der Spalte **Administrator** steht `always`
für einen Handler mit `require_admin` und `with Enhanced security` für einen, der einen
Administrator braucht, während die erweiterte Sicherheit an ist
([Kapitel 21](21-users-and-security.md)). Ein Handler kann außerdem in seinem Inneren Teile einer
Anfrage ablehnen. Das sind die eigenen Befehle des Panels, keine stabile öffentliche Schnittstelle:
Sie ändern sich zwischen Versionen. Für Automationen nimm die Entitäten, Dienste und Ereignisse aus
[Kapitel 14](14-home-assistant-reference.md). Mehr: [Websocket API](../../02_WEBSOCKET_API.md).

Die folgende Tabelle ist englisch: Sie entsteht direkt aus PadSpans Code.

<!-- english:websocket -->
