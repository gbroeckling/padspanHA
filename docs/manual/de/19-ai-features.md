# 19. KI-Funktionen

[Inhalt](README.md)

PadSpan hat keine eigene KI und schickt selbst nichts an einen KI-Dienst. Ein paar Funktionen
können eine KI, die **du** in Home Assistant eingerichtet hast, einen **AI Task** (im deutschen Home Assistant „KI-Aufgabe“), bitten, ein Bild
für dich zu lesen: das Foto eines Sofas oder einen Grundriss. Anwesenheit pro Raum, Kalibrierung und
alles andere funktionieren ohne.

## Was es kann

Alle diese Funktionen brauchen PadSpan Pro oder, ab dem 1. Dezember 2026, das Add-on Erweiterte
Kartenerstellung ([Kapitel 25](25-padspan-pro.md#add-ons)); Furnish und **Edit** in Live Aboard
bleiben bei PadSpan Pro. Jedes Lesen geschieht nur, wenn jemand es startet, nie nach Zeitplan.

| Funktion | Was gelesen wird | Wo | Schalter in Einstellungen → KI |
|---|---|---|---|
| **Furniture from a photo** (auch ein Tag, ein Empfänger oder die Figur einer Person) | Das Foto, das du gewählt hast | Furnish in Live Aboard ([Kapitel 17](17-furnish.md)) | An, bis du ihn ausschaltest |
| **Stairs from your floor plans** | Ein platzierter Grundriss, in der Größe angepasst | Furnish → **Build ▾ → House → Read stairs off the plans (AI)** | Ab Werk aus, unter **AI map-building research (experimental)** |
| **Add data via plans** (das Werkzeug **Plans**) | Deine platzierten Grundrisse, ganz und in Stücken | **Edit → Plans** in Live Aboard ([Kapitel 16](16-live-aboard.md#aus-deinen-plänen-bauen-mit-einer-ki-experimentell)) | **AI map-building research (experimental)**, ab Werk aus |
| **Build from plans** (**Line up plans**, **Rooms from plans**) | Deine platzierten Grundrisse | **Edit → Plans** in Live Aboard | **Build from plans**, für alle aus, bis es angeboten wird; braucht Claude |
| **Let Claude draw your rooms** | Die Grundrisse der Etage, die du gewählt hast | Der Schritt Räume zeichnen in der Einrichtung ([Kapitel 9](09-setup-the-map.md#schritt-3-räume-zeichnen)) | Keiner: Nichts wird gelesen, bis du es dort startest; braucht Claude |

Die experimentellen sind Forschung: Die KI schlägt vor, du prüfst jeden Punkt, und nichts wird
gespeichert, bis du es annimmst. Sie ändern nie deine Kalibrierung oder deine Signalwände. Was sie
speichern können (das ausgerichtete Bild eines Grundrisses, Räume), legt vorher ein Backup an und
lässt sich rückgängig machen. Einen Schalter auszuschalten blendet die Funktion aus; was du behalten
hast, macht es nicht rückgängig.

**Frag deinen Sprachassistenten, wo jemand ist** ist die einzige Zeile unter **Was sie für dich
tut**, die als **DEMNÄCHST** markiert ist: Sie lässt sich noch nicht einschalten. Die eigenen
„Wo ist“-Sätze von Assist funktionieren schon heute ohne KI: [Kapitel 14](14-home-assistant-reference.md).

## Eine KI verbinden

**Einstellungen → KI → Deine KI**:

- **AI Task**: Wähl einen, dessen Modell Bilder lesen kann (ein Vision-Modell). Er braucht Home
  Assistant 2025.8 oder neuer. Hat Home Assistant noch keinen, füg zuerst eine KI-Integration mit
  einem Vision-Modell hinzu: eine, die bei dir zu Hause läuft, etwa Ollama, oder eine in der Cloud.
- **Backup AI task**: wird benutzt, wenn der Haupt-AI-Task nicht erreichbar ist (etwa ein Computer,
  der weg ist). Vor jedem Lesen öffnet und schließt PadSpan eine Verbindung zum Server des
  Haupt-AI-Tasks, um zu sehen, ob er da ist; darüber wird nichts geschickt.

Ab Werk ist keiner gewählt, und ohne gewählten wird nichts gelesen. Nur ein Administrator wählt
einen.

### Claude verbinden

**Build from plans** und **Let Claude draw your rooms** brauchen Claude, über die eigene
Anthropic-Integration von Home Assistant und dein eigenes Anthropic-Konto. Anthropic berechnet
diesem Konto jedes Lesen; PadSpan verkauft kein Guthaben und fragt nie nach einer Karte. Es dauert
etwa 15 Minuten, einmal.

1. **In der Anthropic Console**: Registrier dich oder melde dich an, und lade auf der Seite
   **Billing** Guthaben auf. Enthält dein Claude-Abo monatliches API-Guthaben, verknüpf stattdessen
   deine Console-Organisation damit. Ein Claude-Abo allein bezahlt diese Lesevorgänge nicht.
2. Öffne **API keys**, wähl **Create Key**, gib ihm einen Namen („Home Assistant“) und kopier ihn.
   Die Console zeigt ihn nur einmal.
3. **In Home Assistant**: **Einstellungen → Geräte & Dienste → Integration hinzufügen → Anthropic**,
   füg den Schlüssel ein und schließ ab.
4. Öffne in der Anthropic-Integration ihren AI Task (oder füg einen hinzu), wähl als Modell
   **Claude Opus 5.5 oder neuer** mit seinem vollen Namen und speichere. Sonnet und Haiku werden
   nicht angenommen: Das Lesen der Grundrisse wurde mit Opus 5.5 getestet.
5. **In PadSpan**: Der Bildschirm **Connect Claude** des Helfers prüft von selbst noch einmal, wenn
   du zurückkommst (oder wähl **Check again**). Hat Home Assistant ein nutzbares Claude, das noch
   nicht PadSpans KI ist, bietet er **Use it for PadSpan** an, und dein bisheriger AI Task bleibt als
   Backup. Oder wähl es selbst unter **Einstellungen → KI → Deine KI**.

Bevor irgendetwas gelesen wird, schickt der Helfer einen winzigen Lesevorgang ohne Plan darin (ein
leeres Bild aus einem Pixel und die Worte „This is a connection check. Reply with the single word
OK.“), damit ein Konto ohne Guthaben schon dann auffällt und nicht erst, nachdem du deinen Plan
vermessen hast.

| Der Helfer sagt | Was du tust |
|---|---|
| Claude isn't connected to Home Assistant yet | Schritte 1 bis 4. |
| Anthropic says this account is out of credit | Lade Guthaben auf (Schritt 1) und komm dann zurück. |
| Your AI Task uses an older Claude | Stell sein Modell auf Claude Opus 5.5 oder neuer um. |
| PadSpan can't tell which Claude model this AI Task uses | Wähl das Modell noch einmal mit seinem vollen Namen. |
| Home Assistant has Claude ready | Wähl **Use it for PadSpan**. Das Lesen von Fotos und Treppen nutzt es dann auch. |

**Wenn ein Lesevorgang fehlschlägt**: Kein Guthaben mehr: Lade Guthaben auf und wähl **Try again**
(was gelesen wurde, bleibt erhalten). Claude war nicht erreichbar: Prüf die Anthropic-Integration
unter **Einstellungen → Geräte & Dienste** und das Protokoll von Home Assistant. Der Medienordner
konnte den Plan nicht aufnehmen: Der Medienordner von Home Assistant muss beschreibbar sein, weil
PadSpan das Bild über ihn an den AI Task gibt.

## Was gelesen wird und wohin es geht

Jedes Lesen ist ein Aufruf von Home Assistants eigenem `ai_task.generate_data` auf dem AI Task, den
du gewählt hast, und enthält:

- **ein Bild**: das Foto oder einen Grundriss (ganz oder einen Ausschnitt davon). Es geht so, wie es
  ist, also geht alles, was auf einem Grundriss steht, mit;
- **fest in PadSpan geschriebene Anweisungen**, die nur die Größe des Bilds in Pixeln ergänzen und,
  bei einem Foto, die Art des Stücks, die du gewählt hast;
- bei einem Foto die Liste der Felder, die auszufüllen sind.

PadSpan fügt keine Namen, Adressen, Personen, Geräte oder Positionen aus deinem Haus hinzu. Home
Assistant gibt das Lesen an die KI hinter dem AI Task weiter: Eine, die bei dir zu Hause läuft,
behält das Bild dort, und eine in der Cloud schickt es an diese Firma, zu deren eigenen
Bedingungen. Für die Dauer des Aufrufs ist das Bild eine Datei in einem versteckten Ordner im
Medienordner von Home Assistant, die gelöscht wird, wenn der Aufruf endet. PadSpan behält keine
Kopie eines Fotos. Ein Foto oder Grundriss kann mehrere Lesevorgänge brauchen.

Die Figur einer Person aus einem Foto fragt zuerst, ob die Person einverstanden ist, schickt
nichts, bis das angehakt ist, und empfiehlt einen lokalen AI Task.

## Was es kostet

PadSpan kostet hier nichts extra: Du bezahlst den Hersteller der KI, wenn überhaupt jemanden. Eine
lokale KI (Ollama auf deinem eigenen Rechner) kostet nur ihren Strom. Eine KI in der Cloud rechnet
über ihr eigenes Konto ab.

Für Claude führt **Einstellungen → KI** eine Zählung:
**Every read PadSpan sent to your AI this month**, mit geschätzten Kosten nur für Claude.

- Es ist eine Schätzung aus der Größe jedes Bilds und der Länge jeder Frage: Home Assistant gibt
  nicht weiter, was Claude gezählt hat. Die genauen Zahlen stehen in der
  **Anthropic Console → Usage**, gefiltert nach dem Schlüssel, den Home Assistant nutzt.
- Gib **Your monthly credit, US$** ein und wähl einen Anteil (50, 75 oder 90 %), dann schickt
  PadSpan einmal im Monat eine Benachrichtigung in Home Assistant, wenn die Schätzung ihn
  überschreitet (**PadSpan: AI credit**).
- Die Zählung bleibt auf diesem Home Assistant: Sie ist nicht in Backups, ein Zurücksetzen auf
  Werkseinstellungen leert sie, und der Nutzungsbericht bekommt daraus nur Zahlen und grobe
  Bereiche.

Was allgemein das Haus verlässt: [Kapitel 24](24-privacy.md).
