# 5. Empfänger: welche, wie viele, wo

[Inhalt](README.md)

Ein Empfänger ist alles, was Bluetooth hört und das Gehörte an Home Assistant weitergibt: ein
ESP32-Board mit ESPHome, ein Shelly, das eigene Bluetooth des Home-Assistant-Rechners, ein
ESPresense-Knoten oder ein Tasmota-Gerät. Andere Software nennt sie Bluetooth-Proxys oder Scanner.
PadSpan liest sie alle über Home Assistant, ein Empfänger, den du schon hast, funktioniert also,
ohne dass du etwas hinzufügen musst.

## Wie viele

| Empfänger | Was du bekommst |
|---|---|
| Einer im Haus | Zu Hause oder weg, keine Räume. Alles, was er hört, zählt als in seinem Raum. |
| Einer in jedem Raum, den du unterscheiden willst | Räume. Jedes Gerät kommt in den Raum, dessen Empfänger es am besten hört. Eine offene Küche mit Wohnzimmer zählt als ein Raum, außer jedes Ende hat seinen eigenen Empfänger. |
| Drei oder mehr, auf einem Grundriss platziert | Dazu Positionen zwischen den Empfängern, sodass ein Gerät in einen Raum ohne eigenen Empfänger kommen kann, etwa eine Abstellkammer oder einen Flur. |

Du musst sie nicht alle zuerst kaufen. Fang mit dem an, was Home Assistant schon hört. PadSpan
zeigt ein Beispielhaus, bis es den ersten Empfänger hört. Dann füg Empfänger dort hinzu, wo die
Werte in der [Kalibrierung](11-calibration.md) es dir sagen (siehe
[Die Räume finden, die einen brauchen](#die-räume-finden-die-einen-brauchen)).

## Welche Art

Du kannst sie mischen. Verschiedene Funkgeräte hören dasselbe Handy unterschiedlich stark, in einem
gemischten Haus ist die Kalibrierung also wichtiger: Mit ihr kann PadSpan jeden Empfänger für sich
berücksichtigen.

### ESPHome-Bluetooth-Proxy (ein ESP32-Board)

Die übliche Wahl. Home Assistant findet einen ESPHome-Bluetooth-Proxy von selbst, und PadSpan nutzt
ihn, sobald Home Assistant es tut.

- **Nimm ein Board mit externer Antenne**: einen ESP32-S3 mit einem kleinen IPEX-Anschluss (u.FL)
  und einer 2,4-GHz-Antenne. Die Antenne zählt mehr als der Chip. Boards, deren Antenne nur auf die
  Platine gedruckt ist, liefern zu verrauschte Werte, um Räume auseinanderzuhalten: Zwei Räume können
  nur wenige dB auseinanderliegen, und eine verrauschte Antenne kippt diese Entscheidung zufällig.
- **WLAN reicht.** Ethernet verortet Geräte nicht merklich besser, passt aber zu einem Empfänger, der
  nie bewegt wird.
- Ältere ESP32-Boards ohne externe Antenne reichen für zu Hause oder weg, nicht für Räume.

### Shelly, Gen2 oder neuer

Shelly Plus, Pro, Gen3 und Gen4 mit Netzstrom können Empfänger sein. Shellys mit Batterie und Gen1
nicht. Shelly-BLU-Tasten und -Sensoren sind Dinge, die ein Empfänger hört, keine Empfänger.

1. Öffne in Home Assistant **Einstellungen → Geräte & Dienste → Shelly**.
2. Wähl das Zahnrad am Eintrag des Shelly.
3. Stell **Bluetooth-Scannermodus** auf **Auto** (Aktiv und Passiv gehen auch) und wähl
   **Absenden**.
4. Home Assistant führt den Scanner des Shelly als eigenes Gerät, unter
   **Einstellungen → Geräte & Dienste → Bluetooth**. Der Bereich dieses Geräts ist der Raum des
   Empfängers. Ein Scanner ohne eigenen Bereich übernimmt den seines Shelly.

Die meisten Shellys sitzen in einer Unterputzdose oder im Sicherungskasten, mit einer kleinen
eingebauten Antenne, deshalb hören sie weniger, und weniger gleichmäßig, als ein Empfänger frei im
Raum. Sieh sie als kostenlosen Anfang: Einer reicht für zu Hause oder weg, und ob sie für Räume gut
genug sind, hängt vom Haus ab. Shellys können keine Bluetooth-Verbindung halten, aber die braucht
die Raumerkennung auch nicht.

### Das eigene Bluetooth von Home Assistant

Das eingebaute Bluetooth des Home-Assistant-Rechners oder ein USB-Bluetooth-Adapter ist ein
Empfänger, sobald die Bluetooth-Integration von Home Assistant ihn hat. Es zählt als ein Empfänger
in dem Raum, in dem der Rechner steht. Ein Rechner in einem Schrank oder im Keller hört diese Ecke
des Hauses.

### ESPresense

ESPresense-Knoten melden über MQTT statt über das Bluetooth von Home Assistant.

1. Richte die MQTT-Integration von Home Assistant ein.
2. Öffne in PadSpan **Verwalten → HA Entities → ESPresense MQTT** und hak
   **Enable ESPresense MQTT ingestion** an. Deine Knoten erscheinen innerhalb von etwa zehn Sekunden
   als Empfänger.
3. Veröffentlichen deine Knoten unter einem anderen Topic als `espresense`, gib es bei
   **Topic prefix:** ein und wähl **Save**.

Die Karte ist mit **Experimental** markiert.

### Tasmota (experimentell)

Ein ESP32 mit Tasmota und Bluetooth meldet ebenfalls über MQTT.

1. Richte die MQTT-Integration von Home Assistant ein.
2. Öffne in PadSpan **Verwalten → HA Entities → Tasmota BLE** und hak
   **Read Tasmota BLE over MQTT** an.
3. Gib auf jedem Tasmota diese Befehle in seine Konsole ein:
   - `TelePeriod 10`
   - `BLEMaxAge 30`
   - `BLEAddrFilter 1`

Die eigenen Einstellungen von Tasmota sind für eine gelegentliche Liste von Geräten gemacht. Ohne
diese Befehle meldet es zu langsam für Räume (ein Messwert, der älter als etwa 15 Sekunden ist,
zählt nicht), behält ein Gerät, das gegangen ist, auf seiner Liste und meldet nie Handys und Tags,
die ihre Adresse wechseln. PadSpan liest die Topics `tele/+/BLE` und `stat/+/BLE`.

### Passive Empfänger und Home Assistant 2026.4

Seit Home Assistant 2026.4 können wiederholte Messwerte von passiven Empfängern (Shellys und andere,
die nur zuhören) zurückgehalten werden. PadSpan holt sie per Timer erneut ab:
**Einstellungen → Ortung → Empfänger → Bluetooth-Aktualisierungsintervall**, 5 Sekunden bei einer
neuen Installation. Hört ein Shelly Geräte, zeigt aber bei der Kalibrierung kein Signal, prüf, ob
das Intervall 5 Sekunden ist, oder hak **Alle 5 s für passive Proxy-Scanner aktualisieren** auf
derselben Karte an; das hält es bei 5 Sekunden, auch wenn das Intervall länger ist. Es braucht etwas
mehr Rechenzeit.

## Wo du sie hinstellst

- In die Räume, die du unterscheiden willst, nicht in Flure.
- Näher an die Mitte eines Raums als in eine Ecke. Nicht hinter große Dinge aus Metall, nicht in
  einen Schrank und nicht an eine Außenwand.
- Nah genug, dass sich benachbarte Empfänger ein wenig überschneiden.
- In einem großen Raum ist ein Empfänger das Mindeste; zwei sind merklich besser.
- Etwa auf Kopfhöhe oder höher. Dann trag die echte Höhe ein (unten).

## Raum, Platz und Höhe eines Empfängers

**Raum.** Der Raum eines Empfängers ist der Home-Assistant-Bereich seines Geräts. Ein Empfänger ohne
Bereich ergibt keinen Raum, egal wie gut er dich hört: Ein Handy direkt daneben landet im Raum des
nächsten Empfängers. Die Karte **Wer ist wo** in der Übersicht listet jeden Empfänger ohne Bereich
und lässt dich ihn dort festlegen: [Kapitel 4](04-first-room.md#2-gib-jedem-empfänger-seinen-raum).
Räume und Bereiche erklärt [Kapitel 8](08-rooms-and-floors.md). Stellst du einen Empfänger in einen
anderen Raum, ändere auch seinen Bereich.

**Platz.** Für Positionen zwischen Empfängern braucht ein Empfänger auch eine Stelle auf deinem
Grundriss:
[Kapitel 9, Schritt 5](09-setup-the-map.md#schritt-5-empfänger-platzieren-und-ihre-höhen-festlegen).
Platzier ihn dort, wo er wirklich ist.

**Höhe.** Trag seine Höhe über seiner eigenen Etage in **Kalibrierung → Feinabgleich** ein
(**Höhe über dem Boden (m):**, das bei 2,4 m beginnt), im Empfänger-Schritt von Karten oder in der
Spalte **Höhe** des Bildschirms **Empfänger**. Alle drei sind derselbe Wert. Eine Höhe lässt sich
erst festlegen, wenn der Empfänger einen Platz auf einem Grundriss hat.

**Signalanpassung.** Manche Empfänger messen bei gleichem Abstand schwächer als andere.
**Einstellungen → Ortung → Empfänger → Signalanpassung der Empfänger** listet jeden Empfänger mit
einem Feld von −20 bis +20 dB, das zu jedem Messwert von ihm addiert wird (positiv, wenn er
schwächer misst, als er sollte). Die Zahl neben jedem Feld ist nur ein Vorschlag: Sie gilt erst,
wenn du sie eintippst und **Speichern** wählst. Die meisten Haushalte lassen diese Werte auf 0 und
kalibrieren stattdessen.

## Wie es deinen Empfängern geht

- **Empfänger** (im Menü): jeder Empfänger in einer Tabelle, mit **Raum**, **Etage**,
  **Auf einem Grundriss**, **Höhe**, **Signalanpassung**, **Status**, **Geräte jetzt** und
  **Zuletzt gehört**. **Nur Probleme** zeigt nur die, um die du dich kümmern musst. **Platzieren**
  öffnet Karten mit dem Empfänger ausgewählt.
- **Der Statuspunkt** in der oberen Leiste: Ein Empfänger zeigt **Seit … Min. still**, wenn seit
  über 10 Minuten nichts von ihm gekommen ist.
- **Zustand → Hört weniger als sonst**: erscheint nur, wenn ein Empfänger seit über 10 Minuten weit
  weniger Bluetooth-Nachrichten gehört hat als normal, während die anderen normal laufen. Räume in
  seiner Nähe können falsch sein. Ein Neustart hilft oft.
- **Zustand → Zustand der Scanner**: für jeden Empfänger, wie oft er mit dem Raum übereinstimmt, auf
  den die anderen zeigen. Die Zahl **Zuverlässigkeit** wird nur angezeigt: Eine niedrige lässt diesen
  Empfänger nicht weniger zählen.
- **Zustand → Scanner → Raum**: jeder Empfänger mit seiner Bluetooth-Adresse und seinem Raum.

Ein Empfänger, der still ist: [Kapitel 26](26-troubleshooting.md#ein-empfänger-ist-still).

## Die Räume finden, die einen brauchen

- **Kalibrierung → Modell** zeigt, wie oft PadSpan an Stellen, an denen nicht kalibriert wurde, den
  richtigen Raum wählt. Ein Raum, der immer wieder schlecht abschneidet, ist die erste Stelle, an der
  du einen Empfänger hinzufügst oder versetzt.
- **Kalibrierung → Genauigkeit je Stelle** zeigt, welche Stellen danebenliegen, und in welchen Raum
  sie geraten.
- **Kalibrierung → Umhergehen** zeigt, wo du bisher kalibriert hast und wo du dich als Nächstes
  hinstellen sollst.
- **Raum abgehen**, wenn es an ist, zeigt den Wert eines Raums vor und nach einem Rundgang von 90
  Sekunden.

Alle davon stehen in [Kapitel 11](11-calibration.md).

## Neben Bermuda

Du nutzt schon Bermuda? Behalt es. PadSpan liest dieselben Bluetooth-Daten von Home Assistant wie
Bermuda, deine ESPHome-Proxys und Shelly-Scanner dienen also beiden zugleich.

- **Bermuda bleibt, wie es ist.** PadSpan zu installieren, neu zu laden oder zu entfernen ändert
  nichts an Bermudas Geräten, Entitäten oder Einstellungen, und ein Test in PadSpans Code schlägt
  fehl, wenn neuer Code das versucht.
- **Deine Bermuda-Geräte erscheinen** in PadSpan als eigene Geräte. Soll PadSpan lieber nur seine
  eigenen Messwerte nutzen, hak **Bermuda ignorieren** (**Alle Daten der Bermuda-Integration
  ignorieren**) unter **Einstellungen → Ortung → Home Assistant und Integrationen** an.
- **Handys, die du für Bermuda eingerichtet hast, funktionieren weiter.** Ein iPhone oder eine Apple
  Watch in Private BLE Device von Home Assistant wird am selben Schlüssel erkannt und so benannt, wie
  du es dort benannt hast: [Kapitel 6](06-phones-and-watches.md).
- **Mit einem Empfänger pro Raum** wählt PadSpan Räume danach, welcher Empfänger ein Gerät am besten
  hört, wie Bermuda: Rechne mit etwa gleich guten Räumen und mit einem Kalibrier-Rundgang, der manche
  Entscheidungen korrigiert. Mit drei oder mehr Empfängern auf einem Grundriss mit Maßstab kann es
  ein Gerät auch zwischen ihnen platzieren.

Deine Automationen können bei Bermudas Sensoren bleiben, bis du dich entscheidest, sie zu ändern.
PadSpans eigene Sensoren stehen in [Kapitel 14](14-home-assistant-reference.md).
