# 20. Einstellungen im Überblick

[Inhalt](README.md)

Jede Einstellung, die PadSpan speichert: wo sie im Panel steht, ihr Standardwert, welche Werte sie
annimmt und was sie tut. Die Tabellen entstehen mit `scripts/build_manual_reference.py` aus PadSpans
Code (die Standardwerte aus `settings_store.py`, die Wertebereiche aus `ws_settings.py`, die
Beschriftungen gegen die Bildschirme des Panels geprüft), und ein Test schlägt fehl, wenn sie und
der Code nicht übereinstimmen.

## Bevor du etwas änderst

- **Der Modus Einfach zeigt nur Darstellung.** Die anderen Reiter der Einstellungen (Ortung,
  Funktionen, KI, Atlas, UI-Struktur) gibt es in den Modi Erweitert und Entwicklung. Der Modus-Knopf
  oben rechts wechselt zwischen ihnen.
- **Die meisten Einstellungen werden sofort gespeichert** und wirken ab der nächsten
  Aktualisierung, ohne Neustart. Die, die mehr brauchen, sagen das auf ihrer Karte (der Eintrag des
  Atlas in der Seitenleiste braucht einen Neustart von Home Assistant; eine neu angehakte Art von
  Entität braucht ein Neuladen von PadSpan).
- **Mit eingeschalteter erweiterter Sicherheit** (bei einer neuen Installation an) kann nur ein
  Administrator von Home Assistant PadSpans gemeinsame Einrichtung ändern. Ein paar Einstellungen
  ändert immer nur ein Administrator, egal wie die erweiterte Sicherheit steht: die erweiterte
  Sicherheit selbst, der Nutzungsbericht, der Urlaubsmodus, Gast-Tags, die KI und die gemeinsame
  Möbelbibliothek, wer in Live Aboard zu sehen ist, und die Adresse von ESPresense Companion.
- **Jede Einstellung ist in PadSpans Backups**, und ein Zurücksetzen auf Werkseinstellungen setzt
  sie auf diese Standardwerte zurück (dein Lizenzschlüssel bleibt). Siehe
  [Kapitel 22](22-backup-restore-moving.md).
- **Keys** (die Spalte Key) sind die Namen, unter denen PadSpan jede Einstellung in
  `.storage/padspan_ha.settings` speichert. Sie stehen hier für den Support und zum Lesen einer
  Diagnosedatei; die Datei musst du nicht bearbeiten.

„Range or choices“ ist das, worauf PadSpan den Wert hält: Eine Zahl außerhalb des Bereichs wird an
die Grenze des Bereichs verschoben, und ein Wort, das nicht auf der Liste steht, wird abgelehnt oder
ersetzt. „empty“ heißt, dass nichts gesetzt ist.

## In den Einstellungen

Die Reiter, Abschnitte und Karten heißen so, wie das englische Panel sie nennt. Die acht Abschnitte
von Ortung sind jeweils eine aufklappbare Überschrift auf diesem Reiter.

Die folgenden Tabellen sind englisch: Sie entstehen direkt aus PadSpans Code.

<!-- english:settings -->

## Auf anderen Bildschirmen

Einstellungen, die PadSpan für ein Bedienelement auf einem anderen Bildschirm speichert. Jede wird
gespeichert, wenn du dieses Bedienelement benutzt.

Die folgende Tabelle ist englisch: Sie entsteht direkt aus PadSpans Code.

<!-- english:elsewhere -->

## Nicht im Panel

Einstellungen ohne Bedienelement im Panel: eine, die ein Dienst ändert, ein paar, die das Panel nie
zeigt (sie lassen sich nur mit einem Befehl ändern oder sind für ältere Versionen da), und die, die
PadSpan für sich selbst führt (wann es zuletzt geprüft hat, was es gefragt hat, was es gelernt hat).
Keine davon musst du je setzen.

Die folgenden Tabellen sind englisch: Sie entstehen direkt aus PadSpans Code.

<!-- english:not-in-panel -->
