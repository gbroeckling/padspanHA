# 6. Handys und Uhren

[Inhalt](README.md)

Deine Empfänger hören dein Handy sofort. Was sie allein nicht erkennen: wessen Handy es ist. Ein
Schritt pro Handy löst das, und dann steckt PadSpan es mit Namen in einen Raum.

| | Was es braucht | Dann in PadSpan |
|---|---|---|
| Android-Handy | Den **BLE Transmitter** der Companion App, eingeschaltet | **Dein Handy verfolgen → Dieses Handy verfolgen** |
| iPhone | Seinen Schlüssel (den IRK) in **Private BLE Device** von Home Assistant. Den Schlüssel holst du einmal, von einem Mac oder einem irk-capture-ESP32 | **Verfolgen** in **Wer ist wo**, oder ein Name in **Alle Objekte** |
| Apple Watch | Einen eigenen Schlüssel, genauso wie beim iPhone | Genauso |

## Warum ein Handy einen Schritt braucht

Ein Beacon oder ein einfacher Schlüssel-Tag behält seine Bluetooth-Adresse, also erkennt ein
Empfänger ihn jedes Mal wieder. Handys nicht. Sie senden von einer zufälligen Adresse und wechseln
sie alle paar Minuten, damit ihnen niemand durch einen Laden folgen kann. Für Home Assistant sieht
dein Handy aus wie eine Reihe neuer Geräte. Es gibt zwei Wege drumherum:

- **Das Handy sagt, wer es ist.** Die Android-Companion-App kann einen Beacon mit einer ID senden,
  die sich nie ändert.
- **Du hast seinen Schlüssel.** Jedes iPhone und jede Apple Watch hat einen Identity Resolving Key
  (IRK), der die wechselnden Adressen wieder zu einem Gerät macht.

## Android

1. Installier die Home Assistant Companion App und melde dich an.
2. Öffne in der App **Einstellungen → Companion App → Sensoren verwalten → BLE Transmitter** und
   schalte ihn ein. Die meisten Sensoren der App sind anfangs aus.
3. Stell an derselben Stelle **Transmit power** auf **High** und **Advertise mode** auf
   **Low latency**. Die App startet mit ihren schwächsten Einstellungen, und Empfänger hören sie
   kaum. High kostet etwas Akku; die App kann auch nur in deinem WLAN zu Hause senden.
4. Fällt das Handy nach einer Weile weg, nimm die Companion App aus der Akku-Optimierung von Android
   heraus, sonst beendet Android sie.
5. Öffne in PadSpans Übersicht **Dein Handy verfolgen**. Deine Handys mit der Companion App stehen
   dort. Wähl **Dieses Handy verfolgen** (im Modus Einfach **Verfolgen**).

PadSpan nimmt den Namen des Home-Assistant-Geräts des Handys, folgt ihm und bittet die App, mit dem
Senden anzufangen. Was der Knopf sagt:

- **Einrichtung**: Der Transmitter ist in der App noch nicht an.
- **Aktivieren & verfolgen**: Der Sensor ist in Home Assistant ausgeschaltet. Der Knopf schaltet ihn
  dort ein; starte dann Home Assistant neu und schalte den Transmitter in der App ein.

Solange der Transmitter des Handys noch auf einer schwachen Einstellung steht, sagt seine Zeile das:
„Sendet zu schwach, als dass die Empfänger es gut hören“, mit dem, was du ändern sollst. Das Handy
erscheint in seinem Raum, Sekunden nachdem ein Empfänger es hört.

## iPhone

Die iPhone-App hat keinen BLE Transmitter, deshalb wird ein iPhone an seinem Schlüssel erkannt. Den
Schlüssel holst du einmal, auf einem von zwei Wegen.

**Auf einem Mac**, der beim selben iCloud-Konto angemeldet ist: Öffne die Schlüsselbundverwaltung,
such den Bluetooth-Eintrag des iPhones und kopier seinen Remote IRK. Die Seite zu Private BLE Device
bei Home Assistant hat die Schritte, und wie du erkennst, welcher Eintrag das iPhone ist.

**Mit einem irk-capture-ESP32**: irk-capture ist ein ESPHome-Paket für einen freien ESP32. Öffne in
PadSpan **Bluetooth → IRK-Verwaltung** und wähl **Ich habe einen IRK-Capture-ESP32**. Es führt dich
Gerät für Gerät hindurch: Gib seinen Namen ein und wem es gehört, kopple das iPhone unter
**Einstellungen → Bluetooth** des iPhones mit dem ESP32, dann **Schlüssel suchen** und
**Speichern**. Entferne danach die Kopplung vom iPhone, und gib dem ESP32 vor dem nächsten Gerät
eine neue Bluetooth-Identität (sein Knopf **Refresh BLE Identity** in Home Assistant), damit sich
das letzte Gerät nicht wieder mit ihm verbindet. Dieser ESP32 kann nicht gleichzeitig ein Empfänger
sein.

Dann gib den Schlüssel an Home Assistant, an einer von zwei Stellen:

- **In Home Assistant**: **Einstellungen → Geräte & Dienste → Integration hinzufügen → Private BLE
  Device**, und füg ihn ein.
- **In PadSpan**: **Einstellungen → Ortung → Handys und Gast-Tags → Handy-Ortung (Private BLE)**.
  Gib einen Namen ein, füg den Schlüssel ein und wähl **IRK hinzufügen**. PadSpan hört bis zu 30
  Sekunden lang zu (**Suche nach dem Gerät...**), um zu prüfen, ob der Schlüssel zu einem Handy
  passt, das deine Empfänger hören, und legt dann den Eintrag in Private BLE Device für dich in Home
  Assistant an. **Ausführliche Anleitung** hat die Schritte für jede Art von Gerät.
  **IRKs automatisch finden** findet Schlüssel von Geräten, die mit dem eigenen Bluetooth des
  Home-Assistant-Rechners gekoppelt sind.

Der Schlüssel kann aus 32 Hex-Zeichen bestehen, Base64 sein (er endet auf „=“), durch Doppelpunkte
getrennt sein oder mit `irk:` anfangen. So oder so halt das iPhone wach, mit Bluetooth an, in der
Nähe eines Empfängers: Home Assistant nimmt einen Schlüssel erst an, wenn es das Handy hört, zu dem
er gehört. Einen Schlüssel einzutragen braucht einen Administrator von Home Assistant. PadSpan lädt
seine Liste der Schlüssel alle fünf Minuten neu, ein in Home Assistant eingetragener Schlüssel kommt
also innerhalb von etwa fünf Minuten an.

Zum Schluss benenne das iPhone in PadSpan: **Wer ist wo** zeigt es mit einem Knopf **Verfolgen**
neben seinem Namen. Oder öffne auf der Karte **Objekte** der Übersicht (Modus Erweitert)
**Alle Objekte**, wähl **Benennen** in seiner Zeile, gib einen Namen ein und wähl
**Namen speichern**.

**Einen Schlüssel prüfen**, ohne ihn zu speichern: Füg ihn im Weg **Ich habe ein iPhone** des
Handy-Assistenten ein und wähl **Prüfen**. PadSpan sagt, wie viele der wechselnden Adressen, die es
gerade hört, zu diesem iPhone gehören.

## Apple Watch

Eine Apple Watch hat einen eigenen Schlüssel, getrennt von dem ihres iPhones. Hol ihn auf denselben
zwei Wegen: aus der Schlüsselbundverwaltung oder indem du die Uhr in ihren eigenen
Bluetooth-Einstellungen mit dem irk-capture-ESP32 koppelst. Trag ihn als eigenen Eintrag in Private
BLE Device ein und benenne die Uhr in PadSpan auf dieselbe Weise.

Eine Uhr, die eine feste Bluetooth-Adresse behält (manche Garmins tun das), hat keinen Schlüssel und
braucht keinen: Benenne sie wie einen Tag ([Kapitel 7](07-tags-and-beacons.md)).

## Der Handy-Assistent

Der Handy-Schritt der Einrichtung und **Bluetooth → IRK-Verwaltung** im Modus Erweitert öffnen
**Dein Handy verfolgen**, mit drei Wegen hinein: **Ich habe ein Android-Handy**,
**Ich habe ein iPhone** und **Ich habe einen IRK-Capture-ESP32**. Jeder hat die Schritte von oben,
im Panel.

Bei einer Installation von vor 0.38.165 zeigt die Karte **Dein Handy verfolgen** der Übersicht
iPhones die Android-Schritte, außer **Einstellungen → Funktionen → iPhone Setup Path** ist
eingeschaltet. Neuere Installationen starten mit eingeschaltetem Schalter. **Phone Setup Wizard**
auf demselben Reiter schaltet den Assistenten selbst ein oder aus.

## Was du bekommst

- **Auf den Bildschirmen**: jedes benannte Handy in seinem Raum, und die Karte
  **Personen im Gebäude** der Übersicht, die zeigt, wer zu Hause ist und in welchem Raum jede Person
  ist.
- **In Home Assistant**: ein Device Tracker, dessen Zustand der Raum ist (oder `not_home`, sobald es
  fünf Minuten lang nicht gehört wurde, das voreingestellte **Abwesenheits-Timeout**), ein
  Bereichssensor und Entfernungssensoren. Jede Entität steht in
  [Kapitel 14](14-home-assistant-reference.md).
- **Der Raum einer Person**: Verknüpf den Tracker unter **Einstellungen → Personen** mit der Person.
  Hat diese Person noch einen anderen Tracker, etwa das GPS der Companion App oder einen vom Router,
  richtet sich Home Assistant nach diesem und zeigt sie als zu Hause, nicht in einem Raum.
- **Alarme**, wenn ein Handy den Raum wechselt, ankommt oder geht: [Kapitel 13](13-alerts.md).

Private BLE Device allein liefert zu Hause oder abwesend und eine Entfernung zum nächsten Empfänger,
keinen Raum. PadSpan liefert den Raum dazu.

## Handys, die du nicht eingerichtet hast

Ein Handy ohne Schlüssel und ohne Beacon ist namenlos, nicht unsichtbar. **Personen im Gebäude**
zählt es als **Unbekanntes Handy** in seinem Raum, wenn zwei oder mehr Empfänger es hören, ziemlich
stark, und was es sendet, wie ein Handy oder eine Uhr aussieht. Es bekommt keine Entitäten und
keinen Namen.

- **Deins, oder das von jemandem, der bei dir wohnt**: Gib ihm seinen Schritt von oben. Dann zählt es
  als diese Person.
- **Das eines Besuchers**: Du musst nichts tun. Es geht, wenn der Besuch geht.
- **Das eines Nachbarn, durch die Wand**: Rück den Empfänger an dieser Wand von ihr weg, oder
  zeichne diese Wand als stärkeres Material ([Kapitel 10](10-walls-and-signal-loss.md)).

## Wenn ein Handy nicht auftaucht

- **„Der bereitgestellte IRK stimmt mit keinem BLE-Gerät überein, das Home Assistant sehen kann.“**
  (Die Meldung von Home Assistant.) Weck das Handy auf, bring es in die Nähe eines Empfängers und
  versuch es noch einmal.
- **Ungültiges IRK-Format**: Kopier den ganzen Schlüssel.
- **Ein Android-Handy wird nur direkt neben einem Empfänger gehört**: Sein Transmitter läuft mit den
  schwächsten Einstellungen (Android-Schritt 3).
- **Ein Android-Handy verschwindet nach einer Weile**: Die Akku-Optimierung hat die Companion App
  gestoppt (Android-Schritt 4).
- **irk-capture bekommt von einer Uhr keinen Schlüssel**: Manche Uhren brauchen eine Art Kopplung,
  die es nicht kann, und manche behalten eine feste Adresse und haben keinen Schlüssel (verfolg
  diese wie einen Tag).
- **Ein Handy erscheint als viele Geräte**, oder springt ständig zwischen Räumen:
  [Kapitel 26](26-troubleshooting.md#ein-handy-wird-nicht-erkannt-oder-erscheint-als-viele-geräte).
