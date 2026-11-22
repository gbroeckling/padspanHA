# 4. Dein erster Raum in 15 Minuten

[Inhalt](README.md)

Von einer frischen Installation bis „Alex' Handy ist in der Küche“, ganz ohne Grundriss. Danach,
wenn du willst, dein Haus auf einer Karte. Alles auf dieser Seite ist kostenlos.

Bevor du anfängst, brauchst du Home Assistant 2024.8 oder neuer, mindestens einen
Bluetooth-Empfänger und in Home Assistant einen Bereich für jeden Raum
(**Einstellungen → Bereiche, Labels & Zonen**). Siehe [Kapitel 2](02-requirements.md).

## 1. PadSpan installieren

Ab Home Assistant 2026.11:

1. Öffne **Einstellungen → Marketplace** und suche nach **PadSpan**.
2. Öffne **PadSpan HA** und wähle **Installieren**.
3. Der Einrichtungsdialog öffnet sich sofort, ohne dass du etwas ausfüllen musst. Wähle **Absenden**.
4. Öffne **PadSpan HA** in der Seitenleiste.

Bei älteren Versionen installierst du es mit HACS und startest Home Assistant zuerst neu. Beide Wege
stehen in [Kapitel 3](03-install-update-uninstall.md). Der andere neue Eintrag in der Seitenleiste,
**Atlas**, ist die Karte deiner Lichter; den lässt du erst einmal liegen.

### Das Beispielhaus

Bis PadSpan seinen ersten Empfänger hört, zeigt es ein Beispielhaus, in dem alle Funktionen
eingerichtet sind, und ein gelbes Banner sagt das. Eine neue Installation wechselt von selbst zu
deinem eigenen Haus, sobald sie einen Empfänger hört. Siehst du das Beispielhaus und willst dein
eigenes, wähle **Zu meinem Haus**.

## 2. Gib jedem Empfänger seinen Raum

PadSpan steckt jedes Gerät in den Raum, dessen Empfänger es am besten hört, und der Raum eines
Empfängers ist der Home-Assistant-Bereich seines Geräts. Ein Empfänger ohne Bereich ergibt keinen
Raum, egal wie gut er dich hört: Ein Handy direkt daneben landet im Raum des nächsten Empfängers.
Deshalb kommt das zuerst.

Am schnellsten geht es auf der Karte **Wer ist wo** in der Übersicht. Jeder Empfänger ohne Bereich
hat dort seine eigene Zeile mit einer Liste deiner Räume:

1. Prüf den Raum in der Liste. Verrät der Name des Empfängers einen Raum („esp32-kitchen“), ist
   dieser Raum schon gewählt, und die Zeile sagt **Nach seinem Namen gewählt; ändere es, wenn es nicht stimmt.**
2. Wähle **Raum festlegen**. Die Zeile sagt **Raum festgelegt: Küche.**

Damit bekommt das Gerät des Empfängers diesen Bereich in Home Assistant, genau wie wenn du ihn dort
setzt. Du kannst auch:

- den Bereich am Gerät in Home Assistant setzen: **Einstellungen → Geräte & Dienste → Geräte**, den
  Empfänger öffnen, seinen Bereich bearbeiten;
- in PadSpan auf der Karte **Bluetooth-Funkempfänger** der Übersicht (Modus Erweitert)
  **Empfängerliste ansehen** wählen, dann **Zuweisen** neben dem Empfänger (oder **Ändern**, wenn
  er schon einen Bereich hat).

Der Bluetooth-Scanner eines Shelly ist in Home Assistant ein eigenes Gerät: Gib diesem Gerät den
Bereich. [Deine Shellys können Bluetooth-Proxys sein](https://padspan.traks.ca/guides/shelly-bluetooth-proxy/)
zeigt, wie es geht.

Hat Home Assistant noch keine Bereiche, sagt die Karte das: Leg sie zuerst an, unter
**Einstellungen → Bereiche, Labels & Zonen**.

## 3. Sieh, wer wo ist

Dafür brauchst du keinen Grundriss. In der Übersicht listet **Wer ist wo** jeden Raum, den deine
Empfänger abdecken, die benannten Geräte darin und wie viele andere Bluetooth-Geräte dort zu hören
sind. Die Karte hält sich selbst aktuell.

Die Zeile oben sagt dir, wo du stehst:

| Was sie sagt | Was es heißt |
|---|---|
| „Noch keine Bluetooth-Empfänger gefunden. Füge einen ESPHome Bluetooth-Proxy hinzu …“ | PadSpan hört keinen Empfänger. Füg einen hinzu oder nutze das Bluetooth deines Home-Assistant-Rechners. Er erscheint innerhalb einer Minute. |
| „… hat noch keinen Home-Assistant-Bereich, daher kann PadSpan zu Hause und weg unterscheiden, aber keine Räume.“ | Kein Empfänger hat einen Bereich. Gib jedem den Bereich, in dem er steht (Schritt 2). |
| „… decken einen Raum ab, du bekommst also zu Hause oder weg.“ | Alle deine Empfänger sind in einem Bereich. Stell einen in einen anderen Raum. |
| „One receiver has no Home Assistant area yet, so it gives no room: …“ | Die anderen funktionieren. Gib diesem einen seinen Bereich. |
| „Deine 3 Empfänger decken 3 Räume ab. …“ | Es funktioniert. Jedes Gerät kommt in den Raum, dessen Empfänger es am besten hört. |

Eine Zeile namens **Gehört, noch kein Raum** enthält benannte Geräte, die nur ein Empfänger ohne
Bereich hört. Gib diesem Empfänger seinen Bereich.

## 4. Benenne dein Handy

Ein Gerät, das du nicht benannt hast, bekommt von PadSpan keine Entitäten. Benennst du es, bekommt
es einen Device Tracker, dessen Zustand der Raum ist, einen Bereichssensor und Entfernungssensoren,
und PadSpan folgt ihm.

**Android-Handy**

1. Öffne in der Home Assistant Companion App
   **Einstellungen → Companion App → Sensoren verwalten → BLE Transmitter** und schalte ihn ein.
   Stell an derselben Stelle **Transmit power** auf **High** und **Advertise mode** auf
   **Low latency**: Ab Werk sendet er zu schwach, um gut gehört zu werden.
2. Öffne in PadSpans Übersicht die Karte **Dein Handy verfolgen** und wähle daneben
   **Dieses Handy verfolgen** (im Modus Einfach heißt der Knopf **Verfolgen**).

PadSpan benennt das Handy, folgt ihm und bittet die App, mit dem Senden anzufangen. Zeigt der Knopf
**Einrichtung**, ist der Sensor in der App noch nicht an; zeigt er **Aktivieren & verfolgen**, ist er
in Home Assistant ausgeschaltet, und dieser Knopf schaltet ihn ein (starte Home Assistant danach neu).
Im Modus Erweitert sagt er dann, wie es gelaufen ist: **Wird verfolgt!**,
**Registriert — warte auf Signal** (geh in die Nähe eines Empfängers) oder
**Registriert — BLE aktivieren**.

**iPhone oder Apple Watch**

Ein iPhone wechselt alle paar Minuten seine Bluetooth-Adresse, deshalb braucht PadSpan einmal seinen
Schlüssel, den IRK.

1. Hol dir den Schlüssel und trag ihn in Home Assistants Integration **Private BLE Device** ein.
   Die Schritte, mit einem irk-capture-ESP32 oder einem Mac, stehen in
   [In welchem Raum ist mein Handy?](https://padspan.traks.ca/guides/phone-room-presence/) und im
   Handy-Assistenten von PadSpan selbst (unten).
2. Sobald Home Assistant ihn hat, erscheint das Handy in **Wer ist wo** mit einem Knopf
   **Verfolgen** neben seinem Namen. Wähle **Verfolgen**. Beim ersten Mal kann es ein paar Minuten
   dauern, bis es auftaucht.

Ist die erweiterte Sicherheit an, sieht nur ein Administrator **Verfolgen**.

**Ein Beacon oder Schlüsselanhänger**

Wähle ihn auf **Folgen** unter **Tag zum Folgen wählen** und dann **Diesen Tag benennen**. Oder öffne
auf der Karte **Objekte** der Übersicht (Modus Erweitert) **Alle Objekte**, wähle **Benennen** in
seiner Zeile, gib einen Namen ein und wähle **Namen speichern**. In der Nähe einer belebten Straße
ist diese Liste lang: Stell **Alle Zustände** auf **Erkannt** oder such nach dem Namen.
[Welcher Bluetooth-Tracker funktioniert mit Home Assistant?](https://padspan.traks.ca/guides/bluetooth-tags/)
sagt, was du kaufen kannst.

Sobald ein Handy oder Tag einen Namen hat, steht es mit Namen in **Wer ist wo**, und deine
Automationen können seinen Raum nutzen: [Kapitel 14](14-home-assistant-reference.md).

**Das ist dein erster Raum.** Der Rest dieser Seite ist freiwillig.

## 5. Mach eine Karte daraus

Eine Karte macht aus der Liste der Räume dein Haus, gezeichnet in der Übersicht. Die Kalibrierung
braucht sie. Mit drei oder mehr Empfängern darauf kann PadSpan Geräte auch zwischen ihnen verorten,
sogar in einem Raum ohne eigenen Empfänger.

Wähle **Eine Karte daraus machen** auf der Karte **Wer ist wo**. Das öffnet die **Einrichtung**, die
Schritte der Reihe nach:

1. **Grundriss hochladen**: irgendein Bild der Etage, sogar ein Foto einer Skizze. Kein Bild?
   **Kein Grundriss? So bekommst du einen** bietet den Raumscan eines Handys, deine eigene Skizze
   oder eine leere Etage.
2. **Maßstab festlegen**: Klick beide Enden einer Wand an, deren Länge du kennst, gib die Länge ein
   und wähle **Maßstab speichern**. Lass das nicht aus: Ohne Maßstab kommt nichts auf die Karte.
3. **Räume zeichnen**: Drück über dem Grundriss auf den Namen eines Raums, klick jede Ecke an und
   doppelklicke die letzte. Jeder Raum wird gespeichert, sobald du ihn fertig hast.
4. **Etagen und ihre Höhen**: nur in einem Haus mit zwei oder mehr Etagen innen.
5. **Empfänger platzieren und ihre Höhen festlegen**: Wähle in **Live-BLE-Empfänger** neben dem
   Grundriss **Hinzufügen** neben jedem Empfänger und zieh ihn dahin, wo er hängt. Oder wähle
   **Meine Empfänger in ihre Räume setzen**: Jeder kommt in die Mitte seines Raums, und du ziehst
   ihn später an seinen Platz.
6. **Dein Handy oder deine Uhr verfolgen**: schon erledigt, wenn du dein Handy oben in Schritt 4
   benannt hast.
7. **Kalibrieren**: Geh mit deinem Handy durchs Haus, damit PadSpan lernt, wie jede Stelle klingt.

Der Knopf jedes Schritts öffnet das Werkzeug dafür, mit einer Leiste oben, die sagt, bei welchem
Schritt du bist, und **← Zurück zur Einrichtung**. **Vorerst überspringen** geht weiter; die
Einrichtung merkt sich, wo du warst.

**Einen Schritt übersieht man leicht.** Die Schritte zum Grundriss laufen im **Setup Wizard** unter
Karten, und der endet mit **Abschluss**. Bis du dort **Auf die Karte setzen** wählst, sind deine
Räume und Empfänger nur auf dem Bild. Sobald der erste Raum auf der Karte ist, nimmt dein Haus in
der Übersicht den Platz von **Wer ist wo** ein. Zeichne also jeden Raum, den deine Empfänger
abdecken: Ein Gerät in einem Raum, den du nicht gezeichnet hast, wird vielleicht nicht angezeigt.

Jeder Schritt ist in [Kapitel 9](09-setup-the-map.md) erklärt.

## 6. Kalibrieren

Der stärkste Empfänger ist eine gute erste Antwort. Die Kalibrierung macht sie besser: Sie zeichnet
auf, was jeder Empfänger an bekannten Stellen in deinem Haus hört. Sie braucht einen Grundriss mit
Maßstab.

Der Schritt **Kalibrieren** der Einrichtung öffnet sich auf eine von zwei Arten:

- **Raum abgehen**, wo das eingeschaltet ist: Geh mit deinem Handy jeden Raum 90 Sekunden lang ab.
  Bei einer neuen Installation ist es aus. Schalte es ein unter
  **Einstellungen → Ortung → Positionierung und Kalibrierung → Raum abgehen (Kalibrierung)**; die
  Einrichtung hat dafür einen Knopf **Diese Einstellung öffnen**.
- **Geführte Kalibrierung**, Punkt für Punkt: Wähle dein Handy und die Etage, stell dich an eine
  Stelle, markier sie auf dem Grundriss und lass PadSpan zuhören. Nimm dir 10 bis 20 Stellen pro
  Etage vor, gut verteilt.

Der Schritt gilt ab fünf Kalibrierpunkten als erledigt. Alles über die Kalibrierung steht in
[Kapitel 11](11-calibration.md).

## Wenn es nicht klappt

- **„Bluetooth-Daten nicht verfügbar“**: Starte Home Assistant ganz neu, unter
  **Einstellungen → System → Neu starten**. Nach einer Erstinstallation reicht ein Neuladen nicht.
- **Grundriss hochladen, Maßstab speichern oder den Testzeitraum starten wird abgelehnt**: Das
  braucht einen Administrator von Home Assistant.
- **Karten hat nur Bibliothek und Hochladen, oder die Einstellungen haben keine Reiter**: Der
  Modus-Knopf oben rechts hat das Panel auf Einfach gestellt. Jeder Bildschirm ist trotzdem im Menü,
  die, die Einfach weglässt, unter **Weitere Werkzeuge**. Wähl den Modus-Knopf noch einmal für
  Erweitert.
- **Ein Handy springt zwischen Räumen**: siehe [Kapitel 26](26-troubleshooting.md) und
  [Warum springt mein Handy zwischen den Räumen?](https://padspan.traks.ca/guides/room-flapping/)
- **Etwas anderes**: [Kapitel 27](27-getting-help.md).
