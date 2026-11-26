# 9. Einrichtung: dein Haus auf einer Karte

[Inhalt](README.md)

Die **Einrichtung** bringt dein Haus Schritt für Schritt von einer Liste der Räume auf eine Karte:
der Grundriss, sein Maßstab, die Räume, die Höhen der Etagen, die Empfänger, dein Handy und die
Kalibrierung. Dieses Kapitel geht jeden Schritt durch, dann die Wege zu einem Grundriss, wenn du
keinen hast, und das Ausrichten von zwei oder mehr Etagen.

Für Räume brauchst du keine Karte: **Wer ist wo** funktioniert ohne ([Kapitel 4](04-first-room.md)).
Eine Karte bringt die Zeichnung deines Hauses, die Kalibrierung und, mit drei oder mehr darauf
platzierten Empfängern, Positionen zwischen den Empfängern.

## Bevor du anfängst

- **Räume und Etagen kommen aus Home Assistant.** Jeder Raum ist ein Bereich und jede Etage eine
  Etage, unter **Einstellungen → Bereiche, Labels & Zonen**. Leg sie zuerst dort an: PadSpan kann
  sie nicht umbenennen. Ein Haus mit einer Etage braucht in Home Assistant keine Etagen.
- **Du musst Administrator sein**, um einen Grundriss hochzuladen oder zu ändern. Die Einrichtung
  sagt es, wenn du keiner bist.
- **Arbeite an deinem eigenen Haus.** Solange das Beispielhaus angezeigt wird, lassen sich die
  Knöpfe der Einrichtung nicht benutzen: Wähle zuerst **Zu meinem Haus**.
- **Einfach oder Erweitert.** Die Einrichtung ist in beiden gleich. Im Modus Einfach zeigt jeder
  Schritt nur das Werkzeug, das er braucht. Im Modus Erweitert öffnen sich dieselben Schritte mit den
  anderen Werkzeugen von Karten daneben.

## Die Einrichtung öffnen

- **Einrichtung** im Menü, direkt über Karten, bis jeder Schritt erledigt ist oder du die
  Einrichtung überspringst.
- **Eine Karte daraus machen** auf der Karte **Wer ist wo** der Übersicht.
- **Einrichten** auf der Karte **Erste Schritte** der Übersicht.
- Der Knopf **Einrichtung** oben in Karten, oder **Start Setup Wizard** in einer leeren Bibliothek
  von Karten.

## Die Seite Einrichtung

Die Einrichtung listet die Schritte der Reihe nach, mit einem Zähler („2 von 6 erledigt“) und einer
Leiste aus Punkten. Jeder Schritt ist als **Fertig**, **Nächster**, **Offen** oder **Übersprungen**
markiert. Ob er fertig ist, liest PadSpan an deinem Haus selbst ab, also zählt auch ein Schritt, den
du woanders erledigt hast.

| Knopf | Was er tut |
|---|---|
| **Start →** | Öffnet das Werkzeug des Schritts. |
| **Weiter →** | Dasselbe, beim Schritt, an dem du zuletzt gearbeitet hast. |
| **Öffnen** | Öffnet einen Schritt, der nicht der nächste ist. |
| **Ändern** | Öffnet einen erledigten Schritt (**Etage hinzufügen** beim Schritt zum Grundriss). |
| **Vorerst überspringen** | Markiert den Schritt als Übersprungen und geht weiter. Du kannst ihn jederzeit wieder öffnen. |

Den Schritt zum Grundriss kannst du nicht überspringen: Jeder spätere Schritt braucht einen
Grundriss.

Während du im Werkzeug eines Schritts arbeitest, sagt eine Leiste oben, welcher Schritt es ist
(„Einrichtung · Schritt 3 von 6: Räume zeichnen“), mit **← Zurück zur Einrichtung**. Die
Einrichtung merkt sich, wo du warst.

Die Schritte zum Grundriss (Hochladen, Maßstab, Räume, Etagenhöhen, Empfänger) laufen im **Setup
Wizard** von Karten, ein Grundriss nach dem anderen. Seine Chips oben tragen die Nummern und Namen
der Einrichtung; sobald der Grundriss existiert, klick einen Chip an, um dorthin zu springen.
**Beenden** verlässt ihn und behält, was du gezeichnet hast. Der Wizard endet mit **Abschluss**, und
dort ist der eine Knopf, den du nicht übersehen darfst: **Auf die Karte setzen**.

## Schritt 1. Grundriss hochladen

Ein Bild einer Etage oder ein PDF davon. Es muss nicht perfekt sein: Ein Foto eines Papierplans oder
deiner eigenen Skizze reicht.

1. **Etage (aus HA)**: die Home-Assistant-Etage, zu der dieser Grundriss gehört. **Außen
   (experimentell)** ist für einen Garten oder Hof; ein Haus kann einen Außen-Grundriss haben.
2. **Kartenname**: freiwillig. Bleibt er leer, nimmt er den Namen der Datei.
3. **Maximale Größe**: die längste Seite in Pixeln nach der Umwandlung, 1600, solange du es nicht
   änderst.
4. Wähle das Bild: PNG, JPG, GIF, BMP, WebP oder SVG, oder ein PDF, etwa die Zeichnung des
   Architekten. Hat das PDF mehrere Seiten, fragt PadSpan, welche Seite der Grundriss ist; diese
   Seite wird in deinem Browser als Bild gezeichnet und geht weiter wie jedes andere. Ein
   passwortgeschütztes PDF lässt sich nicht lesen: Speichere es vorher ohne Passwort oder als Bild.
   Zieh auf der Vorschau, um es zuzuschneiden, wenn du willst; **Zuschnitt zurücksetzen** fängt von
   vorn an.
5. Ist das Bild deine eigene Zeichnung, hak **Das ist meine eigene Skizze, nicht maßstabsgetreu**
   an. PadSpan fragt dann nach einer Länge in jeder Richtung.
6. Wähle **Hochladen und umwandeln**. PadSpan bewahrt den Grundriss in Home Assistant auf, wo ihn nur
   angemeldete Personen sehen können.

Lade deinen genauesten, maßstabsgetreuen Grundriss zuerst hoch. Die anderen werden später an ihm
ausgerichtet.

Eine Etage kann mehr als einen Grundriss haben, etwa einen Flügel, der für sich gezeichnet ist. Für
die nächste Etage nimmst du **+ Weitere Etage einrichten** am Ende des Wizards oder **Etage
hinzufügen** beim ersten Schritt der Einrichtung.

Gar kein Bild der Etage? Siehe [Kein Grundriss?](#kein-grundriss) unten.

## Schritt 2. Maßstab festlegen

PadSpan braucht die echte Größe des Grundrisses, bevor Räume, Empfänger oder irgendetwas in Metern
daraufkommen können. Ohne Maßstab kommt nichts auf die Karte, und die Kalibrierung kann nicht
beginnen.

Direkt nach dem Hochladen öffnet sich **Den Maßstab dieses Grundrisses jetzt festlegen**:

1. Klick (oder tipp) beide Enden von etwas an, dessen Länge du kennst. Je länger, desto besser: die
   längste Wand, die du findest, oder das ganze Haus. Eine Türöffnung geht, aber ein kleiner
   Ausrutscher auf einer kurzen Länge macht den ganzen Grundriss ungenauer.
2. Gib die Länge unter **Seine Länge:** ein. Längen sind in Metern. Mit
   **Einstellungen → Darstellung → Einheiten: Längen in Fuß und Zoll zeigen** an erscheinen sie in
   Fuß und Zoll, und du kannst sie auch so eingeben.
3. Freiwillig: **Eine Länge in der anderen Richtung hinzufügen**. Eine zweite Länge, quer zur
   ersten, prüft, dass das Bild nicht verzerrt ist. Passen die beiden nicht zusammen, sagt der
   Bildschirm das. Prüf zuerst beide Enden; ist das Bild wirklich verzerrt (deine eigene Skizze oder
   ein gestauchter Scan), wähle **Dieses Bild ist nicht maßstabsgetreu**, und jede Richtung bekommt
   ihren eigenen Maßstab.
4. Wähle **Maßstab speichern**. Der Wizard geht weiter zu den Räumen.

Ein Grundriss, den du übersprungen hast, zeigt **Noch kein Maßstab** mit einem Knopf **Messen**, in
der Einrichtung und in der Bibliothek von Karten. Um einen Grundriss später noch einmal zu vermessen,
nimm im Modus Erweitert **Karten → Bearbeiten → 📏 Messen** oder im Modus Einfach den Schritt
Maßstab festlegen der Einrichtung.

## Schritt 3. Räume zeichnen

Zeichne jeden Home-Assistant-Raum auf dem Grundriss seiner Etage nach.

1. Über dem Grundriss zählt ein Kasten die gezeichneten Räume („2 von 7 Räumen gezeichnet“) und
   listet die, die noch fehlen. Drück auf den Namen eines Raums.
2. Klick jede Ecke des Raums auf dem Grundriss an.
3. Doppelklicke die letzte Ecke oder wähle **Umriss abschließen** (ab drei Ecken).

Im Setup Wizard wird jeder Raum gespeichert, sobald du ihn fertig hast. Eine Ecke nahe an der Ecke
oder Kante eines anderen Raums rastet dort ein; halte Alt gedrückt, um sie genau dahin zu setzen, wo
du willst.

- **Ein Raum fehlt in der Liste?** Prüf unter **Einstellungen → Bereiche, Labels & Zonen**, dass
  sein Bereich auf dieser Etage ist.
- **Zeichne jeden Raum, den deine Empfänger abdecken.** Sobald Räume auf der Karte sind, wird ein
  Gerät in einem Raum, den du nicht gezeichnet hast, vielleicht nicht angezeigt.
- **Ein Raum, der schon auf einem anderen Grundriss gezeichnet ist**, ist mit ⚠ und dem Namen dieses
  Grundrisses markiert: Zeichnest du ihn noch einmal, entsteht eine zweite Kopie.

**Lass Claude deine Räume zeichnen (experimentell).** Wo ein Grundriss noch keine Räume hat, bieten
die Einrichtung und der Wizard **Oder lass Claude die Räume aus deinem Grundriss zeichnen
(experimentell) →** an. Claude liest den Grundriss zweimal, findet seine Räume und ihre Namen und
zeichnet sie, damit du sie prüfst. Nichts wird gespeichert, bis du **Speichern** wählst, und es
lässt sich rückgängig machen. Dafür braucht es die Anthropic-Integration von Home Assistant mit einem
AI Task, der Claude nutzt, und Anthropic berechnet deinem Konto jedes Lesen; sein erster Bildschirm
sagt, was gesendet wird und wie viele Lesevorgänge es braucht.
[Claude mit Home Assistant verbinden, für PadSpans Raum-Helfer](https://padspan.traks.ca/guides/claude-ai-task/)
zeigt die Einrichtung.

## Schritt 4. Etagen und ihre Höhen

Nur in einem Haus mit zwei oder mehr Etagen innen (Außen zählt nicht). Der Schritt sagt PadSpan, wie
hoch jede Etage ist, damit es die Etagen auseinanderhalten kann. Bis du sie festlegst, nimmt es eine
übliche Geschosshöhe, 2,8 m.

Der Schritt öffnet die Karte **Etagenhöhen** (im Modus Erweitert unter **Karten → 3D-Stapel**):

- **Etage↕ (m)**: von einem fertigen Fußboden bis zum nächsten, Raumhöhe und Geschossdecke
  zusammen. Leer heißt 2,8 m.
- **Grundhöhe (m)**: wie hoch die Etage beginnt. Lass sie leer, außer die Stapelung stimmt nicht,
  etwa bei einem Split-Level oder einem Zwischengeschoss.

Wähle **Etagenhöhen speichern**. Ein einzelner hoher Raum, etwa ein Wohnzimmer über zwei Etagen,
behält hier die normale Höhe der Etage: Gib diesem Raum seine eigene Höhe auf der Seite **Räume**
(**Ceiling height**).

## Schritt 5. Empfänger platzieren und ihre Höhen festlegen

Setz jeden Bluetooth-Empfänger dahin, wo er wirklich hängt.

**Von Hand.** Neben dem Grundriss listet **Live-BLE-Empfänger** die Empfänger, die Home Assistant
hört:

1. Wähle **Hinzufügen** neben einem Empfänger. Er landet in der Mitte des Grundrisses, schon in
   seinem Home-Assistant-Raum.
2. Zieh ihn dahin, wo er hängt.
3. Mach dasselbe für jeden Empfänger auf dieser Etage. Ein platzierter zeigt **✓ platziert**, mit
   **Bearbeiten**.

Nimm **Hinzufügen** in dieser Liste. Der Text des Schritts selbst sagt, du kannst auf die Karte
doppelklicken, und **Empfänger hinzufügen** tut dasselbe, aber beides macht einen leeren
„Receiver N“, der an keinen echten Empfänger gebunden ist, und **Auf die Karte setzen** lässt ihn
weg.

**Oder lass PadSpan es machen.** **Meine Empfänger in ihre Räume setzen** setzt jeden Empfänger,
dessen Raum einen Umriss hat, in die Mitte dieses Raums, auf der Karte deines Hauses. Es sagt, was
es platziert hat, was nicht und warum. **Die zuletzt platzierten … rückgängig machen** nimmt sie
zurück. Zieh jeden später dahin, wo er hängt, im ersten Schritt der Kalibrierung, **Positionen der
Empfänger prüfen**.

**Ein Empfänger ohne Raum.** Hat ein Empfänger keinen Home-Assistant-Bereich, listet dieser Schritt
ihn mit einer Liste der Räume und **Raum festlegen**; der Raum, auf den sein Name deutet, ist schon
gewählt. Damit bekommt das Gerät des Empfängers den Bereich in Home Assistant, genau wie mit
**Empfängerliste ansehen → Zuweisen** in der Übersicht.

**Ein Empfänger im falschen Raum.** Sobald du Kalibrierpunkte hast, kann dieser Schritt sagen:
**Die Signale sagen: Küchen-Proxy gehört zu Esszimmer, nicht zu Küche. 4 der 5 Kalibrierpunkte, die
er am besten hört, liegen dort.** Wähle **Esszimmer übernehmen**, um seinen Bereich zu ändern, oder
**Küche behalten**, um ihn zu lassen. Siehe
[Kapitel 11](11-calibration.md#die-signale-sagen-dieser-empfänger-ist-in-einem-anderen-raum).

**Höhen.** Die Höhe eines Empfängers zählt, sobald er auf der Karte deines Hauses ist (nach **Auf
die Karte setzen** oder **Meine Empfänger in ihre Räume setzen**). Leg sie in **Positionen der
Empfänger prüfen** der Kalibrierung fest (die Markierung anklicken, **Höhe über dem Boden (m)**,
**Höhe speichern**), auf der Seite **Empfänger** oder im Modus Erweitert unter **Karten →
Bearbeiten**. Es ist überall derselbe Wert. Er beginnt bei 2,4 m. In einem Haus mit zwei oder mehr
Etagen ist der Schritt nicht erledigt, solange alle Empfänger auf derselben Höhe sind: Gib an, wie
hoch jeder wirklich hängt.

## Abschluss: Auf die Karte setzen

Der letzte Bildschirm des Wizards fasst den Grundriss zusammen („4 Räume gezeichnet, 3 Empfänger
platziert“) und sagt, was als Nächstes kommt.

**Bis du Auf die Karte setzen wählst, sind deine Räume und Empfänger nur auf dem Bild.** Die
Übersicht, der Atlas und die Ortung arbeiten alle mit der Karte deines Hauses, nicht mit dem Bild.
Wähle **Auf die Karte setzen**: Es fügt die Räume und Empfänger hinzu, die die Karte noch nicht hat.
Was schon darauf ist, ändert sich nicht. **Fertig** allein tut das nicht.

Sobald der erste Raum auf der Karte ist, nimmt dein Haus in der Übersicht den Platz von **Wer ist
wo** ein.

Danach:

- geht der Knopf zum nächsten Schritt (**Handy oder Uhr verfolgen →**, **Zur Kalibrierung →** und so
  weiter) weiter;
- startet **+ Weitere Etage einrichten** den Wizard noch einmal für den nächsten Grundriss;
- geht **Fertig** zurück zur Bibliothek von Karten.

**Schon fertig, und die Übersicht sagt „Raum- und Empfänger-Layout noch nicht erstellt“?** Du musst
nicht von vorn anfangen. Öffne den Setup Wizard für diesen Grundriss, geh zu Abschluss und wähle
**Auf die Karte setzen**. Auf der Seite **Räume** hat ein Raum, der auf einem Grundriss, aber nicht
auf der Karte gezeichnet ist, sein eigenes **Auf die Karte setzen**. Im Modus Erweitert hat
**Karten → Aufteilung**, mit **Anordnung** auf **Kartenlagen** gestellt, **Diese Anordnung
übernehmen**.

## Schritt 6. Dein Handy oder deine Uhr verfolgen

PadSpan lernt das Handy oder die Uhr kennen, die du bei dir trägst, damit es dir folgen und damit
kalibrieren kann. Der Schritt ist erledigt, sobald PadSpan einem Handy oder einer Uhr als Gerät einer
Person folgt: einem mit registriertem Schlüssel (IRK) oder einem Handy mit Companion App, für das du
Verfolgen gedrückt hast.

Der Schritt öffnet den Handy-Assistenten, **Dein Handy verfolgen** (im Modus Erweitert unter
**Bluetooth → IRK-Verwaltung**), mit drei Wegen hinein:

- **Ich habe ein Android-Handy**: Öffne in der Companion App
  **Einstellungen → Companion App → Sensoren verwalten → BLE Transmitter**, schalte ihn ein, stell **Transmit power** auf **High** und **Advertise mode** auf
  **Low latency**. Dann öffnet **In „Übersicht“ verfolgen →** die Karte **Dein Handy verfolgen**:
  Wähle **Dieses Handy verfolgen** (im Modus Einfach **Verfolgen**).
- **Ich habe ein iPhone**: die Schritte, um seinen IRK zu bekommen, ihn in Home Assistants Private
  BLE Device einzutragen und ihn zu prüfen: Füg ihn ein und wähle **Prüfen**, und PadSpan sagt, wie
  viele der wechselnden Adressen, die es gerade hört, dieses iPhone sind.
- **Ich habe einen IRK-Capture-ESP32**: Gib den Namen des Geräts ein und wem es gehört, kopple das
  iPhone oder die Apple Watch mit dem ESP32 und speichere den Schlüssel, den PadSpan findet. Entferne
  dann die Kopplung vor dem nächsten Gerät.

Bei einer älteren Installation, bei der beide Handy-Schalter aus sind (**Phone Setup Wizard** und
**iPhone-Einrichtungsweg**, unter **Einstellungen → Funktionen**), öffnet der Schritt stattdessen die
Karte **Dein Handy verfolgen** der Übersicht.
[In welchem Raum ist mein Handy?](https://padspan.traks.ca/guides/phone-room-presence/) hat jeden
Schritt, mit Bildern.

## Schritt 7. Kalibrieren

Geh mit deinem Handy durchs Haus, damit PadSpan lernt, wie jede Stelle klingt. Der Schritt ist ab
fünf Kalibrierpunkten oder einem berechneten Modell erledigt.

- Wo **Raum abgehen** an ist, startet **Start →** das Abgehen, 90 Sekunden pro Raum, und **Punkt für
  Punkt** daneben öffnet die Geführte Kalibrierung.
- Wo es aus ist, öffnet **Start →** die Geführte Kalibrierung, und eine Zeile sagt, wie du Raum
  abgehen einschaltest, mit **Diese Einstellung öffnen**.

[Kapitel 11](11-calibration.md) erklärt beides.

Wenn jeder Schritt erledigt ist, sagt die Einrichtung **Dein Haus ist eingerichtet.** und
verschwindet aus dem Menü. Über den Knopf Einrichtung in Karten und über die Übersicht ist sie
weiter da, wenn du einen Schritt ändern willst.

## Mit einem groben Haus beginnen

Kein Grundriss und keine Zeichnung? Die Einrichtung, und Karten, solange es keinen Grundriss hat,
bieten **Mit einem groben Haus aus deinen Home-Assistant-Räumen beginnen** an, solange noch kein Raum
gezeichnet ist. Es läuft nur, wenn du es drückst.

1. Wähle **Zeigen, was angelegt wird**. Es listet jede Etage mit ihren Räumen und alles, was es
   auslässt, mit dem Grund: ein Raum, der schon gezeichnet ist, eine Etage, die schon einen Plan oder
   Räume hat, ein Bereich draußen.
2. Ein Bereich, der in Home Assistant keine Etage hat, kommt auf die Etage, die du dort wählst (die
   erste, wenn du keine wählst).
3. Wähle **Grobes Haus anlegen**.

Für jede Etage ohne Plan legt PadSpan eine leere Etage an, als „grober Anfang“ markiert, mit einem
quadratischen Kasten für jeden Home-Assistant-Bereich darauf, benannt wie der Bereich. Ein Kasten ist
3,5 m breit, etwas größer, wo der Bereich mehr als vier Geräte hat, höchstens 6 m. Deine Geräte
erscheinen sofort in ihren Räumen, wie bei jedem Raum. Sonst ändert sich nichts: kein
Kalibrierpunkt, kein Empfänger und keine Wand wird angefasst, und ein zweiter Druck legt nichts an.

Die Kästen sind Platzhalter fürs Zeichnen der Räume: Bis du sie umformst oder ersetzt, bleibt der Schritt
**Räume zeichnen** der Einrichtung offen, ein echter Plan dieser Etage öffnet mit seinem Räume-Werkzeug, und
**Let Claude draw your rooms** wird dafür weiter angeboten. Für alles andere (wo Menschen und Geräte sind)
sind sie Räume.

Die Kästen sind ein Anfang. Der Hinweis auf dem groben Plan sagt, wie viele noch Kästen sind, mit zwei
Wegen weiter:

- **Räume umformen.** Im Modus Erweitert öffnet das **Karten → Aufteilung** auf dieser Etage:
  verschiebe jeden Kasten, ändere seine Größe, dann **Korrekturen speichern**. Im Modus Einfach öffnet
  es den Räume-Schritt des Einrichtungsassistenten auf dem groben Plan, wo die Kästen gestrichelt
  gezeichnet sind: zeichne den Raum über seinen Kasten.
- **Einen Plan dieses Stockwerks hochladen.** Hochladen, Maßstab festlegen und die Räume zeichnen
  wie in den Schritten 1 bis 3. Der grobe Plan steht dabei nie im Weg.

So oder so setzt **Auf die Karte setzen** (der Abschluss des Assistenten oder der eigene Knopf des
Raums auf der Seite **Räume**) jeden gezeichneten Raum an die Stelle seines Kastens. Der Raum behält
seinen Namen und bleibt so mit seinem Home-Assistant-Bereich verbunden. Einen Kasten, den du unter
Aufteilung umgeformt hast, ersetzt nichts mehr: er gehört dir. Hat eine Etage ihren echten Plan,
kannst du den groben Plan in der Bibliothek löschen. Seine Räume bleiben auf der Karte,
ebenso die Kalibrierpunkte, die auf ihm aufgenommen wurden.

## Kein Grundriss?

Beim Schritt zum Hochladen listet **Kein Grundriss? So bekommst du einen** sechs Wege, den besten
zuerst. Je weiter unten in der Liste, desto grober der Grundriss.

1. **Nach einer vorhandenen Zeichnung suchen.** Die Zeichnungen des Bauträgers oder Architekten, das
   Verkaufsexposé, die Bauakte der Gemeinde, ein Versicherungsgutachten, der Fluchtwegplan an einer
   Wand. Ein PDF geht so hoch, wie es ist; bei Papier reicht ein Foto, gerade über die Seite
   gehalten.
2. **Einen Plan aus einer anderen App importieren.** Ein Haus, das schon anderswo gezeichnet ist,
   kommt maßstabsgetreu herein:
   - **Easy Floorplan** (die Home-Assistant-Karte): Bearbeite die Karte, öffne ihren Code-Editor und
     kopiere alles in eine Textdatei mit der Endung `.yaml`. Ihre Wände, Türen, Fenster und Räume
     kommen herein; ein Raum, der mit einem Bereich in Home Assistant verknüpft ist, heißt wie dieser.
     Die Karte hat keine Einheit, also gib die Breite der Zeichnung (Außenwand bis Außenwand) in das
     Feld über der Datei ein; bleibt es leer, wird der Maßstab aus ihren Türen genommen (jede als
     85 cm), und du misst eine Länge, um ihn genau zu machen.
   - **DXF** aus einem CAD-Programm, als Text gespeichert (nicht binär, nicht DWG). Jede geschlossene
     Polylinie wird ein Raum, benannt nach dem Text darin; Linien und offene Polylinien sind Wände.
     Die Einheit kommt aus der Einstellung der Zeichnung (`$INSUNITS`); eine Zeichnung ohne braucht
     ihre Breite.
   - **Floorplanner**: Exportiere das Projekt (Quick Export, wo dein Projekt es anbietet) und wähle
     die `.fml`-Datei aus dem ZIP oder das ZIP selbst. Ihre Wände, Türen, Fenster und Räume kommen
     herein.

   Wähle die Etage und die Datei (höchstens 2,8 MB). Hat die Datei mehrere Etagen, fragt PadSpan, welche
   es ist; eine Easy-Floorplan-Etage, die mit der gewählten Etage in Home Assistant verknüpft ist, wird
   von selbst genommen. Was PadSpan nicht nutzt (Geräte und ihre Entitäten, Möbel, Texte, gerade
   gezeichnete Kurven), steht in der Meldung und neben den Räumen auf dem Plan. Die Räume der Datei
   sind Umrisse, keine neuen Räume: Wähle jeden Home-Assistant-Raum in der Liste und drück **Den Umriss
   nehmen, den die Datei** ihm **gibt** (oder **Stattdessen einen gescannten Umriss nehmen** und klick
   in einen hinein), so bleiben deine Räume deine Bereiche in Home Assistant.
3. **Die Etage mit einem iPhone oder iPad scannen.** Dafür brauchst du ein Pro-Modell mit LiDAR
   (iPhone 12 Pro oder ein neueres Pro, iPad Pro 2020 oder neuer). Jede Raumscan-App, die Apples
   RoomPlan nutzt, kann den Scan als USDZ-Datei teilen (manche bieten auch RoomPlan-JSON). Scanne
   die ganze Etage in einem Durchgang, Türen offen und Licht an. Wähle ihre Etage, wähle die Datei,
   und PadSpan zeichnet den Grundriss maßstabsgetreu, ohne dass du etwas messen musst. Wo jeder Raum
   ist, sagst du trotzdem selbst. **Schritt für Schritt führen** zeigt dieselben Schritte einen
   Bildschirm nach dem anderen, fürs Handy gemacht, und gibt dir eine Adresse, die du dem schicken
   kannst, der den Scan macht. Ab dem 1. Dezember 2026 braucht ein Grundriss aus einem Scan PadSpan
   Pro oder das Add-on Erweiterte Kartenerstellung.
4. **Die Karte deines Saugroboters nutzen.** Ein Valetudo-, Dreame- oder Xiaomi-Roboter, den Home
   Assistant sieht. Schalte **Einstellungen → Funktionen → Experimentelle Funktionen →
   Saugroboter-Import** ein, nimm dann **Karten → Aufteilung → 🤖 Import from a robot vacuum** und
   **Add as a new map**. Daraus wird ein Grundriss mit seinen Räumen; Räume, die du schon hast, bleiben
   erhalten. Ab dem 1. Dezember 2026 braucht das PadSpan Pro oder das Add-on Saugroboter.
5. **Selbst zeichnen und fotografieren.** Auf weißem Papier, zuerst die Außenwände, dann die Wände
   zwischen den Räumen, mit einer Lücke für jede Tür. Schreib die Länge einer langen Wand quer und
   einer längs dazu. Fotografier es von direkt oben. **Ich habe meine Skizze: hochladen** hakt im
   Formular „meine eigene Skizze“ für dich an, und der Schritt zum Maßstab nimmt eine Länge in jede
   Richtung.
6. **Mit einer leeren Etage beginnen.** Gib Breite und Tiefe der Etage ein (grob reicht), wähle ihre
   Etage und **Leere Etage anlegen**. PadSpan legt eine leere Etage dieser Größe an, mit einer Linie
   pro Meter; zeichne jeden Raum an seinen Ecken darauf und zähl dabei die Linien.

Zwei weitere Wege, im Modus Erweitert, unter **Karten → Aufteilung**:

- **Räume in Metern, ohne Bild.** Gib den genauen Namen des Bereichs in **Name des neuen Raums** ein,
  wähle **+ Raum hinzufügen**, zieh ihn in Form und wähle **Korrekturen speichern**. Die Kalibrierung
  braucht trotzdem einen Grundriss mit Maßstab.
- **Sweet Home 3D.** **📐 Grundriss importieren (.sh3d)** liest die Räume aus einer
  Sweet-Home-3D-Datei, als Vorschlag für diese Etage, den du prüfst und bearbeitest, bevor du ihn
  übernimmst. Mit **RoomPlan Import** an, unter Einstellungen → Funktionen, liest derselbe Knopf
  einen Raumscan (ab dem 1. Dezember 2026 mit PadSpan Pro oder dem Add-on Erweiterte
  Kartenerstellung).

[Welcher Grundriss für Home Assistant?](https://padspan.traks.ca/guides/floor-plans/) und
[Dein Saugroboter hat deinen Grundriss schon gezeichnet](https://padspan.traks.ca/guides/robot-vacuum-floor-plan/)
gehen weiter.

### Raumortung mit dem Roboter

Ein Roboter mit Valetudo, dessen Karte so importiert wurde, kann PadSpan auch helfen, deine Räume
zu lernen. Das ist freiwillig, und nichts passiert, bis du eine Fahrt startest. Kleb einen
Bluetooth-Beacon mit fester Adresse (iBeacon oder Eddystone) oben auf den Roboter, weg vom
Laserturm. Kein AirTag und kein Tile: deren Adressen ändern sich ständig. PadSpan hört nie den
Roboter selbst, nur den Beacon auf ihm.

Ab dem 1. Dezember 2026 brauchen die Funktionen des Roboters (seine Karte als Grundriss, der Roboter
im Atlas und im 3D-Haus mit seiner Karte, die Raumortungsfahrten, **Fehler finden** und das WLAN
beim Saugen) PadSpan Pro oder das Add-on Saugroboter ([Kapitel 25](25-padspan-pro.md#add-ons)); ein
Bright-Pro-Schlüssel behält sie. Ohne eins davon wird der Roboter nicht gezeichnet, und der Import
und **Fahrt starten** sagen, was sie brauchen. Nichts Gespeichertes wird gelöscht: Die Verbindung,
die Karte und frühere Fahrten bleiben, **Stopp** und **Diese Fahrt rückgängig machen** gehen immer,
und mit einem Schlüssel kommt alles zurück.

Der Roboter erscheint im Atlas und im 3D-Haus, solange seine Live-Position an ist und der
Saugroboter-Import eingeschaltet ist, ob dort Personen und Tags gezeigt werden oder nicht. Halte
ihn gedrückt, um seine Karte zu öffnen. Die Karte spricht direkt mit
dem Valetudo des Roboters, also braucht es weder die Saugroboter-Entität von Home Assistant noch
MQTT. Sie zeigt, was der Roboter gerade tut, und seinen Akku, mit **Starten**, **Pausieren** und
**Zur Station**. Nur ein Administrator kann sie benutzen.

Unter **Raumortung** zeigt die Karte, was eine Fahrt braucht: die Adresse des Roboters (und seinen
Valetudo-Benutzer und sein Passwort, wenn die Anmeldung an ist), seine Karte aus Valetudo und den
Beacon auf dem Roboter, und ob PadSpan ihn gerade hört. **Fahrt starten** schickt den Roboter zu
Stellen etwa 1,5 m auseinander in jedem Raum oder in dem, den du wählst, jede mindestens 40 cm von
den Wänden, und nie in einen Sperrbereich oder an eine virtuelle Wand oder ein Hindernis auf der
Karte des Roboters. An jeder Stelle steht er etwa 20 Sekunden still, während PadSpan dem Beacon
zuhört, jedem Paket, das jeder Empfänger hört (etwas länger, wenn zu wenige Empfänger ihn gehört
haben, und die Stelle wird übersprungen, wenn es dann immer noch zu wenige sind). Hat sich der
Roboter während des Halts bewegt, fällt die Stelle weg; eine, die er nicht erreicht, wird
übersprungen. Vor jeder Fahrt wird die Kalibrierung gesichert, und eine Fahrt beginnt nicht, wenn
sich die Karte des Roboters seit dem Import geändert hat (seine Station ist umgezogen): importiere
sie dann neu. Startet ein Valetudo-Zeitplan den Roboter innerhalb von zwei Stunden, sagt die Karte
es.

Vor der ersten Fahrt wählst du, wie die Punkte des Roboters genutzt werden; nichts wird für dich
gewählt, und du kannst es jederzeit ändern:

- **Wie deine eigenen zählen**: jede Stelle kommt in die Kalibrierung, mit vollem Gewicht.
- **Lücken füllen, weniger zählen**: nur in Räumen, in denen du weniger als 3 eigene Punkte hast,
  und mit halbem Gewicht.
- **Nur Fehler finden und WLAN**: nichts kommt in die Kalibrierung.

Die Messwerte jeder Stelle bleiben so oder so bei ihrer Fahrt. Änderst du die Wahl, sagt die
Karte, was sich für frühere Fahrten ändern würde, und lässt dich das anwenden (in einem Schritt,
nach einer Sicherung, rückgängig zu machen) oder sie lassen, wie sie sind. Nach jeder Fahrt zeigt
die Karte, wie deine eigenen Teststellen davor und danach abgeschnitten haben. **Stopp** beendet die Fahrt und schickt den Roboter zurück zur
Station; das tun auch das Ende der Fahrt, ein Problem oder zwei Stunden. Fährt der Roboter von sich
aus zur Station, übernimmt ihn jemand oder ein Valetudo-Zeitplan (er saugt, wird gesteuert oder
pausiert), oder fällt sein Akku unter 20 %, endet die Fahrt dort, und PadSpan schickt ihm nichts
mehr; unter 20 % beginnt keine Fahrt. **Diese Fahrt rückgängig machen** nimmt genau die
Punkte heraus, die diese Fahrt hinzugefügt hat, und keinen deiner eigenen; jede frühere Fahrt,
deren Punkte noch da sind, steht mit ihrem eigenen **Rückgängig** auf der Karte. Eine Fahrt, die
beim Neustart von Home Assistant lief oder als PadSpan neu geladen oder eine Sicherung
wiederhergestellt wurde, ist vorbei (der Roboter wird zur Station geschickt); ihre Punkte bleiben
und lassen sich weiterhin rückgängig machen.

Die Punkte des Roboters zählen als PadSpans eigene, wie die automatischen Punkte eines
angehefteten Beacons, nicht als deine. Nur das Rückgängigmachen einer Fahrt entfernt sie: die
Aufräumarbeiten der Beacons rühren sie nie an.

**Fehler finden** auf der Karte öffnet eine eigene Karte. Aus den Punkten, die die Fahrten schon
gespeichert haben (ohne weitere Fahrt), berechnet sie, wo jeder Empfänger wirklich steht, und
listet die auf, die an der falschen Stelle oder auf der falschen Etage platziert scheinen (einer
oben, der den Roboter unten etwa so stark hört wie die Empfänger dort), mit
der Angabe, wie sicher das ist, und einem Link zur Platzierung dieses Empfängers. Ein Empfänger
muss an sechs Stellen oder mehr gehört worden sein, über 3 m verteilt und rund um ihn, denn eine
Fahrt durch einen Raum sagt nichts über einen Empfänger im nächsten; die anderen stehen unter zu
wenigen Messwerten. Sie verschiebt nie etwas.

Auf einem Wandbildschirm zeigt die Karte nur, was der Roboter gerade tut, und seinen Akku.

An jeder Stelle meldet der Roboter auch sein eigenes WLAN-Signal. PadSpan behält die letzten 2.000
davon für die WLAN-Abdeckungskarte, und andere Integrationen können sie lesen.

Der Roboter kann sein WLAN auch melden, während er von sich aus saugt. Schalte dazu auf seiner Karte
**WLAN beim Saugen erfassen** ein (bis dahin ist es aus). Während der Roboter saugt oder fährt und
seine Live-Position an ist, liest PadSpan etwa alle 5 Sekunden sein WLAN und wo er ist, und nichts,
solange er in der Station steht oder eine Fahrt läuft. Diese Messwerte entstehen während der Fahrt,
deshalb zählt jeder nur ein Zehntel eines Messwerts im Stillstand; PadSpan behält die letzten 5.000,
getrennt von den Stellen der Fahrten. Auf dem Bildschirm zur WLAN-Abdeckung sind sie blasse Quadrate
unter den Rauten, mit **Beim Saugen** zum Ausblenden.

## Mehr als eine Etage: sie ausrichten

Jeder Grundriss behält seinen eigenen Platz in Metern. Mit zwei oder mehr Etagen richtest du sie so
aus, dass ein Treppenhaus auf der einen über dem Treppenhaus auf der anderen liegt. Das geht unter
**Karten → 3D-Stapel** (Erweitert):

1. **Etagenhöhen**: wie in Schritt 4.
2. **Etagen-Zuordnung und Deckenhöhen**: eine Zeile pro Grundriss, mit seiner **HA-Etage** und
   **Stapelebene**. **Speichern** in einer Zeile behält sie. Nimm den Haken bei **Zeigen** weg, um
   einen Grundriss auszublenden.
3. **Ausrichtung überlagern**: Wähle eine **Referenz** (fest und vermessen) und ein **Ziel** (den
   Grundriss, den du bewegst). Zieh das Ziel, bis Treppenhäuser und Außenwände übereinanderliegen.
   **Maßstab +** und **Maßstab −** ändern seine Größe, **−15°**, **﹢15°** und **0°** drehen es, und
   **Deckkraft** hilft dir, beide zu sehen. Nichts wird behalten, bis du **Ausrichtung speichern**
   wählst.
4. Für eine genauere Passung **Punkte ausrichten**: Klick denselben echten Punkt auf beiden
   Grundrissen an (eine Ecke des Treppenhauses), drei Paare oder mehr, dann **Berechnen**. Es
   bewertet die Passung als Sehr gut, Mittel oder Schwach, in Metern. **Anwenden** verschiebt das
   Ziel auf dem Bildschirm; dann **Ausrichtung speichern**.

PadSpan lehnt eine Ausrichtung ab, die mehr als die Hälfte der Kalibrierpunkte eines Grundrisses von
der Karte schieben würde. **Compare Maps** in der Bibliothek bewertet, wie gut deine Etagen
übereinanderliegen, wenn du fertig bist.

Der Modus Einfach hat keinen Reiter 3D-Stapel: Stell den Modus-Knopf auf Erweitert, um Etagen
auszurichten.

## Später ändern

- **Der Umriss eines Raums**: die Seite **Räume**, **Edit outline**; im Modus Erweitert **Karten →
  Bearbeiten**, das Werkzeug Räume, oder **Karten → Aufteilung** für die Räume in Metern.
- **Platz oder Höhe eines Empfängers**: Kalibrierung → **Feinabgleich** oder die Seite **Empfänger**
  (**Platzieren** oder **Verschieben**).
- **Der Maßstab**: Karten → Bearbeiten → 📏 Messen (Erweitert) oder der Schritt Maßstab festlegen
  der Einrichtung.
- **Ein Grundriss, den du nicht mehr willst**: Karten → Bibliothek, **Löschen**. Sein Bild und was
  darauf gezeichnet war, verschwinden; die Räume in Metern und Kalibrierpunkte mit einer Position in
  Metern bleiben.
