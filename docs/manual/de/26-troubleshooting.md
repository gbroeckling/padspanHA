# 26. Fehlersuche nach Symptom

[Inhalt](README.md)

Such das Symptom, schau zuerst dort nach, wo es angegeben ist, und geh dann die Ursachen von oben
nach unten durch. Die Bildschirme heißen hier so, wie das Panel sie nennt; manche stehen unter
**Weitere Werkzeuge** unten im Menü (im Modus Einfach die meisten).

Zwei Stellen helfen bei fast allem:

- **Der Statuspunkt** in der oberen Leiste erscheint nur, wenn etwas nicht stimmt: Gelb heißt, sieh
  nach, Rot heißt, etwas ist kaputt. Fährst du mit der Maus darüber, nennt er die Probleme; ein Klick
  öffnet **Zustand**.
- **Zustand → Gefundene Probleme** prüft alles, was du eingerichtet hast, auf das, was Geräte in den
  falschen Raum bringt, und jede Karte endet mit einer Zeile „Was tun:“, die sagt, was zu tun ist.

Hilft nichts davon, sagt [Kapitel 27](27-getting-help.md), was du schicken sollst.

## Ein Gerät zeigt den falschen Raum oder springt zwischen Räumen

**Zuerst ansehen:** die Seite **Empfänger** (wird jeder Empfänger gehört, und ist er im richtigen
Raum?), dann **Zustand → Gefundene Probleme** (eine Karte RÄUME VERWECHSELT nennt die beiden Räume,
zwischen denen es immer wieder wechselt).

Wahrscheinliche Ursachen, die häufigste zuerst:

1. **Ein Empfänger ist still oder hört weniger.** Räume in seiner Nähe stimmen nicht, bis er sich
   erholt. Siehe [Ein Empfänger ist still](#ein-empfänger-ist-still) unten.
2. **Ein Empfänger ist im falschen Raum.** PadSpan steckt ein Gerät in den Raum des Empfängers, der
   es am besten hört; ein Empfänger mit dem falschen Raum schickt Geräte also dorthin. Korrigier das
   in Übersicht → **Empfängerliste ansehen** (Zuweisen oder Ändern) oder in Karten → Bearbeiten →
   Empfänger.
3. **Die Empfänger zweier Räume hören das Gerät fast gleich.** In der Nähe einer Tür können zwei
   Empfänger nur wenige dB auseinanderliegen. Stell jeden Empfänger gut in seinen Raum hinein, näher
   an die Mitte als in eine Ecke, nicht in einen Schrank, nicht hinter Metall und nicht an eine
   Außenwand. Einen Raum ohne eigenen Empfänger kann PadSpan nur mit Kalibrierung unterscheiden, und
   weniger zuverlässig.
4. **Noch keine Kalibrierung, oder eine alte.** Die Kalibrierung korrigiert den Raum, den der
   nächste Empfänger ergibt. Starte **🧭 Geführte Kalibrierung** in Kalibrierung; setz Punkte in
   beiden Räumen, nahe der Stelle, wo sie aneinanderstoßen. **Kalibrierung → Modell** zeigt, wie oft
   PadSpan an Stellen, an denen nicht kalibriert wurde, den richtigen Raum wählt.
5. **Ein Empfänger, der stärker oder schwächer misst als die anderen.** Gib ihm einen Ausgleich
   unter Einstellungen → Ortung → Empfänger → Signalanpassung der Empfänger (oder auf der Seite
   Empfänger).

Dann, wenn es an einer Grenze immer noch flackert:

- Erhöhe **Verzögerung beim Raumwechsel** (Einstellungen → Ortung → Räume und Zeiten; 40 Sekunden,
  wenn du es nicht geändert hast). 40 bis 60 Sekunden beruhigen die meisten Grenzen; eine längere
  Verzögerung ist ruhiger und langsamer.
- Schalte im selben Abschnitt **Warum dieser Raum (Sensor-Attribut)** ein. Der Bereichssensor sagt
  dann in seinem Attribut `room_reason`, wie viele Abfragen für den Raum gestimmt haben und warum ein
  Wechsel zurückgehalten oder beibehalten wurde ([Kapitel 14](14-home-assistant-reference.md)).
- Zeichne in Karten → Bearbeiten eine Signalwand zwischen den beiden Räumen, wenn dort eine echte
  Wand ist.

Ein Gerät, das verstummt ist, behält den Raum, in dem es zuletzt war (seit 0.38.271): Es wandert
nicht mehr wegen alter Messwerte in einen anderen Raum oder auf eine andere Etage. Ein gepinnter
Beacon meldet seinen Raum einmal, und ein Raumwechsel wird nie zweimal hintereinander gesendet. Mehr
dazu, wie PadSpan Räume ruhig hält:
[Warum springt mein Handy zwischen den Räumen?](https://padspan.traks.ca/guides/room-flapping/)

## Ein Gerät ist zu früh weg oder bleibt zu lange

**Zuerst ansehen:** Einstellungen → Ortung → Räume und Zeiten → **Zuhause/Abwesend-Timeout**.

- **`not_home` zu früh:** Ein Gerät, das so lange wie das Abwesenheits-Timeout nicht gehört wurde
  (5 Minuten, wenn du es nicht geändert hast), steht auf `not_home`. Für ein Gerät, das in einem Raum
  mit dicken Wänden kurz außer Reichweite ist, stell es auf 10 bis 30 Minuten. Für Schlüssel und
  Tags, die niemand trägt, lässt **Dinge behalten ihren Raum** sie stattdessen stundenlang in ihrem
  letzten Raum.
- **`not_home` zu spät:** Setz das Timeout herunter. Das kürzeste ist 1 Minute.
- **Der Raum, in dem es zuletzt war:** Jeder Tracker und jeder Bereichssensor hat `last_room`, das
  bleibt, nachdem er `not_home` zeigt.

## Ein Gerät taucht nicht auf

**Zuerst ansehen:** die Seite **Empfänger** (meldet überhaupt ein Empfänger?), dann Bluetooth →
**Scanner** (was jeder davon hört).

1. **Kein Empfänger meldet.** Der Statuspunkt ist rot. Siehe die nächsten Abschnitte.
2. **Das Gerät sendet nicht, oder es ist außer Reichweite.** Es muss in Reichweite mindestens eines
   Empfängers sein und über Bluetooth senden. Weck es auf, bring es neben einen Empfänger und sieh
   noch einmal nach.
3. **Es ist da, aber ausgeblendet.** **Ruhiger Modus** (das Häkchen Ruhig oben in der Übersicht)
   blendet jedes Gerät aus, das niemand benannt hat. In der Nähe einer Straße ist Alle Objekte in der
   Übersicht voller fremder Geräte: Stell **Alle Zustände** auf **Erkannt** oder such nach dem Namen.
4. **Es hat seine Adresse geändert.** Handys, Uhren und Find-My-Tags wechseln ihre
   Bluetooth-Adresse, also erscheint ein unbenanntes jedes Mal als neues Gerät. Ein Handy braucht
   seinen Schlüssel (nächster Abschnitt). Für einen benannten AirTag oder einen anderen Find-My-Tag
   schalte **MAC-Wechsel überbrücken** unter Einstellungen → Funktionen ein.
5. **Ein iBeacon zerfällt in mehrere Geräte.** Deine Empfänger müssen das ganze Advertisement
   weitergeben (Firma 0x004C mit iBeacon-Nutzdaten). Einem Tracker, der seine UUID selbst wechselt,
   lässt sich so nicht folgen.
6. **Keine Home-Assistant-Entität dafür.** PadSpan legt Entitäten nur für Geräte an, die du benannt
   hast, und nur für die Arten, die unter Verwalten → HA Entities → Entity Publishing Controls
   angehakt sind.

## Ein Handy wird nicht erkannt oder erscheint als viele Geräte

**Zuerst ansehen:** Bluetooth → **IRK-Verwaltung**.

- **Ein iPhone oder eine Apple Watch erscheint als viele unbekannte Geräte.** Ohne den
  Identitätsschlüssel (IRK) sieht jeder Adresswechsel aus wie ein neues Gerät. Trag den Schlüssel
  unter Bluetooth → IRK-Verwaltung → **IRK hinzufügen** ein; **Nur testen** prüft einen Schlüssel,
  ohne ihn zu speichern. Ein in PadSpan eingetragener Schlüssel wirkt sofort. Einen, der in Private
  BLE Device von Home Assistant eingetragen ist, übernimmt PadSpan innerhalb von fünf Minuten.
- **„Der bereitgestellte IRK stimmt mit keinem BLE-Gerät überein, das Home Assistant sehen kann.“**
  Weck das Handy auf, bring es in die Nähe eines Empfängers und versuch es noch einmal.
- **„Der Schlüssel sieht nicht wie ein gültiger IRK aus.“** Kopier den ganzen Schlüssel: 32
  Hex-Zeichen oder den Base64-Text, der auf „=“ endet.
- **Ein Android-Handy zeigt „Warte auf Signal“.** Der BLE Transmitter seiner Companion App ist aus.
  Öffne in der Home-Assistant-App auf dem Handy Einstellungen → Companion App → Sensoren verwalten →
  BLE Transmitter und schalte ihn ein. Sorg dafür, dass Bluetooth am Handy an ist, und geh dann in
  die Nähe eines Empfängers.
- **Ein Android-Handy zeigt „BLE aus“.** Der Befehl, den Transmitter einzuschalten, hat die App
  nicht erreicht. Schalte ihn wie oben von Hand ein; damit der Befehl funktioniert, muss das Handy
  mit deinem Home Assistant verbunden sein.
- **Ein Android-Handy wird nur direkt neben einem Empfänger gehört oder verschwindet nach einer
  Weile.** Sein Transmitter läuft mit den schwächsten Einstellungen, oder das Akkusparen hat die
  Companion App gestoppt. Die Handy-Anleitung hat die Schritte: [In welchem Raum ist mein
  Handy?](https://padspan.traks.ca/guides/phone-room-presence/)

## Ein Empfänger ist still

**Zuerst ansehen:** die Spalte Status auf der Seite **Empfänger**, und Zustand. Ein Empfänger zeigt
**Seit … Min. still** (die Minuten, seit er zuletzt gehört wurde), wenn seit über 10 Minuten nichts
von ihm kam, oder **Hört weniger**, wenn er viel weniger Geräte hört als sonst, während die anderen
normal laufen.

1. **Starte ihn neu.** Prüf bei ESPHome auch seine Version und sein WLAN.
2. **Prüf, ob er in Home Assistant noch ein Empfänger ist**: Einstellungen → Geräte & Dienste →
   seine Integration (ESPHome, Shelly und so weiter). Ein Proxy, der seine Bluetooth-Einstellung
   verloren hat, meldet nichts mehr.
3. **Ein passiver Empfänger (Shelly, ein ESPHome-Proxy auf passiv gestellt), der nur ab und zu
   gehört wird**: Schalte **Alle 5 s für passive Proxy-Scanner aktualisieren** unter Einstellungen →
   Ortung → Empfänger ein.
4. **Ein Empfänger, den du für immer entfernt hast**: Wähl **Als verloren markieren** in seinen
   Details, oder **Ausschließen** unter Bluetooth → Scanner, damit er nicht mehr als still zählt.
   Beides behält, was er aufgezeichnet hat, und **Empfänger wiederherstellen** oder **Einbeziehen**
   holt ihn zurück.

Ein Empfänger, den du als verloren markiert, deaktiviert oder ausgeschlossen hast, lässt den
Statuspunkt nie aufleuchten.

## „Raum- und Empfänger-Layout noch nicht erstellt“

Das sagt die Übersicht, wenn auf deinen Grundrissen Räume oder Empfänger sind, PadSpans Karte des
Hauses (in Metern) aber keine enthält: Geräte werden nur nach dem nächsten Empfänger verortet, und
auf dem Haus wird nichts gezeichnet.

- Drück **Auf die Karte setzen** (der letzte Schritt der Einrichtung, und an jedem Raum unter
  Räume), oder in Karten → Aufteilung **Diese Anordnung übernehmen**.
- **Zustand → Gefundene Probleme → GRUNDRISS** sagt, wenn noch kein Plan einen Maßstab hat: Ein Plan
  braucht seinen Maßstab, bevor irgendetwas in Metern platziert werden kann.

## Das Panel aktualisiert sich nicht

**Zuerst ansehen:** die Leiste oben im Panel und den Statuspunkt.

- **„PadSpan wurde auf v… aktualisiert. Diese Seite läuft noch mit v….“**: Drück **Neu laden**.
- **„Diese Seite ist v…, aber Home Assistant führt PadSpan v… aus. Wenn du gerade aktualisiert
  hast, starte Home Assistant neu.“**: Starte Home Assistant neu (Einstellungen → System → Neu
  starten) und lade dann neu.
- **„Bluetooth-Daten nicht verfügbar“** nach einer Erstinstallation: Starte Home Assistant ganz neu.
  Die Integration neu zu laden reicht beim ersten Mal nicht.
- **Ein roter Statuspunkt**: PadSpan antwortet nicht, die Positionierung ist stehen geblieben, oder
  kein Empfänger meldet. Fahr mit der Maus darüber, um zu sehen, was davon; Zustand hat die
  Einzelheiten.
- **Deine Änderungen erscheinen nicht**: Lade die Seite hart neu (Strg+F5, oder Cmd+Shift+R auf
  einem Mac). Zustand → System zeigt Version und Build des Panels, und Diagnose → Installation prüfen
  vergleicht sie mit denen von Home Assistant. Unterscheiden sie sich, liefert Home Assistant eine
  ältere Kopie aus: Such nach zwei Kopien von PadSpan in `custom_components`, entferne eine und
  starte neu.
- **Karten hat nur Bibliothek und Hochladen, oder die Einstellungen haben keine Reiter**: Das Panel
  ist im Modus Einfach. Der Modus-Knopf oben rechts schaltet zurück auf Erweitert.
- **Ein Knopf wird abgelehnt**: Einen Plan hochladen, den Maßstab festlegen, Sicherungen und alles,
  was Daten nach außen schickt, brauchen einen Administrator von Home Assistant, und mit
  eingeschalteter erweiterter Sicherheit gilt das auch für jede Änderung an der gemeinsamen
  Konfiguration.

## Alarme werden nicht gesendet

**Zuerst ansehen:** **Folgen**, die Alarm-Einstellungen für dieses Gerät und **Test senden**.

1. **Nichts wurde gespeichert.** Hak an, worüber du informiert werden willst, dann **Speichern**:
   Nichts ist aktiv, bevor es gespeichert ist.
2. **Kein Weg zum Senden.** Alarme gehen über die notify-Dienste von Home Assistant raus. Für ein
   Handy muss die Companion App eingerichtet sein; für E-Mail eine Mail-Integration wie SMTP
   (Einstellungen → Geräte & Dienste). **Test senden** sagt klar, wenn es dein Handy oder deinen
   Maildienst nicht erreichen konnte.
3. **Zu dicht hintereinander.** Die Raum-Alarme eines Geräts liegen mindestens 60 Sekunden
   auseinander; ein Wechsel innerhalb dieser Zeit wird nicht eigens gesendet.
4. **Kommen- und Gehen-Alarme kommen spät oder früh**: Sie folgen dem Abwesenheits-Timeout, so wie
   `not_home` (oben).
5. **Deine eigene Automation löst nie aus**: PadSpans Ereignisse gibt es nur für benannte Geräte, und
   `padspan_room_change` nur für Geräte, denen du folgst, wenn Tag-Ereignisse bei Raumwechsel
   eingeschaltet ist (Einstellungen → Ortung → Home Assistant und Integrationen →
   HA-Tags-Integration). Siehe [Kapitel 14](14-home-assistant-reference.md).

## Das 3D-Haus startet nicht

**Zuerst ansehen:** den Atlas. Wenn Live Aboard nicht laufen kann, zeigt der Atlas stattdessen die
flache Karte, und der Knopf **🏠** sagt, warum; tipp ihn an, um es noch einmal zu versuchen.

- **Kein WebGL, zu langsam, oder die Grafik wurde neu gestartet**: Der Browser oder das Gerät kann
  die 3D-Ansicht nicht darstellen. Versuch **Quality** auf Low (Einstellungen → Atlas → Live Aboard),
  einen anderen Browser oder ein anderes Gerät. Ein Wandtablet schafft vielleicht nur den flachen
  Atlas.
- **Gar kein 3D-Schalter**: Live Aboard ist eine Pro-Funktion, und es ist aus, solange **Show Live
  Aboard on the Atlas** unter Einstellungen → Atlas nicht angehakt ist.
- **Ein Gerät schwebt an der falschen Stelle**: Setz seine Höhe in Live Aboard unter Edit → Heights,
  oder verschieb es auf der Karte.
- **Die Temperatur eines Raums zeigt „–°“**: Sein Sensor hat sich seit über einer Stunde nicht
  gemeldet.

## Home Assistant geht der Speicher aus, oder es ist langsam

**Zuerst ansehen:** wie viel Speicher der Rechner hat. An einer belebten Straße oder in einem
Mehrfamilienhaus hört PadSpan Tausende vorbeikommende Geräte, und auf einem Rechner mit 2 GB ist
Home Assistant innerhalb von Stunden der Speicher ausgegangen.

1. **Auf einem Rechner mit 2 GB** schalte **Speichersparmodus** ein (Einstellungen → Ortung →
   Leistung). Er behält weniger vorbeikommende Geräte, die niemand benannt hat. Deine benannten,
   markierten und verfolgten Geräte werden nie verworfen.
2. **Unbenannte Geräte kürzer behalten**: Einstellungen → Ortung → Was das Panel zeigt →
   Aufbewahrung des Objektverlaufs, 1 Tag (die Voreinstellung).
3. **Mehrere Wandbildschirme**: Schalte **Für viele Bildschirme optimieren** ein (Einstellungen →
   Ortung → Leistung).
4. **Die Raumberechnung bremst Home Assistant**: **CPU-Modus** (im selben Abschnitt) kann sie auf
   einen Kern beschränken.
5. **Zieh auf einen Rechner mit mehr Speicher um**: [Kapitel 22](22-backup-restore-moving.md) sagt,
   wie, und [Mindestanforderungen](../../MINIMUM_REQUIREMENTS.md) hat die Zahlen.
