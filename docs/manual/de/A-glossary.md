# A. Glossar

[Inhalt](README.md)

Die Wörter, die dieses Handbuch und PadSpans Panel benutzen, alphabetisch geordnet.

**Abfrage.** Eine Runde, in der PadSpan die Räume ermittelt, alle 5 Sekunden, wenn du es nicht
änderst (Einstellungen → Ortung → Leistung → Abfrageintervall der Anwesenheit).

**Abwesenheits-Timeout.** Wie lange ein Gerät nicht gehört wird, bevor es `not_home` zeigt (5 Minuten,
wenn du es nicht änderst, unter Einstellungen → Ortung → Räume und Zeiten → Zuhause/Abwesend-Timeout).

**Add-on.** Ein Teil von PadSpan Pro, einzeln gekauft für eine Installation ohne Pro: Audio, Alarm &
Sicherheit, WLAN-Abdeckung, Klimakarte, Zeitreise, Urlaubsmodus & Voreinstellungen, Looks-Paket,
Forensik oder Präsenz-Auswertungen. Eine Zahlung gilt 2 Jahre, auf bis zu drei Zuhause; PadSpan Pro
enthält sie alle. Siehe [Kapitel 25](25-padspan-pro.md#add-ons).

**Administrator.** Ein Benutzer von Home Assistant mit Administratorrechten. Backups,
Wiederherstellungen, ein Factory Reset, die Schlüssel von Handys, das Hochladen von Grundrissen und
alles, was Daten aus dem Haus schickt, brauchen einen; ist die erweiterte Sicherheit an, gilt das auch
für jede Änderung an PadSpans gemeinsamer Einrichtung.

**Advertisement.** Eine kurze Bluetooth-Nachricht, die ein Handy, ein Tag oder ein Beacon immer wieder
aussendet. Empfänger hören Advertisements; PadSpan verbindet sich nie mit dem Gerät.

**Atlas.** PadSpans Karte des Hauses für die alltägliche Lichtsteuerung, in der Seitenleiste als
**Atlas**, gebaut in Karten → Atlas-Editor.

**Auf die Karte setzen.** Der Knopf (am Ende der Einrichtung und bei einem Raum auf der Seite Räume),
der Räume und Empfänger, die auf einem Grundriss mit Maßstab gezeichnet sind, auf die Karte des Hauses
bringt. Bis dahin setzt PadSpan Geräte nur nach dem nächsten Empfänger.

**Backup.** Hier entweder PadSpans eigenes (Verwalten → Data → Backup & Restore, auf dem Rechner
gespeichert) oder das von Home Assistant (Einstellungen → System → Backups, das PadSpans Dateien
mitnimmt). Siehe [Kapitel 22](22-backup-restore-moving.md).

**Beacon.** Ein kleines Gerät, das nur Advertisements aussendet: ein Tag, ein iBeacon, ein Find-My-Tag.
Ein **gepinnter Beacon** ist einer, den du an einer festen Stelle auf die Karte gesetzt hast
(Kalibrierung → Beacon-Abgleich) und der von selbst Kalibrierpunkte hinzufügen kann.

**Benanntes Gerät, Label.** Ein Gerät, dem du in PadSpan einen Namen gegeben hast. Nur benannte
Geräte bekommen Entitäten in Home Assistant, Ereignisse und Alarme.

**Bereich.** Ein Bereich in Home Assistant (Einstellungen → Bereiche, Labels & Zonen). Normalerweise
ist ein Raum in PadSpan ein Bereich von Home Assistant, und sein Name ist überall der Name des Raums.
(Steht Einstellungen → Ortung → Home Assistant und Integrationen → Quelle für Räume und Empfänger
auf Eigenständig, nutzt PadSpan in PadSpan gezeichnete Räume und gar keine Bereiche.)

**BLE.** Bluetooth Low Energy, die Art Bluetooth, mit der Handys, Uhren und Tags ihre Advertisements
senden.

**BLE Transmitter.** Ein Sensor in der Android-Version der Home Assistant Companion App, der das Handy
einen iBeacon mit fester ID senden lässt, damit PadSpan ihm ohne Schlüssel folgen kann.

**Bluetooth-Proxy, Scanner.** Andere Namen für einen **Empfänger**. „Bluetooth-Proxy“ ist das Wort von
ESPHome und Home Assistant; ältere Teile von PadSpan sagen „Scanner“.

**dBm.** Die Einheit der Signalstärke (RSSI). Näher an null ist lauter: -55 dBm ist nah, -90 dBm weit
weg.

**Diagnose.** PadSpans Bericht für den Support (QA → Go to Diagnostics).
**Diagnosedaten herunterladen** von Home Assistant selbst ist ein anderer, viel kürzerer Bericht.
Siehe [Kapitel 27](27-getting-help.md).

**Diese Anordnung übernehmen.** Der Knopf in Karten → Aufteilung, der die auf einem Grundriss
gezeichneten Räume und Empfänger auf die Karte des Hauses bringt, wie es **Auf die Karte setzen** tut.

**Edition.** Welcher Download installiert ist: **PadSpan HA** (Anwesenheit, Karten und der Atlas) oder
**PadSpan Bright** (nur der Atlas, für Lichtsteuerung ohne Anwesenheit).

**Einfach, Erweitert und Entwicklung.** Die drei Modi des Panels, gewechselt mit dem Modus-Knopf oben
rechts. Jeder Bildschirm steht in jedem Modus im Menü; der Modus entscheidet, welche in der
Hauptliste stehen (der Rest liegt unter **Weitere Werkzeuge**) und wie viel jeder Bildschirm im
Einzelnen zeigt. In Einfach haben die Einstellungen nur Darstellung.

**Empfänger.** Ein Gerät, das Bluetooth-Advertisements hört und an Home Assistant weitergibt: ein
ESPHome-Bluetooth-Proxy, ein Shelly ab Gen2, das eigene Bluetooth des Home-Assistant-Rechners, ein
ESPresense-Knoten oder ein Tasmota-Gerät. Auch **Bluetooth-Proxy** oder **Scanner** genannt. Einer in
jedem Raum, den du unterscheiden willst.

**Entität.** Ein Ding, das Home Assistant anzeigen und automatisieren kann: ein Tracker, ein Sensor,
ein Licht. PadSpans stehen in [Kapitel 14](14-home-assistant-reference.md).

**Erweiterte Sicherheit.** Einstellungen → Ortung → Datenschutz, Updates und Feedback → Erweiterte
Sicherheit. Ist sie an, kann nur ein Administrator PadSpans gemeinsame Einrichtung ändern; ansehen und
benutzen können sie weiterhin alle. Bei einer neuen Installation an.

**Etage.** Eine Etage in Home Assistant (Einstellungen → Bereiche, Labels & Zonen). Jede Etage kann
Grundrisse und ihre eigene Höhe haben.

**Export for support.** Monitor → Export for support: der Bericht Diagnose, dazu, was die Empfänger
gerade hören.

**Fabric.** PadSpans Karte des Hauses in Metern: jede Etage, die Umrisse ihrer Räume, ihre Wände, wo
jeder Empfänger und jedes Licht ist. Grundriss-Bilder werden darübergelegt; Positionen werden immer
darin berechnet, nie aus dem Bild. Zustand nennt es **Anordnung von Räumen und Empfängern**.

**Factory Reset.** Verwalten → Factory Reset: leert PadSpans Dateien, auch seine eigenen Backups, und
startet es wie neu. Dein Lizenzschlüssel bleibt.

**Find-My-Tag.** Ein AirTag oder ein anderer Tag, der mit Apples Find My funktioniert. Er wechselt
seine Adresse, alle 15 Minuten in der Nähe seines Besitzers und einmal am Tag fern von ihm.

**Fingerabdruck.** Was jeder Empfänger an einem Kalibrierpunkt gehört hat. PadSpan ordnet die
Live-Messwerte eines Geräts den nächstliegenden Fingerabdrücken zu. In einem Haus mit Karte
entscheidet zuerst die aus den Empfängern berechnete Position über den Raum
([Kapitel 11](11-calibration.md)).

**Folgen.** Einem Gerät zu folgen (auf dem Bildschirm Folgen) heißt, es genauer zu beobachten: Alarme,
wenn es den Raum wechselt, ankommt oder geht, und, wenn Tag-Ereignisse bei Raumwechsel an ist, das
Ereignis `padspan_room_change`.

**Gerät.** Hier alles mit Bluetooth, was PadSpan hört: ein Handy, eine Uhr, ein Tag, ein Beacon, die
Ohrhörer eines Nachbarn. Auch das Wort von Home Assistant für ein Ding mit seinen Entitäten.

**Grundriss.** Ein Bild einer Etage, hochgeladen in Karten (oder gemacht aus einer leeren Etage, dem
Raumscan eines Handys oder der Karte eines Saugroboters). Sobald sein **Maßstab** festgelegt ist (eine
gemessene Länge darauf), kann, was darauf gezeichnet ist, auf die Karte des Hauses.

**HACS.** Der Home Assistant Community Store, über den PadSpan bei Home Assistant 2026.10 und älter
installiert und aktualisiert wird.

**iBeacon.** Ein Beacon-Format mit fester UUID, Major- und Minor-Nummer. PadSpan folgt einem iBeacon
über diese, nicht über seine Adresse.

**IRK (Identity Resolving Key).** Der geheime Schlüssel eines Handys oder einer Uhr für seine
wechselnden Bluetooth-Adressen. Mit ihm erkennt PadSpan, dass all diese Adressen dasselbe Handy sind.
Eingetragen in Bluetooth → IRK-Verwaltung oder in Private BLE Device von Home Assistant. PadSpan
schickt ihn nie irgendwohin und verbirgt die Schlüssel in jedem Bericht.

**Kalibrierpunkt.** Eine Stelle in einem Raum, an der du mit einem Gerät gestanden hast, während
PadSpan aufzeichnete, was jeder Empfänger hörte und wie laut. Mit genug davon kann PadSpan Räume
unterscheiden, die für den nächsten Empfänger gleich klingen. Angelegt in Kalibrierung
(**🧭 Geführte Kalibrierung**, Pinnen & Hören, Beacon-Abgleich oder Raum abgehen).

**Konsens.** Der Raum, auf den sich die meisten der letzten Abfragen einigen. Ein neuer Raum muss eine
Abstimmung über mehrere Abfragen gewinnen (festgelegt durch Verzögerung beim Raumwechsel), bevor ein
Gerät dorthin wechselt, damit ein einzelner lauter Messwert es nicht verschiebt. In Zustand werden
Empfänger daran gemessen („Übereinstimmung“).

**Live Aboard.** Der Atlas in 3D (Pro, experimentell, aus, bis du es einschaltest), mit **Furnish** für
Möbel, Geräte und Personen.

**Live und Beispiel.** Live ist dein eigenes Haus; Beispiel ist ein fertiges Beispielhaus zum Umsehen
(**Ein fertiges Haus ansehen**, und **Zu meinem Haus** geht zurück).

**Lizenzschlüssel.** Was PadSpan Pro (oder Bright Pro) freischaltet, eingetragen in Einstellungen →
Funktionen → PadSpan licence. Ein Schlüssel gilt für bis zu fünf Zuhause.

**Lost & Found.** Der letzte Raum, in dem PadSpan jedes Gerät gesehen hat, aufbewahrt, damit ein Gerät
nie auf „unbekannt“ zurückfällt.

**Marketplace.** Home Assistants eigener Store (Einstellungen → Marketplace), ab Home Assistant
2026.11.

**`not_home`.** Das Wort von Home Assistant für weg: Ein Tracker oder Bereichssensor von PadSpan zeigt
`not_home`, sobald das Gerät für die Dauer des Abwesenheits-Timeouts nicht gehört wurde.

**Nutzungsbericht.** Der freiwillige, tägliche, anonyme Bericht (Einstellungen → Ortung → Hilf, PadSpan
besser zu machen). Aus, bis du ihn einschaltest.

**Objektverlauf.** PadSpans Liste aller Geräte, die es gehört hat. Unbenannte fallen nach Aufbewahrung
des Objektverlaufs heraus (1 Tag, wenn du es nicht änderst); benannte bleiben.

**Power-Team.** Ein Wanddimmer oder Schalter und die smarten Birnen, die er versorgt, zu einem Licht
gemacht (Einstellungen → Atlas → Power teams).

**Private BLE Device.** Die Integration von Home Assistant, die einem Handy über seinen IRK folgt.
PadSpan liest ihre Schlüssel; ein Schlüssel, den du dort einträgst, erreicht PadSpan innerhalb von
fünf Minuten.

**Pro und die Stufen.** PadSpan HA ist ohne Schlüssel kostenlos. Die **Stufe** eines Schlüssels sagt,
was er freischaltet: `pro` (PadSpan Pro: alles in PadSpan HA, etwa das Platzieren im Atlas, Live
Aboard, den Wandmodus, Vacation Mode, Forensik, Busy Times und Finden) oder `bright` (Bright Pro: die
ganzen Werkzeuge des Atlas). Kostenlos < Bright < Pro, jede mit allem der vorigen. Es gibt einen
einmaligen kostenlosen **Testzeitraum** von 90 Tagen, unter Einstellungen → Funktionen → PadSpan
licence.

**Raum.** Ein Bereich von Home Assistant (siehe Bereich), auf der Karte des Hauses gezeichnet. Der
Bereich eines Empfängers entscheidet, in welchem Raum er steht.

**RSSI.** Empfangene Signalstärke: wie laut ein Empfänger ein Gerät hört, in dBm.

**Statuspunkt.** Die kleine Markierung in der Leiste oben, die nur erscheint, wenn etwas nicht stimmt:
Bernstein braucht einen Blick, Rot ist kaputt.

**Teilzone.** Eine Fläche innerhalb eines Raums (ein Bett, ein Sofa, ein Schreibtisch), gezeichnet in
Karten → Bearbeiten → Teilzonen, mit eigenen Entitäten.

**Traceback.** Der Bildschirm, der zeigt, wo Geräte früher waren.

**Update-Prüfung.** PadSpans tägliche Frage an `padspan.traks.ca` nach einer neueren stabilen Version,
die nur die Versionsnummer mitschickt.

**Vacation Mode, Urlaubsmodus.** Schaltet die Lichter wie an einem gewöhnlichen Tag, gelernt aus dem
Verlauf von Home Assistant, während du weg bist (Karten → Atlas-Editor, Pro).

**Verzögerung beim Raumwechsel.** Wie lange ein neuer Raum immer wieder gewinnen muss, bevor ein Gerät
dorthin wechselt (40 Sekunden, wenn du es nicht änderst).

**Wandbildschirm, Kiosk.** Ein Tablet oder Bildschirm an der Wand, der den Atlas zeigt, geöffnet mit
`?kiosk=1` (Einstellungen → Atlas → Wall screens).

**Wechselnde Adresse, zufällige Adresse.** Eine Bluetooth-Adresse, die ein Handy, eine Uhr oder ein
Find-My-Tag von Zeit zu Zeit wechselt, damit man ihm nicht folgen kann. PadSpan folgt einem Handy
trotzdem, mit dem IRK oder dem BLE Transmitter des Handys.

**Weitere Werkzeuge.** Die zugeklappte Gruppe unten im Menü des Panels mit den Bildschirmen, die nicht
in der Hauptliste stehen.

**Zustand.** Der Bildschirm, der PadSpans Prüfungen sammelt; der Statuspunkt öffnet ihn.
**Gefundene Probleme** ist seine Liste der Dinge, die Geräte in den falschen Raum bringen können.
