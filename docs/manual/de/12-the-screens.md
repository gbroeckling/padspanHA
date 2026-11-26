# 12. Die Bildschirme

[Inhalt](README.md)

Wofür jeder Bildschirm von PadSpan da ist, wo er im Menü steht, und die alltäglichen genauer:
Übersicht, Live-Tracker, Folgen, Belegung, Traceback, Forensik und Zustand. Die meisten Bildschirme
und Karten haben neben der Überschrift ihre eigene **?**-Hilfe, auf Englisch, Deutsch, Französisch
und Niederländisch.

## Zurechtfinden

- **Das Menü** läuft links an der Seite entlang. Auf einem Handy ist es eine Leiste unten, und
  **Mehr** öffnet das ganze Menü.
- **Der Modus-Knopf**, oben rechts (auf einem Handy in der Leiste oben), zeigt **Einfach**,
  **Erweitert** oder **Dev**. Jeder Druck wechselt zum nächsten Modus. Dieser Browser merkt sich
  deine Wahl.
- **Der Knopf Daten**, daneben, zeigt **Live** (dein Haus) oder **Beispiel** (das Beispielhaus).
  Siehe [Das Beispielhaus](#das-beispielhaus).
- **Der Statuspunkt**, in der Leiste oben, erscheint nur, wenn etwas einen Blick braucht. Siehe
  [Zustand](#zustand).

## Einfach, Erweitert und Entwicklung

Jeder Bildschirm steht in jedem Modus im Menü. Der Modus entscheidet zweierlei: welche Bildschirme
in der **Hauptliste** stehen (der Rest liegt unter **Weitere Werkzeuge** unten im Menü, zugeklappt,
bis du es öffnest), und wie viel jeder Bildschirm im Einzelnen zeigt.

- **Einfach**: eine kurze Hauptliste, und jeder Bildschirm bleibt beim Wesentlichen. Für alle im
  Haus, die nur sehen wollen, wo die Dinge sind. Ein Link auf einen Teil eines Experten-Bildschirms
  (den Umriss eines Raums, den Platz eines Empfängers, die Etagenhöhen) öffnet nur diesen Teil, mit
  einem Weg zurück, und der Modus bleibt Einfach.
- **Erweitert**: der Standard. Eine längere Hauptliste, und jedes Werkzeug auf jedem Bildschirm.
- **Entwicklung**: dasselbe Menü wie Erweitert, mit mehr Diagnose-Details in den Bildschirmen. Nimm
  es zur Fehlersuche, oder wenn der Support darum bittet.

Den Modus zu wechseln löscht nichts. In Erweitert und Entwicklung kann **Einstellungen → UI-Struktur**
Geräte, Bluetooth, Anwesenheit, Monitor, QA oder Sandbox aus Weitere Werkzeuge in die Hauptliste
holen.

## Die Menükarte

Jeder Bildschirm, wo er in jedem Modus steht, und seine Überschrift im Menü. Die Überschriften
erscheinen mit dem Panel-Stil 2025 (dem Standard, **Einstellungen → Darstellung → Panel-Stil**); in
Einfach und mit dem Stil Klassisch hat das Menü keine Überschriften. Eine Installation von PadSpan
Bright zeigt nur ihre Licht-Bildschirme.

Die folgende Tabelle ist englisch: Sie entsteht direkt aus PadSpans Code.

<!-- english:menu -->

## Das Beispielhaus

Das Beispielhaus ist ein erfundenes Haus auf drei Etagen, in dem jede Funktion eingerichtet ist,
damit du siehst, was PadSpan macht, bevor deine eigene Einrichtung fertig ist. Es ist
schreibgeschützt: Alles, was es ändern würde, wird mit einer Meldung abgelehnt, und nichts, was du
dort tust, berührt dein eigenes Haus. Nur wie das Panel aussieht (sein Thema und sein Stil) lässt
sich dort ändern.

- Eine neue Installation startet mit dem Beispielhaus und wechselt von selbst zu deinem, sobald
  PadSpan deinen ersten Empfänger hört.
- **Ein fertiges Haus ansehen**, auf der Karte **Wer ist wo** der Übersicht, öffnet es.
- **Der Knopf Daten**: Von Live aus macht der erste Druck daraus **Demo zeigen?**; drück innerhalb
  von 3 Sekunden noch einmal, um das Beispielhaus zu öffnen. Von Beispiel aus geht ein Druck zurück
  zu Live.
- **Zu meinem Haus**, auf dem gelben Banner, geht zurück zu deinem eigenen.

Live oder Beispiel wählt jeder Browser für sich: Wer sich das Beispielhaus ansieht, schaltet keinen
Wandbildschirm und keinen anderen Browser um. Steht das Haus selbst noch auf Beispiel und ist die
erweiterte Sicherheit an, kann nur ein Administrator es zurück auf Live stellen.

## Übersicht

Die erste Seite: wo alle und alles gerade sind. Im Modus Live aktualisiert sie sich alle 5 Sekunden.

Was du siehst, hängt davon ab, wie weit die Einrichtung ist:

- **Noch kein Raum gezeichnet**: **Wer ist wo**, jeder Raum und wer darin ist, aus den
  Home-Assistant-Bereichen deiner Empfänger ([Kapitel 4](04-first-room.md)), und eine Karte
  **Karte anlegen (optional)** mit den Schritten der Einrichtung.
- **Räume auf der Karte**: die Karte, ein 3D-Stapel deiner Etagen. Jeder Raum hat seine eigene
  Farbe. Empfänger sind Ringe mit einem kurzen Namen, grün, wenn sie melden, und grau, wenn sie
  offline sind. Geräte, denen du folgst, sind bernsteinfarbene Markierungen mit ihrem Namen und
  damit, wie sicher PadSpan sich der Stelle ist („Nur Raum“, wenn es den Raum kennt, aber nicht die
  Stelle); sie werden blass und sagen „(weg)“, wenn sie weg sind. Schalte **Pins** ein, um auch
  deine anderen benannten Geräte zu zeigen.

**Einfach** hält es kurz: das Häkchen **Ruhig**, die Zahl der Räume, Objekte, Empfänger und
Kalibrierpunkte, die Karte **Dein Handy verfolgen** und unter **Dein Zuhause** die Karte des Hauses.

**Erweitert und Entwicklung** fügen **Personen im Gebäude** hinzu (klick darauf, um zu sehen, wie die
Zahl zustande kam) und unter der Karte die Karten Räume, Objekte, Bluetooth-Funkempfänger und
Kalibrierung. Ihre Knöpfe öffnen ganze Listen: **Raumliste ansehen**, **Alle Objekte** und
**Unerkannt**, **Empfängerliste ansehen**. Klick eine Zeile an, um ihre Details zu sehen.
**Unerkannte löschen** entfernt Geräte, die niemand benannt hat und denen niemand folgt; sie kommen
wieder, wenn sie wieder gehört werden.

**Ruhig**, oben rechts, blendet Geräte aus, die niemand benannt hat und denen niemand folgt, hier und
auf den anderen Bildschirmen. Es ändert, was gezeigt wird, nicht, was verfolgt wird.

Andere Karten kommen und gehen: **Erste Schritte**, solange die Einrichtung nicht fertig ist,
**Genauigkeit verbessern** mit einem letzten Tipp oder zwei, sobald sie es ist, der Pro-Testzeitraum,
was sich nach einem Update geändert hat, **Das 3D-Haus ist jetzt kostenlos** (ab dem 1. Dezember
2026, einmal, für einen Administrator, nie auf einem Wandbildschirm) und **Ortungsdiagnose**
(zugeklappt) für den Support. Mit
PadSpan Pro setzt **Einstellungen → Atlas → Den Atlas als Übersicht zeigen** stattdessen den Atlas
hierher.

## Live-Tracker

Die Live-Karte für sich allein, so groß, wie der Bildschirm es zulässt: gut für ein Wand-Tablet oder
einen zweiten Bildschirm.

- Zieh, um die Karte zu verschieben; das Mausrad oder zwei Finger zoomen; **+**, **−** und **⌂** in
  der Ecke tun dasselbe, und ⌂ setzt die Ansicht zurück. **Search objects, rooms, scanners…** findet
  eines und bewegt die Karte dorthin.
- Oben links: die Zahl der Räume, der benannten Geräte (Tracked) und der Empfänger (Radios). Oben
  rechts: deine Empfänger, jeder mit der Zahl der Geräte, die er hört; rot heißt, er scannt nicht.
- Wechselt ein Gerät den Raum, erscheint es kurz auf der Karte und in einer kurzen Liste der letzten
  Wechsel.
- Unter der Karte listet **Tracked Devices** die Geräte, denen du folgst, und ihre Räume; das
  Zielsymbol zentriert die Karte auf eines. **ℹ** blendet diese Felder aus oder ein.
- **Controls** öffnet die Einstellungen der Zeichnung (die Etage, den Abstand zwischen den Etagen,
  Wände, Spuren, Pins, Heatmap), wie auf der Karte der Übersicht.

Für einen Wandbildschirm öffnest du ihn mit `?view=purelive&kiosk=1` am Ende der Adresse des Panels:
Die Menüs des Panels sind dann ausgeblendet.

## Folgen

Wo eine Person oder ein Ding gerade ist: ein Handy, ein Schlüsselanhänger, ein Tag, alles mit
Bluetooth, was PadSpan hört.

1. Wähl es unter **Tag zum Folgen wählen**: Klick in das Suchfeld, oder tipp einen Teil eines
   Namens, eines Raums oder einer Adresse. Die Liste ist nach Signal sortiert, das stärkste zuerst.
   Wählst du eines, kommt es auch zu den Geräten, denen du folgst, und die Übersicht zeichnet es als
   bernsteinfarbene Markierung.
2. Die Karte darunter sagt, in welchem Raum es gerade ist, seine Etage, und wann ein Empfänger es
   zuletzt gehört hat. Ein Abzeichen **Kalibriert** mit einer Prozentzahl erscheint, wenn sein Platz
   aus deinen Kalibrierpunkten kommt.
3. Die **Ortskarte** zeichnet jeden Raum als Kasten und den Tag als pulsierenden Punkt in seinem
   Raum. Sie ist ein Raumschema, nicht dein Grundriss.

**Diesen Tag benennen** (oder **Umbenennen**) gibt ihm einen Namen. **Details →** öffnet alles, was
PadSpan darüber weiß. In Erweitert und Entwicklung listet die Karte auch die Empfänger, die es hören,
und eine Karte **Bewegungsprotokoll** seine letzten Raumwechsel.

Unter der Karte:

- **📍 Finden** (PadSpan Pro oder das Add-on Präsenz-Auswertungen): in welche Richtung du gehen musst, um es zu finden. Wähl unter
  **Du trägst:** dein eigenes Handy. Im selben Raum zeigt es die Entfernung in Metern, und ob du
  näher kommst oder dich entfernst. In einem anderen Raum sagt es, in welchen Raum du als Nächstes
  gehst, und ob eine Etage hinauf oder hinunter. Kein Kompass, keine Kamera.
- **Bewegungsalarme**: sagen dir, wenn es den Raum wechselt, ankommt oder geht, auf dem Handy oder
  per E-Mail. Siehe [Kapitel 13](13-alerts.md).

## Belegung

Wie viele **Personen** im Gebäude sind, nie wie viele Geräte.

- **Bekannte Personen** kommen aus deinen Personen-Entitäten in Home Assistant.
- **Unbekannte Personen** kommen von Handys, die niemand für sich beansprucht hat, und aus Räumen,
  deren Belegungs- oder Bewegungsmelder sagen, dass jemand da ist, wenn keine bekannte Person da ist.
- **Dinge** (Schlüssel, Tags) stehen unter **Gesehen, keine Personen** und werden nie gezählt.

Oben: die Zahl, eine Spanne, wenn es nicht sicher ist, wie zuversichtlich es ist, und die Zahlen
dahinter. **Gezählt** listet jede Person und wie sie gefunden wurde; **Räume mit Hinweisen** und
**Wie die Zahl zustande kommt** zeigen den Rechenweg.

- **Hybridzählung** nutzt auch Personen-Entitäten und Belegungs- und Bewegungsmelder; nimm das
  Häkchen weg, um nur Handys zu zählen.
- **Handys gruppieren**: Handys, die jeder Empfänger fast gleich stark hört, zählen als eine Person
  (ein Handy und seine Uhr). **Übernehmen** wendet einen neuen Schwellenwert an.
- **Die echte Zahl festhalten**: Tipp ein, wie viele Personen wirklich da sind, und wähl
  **Speichern**. Die Karte **Genauigkeit** zeigt dann, wie oft PadSpans Schätzung und die echte Zahl
  übereinstimmen.

Dieselbe Zahl ist die Karte **Personen im Gebäude** in der Übersicht.

## Traceback

Eine Wiedergabe, wohin deine Geräte gegangen sind. Etwa alle 10 Sekunden zeichnet PadSpan auf, wo
jedes Gerät ist, das du benannt hast oder dem du folgst; unbenannte Geräte werden nicht
aufgezeichnet. Es behält 7 Tage.

Die Zeile oben wechselt zwischen vier Modi:

- **Playback**: Wähl die **Time range** (5 Minuten bis 7 Tage, oder einen eigenen Zeitraum) und
  **All objects** oder ein Gerät. **▶** spielt den ganzen Zeitraum ab; **Run time** (1 bis 60
  Minuten) ist, wie lange die Wiedergabe dauert. Geh ein Bild weiter, spring zum Anfang oder Ende,
  oder zieh die Zeitleiste. Jedes Gerät wird da gezeichnet, wo die Live-Ortung es in diesem Moment
  hingesetzt hat, oder in der Mitte seines Raums, wenn es keine Position gab. **Export CSV** und
  **Export JSON** speichern die Bilder.
  - **Wiedergabe teilen** macht aus dem gewählten Zeitraum einen Clip von 10 bis 30 Sekunden, in dem
    sich Menschen durchs Haus bewegen, fertig zum Posten. Namen werden zu **Person 1**, **Person 2**
    (oder Initialen); Gerätenamen, Adressen und Signalwerte bleiben weg; Raumnamen bleiben, wie sie
    sind, oder werden allgemein (**Schlafzimmer**, **Raum 3**); Etagen sind nummeriert, nie benannt,
    und nur die Uhrzeit ist zu sehen, nicht das Datum. Der Clip wird aus den Umrissen deiner Räume
    gezeichnet, also sind kein Grundrissbild, keine Adresse und keine Koordinaten darin, und er
    beginnt dort, wo die erste Person den Raum wechselt. Der Dialog spielt den Clip ab und zeigt, was
    er verbirgt (und jeden Namen und Raum so, wie er erscheinen wird), bevor du **Clip speichern**
    drückst. Wähl **Breit** oder **Hochkant** und **MP4** (am besten für Reddit und X; Chrome und Edge
    können es), **WebM** (Firefox) oder **GIF**. Ein kleines Zeichen **gemacht mit PadSpan** steht in
    einer Ecke; nimm den Haken weg, dann fehlt es. Der Clip entsteht in deinem Browser und wird auf
    deinem Computer gespeichert: Nichts wird hochgeladen. Ein Video wird in Echtzeit aufgenommen,
    lass den Tab also im Vordergrund, bis es gespeichert ist. Es spielt auf dem Etagenstapel; das
    3D-Haus kommt später. In jeder Ausgabe kostenlos.
  - **Aktivität im ganzen Haus** (PadSpan Pro oder das gleichnamige Add-on) spielt dasselbe auf deinem Atlas ab, und mit
    **💡 Devices** auch das Haus: Lichter, Schlösser, Bewegung, Türen und Fenster und Messwerte von
    Sensoren, aus dem Recorder von Home Assistant.
- **New Objects**: welche Geräte in einem Zeitfenster zum ersten Mal gehört wurden (bis zu 7 Tage
  zurück).
- **Insights**: zwei Tabellen für die letzten 1, 3 oder 7 Tage. **Time in Room**: wie lange jedes
  Gerät an jedem Tag in jedem Raum war, und wie oft es hineinging. **Peak Concurrent Occupancy**: die
  meisten verfolgten Geräte auf einmal in einem Raum, an jedem Tag, und wann.
- **Busy Times** (PadSpan Pro oder das Add-on Präsenz-Auswertungen): ein Kasten pro Raum, der belebteste zuerst, jeder mit einem
  24-Stunden-Balkendiagramm, wann dort viel los ist.

Insights und Busy Times funktionieren ohne Grundriss. **Verwalten → History → Open History** hat die
gespeicherte Liste der Raumwechsel, jeder mit **▶ Traceback**, um diesen Moment abzuspielen.

## Forensik

Welche Bluetooth-Geräte zwischen zwei Zeitpunkten in der Nähe deiner Empfänger waren: nach einem
Einbruch oder einem gestohlenen Paket, oder um einen unbekannten Tracker zu entdecken, der immer
wiederkommt. Es braucht PadSpan Pro oder das Add-on Forensik und ist aus, bis du es einschaltest.

**Einschalten**: **Einstellungen → Funktionen → Forensik → Aufzeichnung von Anwesenheitssitzungen einschalten**. Es
bittet dich, das zu bestätigen. Solange es an ist, prüft PadSpan alle 60 Sekunden, welche Geräte es
hört, und zeichnet **Anwesenheitssitzungen** auf: Zeitspannen, in denen ein Gerät gehört wurde. Mehr
als 5 Minuten Stille beenden eine Sitzung. Forensik steht dann in jedem Modus in der Hauptliste.

**Suchen**: Wähl einen Anfang und ein Ende (Ortszeit), oder **Last hour**, **Last 24 h** oder
**Last 7 days**, dann **Search window**.

- **Recorded — actually present**: die Geräte mit einer Sitzung im Zeitfenster, der längste
  Aufenthalt zuerst, mit ihrer Zeit im Fenster (Dwell), dem stärksten Signal und den Empfängern, die
  sie gehört haben.
- **Hide my labelled devices** blendet die aus, die du benannt hast, damit Fremde auffallen.
- **Possible** erscheint nur, wenn das Zeitfenster vor den Beginn der Aufzeichnung zurückreicht.
- **Export CSV** speichert die Ergebnisse.

**Eine Bluetooth-Adresse ist keine Person.** Handys wechseln ihre Adresse, deshalb zeigen sich die
meisten Handys als einmalige Adressen; Geräte mit fester Adresse (Ohrhörer, Tracker, Lautsprecher)
findet es zuverlässig. Adressen lassen sich fälschen. Nimm die Ergebnisse als Spuren, nicht als
Beweis.

**Datenschutz**: Es zeichnet jedes Gerät in der Nähe auf, auch die der Nachbarn und der Passanten. Die
Aufzeichnungen bleiben in deinem Home Assistant und werden nie hochgeladen. Die Karte in den
Einstellungen behält sie 7, 14 (der Standard), 30, 60 oder 90 Tage, auch nachdem du die Aufzeichnung
ausgeschaltet hast; **Delete all recorded data** löscht sie.

## Zustand

Funktioniert PadSpan? Zustand sammelt PadSpans eigene Prüfungen auf einer Seite. Ein Klick auf den
Statuspunkt öffnet sie in jedem Modus.

**Der Statuspunkt** erscheint nur, wenn etwas nicht stimmt, mit der Zahl der Probleme; fahr mit der
Maus darüber, um ihre Namen zu sehen.

- **Rot**: PadSpan antwortet nicht, die Live-Daten sind also stehen geblieben; die letzte
  Aktualisierung der Positionierung ist fehlgeschlagen; oder kein Empfänger meldet.
- **Bernstein**: Ein Empfänger wurde seit über 10 Minuten nicht gehört; ein Empfänger hört viel
  weniger Geräte als sonst; oder das Lernen ist pausiert, die Räume kommen also nur aus den
  Live-Signalen.

Er wartet ein paar Sekunden, bevor er erscheint, damit ein langsamer Moment ihn nicht blinken lässt.
Empfänger, die du als verloren markiert, deaktiviert oder ausgeschlossen hast, zählen nicht, und er
beobachtet nur Live-Daten. Auf einem Wandbildschirm erscheint nur Rot.

Auf der Seite:

- **System**: die Version, Live oder Beispiel, und wie lange die letzte Aktualisierung gedauert hat.
  **Diagnose öffnen** ist hier für den Support ([Kapitel 27](27-getting-help.md)).
- **Hört weniger als sonst**: ein Empfänger, der über 10 Minuten lang viel weniger
  Bluetooth-Nachrichten hört als normal, während die anderen in Ordnung sind. Räume in seiner Nähe
  können falsch sein; ihn neu zu starten hilft oft.
- **Zustand der Scanner**: für jeden Empfänger, wie oft er dem Raum zustimmt, auf den die anderen
  zeigen (**Übereinstimmung**), und dasselbe als Zahl von 0,5 bis 1 (**Zuverlässigkeit**). Die Zahl
  wird nur angezeigt: Eine niedrige lässt diesen Empfänger nicht weniger zählen.
- **Anordnung von Räumen und Empfängern**: PadSpans Modell deines Hauses in Metern, eine Liste von
  Prüfungen, die bestanden oder nicht bestanden sind, und seine Werkzeuge (**Scanner neu abgleichen**,
  **Funkprüfung starten**, **Raummodell zurücksetzen** und mehr).
- **Gefundene Probleme**: automatische Prüfungen der ganzen Einrichtung, die ernstesten zuerst, jede
  markiert mit **Beheben**, **Lohnt sich zu beheben** oder **Gut zu wissen**, mit einer Zeile
  **Was tun:** und einem Knopf zu dem Bildschirm, auf dem du es behebst. Darunter listet
  **Verwechselte Räume** die Raumpaare, zwischen denen PadSpan ein Gerät immer wieder hin und her
  schiebt, und **Kalibrierqualität der Karten** den Kalibrierfehler jedes Plans.

[Kapitel 26](26-troubleshooting.md) führt von einem Symptom zu dem Bildschirm, den du ansehen solltest.

## Die anderen Bildschirme

- **Einrichtung**: [Kapitel 9](09-setup-the-map.md). **Karten**: [Kapitel 9](09-setup-the-map.md);
  der Atlas-Editor steht in der [Anleitung zum Atlas](../../ATLAS_GUIDE.md).
- **Kalibrierung**: [Kapitel 11](11-calibration.md).
- **Räume**: die Farbe jedes Raums, sein Umriss (mit **Edit outline**, oder **Put it on the map** für
  einen Raum, der nur auf einem Plan gezeichnet ist), Deckenhöhe, Halbgeschoss, Empfänger und wer
  gerade darin ist. Räume und Etagen sind deine Bereiche und Etagen in Home Assistant, deshalb
  änderst du ihre Namen in Home Assistant.
- **Empfänger**: jeder Empfänger mit seinem Raum, seiner Etage, Höhe, Signalanpassung und seinem
  Status. Höhe und Signalanpassung änderst du direkt in der Tabelle. **Nur Probleme** zeigt nur die,
  die Aufmerksamkeit brauchen.
- **Einstellungen**: Jede Einstellung steht in [Kapitel 20](20-settings-reference.md). In Einfach
  haben sie keine Reiter.
- **Verwalten**: **Data** (Aufräumen, Löschen, Backup & Restore), **HA Entities**, **Beacon
  Characteristics**, **History**, **Events** (Alarme per E-Mail oder aufs Handy), **Logs** und
  **Factory Reset**. Siehe [Kapitel 22](22-backup-restore-moving.md) und [Kapitel 13](13-alerts.md).
- **Training**: animierte Anleitungen und das Full Manual im Panel. Ein Teil davon ist noch nur auf
  Englisch.
- **Gäste**: [die Anleitung zu Gast-Tags](../../GUEST_TAGS_GUIDE.md) und [Kapitel 13](13-alerts.md).
- **Geräte**: **Alle Geräte**, **Nach Raum** (jedes Gerät mit seinem Raum und Signal; hier benennst
  du Geräte), **Register** (PadSpans feste ID für jedes Gerät, um Doppelte zusammenzuführen) und
  **Türöffner**.
- **Bluetooth**: wer was hört (**Visualisierung**), **Aussendungen**, **Scanner** (die
  Signalanpassung, das Ausschließen und das Mindestsignal jedes Empfängers), **IRK-Verwaltung** (die
  Schlüssel von Handys und Uhren) und **ESPHome-Konfigurationen** (fertige Einstellungen, um einen
  Empfänger zu bauen).
- **Monitor**: was PadSpan hört, in Zahlen, nach Empfänger und nach Raum, und **Export for support**.
- **QA**: Prüfungen deiner Einrichtung, Sicherungen, und jeder Empfänger in einer Rangliste.
- **Anwesenheit**, **Sandbox**: für Experten; sie ändern nichts.
- **Installationen**: der Bildschirm des Entwicklers für die freiwilligen Nutzungsberichte. Er fragt
  nach einer PIN und zeigt nichts über die Häuser anderer Leute.
