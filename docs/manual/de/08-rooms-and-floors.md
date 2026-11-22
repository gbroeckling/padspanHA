# 8. Räume und Etagen kommen aus Home Assistant

[Inhalt](README.md)

PadSpan hat keine eigene Raumliste. Seine Räume sind deine **Bereiche** in Home Assistant, und seine
Etagen sind deine **Etagen** in Home Assistant. Du legst sie in Home Assistant an, benennst sie um
und entfernst sie dort, und PadSpan folgt. Was PadSpan für jeden Raum speichert, ist das, wofür Home
Assistant keinen Platz hat: seinen Umriss auf dem Grundriss, seine Farbe, seine Deckenhöhe und
dergleichen.

## Räume sind Bereiche

- **Der Raum eines Empfängers** ist der Bereich seines Geräts in Home Assistant. Ein Empfänger ohne
  Bereich ergibt keinen Raum, egal wie gut er dich hört
  ([Kapitel 5](05-receivers.md#raum-platz-und-höhe-eines-empfängers)).
- **Der Raum eines Geräts** ist der Raum des Empfängers, der es am besten hört, oder, mit drei oder
  mehr Empfängern auf einem Grundriss, der Bereich, in dessen Umriss es ist.
- **Der Raum, den PadSpan an Home Assistant meldet** (der Zustand eines Trackers, ein
  Bereichssensor), ist der Name des Bereichs, so geschrieben, wie Home Assistant ihn hat: „Küche“,
  nicht „küche“.

Für Räume braucht also jeder Raum, den du unterscheiden willst, einen Bereich in Home Assistant und
darin einen Empfänger mit diesem Bereich. Ein Raum, den du nur auf der Karte haben willst (ein
Abstellraum, ein Flur), braucht einen Bereich und einen Umriss, aber keinen Empfänger.

**Bereiche anlegen** in Home Assistant: **Einstellungen → Bereiche, Labels & Zonen**. Hat Home
Assistant noch keine Bereiche, sagt die Karte **Wer ist wo** in der Übersicht das.

**Einen aus PadSpan anlegen.** Zeichnest du Räume in **Karten → Bearbeiten** und hat die Etage des
Grundrisses keinen Bereich mehr zur Auswahl, sagt PadSpan: „Für diese Etage gibt es noch keinen Raum
zur Auswahl: Räume sind die Bereiche von Home Assistant.“ Gib einen Namen ein und wähle
**Zu Home Assistant hinzufügen**: Home Assistant bekommt einen Bereich mit diesem Namen, auf der
Etage des Grundrisses. Ein Name, der schon ein Bereich ist, wird verwendet, nie doppelt angelegt.
Der Raum-Helfer, mit dem Claude zeichnen kann ([Kapitel 19](19-ai-features.md)), bietet dasselbe an.

## Etagen sind Etagen in Home Assistant

Gib jedem Bereich in Home Assistant seine Etage (das Feld **Etage** eines Bereichs, unter
**Einstellungen → Bereiche, Labels & Zonen**). PadSpan liest die Etagen und stapelt sie von unten
nach oben:

1. nach der **Ebene** jeder Etage in Home Assistant, wenn sie eine hat;
2. sonst nach ihrem Namen: „basement“ und „cellar“ kommen nach unten, „ground“, „main“ und „first
   floor“ auf Bodenhöhe, „outdoors“ ebenfalls auf Bodenhöhe;
3. sonst über die benannten, in der Reihenfolge, in der sie angelegt wurden.

Setz in Home Assistant auf jeder Etage eine Ebene, und die Reihenfolge ist nie geraten. Die
Reihenfolge zählt nicht nur fürs Bild: Ein Signal, das durch eine Decke geht, verliert an Stärke,
und PadSpan zählt die Etagen dazwischen anhand dieser Reihenfolge.

**Wie weit die Etagen auseinanderliegen**, gehört PadSpan, nicht Home Assistant: der Schritt
**Etagen und ihre Höhen** der Einrichtung ([Kapitel 9](09-setup-the-map.md#schritt-4-etagen-und-ihre-höhen)). Ein
Abgleich mit Home Assistant überschreibt sie nie.

**Draußen.** Eine Etage namens Outside, Outdoor, Outdoors, Exterior, Garden oder Yard gilt als
Außenetage: auf Bodenhöhe und in der 3D-Ansicht gezeichnet. Die flache Karte zeigt keine Räume
darauf.

**Ein Bereich ohne Etage** wird auf jedem Grundriss angeboten, und der Bildschirm **Räume** sagt
**No floor set in Home Assistant**.

Ein Haus mit einer Etage und ohne Etagen in Home Assistant funktioniert so, wie es ist: Alles ist auf
einer Etage.

## Der Bildschirm Räume

**Räume** im Menü listet jeden Raum mit dem, was PadSpan für ihn speichert. Die Namen und Etagen
sind hier nur zu lesen; **Rename in Home Assistant** und **Add a room in Home Assistant** öffnen die
eigenen Seiten von Home Assistant. Die Zeile jedes Raums hat seinen Namen und seine Etage, seine
Farbe (**Room colour, on every map**) und:

| Feld | Was es ist |
|---|---|
| **Outline** | **Drawn** oder **Not drawn**. **Draw outline** oder **Edit outline** öffnet den Umriss auf seinem Grundriss in Karten. |
| **Ceiling height (m)** | 1,5 bis 30 m, oder leer für die Höhe der Etage. **Save height**. |
| **Split level (m up or down)** | Für einen Raum ein paar Stufen höher oder tiefer: bis 3 m höher, 1,5 m tiefer, oder leer für gleiche Höhe mit seiner Etage. |
| **Kind of space** | Für einen Raum auf einer Etage des Hauses: drinnen, oder eine überdachte oder offene Terrasse. **Work it out** errät es aus dem Haus. |
| **Surface** | Für einen Raum draußen: was die 3D-Ansicht auf seinem Boden zeichnet. |
| **Receivers** | Die Empfänger darin. **See receivers** öffnet den Bildschirm Empfänger. |
| **In it now** | Wer gerade darin ist, oder **Nobody**. |
| **Lights** | Die Lichter darin, so wie der Atlas sie zählt. |

Farbe, Deckenhöhe und Split level werden sofort gespeichert. Ein auf einem Grundriss gezeichneter
Umriss kommt erst dann auf die Karte des Hauses, wenn du **Auf die Karte setzen** wählst
([Kapitel 9](09-setup-the-map.md#abschluss-auf-die-karte-setzen)), nie von selbst.

## Umbenennen und entfernen

PadSpan kennt einen Raum an seinem Namen.

- **Ein Raum, der kein Bereich mehr ist**, etwa einer, den du in Home Assistant umbenannt oder
  entfernt hast, erscheint auf dem Bildschirm Räume als **PadSpan only, not a Home Assistant area**,
  und sein Umriss bleibt erhalten. Zeichne nach einem Umbenennen den Umriss für den neuen Namen noch
  einmal und entferne den alten in **Karten → Bearbeiten**.
- **Ein Empfänger, der in einen anderen Raum gekommen ist**: Ändere den Bereich seines Geräts in
  Home Assistant, oder in PadSpan mit **Raum festlegen** auf der Karte **Wer ist wo** der Übersicht.
- **Einen Bereich, den du nicht willst**, kannst du in Home Assistant entfernen, oder mit **Delete**
  auf PadSpans Bildschirm **Verwalten**, der zweimal nachfragt. Das löscht ihn aus Home Assistant
  selbst, nicht nur aus PadSpan: Jedes Gerät und jede Entität darin steht danach ohne Bereich da.

## Was PadSpan liest und nie ändert

PadSpan liest die Bereiche, die Etagen und das Geräteverzeichnis von Home Assistant. Es ändert sie
nur, wenn du dafür einen Knopf drückst, einen nach dem anderen: **Raum festlegen** oder **Zuweisen**
für einen Empfänger, den Raum eines Lichts, **Zu Home Assistant hinzufügen** für einen neuen
Bereich, **Delete** für einen Bereich unter **Verwalten**. Die vollständige Liste steht im README
unter [What PadSpan never touches](../../../README.md#what-padspan-never-touches).
