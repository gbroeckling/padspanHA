# 10. Wände und Signalverlust

[Inhalt](README.md)

Eine Wand schluckt einen Teil des Bluetooth-Signals auf seinem Weg von einem Handy oder Tag zu einem
Empfänger. Wände, die du auf der Karte zeichnest, sagen PadSpan, wie viel. Das verhindert, dass ein
Handy in der Küche im Raum hinter der Küchenwand gezählt wird, und hält die Handys der Nachbarn aus
deinem Wohnzimmer.

Du brauchst nicht jede Wand. Zeichne die zwischen Räumen, die verwechselt werden, und die
Außenwände, wenn Handys der Nachbarn drinnen auftauchen. Wände brauchen eine Karte mit Maßstab
([Kapitel 9](09-setup-the-map.md)), weil sie in Metern gespeichert werden.

## Eine Wand zeichnen

1. Öffne **Karten → Bearbeiten** und wähle das Werkzeug **Signalwände**.
2. Wähle das **Material** (unten). Gib der nächsten Wand einen Namen, wenn du willst.
3. Klick auf die Karte, um die Wand zu beginnen, klick an jeder Ecke und schließ sie ab. Sie wird in
   dem Moment gespeichert, in dem du fertig bist. **Punkt zurück** nimmt den letzten Klick zurück;
   **Zeichnen abbrechen** verwirft sie.

Jede Wand, die du zeichnest, bekommt das gewählte Material, bis du es änderst. Die Liste beginnt mit
**Metall**, dem stärksten, also wähle zuerst das Material.

**Umschließen (3-dB-Wände)** zeichnet in einem Zug dünne 3-dB-Wände rund um den gewählten Raum: gut
für gewöhnliche Innenwände.

## Die Materialien

Jedes Material ist eine Zahl, in dB: mehr dB, mehr Signal geht beim Durchgang verloren.

| Material | Verlust | Wofür |
|---|---|---|
| **Offen (Galerie) — keine Wand** | 0 dB | Keine Wand: eine Öffnung zur Etage darüber oder darunter, oder eine Raumkante, an der keine Wand ist. |
| **Ziegel** | 4 dB | Eine einschalige Wand aus Ziegeln oder Mauersteinen. |
| **Eigene** | 6 dB, oder was du einstellst | Alles andere. Eine Wand ohne Material zählt als Eigene mit 6 dB. |
| **Beton** | 8 dB | Gegossener Beton, Fundamentwände. |
| **Metall** | 12 dB | Stahltüren, Metallständer, alukaschierte Dämmung, Putz auf Drahtgeflecht. |

Wähle **Eigene**, und ein Feld **Dämpfung** erscheint (0 bis 30 dB). Stell es ein, bevor du
zeichnest.

Das sind runde Startwerte, keine Messungen deines Hauses. Sie sind absichtlich eher sanft: Bluetooth
kommt durch Türöffnungen, Spalten und Decken um viele Wände herum, also ist der Verlust, den PadSpan
sieht, meist kleiner, als die Wand allein kosten würde.

**Etagen sind anders.** Jede Etage zwischen zwei Orten beginnt mit 10 dB, und PadSpan lernt den
echten Wert für jedes Etagenpaar aus deinen eigenen Daten, sobald es genug davon hat. Wände werden
nicht gelernt: Es gilt die Zahl, die du wählst.

## Kommt mein Haus da ungefähr hin?

Werte, die oft für die WLAN-Planung bei 2,4 GHz genannt werden, dem Band, das Bluetooth nutzt, geben
ein Gefühl dafür. Sie schwanken stark mit der Dicke, der Feuchtigkeit und dem, was in der Wand
steckt.

| Echte Wand | Etwa |
|---|---|
| Gipskarton auf Holzständern | 2–4 dB |
| Holztür, gewöhnliches Fenster | 2–4 dB |
| Ziegel, einschalig | 6–10 dB |
| Betonstein | 6–12 dB |
| Gegossener Beton, Naturstein | 10–20 dB oder mehr |
| Alter Putz auf Putzträger aus Draht (Metall) | 10–20 dB, manchmal viel mehr |
| Low-E- oder beschichtetes Fensterglas | 10–30 dB |
| Metall: Stahltüren, Alu-Dämmung, ein Kühlschrank, Lüftungskanäle | 15–30 dB oder mehr |

Alte Häuser erwischen einen gleich zweimal:

- **Putz auf Latten.** Holzlatten machen wenig aus. Streckmetall als Putzträger (verbreitet ab den
  1920er-Jahren, und bei Reparaturen) wirkt wie ein Schirm. Steht eine solche Wand zwischen zwei
  Räumen, die immer wieder Geräte tauschen, zeichne sie als **Metall** oder als **Eigene** mit 12
  bis 20 dB.
- **Dickes Mauerwerk.** Eine massive Stein- oder doppelte Ziegelwand liegt näher an **Beton** oder
  Eigene mit 10 bis 15 als an Ziegel.

## Offene Kanten: Räume ohne Wand dazwischen

Eine Galerie, oder Küche und Wohnzimmer als ein offener Raum: Das Signal geht schon dort durch, wo
keine Wand gezeichnet ist, aber wenn du die Kante als offen markierst, steht das auf der Karte, und
das 3D-Haus lässt dort die Wand weg.

- **Offene Kante: Raumkante antippen**: Tipp auf der Karte die Kante eines Raums an. Nur das Stück,
  das er mit dem Nachbarraum teilt, wird geöffnet; eine Kante ohne Nachbarn öffnet sich ganz.
- **Alle Kanten öffnen** gibt jeder Kante des gewählten Raums eine Wand Offen (0 dB). Es fragt
  vorher.
- **Offene Kanten entfernen** nimmt die offenen Kanten zurück, die dieses Werkzeug entlang des Raums
  markiert hat.

Die Kanten eines Raums lassen sich markieren, sobald sein Umriss gespeichert ist. In Live Aboard
kann eine offene Kante ein Glasgeländer haben oder keins: der Knopf **Geländer** in ihrer Zeile
([Kapitel 16](16-live-aboard.md)).

## Türen und Fenster, die aufgehen

Eine Stahltür blockiert das Signal, wenn sie zu ist, und gar nicht, wenn sie offen ist. PadSpan kann
dem mit dem eigenen Sensor der Tür folgen.

1. Wähle in der Zeile einer Wand **Tür** (**Tür/Fenster auf dieser Wand markieren**).
2. Klick die beiden Enden der Tür auf der Wand an. **Neu wählen** fängt von vorn an.
3. Wähle unter **Verknüpfter Sensor** einen Tür- oder Fenstersensor aus Home Assistant und unter
   **Material von Tür/Fenster** ihr Material (am Anfang das der Wand).
4. Wähle **Tür/Fenster anlegen**.

Eine Tür oder ein Fenster aus **Metall** verliert die 12 dB, solange der Sensor offen meldet, und
bekommt sie zurück, wenn er zu meldet. PadSpan wartet zwei Messungen hintereinander ab, bevor es
wechselt, damit ein flackernder Sensor keine Räume springen lässt. Eine Tür aus einem anderen
Material wird auf den Karten offen oder zu gezeigt und ändert nichts am Signal: Gewöhnliche Türen und
Glas blockieren Bluetooth so oder so kaum.

## Ein Empfänger, der die Nachbarn hört

Wände helfen nur, wenn sie zwischen dem Handy und dem Empfänger sind. Ein Empfänger an einer
Außenwand oder auf einer Etage über einem Laden oder einer Wohnung hört auch die Straße und die
Leute unten. Für diesen einen Empfänger ignoriert **Bluetooth → Scanner → Mindestsignal**
(**Mindestsignal: aus**, wenn du nichts einstellst) alles, was er schwächer hört als die Stufe, die
du wählst, etwa **Ignorieren unter -90** an einer Außenwand oder **Ignorieren unter -80** neben
einer Haustür.

- Die Ortung und die Handyzählung von **Belegung** nutzen diese schwachen Messwerte von diesem
  Empfänger nicht mehr.
- Alles andere sieht sie weiter: die Listen der Empfänger und Advertisements, Forensik, Traceback
  und die Kalibrierung.
- Ein Handy im Raum misst bei seinem nächsten Empfänger weit stärker, also geht es nicht verloren.

## Woran du erkennst, dass eine Wand falsch ist

- **Ein Handy oder Tag klebt am Raum auf der anderen Seite einer Wand**: Die Wand ist auf der Karte
  schwächer als in Wirklichkeit. Geh eine Stufe hoch (Ziegel, dann Beton, dann Metall), oder nimm
  Eigene mit einer größeren Zahl.
- **Ein Gerät in einem Raum scheint den Empfänger direkt daneben nicht zu hören**: Vielleicht ist
  zwischen ihnen eine Wand gezeichnet, die dort nicht hingehört, oder eine viel zu starke.
- **Die Kalibrierung hilft in beiden Fällen.** Sie passt an, wie schnell das Signal in deinem Haus
  nachlässt, und fängt damit viel von dem auf, was die Wände nicht richtig treffen:
  [Kapitel 11](11-calibration.md).
