# 22. Sichern, wiederherstellen, auf Werkseinstellungen zurücksetzen, auf ein neues Home Assistant umziehen

[Inhalt](README.md)

PadSpan hält zwei Arten von Kopien deines Hauses, und sie haben verschiedene Aufgaben.

- **PadSpans eigene Backups** (Verwalten → Data → Backup & Restore) sind zum Zurückgehen: vor einer
  großen Änderung oder nach einer, die schiefgegangen ist. Sie liegen in PadSpans eigenen Dateien,
  auf demselben Rechner.
- **Das Backup von Home Assistant** ist für den Fall, dass du den Rechner verlierst oder auf einen
  neuen umziehst. Es nimmt PadSpans Dateien mit dem Rest von Home Assistant mit.

Du brauchst beide. Ein PadSpan-Backup überlebt den Rechner nicht, und es überlebt keinen Factory
Reset.

## PadSpans eigene Backups

Öffne **Verwalten → Data → Backup & Restore** (Verwalten steht im Modus Einfach unter Weitere
Werkzeuge). Nur ein Administrator von Home Assistant kann ein Backup anlegen, wiederherstellen oder
löschen.

### Was ein Backup enthält

**Create Backup** kopiert all das auf einmal:

- die Einstellungen, mit deinem Lizenzschlüssel
- die Grundrisse: ihre Einträge und die Bilder selbst
- Räume, Etagen, Wände, platzierte Lichter und Empfänger (das Layout und das Raummodell)
- Kalibrierpunkte und das Kalibriermodell
- deine Gerätenamen und PadSpans Liste der Geräte
- die Alarme aus Folgen
- den Bewegungsverlauf, den letzten Tag von Traceback und den letzten Raum jedes Geräts (Lost & Found)
- den Objektverlauf und die Forensik-Sitzungen
- was PadSpan sich über jedes WLED-Gerät merkt
- die Möbel und Höhen von Live Aboard, Teilzonen, die Vorschläge der KI zu deinen Plänen und die
  Verknüpfung mit dem Saugroboter, jeweils nur, wenn du es genutzt hast

Nicht in einem PadSpan-Backup: Gast-Tags und ihre Aufenthalte, RSSI-Aufzeichnungen, der Zähler der
KI-Nutzung und die Zähler des Nutzungsberichts. Die Bereiche, Etagen, Entitäten und Automationen von
Home Assistant sind nie darin: Sie gehören Home Assistant und stehen in dessen Backup.

### Wo Backups liegen, und wie viele

Alle Backups von PadSpan stehen in einer Datei, `.storage/padspan_ha.backups`, mit den Bildern der
Grundrisse darin. PadSpan behält die **3 neuesten Backups, die du angelegt hast** (ein viertes
entfernt das älteste). Vor manchen Änderungen legt es selbst eines an („Before merging rooms…“,
„Before putting receivers in their rooms…“, „Before removing all furniture in Live Aboard“, ein
Import aus PadSpan Bright und andere); von diesen behält es getrennt die 3 neuesten, sodass sie nie
eines von deinen verdrängen. Es gibt keinen Knopf, um ein Backup herunterzuladen: Um eines außerhalb
des Rechners aufzubewahren, nimm das Backup von Home Assistant, das diese Datei mitnimmt.

### Wiederherstellen

1. Wähle in Backup & Restore beim Backup **Restore…**.
2. Hak an, was zurückkommen soll. Zu Beginn ist jeder Teil des Backups angehakt, und **Maps Config**
   und **Model** gehören zusammen (ein Plan und wo er liegt sind eins). Die Bilder haben einen
   eigenen Haken, **Map Images**.
3. Wähle **Restore selected**.
4. Lade PadSpan neu (Einstellungen → Geräte & Dienste → PadSpan HA → ⋮ → **Neu laden**), damit alles
   wirkt, wie die Meldung sagt.

Eine Wiederherstellung bringt zurück, was du angehakt hast, lässt aber ein paar Dinge, wie sie jetzt
sind, weil sie zu dieser Installation gehören und nicht zum Haus:

- **Deine Lizenz**: Ein Backup von vor dem Kauf eines Schlüssels oder aus einem Testzeitraum nimmt
  dir den Schlüssel nie weg. Die bessere der beiden Lizenzen bleibt.
- **Eine Tester-Anmeldung, die Antwort auf eine Einladung und was die Update-Prüfung zuletzt gesagt
  hat**.
- **Der Bewegungsverlauf und Lost & Found** werden mit dem zusammengeführt, was seitdem passiert
  ist, nicht ersetzt.
- **Die Möbel in Live Aboard**, die seitdem platziert wurden, bleiben, wenn das Backup keine hat.

## Factory Reset

**Verwalten → Factory Reset** leert PadSpans Dateien und startet es wie neu, wobei PadSpan
installiert bleibt. Es geht nur im Live-Modus, braucht einen Administrator und verlangt, dass du
`FACTORY RESET` eintippst, bevor sich **Erase All Data & Reset** drücken lässt.

Es löscht die Kalibrierung, die Grundrisse und ihre Bilder, Räume und Empfänger, deine Gerätenamen,
die Alarme aus Folgen, den Verlauf und Traceback, Forensik, gelernte Daten, die Möbel in Live
Aboard, Gast-Tags, Teilzonen, jede Einstellung und **alle eigenen Backups von PadSpan**. Mach
vorher ein Backup von Home Assistant, wenn du davon vielleicht etwas zurückhaben willst.

Es behält deinen Lizenzschlüssel, eine Tester-Anmeldung und Möbel, die du in die Bibliothek geteilt
hast (damit du beides noch zurückziehen kannst), und die gelernte Routine des Urlaubsmodus. In Home
Assistant selbst ändert es nichts: Bereiche, Etagen, Entitäten und Geräte bleiben. Ein Factory Reset
während eines Urlaubs schaltet den Urlaubsmodus aus.

## Das Backup von Home Assistant

Das eigene Backup von Home Assistant (**Einstellungen → System → Backups**) kopiert seinen
Konfigurationsordner, und dort hält PadSpan alles:

| Was | Wo im Konfigurationsordner |
|---|---|
| PadSpans Daten, Einstellungen und seine eigenen Backups | `.storage/padspan_ha.*` |
| Der Verlauf von Traceback und RSSI-Aufzeichnungen | `.storage/padspan_ha.traceback_segments/` und `.storage/padspan_ha.capture_sessions/` |
| Bilder der Grundrisse | `padspan_ha/maps/` |
| WLED-Backups, die aus PadSpan gemacht wurden | `padspan_ha/wled_backups/` |
| PadSpan selbst | `custom_components/padspan_ha/` |

**Jedes Backup von Home Assistant enthält also ganz PadSpan.** Ab Home Assistant 2025.1 sind die
„Home Assistant-Einstellungen“ (der Konfigurationsordner) in jedem Backup und lassen sich nicht
weglassen; du wählst, ob die Verlaufsdatenbank, Medien, der Share-Ordner und Add-ons dazukommen.
PadSpan braucht nichts davon. Bei einem älteren Home Assistant OS enthält ein Teil-Backup PadSpan
nur, wenn darin **Home Assistant** angehakt ist.

Die Verlaufsdatenbank gehört nicht PadSpan: Sie enthält die früheren Zustände von PadSpans
Entitäten, wie bei jeder Entität. Lässt du sie weg, verlierst du diesen Verlauf, sonst nichts.

## Auf einen neuen Home-Assistant-Rechner umziehen

Der Weg, der alles mitnimmt, ist der von Home Assistant selbst:

1. Mach auf dem alten Rechner ein Backup: **Einstellungen → System → Backups → Jetzt sichern**. Lade
   es herunter und bewahre seinen Verschlüsselungsschlüssel auf.
2. Schalte den alten Rechner aus, oder halte zumindest Home Assistant darauf an. Zwei Rechner, auf
   denen dasselbe Haus läuft, hören beide dieselben Empfänger und führen beide dieselben
   Automationen aus, und PadSpans Lizenzprüfung sieht zwei Zuhause (unten).
3. Starte auf dem neuen Rechner die Ersteinrichtung von Home Assistant und wähle, aus einem Backup
   wiederherzustellen. Gib ihr die Datei und den Schlüssel.
4. Wenn Home Assistant läuft, öffne PadSpan. Dein Haus, die Pläne, die Kalibrierung, die Namen und
   die Einstellungen sind wie vorher.

Prüf danach diese Punkte, die vom Rechner abhängen und nicht von den Dateien:

- **Das eigene Bluetooth des neuen Rechners.** Empfänger im Netzwerk (ESPHome-Proxys, Shelly-Geräte,
  ESPresense, Tasmota) sind dieselben Empfänger und machen weiter. War der eigene Bluetooth-Adapter
  des alten Rechners ein Empfänger, ist der neue ein anderer Empfänger: Der alte erscheint als nicht
  gehört und der neue als neu. Setz den neuen auf die Karte und nimm **Scanner ersetzen**
  (Einstellungen → Scanner-Karte), um die Kalibrierung des alten auf ihn zu übertragen.
- **Sein Speicher.** Neben einer belebten Straße hört PadSpan Tausende von Geräten. Lies
  [Mindestanforderungen](../../MINIMUM_REQUIREMENTS.md), bevor du auf einen Rechner mit 2 GB umziehst.
- **Deine Lizenz.** Die wiederhergestellte Kopie bringt den Platz des alten Rechners unter den
  Zuhause deiner Lizenz mit. Der Lizenzserver gibt diesen Platz weiter, wenn sich der alte Rechner
  nicht mehr meldet. Laufen beide weiter, muss der neue ein eigenes Zuhause belegen.
- **Wandbildschirme und Links**: Hat der neue Rechner eine neue Adresse, öffne den Link jedes
  Wandbildschirms noch einmal mit der neuen Adresse.

**Nur PadSpans Dateien zu kopieren** (die Ordner oben), in ein Home Assistant, das von Grund auf neu
eingerichtet ist, ist nicht dasselbe: PadSpans Räume und Layout verweisen auf die Etagen und Bereiche
von Home Assistant, und seine Geräte auf das, was Home Assistant kennt. Das funktioniert nur, wo das
neue Home Assistant dieselben Etagen und Bereiche hat. Ein vollständiges Backup von Home Assistant
bringt die auch mit.

## Umstieg von PadSpan Bright

PadSpan Bright (die Edition nur für Licht) und PadSpan HA lassen sich nebeneinander installieren,
und PadSpan HA kann das Haus übernehmen, das du in Bright gebaut hast.

1. Installiere PadSpan HA (Kapitel [3](03-install-update-uninstall.md)) und lass Bright installiert.
2. Öffne in PadSpan HA **Zustand**. Eine Karte **PadSpan Bright auf diesem Home Assistant gefunden**
   sagt, was Bright enthält.
3. Wähle **Aus PadSpan Bright importieren**. PadSpan HA legt zuerst ein eigenes Backup an (es steht
   in Backup & Restore), kopiert Brights Etagen, Räume, Wände, platzierte Lichter, Grundrisse und
   ihre Bilder, Einstellungen und die Möbel von Live Aboard und lädt dann neu.
4. Wenn das Haus in PadSpan HA richtig aussieht, entferne PadSpan Bright. Der Import löscht Brights
   Dateien nie.

Der Import läuft nur in ein leeres Haus: Hat PadSpan HA schon eine Etage, einen Raum, ein Licht,
eine Wand oder eine Karte, sagt die Karte das und bietet nichts an, und der Import führt nie zwei
Häuser zusammen. Brights Lizenzschlüssel kommt mit seinen Einstellungen herüber, außer du hast in
PadSpan HA schon einen Schlüssel eingetragen.
