# 17. Furnish

[Inhalt](README.md)

Furnish stellt Möbel, Geräte und Personen in Live Aboard, das 3D-Haus
([Kapitel 16](16-live-aboard.md)). Es braucht PadSpan Pro und eingeschaltetes Live Aboard, und es
steht unter **Karten → Einrichten**: Der Reiter erscheint neben dem Atlas-Editor, sobald Live Aboard
an ist, im Modus Erweitert. Wie in Edit wird nichts gespeichert, bis du **Save** drückst, und
**Undo** geht Schritt für Schritt durch alles zurück.

## Ein Stück hinzufügen

**Build ▾** fügt ein Möbelstück oder ein Gerät hinzu: ein Sofa, ein Bett, einen Tisch, eine Lampe,
einen Fernseher, eine Treppe und mehr, oder eine einfache **Box**. Jede Art hat ihre eigenen
Schieberegler (die Sitze und Armlehnen eines Sofas, die Größe eines Betts, die Form eines Tischs).
Es sind einfache Formen im Geist der Sims, keine Scans.

Die anderen Wege:

- **From a photo**: Fotografier ein echtes Stück, und PadSpan baut ein passendes. Dafür brauchst du
  Home Assistant 2025.8 oder neuer mit einem **AI Task**, der Bilder lesen kann, gewählt unter
  **Einstellungen → KI**, wo sich **Furniture from a photo** auch ausschalten lässt
  ([Kapitel 19](19-ai-features.md)). Mit einem AI Task in der Cloud verlässt das Foto dein Haus, um
  gelesen zu werden; gespeichert wird es nie. Es fragt nach einem echten Maß, außer auf dem Foto ist
  etwas mit bekannter Größe (eine Tür, ein Maßband). Ergibt die Antwort keinen Sinn, bekommst du
  eine Box, nie einen Fehler.
- **Library**: Möbel, die andere PadSpan-Häuser geteilt haben. Schalte dafür zuerst
  **Shared library** in den Einstellungen von Live Aboard ein und nimm ihre Bedingungen an. Ist sie
  aus, nimmt Live Aboard nie Kontakt mit der Bibliothek auf.
- **Import**: Türen, Fenster und Möbel aus einer Sweet-Home-3D-Datei (`.sh3d`), oder, mit
  eingeschaltetem RoomPlan-Import (**Einstellungen → Funktionen**), aus dem Raumscan eines Handys
  (`.usdz` oder `.json`). Jede Tür und jedes Fenster kommt an die nächste Wand; eines ohne Wand in
  der Nähe wird weggelassen und gezählt. Du siehst sie zuerst und wählst, was du behältst.
- **People & devices**: siehe unten.

## Küchen und Bäder

**Build ▾** hat eine Überschrift **Kitchen** und eine **Bathroom**:

- **Kitchen**: Unterschränke (Türen, Schubladen oder eine Schublade über Türen), Hängeschränke,
  Hochschränke (mit einem Backofen, oder einem Backofen und einer Mikrowelle), eine Spüle mit einem
  oder zwei Becken, ein Kochfeld oder ein Herd, ein Geschirrspüler und ein Kühlschrank. Jeder
  Unterschrank hat seine eigene Arbeitsplatte, so wirkt eine Reihe davon wie eine.
- **Bathroom**: eine Toilette, ein Waschbecken (auf einem Unterschrank, einer Säule oder an der
  Wand), eine Badewanne und eine Dusche.
- Die **Height** einer Spüle oder eines Waschbeckens reicht bis oben an den Wasserhahn: Eine 1,2 m
  hohe Spüle hat ihre Arbeitsplatte auf 0,9 m, auf einer Höhe mit den Schränken daneben, und passt
  unter eine Fensterbank, die so hoch liegt wie ihre Arbeitsplatte.
- Um einen Hängeschrank aufzuhängen, stell seine **Height in room** auf 1,45 m (die übliche Höhe
  über einer Arbeitsplatte auf 0,9 m) und zieh ihn an die Wand, oder nimm **Hang on wall**.

## Raumsets

**Build ▾ → Room sets** möbliert einen ganzen Raum mit einem Tipp: **Kitchen, one wall**,
**Kitchen, L-shaped**, **Bathroom**, **Bedroom**, **Living room**, **Dining room** oder **Office**.

- Dreh die Ansicht so, dass der Raum in der Mitte ist, und wähl dann ein Set.
- Die Stücke kommen an die Wände, mit dem Rücken zur Wand, weichen Türen, Fenstern und allem aus,
  was schon dort steht, und bleiben immer im Raum. PadSpan probiert jede Wand und behält die, an die
  am meisten passt.
- In einer Küche hängen die Hängeschränke über den Unterschränken, und die Spüle kommt unter ein
  Fenster.
- Ein Stück, für das kein Platz ist, wird weggelassen, und die Meldung sagt, wie viele.
- Es ist ein erster Wurf zum Anpassen. Ein **Undo** nimmt das ganze Set wieder weg.

## Ein Stück bewegen und einstellen

- **Zieh** ein Stück über den Boden. Sein Rücken rastet an den Wänden ein, und zwei kurze Linien
  zeigen, wie weit es von den nächsten Wänden entfernt ist.
- **Pfeiltasten** schieben es um 1 cm (Shift: 10 cm); **[** und **]** drehen es um 15° (Shift: 1°).
- Sein Feld hat seine Beschriftung, seine Größe, die Einstellungen seiner Art, Farben, **Turn**,
  **Floor ▲ / ▼**, **Height in room**, genaue **X, Y, Height and Angle**, **Duplicate** und
  **Delete**. **Stand on what's under it** stellt eine Lampe auf ihren Tisch; **Hang on wall** hängt
  es in einer Höhe, die du wählst, an die Wand.
- Warnungen sagen dir, wenn ein Stück nicht passt (durch eine Wand, über den Boden hinaus).

## Treppen

**Build ▾ → House → Stairs**: in welche Richtung sie abbiegen und zu welcher Etage sie hinaufführen.
Ihre Höhe ist der Abstand bis zu dieser Etage, und sie öffnen ein Loch darin.

- **Shape**: Straight, L, U, **2 landings** oder **3 landings** (um ein offenes Treppenauge).
- **Style**: **Closed** (massive Stufen), **Open** (Trittstufen auf einer Wange an jeder Seite),
  **Treads only** (als wären sie in der Wand befestigt) oder **Floating** (Trittstufen auf einem
  einzigen Stahlholm).
- **Rail**: **None**, bis du **Both**, **Inside** oder **Outside** wählst. **Rail style**:
  **Balustrade**, **Topless** oder **Single bar**.
- **Stairs in stair rooms** (zu sehen, wenn es welche gibt): ein erster Vorschlag für jeden Raum
  namens Stairs, Stairwell oder Staircase, der noch keine Treppe und eine Etage darüber hat, in der
  Größe des Raums.
- **Read stairs off the plans (AI)** (mit eingeschaltetem **AI map-building research (experimental)**
  und **Stairs from your floor plans** unter **Einstellungen → KI** und einem gewählten AI Task):
  Deine KI sucht auf jedem Grundriss nach Treppen und fügt hinzu, was sie findet, ungespeichert. Es
  ist ein erster Vorschlag: Prüf jede einzelne. Ein Grundriss geht nur dann an deine KI, wenn du
  darauf drückst.
- **From a file**: Import holt eine Treppe aus Sweet Home 3D als Treppe herein, und die Treppen
  eines RoomPlan-Scans auch.

## Ein Stück, das ein echtes Gerät ist

**This is a device…** verknüpft ein Stück mit einer Entität in Home Assistant, und es verhält sich
wie sie: Eine Lampe leuchtet in der Farbe ihres Lichts, ein Fernseher leuchtet auf, während er
abspielt, die Flügel eines Ventilators drehen sich, eine Waschmaschine wackelt, während sie läuft,
ein Saugroboter verlässt seine Station, während er arbeitet, ein Heizkörper glüht, während er heizt.
Wird die Entität umbenannt, folgt ihr das Stück; wird sie gelöscht, zeigt das Stück **Unlinked** und
bleibt, wo es ist.

## Personen

**People & devices** zeigt jede Person aus Home Assistant im Haus:

- **Eine Figur**, gemacht mit Schiebereglern (Größe, Statur, Haare, Farben), oder aus einem Foto
  (**From a photo**). Eine Figur besteht aus ein paar einfachen Formen, nie aus einem Abbild. Der Weg
  über ein Foto fragt zuerst, ob die Person einverstanden ist, und schickt nichts, bis das angehakt
  ist. Er empfiehlt einen lokalen AI Task.
- **Carries**: welche Handys und Tags jede Person trägt, aus dem, was PadSpan verfolgt. Sie setzen
  die Person in Live Aboard und auf den Atlas.
- Personen werden nie geteilt: Figuren liegen nur in der 3D-Datei dieses Hauses. Löschst du eine
  Person in Home Assistant, verschwindet ihre Figur mit ihr.

**Show people** und **Show tags & scanners**, in den Einstellungen oder in **Views ▾** von Live
Aboard, blenden sie ein oder aus.

## Ein Stück teilen

**Share…** teilt ein Stück, das du gebaut hast, in die Bibliothek: nur seine Form, Größen, Farben und
die Angaben, die du ausfüllst, nie ein Foto oder irgendetwas über dein Haus. Ein Titel mit einer
E-Mail-Adresse, Telefonnummer, Anschrift oder einem Link wird abgelehnt. Du kannst eine Freigabe
später zurückziehen.

## Alles ausräumen

**Einstellungen → Atlas → Live Aboard** hat **Remove all furniture…** (Administratoren). Vorher wird
ein Backup angelegt; um die Möbel zurückzuholen, stellst du dieses Backup wieder her
([Kapitel 22](22-backup-restore-moving.md)).
