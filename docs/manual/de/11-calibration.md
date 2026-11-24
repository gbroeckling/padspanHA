# 11. Kalibrierung

[Inhalt](README.md)

Die Kalibrierung bringt PadSpan bei, wie dein Haus klingt. Du trägst dein Handy oder einen Tag an
Stellen im ganzen Haus, und an jeder Stelle zeichnet PadSpan auf, wie stark jeder Empfänger es hört.
Mit diesen **Kalibrierpunkten** vergleicht es später die Live-Signale, um Leute in den richtigen
Raum zu setzen.

Ohne Kalibrierung verortet PadSpan jedes Gerät allein über die Empfänger: der Raum des Empfängers,
der es am besten hört, oder, mit einer Karte, eine Position, die aus den Plätzen der Empfänger
berechnet wird. Das ist eine gute erste Antwort. Die Kalibrierung macht sie besser, vor allem in
Türöffnungen und an den Wänden zwischen Räumen, wo zwei Räume am schwersten auseinanderzuhalten
sind.

In einem Haus mit Karte entscheidet weiterhin die Position, die aus den Plätzen der Empfänger
berechnet wird, über den Raum, sobald sie in einem gezeichneten Raum liegt. Die Kalibrierung macht
diese Position besser (jeder Empfänger bekommt aus deinen Punkten seine eigene Signalanpassung), und
der Abgleich mit deinen Kalibrierpunkten entscheidet über den Raum, wenn sich keine solche Position
berechnen lässt. **Die bessere Methode für dieses Haus wählen** (unten, ab Werk aus) lässt
stattdessen die Kalibrierpunkte entscheiden, wenn sie in deinem Haus besser abgeschnitten haben.

Die Kalibrierung ist kostenlos und in jedem Modus im Hauptmenü, mit denselben Reitern in Einfach und
Erweitert.

## Bevor du anfängst

- **Ein Grundriss mit Maßstab.** Ein Kalibrierpunkt ist eine in Metern gemessene Stelle, also lässt
  er sich auf einer Etage ohne Maßstab nicht speichern. Die Kalibrierung sagt dann **Diese Etage
  muss zuerst vermessen werden**, mit **Diese Etage vermessen →**.
- **Räume und Empfänger auf der Karte deines Hauses.** Zeichne die Räume, platziere die Empfänger und
  wähle dann **Auf die Karte setzen** ([Kapitel 9](09-setup-the-map.md)). Raum abgehen nutzt die
  Räume auf der Karte deines Hauses, nie die, die nur auf dem Bild gezeichnet sind.
- **Empfänger da, wo sie wirklich sind, in ihrer echten Höhe.** Die Kalibrierung zeichnet auf, was
  jeder Empfänger hört; ein Empfänger, der an der falschen Stelle eingezeichnet ist, macht jeden
  Punkt in seiner Nähe irreführend. Die Geführte Kalibrierung beginnt mit dieser Prüfung.
- **Das Handy oder der Tag, den du tragen wirst.** Es muss eins sein, das PadSpan schon hört und
  kennt: ein Handy, das du verfolgst, oder ein benannter Tag ([Kapitel 4](04-first-room.md)).
- **Ein zweiter Bildschirm hilft.** Trag das Handy so, wie du es meistens tust, in der Tasche,
  Bildschirm aus, und drück die Knöpfe auf einem anderen Handy, Tablet oder Computer. Ein Handy in der
  Hand mit eingeschaltetem Bildschirm wird anders gehört als dasselbe Handy in der Tasche.

## Wann du kalibrierst

- **Sobald die Karte steht.** Der letzte Schritt der Einrichtung, **Kalibrieren**, ist ab fünf
  Kalibrierpunkten oder einem berechneten Modell erledigt.
- **Nachdem du einen Empfänger versetzt hast.** Kalibriere die Räume daneben noch einmal: Sie hören
  jetzt anders, und ihre alten Punkte wissen das nicht.
- **Wenn ein Raum immer wieder falsch herauskommt.** **Ergebnisse** in der Kalibrierung nennt den
  Raum, den PadSpan am häufigsten falsch hat, und wie viele Punkte er noch braucht.
- **Alle paar Monate.** Möbel wandern, Empfänger auch. Ist der neueste Punkt älter als 90 Tage,
  schlägt Ergebnisse vor, noch einmal durchs Haus zu gehen.

## Wie viele Stellen

| | |
|---|---|
| **Jede Etage** | 10 bis 20 Stellen, über die Etage verteilt. Mehr ist besser. |
| **Jeder Raum** | Mindestens 3. Ein Raum mit weniger steht zuerst in der Liste, als Raum, der Arbeit braucht. |
| **Wo** | In der Mitte jedes Raums, und mehr in Türöffnungen und nahe an den Wänden zwischen Räumen. |
| **Wie lange an jeder Stelle** | **Dauer der Aufnahme**: 15, 30, 60 oder 90 Sekunden. Sie beginnt bei 15; empfohlen sind 60, etwa ein Messwert pro Sekunde von jedem Empfänger. |
| **Bevor sich die Genauigkeit berechnen lässt** | 4 Punkte oder mehr. |

Raum abgehen braucht keine Stellen: Ein Rundgang von 90 Sekunden deckt einen ganzen Raum ab.

## Zwei Wege zu kalibrieren

| | Raum abgehen | Geführte Kalibrierung |
|---|---|---|
| **Was du tust** | 90 Sekunden langsam durch jeden Raum gehen | An einer Stelle stillstehen, aufnehmen, zur nächsten gehen |
| **Zeit** | Etwa 2 Minuten pro Raum | Etwa eine Minute pro Stelle bei den empfohlenen 60 s |
| **Bei einer neuen Installation** | Aus: zuerst einschalten | An |
| **Aus der Einrichtung** | **Start →**, wo es an ist | **Punkt für Punkt**, oder **Start →**, wo Raum abgehen aus ist |

Beide speisen dieselbe Kalibrierung, und du kannst beide nutzen: Geh die Räume ab und füg dann von
Hand Stellen hinzu, wo ein Raum noch seltsam misst.

## Raum abgehen

Raum abgehen kalibriert einen ganzen Raum mit einem Rundgang von 90 Sekunden.

**Schalte es ein.** Ab Werk ist es aus. Öffne im Modus Erweitert
**Einstellungen → Ortung → Positionierung und Kalibrierung → Raum abgehen (Kalibrierung)** und hak
**Den Reiter „Raum abgehen“ zur Kalibrierung hinzufügen** an. Vom Schritt Kalibrieren der
Einrichtung bringt dich **Diese Einstellung öffnen** in beiden Modi dorthin. In der Kalibrierung
erscheint dann ein Reiter **Raum abgehen**. Er braucht den Live-Modus.

**Einen Raum abgehen:**

1. Wähle im Reiter **Beacon und Etage** das Handy oder den Tag, den du trägst (**Beacon-Gerät**),
   und die **Etage**. Bis dahin sagt Raum abgehen **Einrichtung nötig**.
2. Wähle in **Raum abgehen** den Raum unter **Raum wählen…** und wähle **Gehen starten**.
3. Geh 90 Sekunden langsam: an den Wänden entlang, in jede Ecke, dann durch die Mitte. Bleib im
   Raum, bis der Ring voll ist. **Abbrechen und verwerfen** hört früher auf.
4. PadSpan zeigt, was es gehört hat, und wie anders der Raum klingt als der nächste andere Raum:
   - **Hebt sich von … ab**: gut.
   - **Etwas ähnlich wie …**: in Ordnung, aber ein zweiter Rundgang kann helfen.
   - **Misst sich sehr ähnlich wie …**: Die beiden sind vielleicht schwer auseinanderzuhalten; geh
     näher an den Wänden und in den Ecken.
5. Wähle **Diesen Rundgang speichern?**, um ihn zu behalten, oder **Verwerfen**. Nichts wird
   gespeichert, bis du wählst.
6. PadSpan testet sich noch einmal und zeigt das Ergebnis vorher und nachher: **Die Fingerabdrücke
   haben mehr Räume richtig erkannt**, **Ungefähr wie vorher** oder **Die Fingerabdrücke haben
   weniger Räume richtig erkannt** (geh den Raum noch einmal ab oder entferne den Rundgang).
7. **Einen weiteren Raum abgehen**.

Jeder Raum behält einen Rundgang: Ein neuer Rundgang eines Raums ersetzt nur den früheren Rundgang
dieses Raums. **Den Rundgang von … entfernen** nimmt nur die Rundgang-Punkte dieses Raums heraus;
deine anderen Kalibrierpunkte werden nie angerührt. Schaltest du die Einstellung aus, verschwindet
der Reiter, und gespeicherte Rundgänge bleiben in Gebrauch.

## Geführte Kalibrierung

**🧭 Geführte Kalibrierung** führt dich der Reihe nach durch die Schritte. Öffne sie aus
**Ergebnisse**, über den Knopf oben in jedem anderen Reiter der Kalibrierung oder aus dem Schritt
Kalibrieren der Einrichtung.

1. **Positionen der Empfänger prüfen.** Freiwillig, aber einen Blick wert: Zieh jede
   Empfänger-Markierung, die nicht dort ist, wo der echte Empfänger hängt. Klick eine Markierung an,
   um ihre **Höhe über dem Boden (m)** festzulegen, und wähle **Höhe speichern**. Hier wird nichts
   aufgenommen. **Überspringen — die Positionen sehen gut aus** geht weiter.
2. **Dein Gerät wählen.** Wähle das Handy oder den Tag, den du trägst (**Beacon-Gerät**), die
   **Etage**, die du kalibrierst, und die **Dauer der Aufnahme**. Die späteren Schritte bleiben
   gesperrt, bis ein Gerät und eine Etage mit Maßstab gewählt sind.
3. **Durchs Haus gehen.** Ein blaues Fadenkreuz auf dem Grundriss markiert das **Nächste Ziel**. Geh
   dorthin, bleib stehen und wähle **Ich bin da — aufnehmen**. Bleib die ganze Zeit still stehen.
   Die Abdeckungskarte füllt sich, während du gehst (abgedeckt, teilweise abgedeckt, noch nicht
   abgedeckt), und wählt die nächste Stelle. **Überspringen — ich sammle die Punkte später** geht
   weiter.
4. **Dein Modell berechnen.** Wähle **Modell berechnen**. **Geschätzte Genauigkeit** ist, wie weit
   PadSpans Schätzung im Test im Durchschnitt danebenlag.
5. **Abschluss.** Wie viele Punkte diese Etage und das ganze Haus haben. **+ Eine weitere Etage
   kalibrieren** geht zurück zu Schritt 2 für die nächste Etage; **Fertig** schließt die Anleitung.

**✕ Anleitung beenden → alle Reiter** verlässt sie jederzeit und behält jeden Punkt, den du
gespeichert hast.

### Die Stellen selbst wählen: Pinnen & Hören

Tipp im Reiter **Pinnen & Hören** auf den Grundriss, wo du stehst, wähle **Aufnahme starten** und
bleib still stehen, bis die Zeit um ist. Dann behält **Punkt speichern** ihn, oder **Verwerfen**.
**Stoppen und verwerfen** bricht eine Aufnahme ab. **Umhergehen** ist dasselbe Aufnehmen, nur wählt
PadSpan die Stelle, wie in Schritt 3 der Anleitung.

Sagt der Bildschirm **Beacon wird gerade von keinem Empfänger erkannt**, wird das Handy oder der Tag
nicht gehört: Prüf, dass sein Bluetooth an ist und es in der Nähe eines Empfängers ist.

## Beacon-Abgleich

**Beacon-Abgleich** (experimentell) ist für Bluetooth-Beacons, die an einem Ort bleiben: ein Tag auf
einem Regal, ein Schlüsselfinder an der Tür, ein fest angebrachter iBeacon. Du markierst, wo jeder
wirklich ist, und PadSpan lernt weiter von ihm, solange er dort liegt.

1. Wähle die Etage, wähle den Beacon unter **Beacon zum Hinzufügen wählen** (Geräte, die du benannt
   hast oder denen du folgst) und wähle **Zur Karte hinzufügen**.
2. Zieh ihn dahin, wo der Beacon wirklich ist, und wähle **Speichern**.
3. Lass den Beacon, wo er ist, während der folgenden Aufnahme von 60 Sekunden. Sie wird als
   Kalibrierpunkt gespeichert.

Ein Beacon, den du platzierst, ist nur gepinnt, wenn du in seiner Zeile **Hier pinnen: bewegt sich
nie** anhakst. Ein gepinnter Beacon wird in seinem gepinnten Raum angezeigt, statt dass sein Raum
berechnet wird, also pinne nur einen, der sich nie bewegt. Ein Gerät, von dem PadSpan weiß, dass es
sich bewegt (ein Handy mit seinem Schlüssel, ein Tag, dem du folgst), wird nie gepinnt, auch
angehakt nicht. Jeder Beacon, den du platzierst, bekommt die eine Aufnahme und geht dann zurück zur
Live-Ortung.

Mit **Auto-Kal.: AN** (der Standard) fügt ein gepinnter Beacon, der still liegt, ab und zu einen
frischen Kalibrierpunkt hinzu, höchstens einmal alle 10 Minuten und 50 Punkte pro Beacon; sie sind
im Reiter Modell mit [auto] markiert.

Versetzt du einen Beacon, beginnt eine neue Aufnahme. Versetzt du denselben Beacon dreimal in
wenigen Minuten, fragt PadSpan nach einer „harten Verlegung“: **OK** löscht die früheren Punkte
dieses Beacons aus dem Beacon-Abgleich. Wähle OK nur, wenn die alten Stellen falsch waren.

## Ergebnisse lesen

Die Kalibrierung öffnet mit **Ergebnisse**. Dieser Reiter liest nur deine Kalibrierung; jeder Knopf
bringt dich zu dem Reiter, der die Arbeit macht.

**Wie genau es jetzt ist**

- **Räume richtig**: der Anteil der Teststellen, die PadSpan in den richtigen Raum gesetzt hat.
- **typische Abweichung**: wie weit es meist danebenlag, in Metern (grün unter 2 m).

Beides kommt aus einem strengen Test an Stellen, die es nicht gesehen hat: PadSpan versteckt eine
Stelle und jeden Punkt im Umkreis von 1,5 m und prüft dann, wohin es jemanden gesetzt hätte, der
dort steht. Die Zeile darunter gibt den Test für beide Arten an, wie PadSpan jemanden verorten kann
(aus deinen Kalibrierpunkten und aus den Plätzen der Empfänger), und sagt, welche besser war. Bevor
dieser Test gelaufen ist, siehst du stattdessen **geschätzte Abweichung**, die besser aussieht als
die Wirklichkeit. Mit weniger als 4 Punkten gibt es noch nichts zu berechnen.

**Was du als Nächstes am besten tust** ist ein Vorschlag, der erste, der zutrifft:

1. **Miss eine Strecke auf einem Grundriss**: ein Grundriss ohne Maßstab.
2. **Das Haus kalibrieren**: noch keine Punkte.
3. **Gib an, wie hoch jeder Empfänger hängt**: Sie hängen alle auf einer Höhe.
4. **Gib deinen Etagen ihre echten Höhen**: Jede Etage hat die Standardhöhe.
5. **Die Genauigkeit neu ermitteln**: Es gibt Punkte, die in den Zahlen noch fehlen (**Modell
   öffnen →**, dann **Modell berechnen**).
6. **Kalibrierpunkte in … hinzufügen**: ein gezeichneter Raum ohne Punkte.
7. **Ein paar Punkte in … hinzufügen**: der Raum, den PadSpan am häufigsten verwechselt („meist mit
   …“), oder einer mit nur wenigen Punkten.
8. **Noch einmal durchs Haus gehen**: Der neueste Punkt ist älter als 90 Tage.
9. **Nichts Dringendes**: Schau in Genauigkeit je Stelle, wenn sich ein Raum noch falsch anfühlt.

**Raum für Raum** listet zuerst die Räume, die Arbeit brauchen: noch keine Punkte, weniger als 3 oder
unter 70 % richtig, jeweils mit dem Raum, mit dem er am häufigsten verwechselt wird (**verwechselt
mit …**). Räume, die gut aussehen, klappen sich unter einer Zeile zusammen.

Ein Raum kann einen höheren Prozentwert zeigen als die Hauptzahl. Die Zahl jedes Raums kommt aus
einer älteren, gnädigeren Wertung, die nahe Punkte drin lässt, wenn sie eine Stelle testet. Vertrau
der Hauptzahl.

## Der Reiter Modell

- **Modell berechnen** ermittelt die Genauigkeit aus deinen Punkten neu (4 oder mehr). Mach das,
  nachdem du Punkte hinzugefügt hast.
- Der Abschnitt Übersicht zeigt deine Punkte, Empfänger und Etagen und die **Geschätzte
  Genauigkeit** (grün unter 2 m). Sie ist eine Entfernung, kein Prozentwert, und sie sieht besser
  aus als die Wirklichkeit.
- **Genauigkeit je Raum**, jeweils mit dem Raum, mit dem er am häufigsten verwechselt wird
  (**Verwechselt mit**).
- **Abdeckung je Empfänger**: wie stark jeder Empfänger deine Punkte hört.
- Jeder Kalibrierpunkt, jeder mit seinem eigenen Löschen.
- **JSON exportieren** speichert alle deine Punkte in eine Datei. **Importieren** liest eine wieder
  ein und überspringt Punkte, die du schon hast. **Alles löschen** löscht nach einer weiteren
  Bestätigung jeden Punkt im Haus. Das lässt sich nicht rückgängig machen: Exportier vorher.

## Genauigkeit je Stelle

**Genauigkeit je Stelle** ist eine Tabelle: eine Zeile pro Kalibrierpunkt, eine Spalte pro
Empfänger. Jede Zelle vergleicht, wie weit der Punkt wirklich von diesem Empfänger entfernt ist, mit
der Entfernung, die das Signal des Empfängers angibt. Fahr mit der Maus über eine Zelle, um die
Zahlen zu sehen.

- **Grün**: Sie stimmen überein.
- **Blau**: Das Signal lässt den Punkt weiter weg erscheinen, als er ist. **Rot**: näher.
- **Grau**: Dieser Empfänger hat den Punkt nie gehört.

Eine Spalte, die ganz nach unten blau oder rot ist, heißt meist, dass Position oder Höhe dieses
Empfängers nicht stimmt: Korrigier sie im Reiter **Feinabgleich**. Eine Zeile, die überall
danebenliegt, ist meist ein Punkt, der an der falschen Stelle gespeichert wurde: Lösch ihn im Reiter
Modell und nimm ihn neu auf. **Neu lernen (Modell neu berechnen)** berechnet das Modell neu, genau
wie Modell berechnen; es löscht nichts.

Dafür braucht es die Signalkurve jedes Empfängers, also nimm erst ein paar Punkte auf und wähle
**Modell berechnen**. Räume, die in der Live-Ortung immer wieder wechseln, sind etwas anderes: siehe
**Zustand → Verwechselte Räume** ([Kapitel 12](12-the-screens.md)).

## Die Signale sagen, dieser Empfänger ist in einem anderen Raum

Jeder Kalibrierpunkt enthält den Raum, in dem du ihn aufgenommen hast, und was jeder Empfänger dort
gehört hat. Ein Empfänger hört die Stellen am besten, die ihm am nächsten sind. Wenn also die
meisten Stellen, die ein Empfänger am besten hört, in ein und demselben anderen Raum liegen, ist sein
Home-Assistant-Bereich wahrscheinlich falsch.

Sobald du Kalibrierpunkte hast, sagt das der Schritt **Empfänger platzieren und ihre Höhen
festlegen** der Einrichtung:

> Die Signale sagen: Küchen-Proxy gehört zu Esszimmer, nicht zu Küche. 4 der 5 Kalibrierpunkte, die
> er am besten hört, liegen dort.

- **Esszimmer übernehmen** gibt dem Gerät des Empfängers diesen Bereich in Home Assistant, genau wie
  **Empfängerliste ansehen → Zuweisen** in der Übersicht.
- **Küche behalten** lässt ihn, und der Vorschlag erscheint erst wieder, wenn die Seite neu geladen
  wird.

PadSpan schlägt das nur vor, wenn es ziemlich sicher ist: Der Empfänger hat mindestens 3 Punkte
gehört, mindestens 60 % der 5, die er am besten hört (von allen, die er gehört hat, wenn es weniger
sind), liegen in diesem einen anderen Raum, dieser Raum ist einer deiner Home-Assistant-Bereiche,
und der eigene Raum des Empfängers hat mindestens 2 eigene Punkte. Ein Empfänger, der als verloren
oder deaktiviert markiert ist, bleibt außen vor. Einen Empfänger in einem Raum, den niemand
kalibriert hat, kann PadSpan nicht vom Nachbarraum unterscheiden, also kalibriere zuerst jeden Raum.

## Tipps

- Trag das Handy so, wie du es immer tust. Ein Handy in der Tasche und dasselbe Handy in der Hand
  klingen verschieden.
- Einen Empfänger versetzt? Kalibriere die Räume daneben noch einmal.
- Bleib während der ganzen Aufnahme still stehen.
- Mehr Punkte in Türöffnungen und nahe an den Wänden zwischen Räumen.
- Ein Handy, das nach dem Kalibrieren immer noch zwischen Räumen springt: siehe
  [Kapitel 26](26-troubleshooting.md) und
  [Warum springt mein Handy zwischen den Räumen?](https://padspan.traks.ca/guides/room-flapping/)

**Für Experten:** **Einstellungen → Ortung → Positionierung und Kalibrierung** hat das
**Positionierungsverfahren** („An Kalibrierpunkten abgeglichen“, der Standard, oder „Gelerntes
Modell (experimentell)“), **Die bessere Methode für dieses Haus wählen** (ab Werk aus: nimmt von
Kartenposition und Kalibrierabgleich das, was an Kalibrierstellen, die es nicht kannte, besser
abgeschnitten hat), **Adaptives Lernen**, das aus Räumen lernt, bei denen PadSpan schon sicher
ist, und **Erinnerungen zur Kalibriergenauigkeit**. Jede Einstellung dort steht in
[Kapitel 20](20-settings-reference.md).
