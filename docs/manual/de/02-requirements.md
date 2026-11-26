# 2. Voraussetzungen

[Inhalt](README.md)

Was PadSpan HA braucht, bevor du es installierst: ein Home Assistant, einen Rechner mit genug
Speicher, mindestens einen Bluetooth-Empfänger und für jede Person etwas, das sie bei sich trägt.

## Home Assistant

PadSpan HA braucht **Home Assistant 2024.8 oder neuer**.

- Ab Home Assistant 2026.11 installierst du es über **Einstellungen → Marketplace**.
- Bei älteren Versionen installierst du es mit HACS.

Beides steht in [Kapitel 3](03-install-update-uninstall.md).

Deine Räume sind die **Bereiche** von Home Assistant, und deine Etagen sind seine **Etagen**. Richte
sie vor dem Start unter **Einstellungen → Bereiche, Labels & Zonen** ein; PadSpan liest sie von
dort. Ein Haus mit einer Etage braucht überhaupt keine Etagen.

Für das Hochladen eines Grundrisses, das Festlegen seines Maßstabs, den Start des Testzeitraums,
Backups und alles, was Daten aus dem Haus schickt, braucht es einen **Administrator** von Home
Assistant. Bei einer neuen Installation ist außerdem **Erweiterte Sicherheit** an: Jede Änderung an
PadSpans gemeinsamer Einrichtung braucht dann einen Administrator, während der Rest des Haushalts es
weiter ansehen und nutzen kann.

## Der Rechner, auf dem Home Assistant läuft

| | |
|---|---|
| **Empfohlen** | **Mehr als 2 GB Speicher.** Ein Raspberry Pi 4 oder 5 mit 4 GB oder mehr, ein Home Assistant Green oder ein beliebiger Mini-PC oder eine virtuelle Maschine mit 4 GB oder mehr. |
| **Rechner mit 2 GB** | Vorerst nicht empfohlen. Hast du einen, schalte den **Speichersparmodus** ein (unten). An einer belebten Straße oder in einem Wohnblock hört PadSpan Tausende vorbeikommende Bluetooth-Geräte, und einem Raspberry Pi mit 2 GB ist schon innerhalb weniger Stunden der Speicher ausgegangen. |
| **Datenträger** | **Eine SSD oder eMMC statt einer SD-Karte.** PadSpan speichert seinen Geräteverlauf bis zu alle 15 Sekunden auf den Datenträger. |

PadSpan behält jedes Gerät, das es hört, eine Weile, nicht nur die, denen du folgst. In einem
ruhigen Haus sind das ein paar Hundert. Neben einer belebten Straße können es Zehntausende sein, und
das kostet Speicher.

### Speichersparmodus

**Einstellungen → Ortung → Leistung → Speichersparmodus**, ab Werk aus. Er hält weniger
vorbeikommende Geräte, und kürzer:

| | Normal | Mit Speichersparmodus |
|---|---|---|
| Wie lange PadSpan sich eine gehörte Adresse merkt | Der BLE-Advertisement-Timeout (4 Stunden, wenn du ihn nicht änderst) | Höchstens 15 Minuten |
| Gemerkte Adressen | Keine Grenze | 2.000 |
| Unbenannte Geräte im Geräteverlauf | 10.000, für 1 bis 14 Tage | 2.000, für 1 Tag |
| Bluetooth-Advertisements, die ans Panel gehen | 5.000 | 2.000 |

Er ändert sonst nichts. Benannte Geräte, Geräte mit Label und Geräte, denen du folgst, fallen nie
heraus, und Räume, Positionen, der Atlas und Live Aboard funktionieren wie vorher. Vorbeikommende
Fremde fallen nur früher aus den Listen. Die Karte fragt, bevor sie ihn einschaltet.

Die gemessenen Speicherwerte, Gerät für Gerät, stehen in
[Minimum requirements](../../MINIMUM_REQUIREMENTS.md).

## Bluetooth-Empfänger

PadSpan hört über Bluetooth-Empfänger (auch Bluetooth-Proxys oder Scanner genannt). Du brauchst
mindestens einen:

- **Ein Empfänger** unterscheidet zu Hause von weg.
- **Einer in jedem Raum, den du unterscheiden willst**, gibt dir Räume. Ein Raum ohne eigenen
  Empfänger lässt sich trotzdem unterscheiden, sobald du eine Karte mit drei oder mehr Empfängern
  darauf hast.

Jeder Empfänger braucht einen **Bereich** in Home Assistant: Das ist sein Raum. Ein Empfänger ohne
Bereich ergibt keinen Raum, egal wie gut er dich hört. [Kapitel 4](04-first-room.md) zeigt, wo du
ihn festlegst.

PadSpan nutzt diese Arten. Du kannst sie mischen.

| Empfänger | Was du tust |
|---|---|
| **ESPHome-Bluetooth-Proxy** (ein ESP32-Board) | Nichts weiter: Das Bluetooth von Home Assistant gibt PadSpan, was das Board hört. Ein Board mit externer Antenne ist besser als eins mit Chipantenne. |
| **Shelly, Gen2 oder neuer** | Stell ihn in den Einstellungen des Shelly selbst als Bluetooth-Scanner ein: [Deine Shellys können Bluetooth-Proxys sein](https://padspan.traks.ca/guides/shelly-bluetooth-proxy/). Home Assistant gibt ihn dann wie einen ESPHome-Proxy an PadSpan weiter. |
| **Das eigene Bluetooth des Home-Assistant-Rechners** oder ein USB-Bluetooth-Adapter | Nichts weiter, sobald die Bluetooth-Integration von Home Assistant es hat. |
| **ESPresense**-Knoten | Sie kommen über MQTT. Sie brauchen die MQTT-Integration von Home Assistant und eingeschaltet in PadSpan **Verwalten → HA Entities → ESPresense MQTT → Enable ESPresense MQTT ingestion**. |
| **Tasmota** auf einem ESP32 (experimentell) | Ebenfalls über MQTT: die MQTT-Integration von Home Assistant und **Verwalten → HA Entities → Tasmota BLE → Read Tasmota BLE over MQTT**. Gib in der Konsole jedes Tasmota `TelePeriod 10`, `BLEMaxAge 30` und `BLEAddrFilter 1` ein. Ohne sie meldet Tasmota zu langsam für Räume und meldet Handys und Tags, die ihre Adresse wechseln, nie. |

**Shellys und andere passive Empfänger ab Home Assistant 2026.4:** Zeigen sie bei der Kalibrierung
kein Signal, schalte **Alle 5 s für passive Proxy-Scanner aktualisieren** ein, unter
**Einstellungen → Ortung → Empfänger → Bluetooth-Aktualisierungsintervall**.

**Du nutzt schon Bermuda?** Behalte es. PadSpan nutzt dieselben Proxys und lässt Bermuda, wie es
ist: [Bermuda und PadSpan zusammen](https://padspan.traks.ca/guides/bermuda/).

Wie viele du brauchst und wo sie hinkommen: [Wie viele Bluetooth-Proxys brauche ich?](https://padspan.traks.ca/guides/bluetooth-proxies/)

## Etwas zum Mitnehmen

PadSpan folgt dem, was jede Person bei sich trägt. Jede Art braucht einmal eine Sache:

| Was | Was es braucht |
|---|---|
| **Android-Handy** | Die Home Assistant Companion App mit eingeschaltetem Sensor **BLE Transmitter**. PadSpan kann ihn für dich einschalten. |
| **iPhone, iPad oder Apple Watch** | Einmal seinen Schlüssel, den IRK, in der Integration Private BLE Device von Home Assistant. Ein übriger ESP32 mit irk-capture ist ein Weg, ihn zu bekommen. |
| **Ein Beacon oder Schlüsselanhänger mit fester Adresse** | Nichts: Benenne ihn in PadSpan, und der Name bleibt. |
| **AirTag, Samsung SmartTag** | Sie wechseln ihre Adresse, ohne Schlüssel zum Auslesen. AirTags funktionieren nur zum Teil, mit dem experimentellen **MAC-Wechsel überbrücken** (Einstellungen → Funktionen); SmartTags nicht zuverlässig. |

[In welchem Raum ist mein Handy?](https://padspan.traks.ca/guides/phone-room-presence/) hat die
Schritte für Handys, und [Welcher Bluetooth-Tracker funktioniert mit Home Assistant?](https://padspan.traks.ca/guides/bluetooth-tags/)
die für Tags.

## Ein Bildschirm zum Anschauen

| | |
|---|---|
| **Das Panel** | Jeder aktuelle Browser: Chrome, Edge, Safari oder Firefox, auf einem Computer, Tablet oder Handy, oder die Home-Assistant-App. |
| **Der Atlas** | Genauso. Ein Wandtablet, auf dem die Dashboards von Home Assistant flüssig laufen, schafft auch den Atlas. |
| **Live Aboard** (das 3D-Haus) | Ein Browser mit **WebGL 2**. Ohne das, oder auf einem Grafikchip, der dafür zu langsam ist, zeigt PadSpan stattdessen den flachen Atlas und sagt das. |

## Ein Grundriss (optional)

Zum Anfangen brauchst du keinen: Räume kommen aus den Bereichen deiner Empfänger. Ein Grundriss
bringt die Karte dazu und lässt PadSpan Geräte zwischen Empfängern verorten. Jedes Bild einer Etage
geht, sogar ein Foto einer Skizze. Gar kein Bild? Eine leere Etage in der Größe, die du eingibst, der
Raumscan eines Handys oder die Karte eines Saugroboters gehen auch. Siehe
[Kapitel 9](09-setup-the-map.md).

## Das Internet

Die Ortung braucht keins. PadSpan geht nur online für: seine tägliche Update-Prüfung (sie lässt sich
abschalten), die tägliche Prüfung eines Lizenzschlüssels, die KI-Funktionen, die du einschaltest, und
den Nutzungsbericht, wenn du zustimmst. Siehe [Updates & Privacy](../../../README.md#updates--privacy).
