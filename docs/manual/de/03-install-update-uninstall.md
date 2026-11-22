# 3. Installieren, aktualisieren, deinstallieren

[Inhalt](README.md)

PadSpan HA braucht Home Assistant 2024.8 oder neuer und mindestens einen Bluetooth-Empfänger. Was
der Rechner und die Empfänger brauchen, steht in [Minimum requirements](../../MINIMUM_REQUIREMENTS.md).

## Installieren

[![PadSpan in deinem Home Assistant öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=gbroeckling&repository=padspanHA&category=integration)

Der Knopf öffnet PadSpan ab Home Assistant 2026.11 im Marketplace und bei älteren Versionen in HACS.

### Aus dem Marketplace (Home Assistant 2026.11 und neuer)

1. Öffne **Einstellungen → Marketplace** und suche nach **PadSpan**.
2. Öffne **PadSpan HA** und wähle **Installieren**. Beim ersten Mal bittet dich der Marketplace zu
   bestätigen, dass das, was er auflistet, nicht vom Home-Assistant-Projekt geprüft wird.
3. Der Einrichtungsdialog öffnet sich sofort, ohne Neustart. Wähle **Absenden**.
4. Öffne **PadSpan HA** in der Seitenleiste.

### Mit HACS (Home Assistant 2026.10 und älter)

PadSpan ist in der HACS-Standardliste, du musst also kein benutzerdefiniertes Repository hinzufügen.

1. Öffne HACS, suche nach **PadSpan HA** und lade es herunter.
2. Starte Home Assistant komplett neu: **Einstellungen → System → Neu starten**.
3. Füge die Integration hinzu: **Einstellungen → Geräte & Dienste → Integration hinzufügen**, suche
   nach **PadSpan HA** und wähle **Absenden**.
4. Öffne **PadSpan HA** in der Seitenleiste.

### Von Hand

1. Lade aus dem [neuesten Release](https://github.com/gbroeckling/padspanHA/releases/latest)
   `padspan_ha.zip` herunter.
2. Leg im Konfigurationsordner von Home Assistant den Ordner `custom_components/padspan_ha` an.
3. Entpacke `padspan_ha.zip` in diesen Ordner. Seine Dateien haben keinen eigenen Ordner: Wenn du
   fertig bist, liegt `manifest.json` unter `custom_components/padspan_ha/manifest.json`.
4. Starte Home Assistant neu und füge dann die Integration hinzu wie in Schritt 3 bei HACS oben.

Eine Installation von Hand bekommt keine Update-Angebote. Du wiederholst diese Schritte für jede
neue Version.

### Was du nach der Installation siehst

PadSpan fügt der Seitenleiste zwei Einträge hinzu: **PadSpan HA** (das Panel) und **Atlas** (die
Lichtkarte; sie lässt sich abschalten). Eine neue Installation öffnet sich auf deinem eigenen Haus,
sobald Home Assistant einen Bluetooth-Empfänger meldet, und zeigt **Wer ist wo**. Bei einer neuen
Installation ist außerdem **Erweiterte Sicherheit** an: Änderungen an PadSpans gemeinsamer
Einrichtung brauchen einen Administrator von Home Assistant.

## Aktualisieren

### Stabil und Beta

PadSpan hat zwei Arten von Releases.

- **Stabil** ist, was der Marketplace und HACS ab Werk installieren und anbieten. Die meisten
  Haushalte sollten bei Stabil bleiben.
- **Betas** kommen oft heraus, manchmal mehrere an einem Tag, damit ein Fix die Tester noch an dem
  Tag erreicht, an dem er gemacht wird. Es sind Pre-Releases auf GitHub. HACS bietet eine Beta nur
  denen an, die es um Betas gebeten haben. Die Release Notes einer Beta haben BETA im Titel.

Betas in HACS 2 bekommst du so: Geh zu **Einstellungen → Geräte & Dienste → HACS**, öffne das Gerät
**PadSpan HA** und schalte seine Entität **Pre-release** ein. Home Assistant legt diese Entität
ausgeschaltet und deaktiviert an, also aktiviere sie zuerst (in ihren Einstellungen, **Aktiviert**).
Um zurück zu Stabil zu gehen, schalte sie wieder aus; HACS bietet dann die nächste stabile Version
an.

### Schritt für Schritt

1. Öffne **Einstellungen → System → Aktualisierungen**. Ein neues PadSpan HA erscheint dort (in HACS
   erscheint es auch bei **PadSpan HA**).
2. Wähle **Installieren**. Die Release Notes stehen im selben Dialog.
3. Starte Home Assistant neu: **Einstellungen → System → Neu starten**.
4. Lade die PadSpan-Seite in jedem Browser neu, in dem sie offen ist (Strg+F5 am Computer).

Nach dem Update zeigt PadSpans Übersicht **PadSpan HA ist jetzt auf v…** mit **Was ist neu?** (die
Release Notes, im Panel) und **Ausblenden**.

Ein Browser, der noch die alte Version ausführt, sagt das in einer Leiste oben, mit einem Knopf
**Neu laden**:

- „PadSpan wurde auf v… aktualisiert. Diese Seite läuft noch mit v….“: Lade die Seite neu.
- „Diese Seite ist v…, aber Home Assistant führt PadSpan v… aus. Wenn du gerade aktualisiert hast,
  starte Home Assistant neu.“: Die neuen Dateien sind da, aber Home Assistant wurde noch nicht neu
  gestartet.

Ein Wandbildschirm, der mit `?kiosk=1` geöffnet wurde, lädt sich nach einem Update einmal selbst
neu, wenn ihn zwei Minuten lang niemand berührt hat, damit er nie alten Code weiterlaufen lässt.

### PadSpans eigener Update-Hinweis

Einmal am Tag fragt PadSpan bei `padspan.traks.ca` nach, ob es eine neuere stabile Version gibt. Die
Anfrage enthält nur die installierte Versionsnummer. Gibt es eine, zeigt Home Assistant eine
Benachrichtigung: **PadSpan HA update available**, „PadSpan HA … is available (you run …)“, mit der
Stelle, an der du aktualisierst (der Marketplace oder HACS, je nachdem, was diese Kopie verwaltet,
oder von Hand bei einer von Hand installierten Kopie), und einem Link zu den Release Notes. Sie
erscheint einmal für jede neue Version (nach einem Neustart von Home Assistant kann die nächste
tägliche Prüfung sie wieder zeigen, bis du aktualisierst), und nur für stabile Versionen. Die erste
Prüfung kommt zu einer zufälligen Zeit zwischen 5 Minuten und 6 Stunden nach dem Start von Home
Assistant, danach einmal am Tag.

So schaltest du ihn ab: **Einstellungen → Ortung → Datenschutz, Updates und Feedback →
Update-Prüfung**, und stell sie auf **Deaktiviert**. Der Marketplace und HACS bieten Updates
weiterhin von sich aus an. Ist ein Lizenzschlüssel eingetragen, wird der Schlüssel weiterhin einmal
am Tag bei `traks.ca` geprüft.

## Deinstallieren

### Bevor du es entfernst

- **Türöffner aus Relais** (Geräte → Türöffner) bestehen aus Skripten, Automationen, einem Helfer
  und einer Template-Entität von Home Assistant, alle mit Namen `padspanha_…`. Wenn du PadSpan
  entfernst, bleiben sie. Um sie zu löschen, wähle zuerst bei jedem in Geräte → Türöffner
  **Entfernen**.
- **Ein iPhone-Schlüssel (IRK), den du aus PadSpan hinzugefügt hast**, ist ein Eintrag in Private
  BLE Device. Er bleibt, wenn PadSpan weg ist. Lösch ihn unter
  **Einstellungen → Geräte & Dienste → Private BLE Device**, wenn du ihn nicht mehr willst.
- **Um dein Haus für später zu behalten**, mach jetzt ein Backup von Home Assistant (siehe
  [Kapitel 22](22-backup-restore-moving.md)). PadSpans eigene Backups liegen in PadSpans Dateien und
  verschwinden, wenn du die löschst.

### Schritt für Schritt

1. Öffne **Einstellungen → Geräte & Dienste → PadSpan HA**, öffne das Menü (⋮) und wähle
   **Löschen**. Home Assistant entfernt PadSpans Entitäten und die Geräte, die nur PadSpan genutzt
   hat. PadSpan gibt jedem WLED-Licht, das es gesteuert hat, seinen WLED-Sync zurück. Ist der
   Nutzungsbericht an, schickt PadSpan einen letzten Bericht, der sagt, dass es entfernt wurde, ohne
   etwas über das Haus.
2. Entferne den Code:
   - Marketplace: Öffne **PadSpan HA** unter **Einstellungen → Marketplace** und entferne es.
   - HACS: Öffne **PadSpan HA** in HACS, öffne das Menü (⋮) und wähle **Remove**.
   - Von Hand: Lösch den Ordner `custom_components/padspan_ha`.
3. Starte Home Assistant neu. Die Einträge **PadSpan HA** und **Atlas** in der Seitenleiste sind
   weg.

### Was zurückbleibt

Home Assistant löscht die Dateien einer Integration nicht, wenn sie entfernt wird. PadSpans Dateien
bleiben im Konfigurationsordner von Home Assistant, bis du sie löschst:

| Was | Wo | Enthält |
|---|---|---|
| PadSpans Datendateien | `.storage/padspan_ha.*`, eine Datei für jede Art von Daten | Einstellungen, Lizenzschlüssel, Karten, Räume, Kalibrierung, Labels, Verlauf, PadSpans eigene Backups und den Rest |
| Zwei Datenordner | `.storage/padspan_ha.traceback_segments/` und `.storage/padspan_ha.capture_sessions/` | Den Verlauf von Traceback und RSSI-Aufzeichnungen (nur, wenn du eine gemacht hast) |
| Grundriss-Bilder | `padspan_ha/maps/` | Die Grundrisse, die du hochgeladen hast |
| WLED-Backups | `padspan_ha/wled_backups/` | Nur, wenn du ein WLED-Gerät aus PadSpan gesichert hast |
| Eine beiseitegelegte unlesbare Datei | `.storage/padspan_ha.<name>.unreadable.<time>` | Nur, wenn PadSpan einmal eine Datei gefunden hat, die es nicht lesen konnte |
| Alter Kartenordner | `www/padspan_ha/maps/` | Nur bei einem Haus, auf dem nie 0.38.143 oder neuer lief: Neuere Versionen verschieben die Bilder daraus |

So entfernst du sie alle:

1. Deinstalliere wie oben und starte Home Assistant neu.
2. Lösch mit dem Add-on File editor, Samba share, SSH oder Studio Code Server im
   Konfigurationsordner: jede Datei und jeden Ordner in `.storage`, deren Name mit `padspan_ha.`
   anfängt, den Ordner `padspan_ha` und `www/padspan_ha`, falls es ihn gibt.

Lösch sie nur, wenn PadSpan entfernt ist: Solange es läuft, schreibt es sie wieder.

Außerdem bleibt in Home Assistant, außerhalb von PadSpans Dateien:

- **Tags**: Ist **Tag-Ereignisse bei Raumwechsel** eingeschaltet (Einstellungen → Ortung → Home
  Assistant und Integrationen → HA-Tags-Integration), hat die Tag-Liste von Home Assistant einen Tag
  namens `padspan_…` für jedes Gerät, dem du folgst und das den Raum gewechselt hat. Lösch sie unter
  **Einstellungen → Tags**, wenn du willst.
- **Verlauf**: Die Datenbank von Home Assistant behält die früheren Zustände von PadSpans Entitäten,
  bis ihre eigene Verlaufseinstellung sie löscht (10 Tage, wenn du das nicht geändert hast).
- **Alles, was du über PadSpans Knöpfe zu einer anderen Integration hinzugefügt hast**, wie oben.

**Ein Factory Reset ist keine Deinstallation.** Verwalten → Factory Reset leert PadSpans Dateien und
lässt PadSpan installiert. Es behält deinen Lizenzschlüssel. Siehe
[Kapitel 22](22-backup-restore-moving.md).

### Wieder installieren

PadSpan findet seine Dateien in `.storage`, wenn sie noch da sind, und kommt mit dem Haus zurück,
wie es war. Ein Haus, dessen Dateien gelöscht wurden, startet wie eine neue Installation.
