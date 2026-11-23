# 23. Leistung und kleine Rechner

[Inhalt](README.md)

Was PadSpan den Home-Assistant-Rechner und die Bildschirme kostet, und was du einschaltest, wenn
einer von beiden nicht mitkommt. Die Kurzfassung der Voraussetzungen steht in
[Kapitel 2](02-requirements.md).

## Der Home-Assistant-Rechner

| | |
|---|---|
| **Empfohlen** | Mehr als 2 GB Speicher: ein Raspberry Pi 4 oder 5 mit 4 GB oder mehr, ein Home Assistant Green oder ein Mini-PC oder eine virtuelle Maschine mit 4 GB oder mehr. |
| **Rechner mit 2 GB** | Vorerst nicht empfohlen. Hast du einen, schalte den **Speichersparmodus** ein (unten). |
| **Datenträger** | Eine SSD oder eMMC statt einer SD-Karte. Der Geräteverlauf wird bis zu alle 15 Sekunden gespeichert: In einem Haus mit etwa 2.900 Geräten ist diese Datei etwa 5 MB groß, das sind bis zu etwa 30 GB Schreibvorgänge am Tag. |

## Warum eine belebte Straße Speicher kostet

PadSpan behält jedes Gerät, das es hört, eine Weile, nicht nur die, denen du folgst. Drei Dinge
wachsen mit ihnen:

- **Der Geräteverlauf**: jedes gehörte Gerät, das nicht die wechselnde Adresse eines Handys ist, ab
  Werk einen Tag lang (**Einstellungen → Ortung → Was das Panel zeigt → Aufbewahrung des
  Objektverlaufs**: 1, 2, 7 oder 14 Tage), höchstens 10.000, die niemand benannt hat. Benannte
  Geräte und Geräte, denen du folgst, bleiben immer.
- **Der Bluetooth-Cache**: der letzte Messwert jedes Empfängers für jede Adresse, behalten für den
  **BLE-Advertisement-Timeout** (derselbe Abschnitt; 4 Stunden, wenn du ihn nicht änderst).
- **Das Live-Bild**: all das, zu einer Liste zusammengebaut, für jeden offenen PadSpan-Bildschirm,
  alle 5 Sekunden.

In einem ruhigen Haus sind das ein paar Hundert Geräte. Neben einer belebten Straße oder in einem
Wohnblock können es Zehntausende sein; ein Haus meldete über 80.000.

**Gemessen** mit 64-Bit-Python und sechs Empfängern (im echten Betrieb 10 bis 30 % mehr):

| Gehaltene Geräte | PadSpans Speicher (gehalten / Spitze mit offenem Bildschirm) |
|---|---|
| 1.000 | etwa 14 / 20 MB |
| 5.000 | etwa 67 / 100 MB |
| 25.000 | etwa 340 / 500 MB |
| 80.000 | etwa 1,0 / 1,6 GB |

Einem Raspberry Pi mit 2 GB bleiben etwa 0,4 bis 0,8 GB für PadSpan, sobald Home Assistant OS und
ein paar Add-ons laufen, und so passen nur etwa 5.000 Geräte hinein.

## Speichersparmodus

**Einstellungen → Ortung → Leistung → Speichersparmodus**, ab Werk aus. Für einen Rechner mit
2 GB: Er begrenzt, wie viele vorbeikommende Geräte PadSpan hält.

| | Normal | Mit Speichersparmodus |
|---|---|---|
| Wie lange der Bluetooth-Cache eine Adresse behält | Der BLE-Advertisement-Timeout (4 Stunden, wenn du ihn nicht änderst) | Höchstens 15 Minuten |
| Adressen im Bluetooth-Cache | Keine Grenze | 2.000 |
| Unbenannte Geräte im Geräteverlauf | 10.000, für 1 bis 14 Tage | 2.000, für 1 Tag |
| Advertisements im Live-Bild | 5.000 | 2.000 |

Zusammen sind das höchstens etwa 4.000 Geräte. Sonst ändert er nichts: Benannte Geräte, Geräte mit
Label und Geräte, denen du folgst, fallen nie heraus, und Räume, Positionen, der Atlas und Live
Aboard funktionieren wie vorher. Vorbeikommende Fremde fallen nur früher aus den Listen. Die Karte
fragt, bevor sie ihn einschaltet.

## Die anderen Einstellungen unter Leistung

Alle unter **Einstellungen → Ortung → Leistung**:

- **Abfrageintervall der Anwesenheit** (5 Sekunden): wie oft die Räume berechnet werden. Höher
  schont den Prozessor und folgt dir langsamer.
- **CPU-Modus**: wo diese Arbeit läuft. **Geteilt** (die Voreinstellung) lässt sie mit Home
  Assistant laufen: am schnellsten, und sie konkurriert mit Home Assistant. **Ein Kern** hält sie
  auf einem Kern, damit Home Assistant flüssig bleibt. **Eigener Kern** gibt ihr einen eigenen Kern.
  Das gilt ab der nächsten Aktualisierung, ohne Neustart.
- **Für viele Bildschirme optimieren** (aus): für mehrere Bildschirme auf einmal. Die Übersicht und
  die 3D-Personen bekommen nur, was sie zeichnen (etwa 50 KB pro Bildschirm statt etwa 2,2 MB in einem
  belebten Haus), Bildschirme, die im selben Moment fragen, teilen sich eine Zusammenstellung, und ein
  ausgeblendeter Bildschirm fragt nach nichts. Einzelheiten in
  [Kapitel 18](18-wall-screens-and-kiosks.md#mehrere-bildschirme-auf-einmal-für-viele-bildschirme-optimieren).

Unter **Einstellungen → Ortung → Empfänger** liest ein längeres
**Bluetooth-Aktualisierungsintervall** die Empfänger seltener aus (aber bleib bei 5 Sekunden für
passive wie Shellys: [Kapitel 5](05-receivers.md)).

## Die Bildschirme

| | |
|---|---|
| **Das Panel und der Atlas** | Jeder aktuelle Browser: Chrome, Edge, Safari oder Firefox, auf einem Computer, Tablet oder Handy. Ein Tablet, auf dem die Dashboards von Home Assistant flüssig laufen, schafft den Atlas. |
| **Live Aboard (das 3D-Haus)** | Ein Browser mit WebGL 2. Ohne das, oder mit einem Grafikchip, der zu langsam ist, um mitzukommen, zeigt PadSpan stattdessen den flachen Atlas und sagt das. |

Für einen langsamen Bildschirm:

- stell die **Quality** von Live Aboard auf Low (**Einstellungen → Atlas → Live Aboard**). Auf Auto
  geht sie von selbst herunter, wenn der Bildschirm nicht mitkommt;
- **Show the frame rate (this browser only)**, auf derselben Karte, zeigt, wie oft pro Sekunde das
  Haus gezeichnet wird;
- die flache Atlas-Wand (`/padspan-lights?kiosk=1`) verlangt Home Assistant am wenigsten ab.

Wenn sich nichts ändert, zeichnet Live Aboard nichts, also kostet eine Wand im Leerlauf fast nichts.

## Wenn Home Assistant langsam ist oder ihm der Speicher ausgeht

1. Schalte den **Speichersparmodus** ein.
2. Kürze die **Aufbewahrung des Objektverlaufs** auf 1 Tag, und den **BLE-Advertisement-Timeout**.
3. Mit mehreren Wandbildschirmen schalte **Für viele Bildschirme optimieren** ein.
4. Versuch **CPU-Modus → Ein Kern**.

Mehr, nach Symptom: [Kapitel 26](26-troubleshooting.md#home-assistant-geht-der-speicher-aus-oder-es-ist-langsam).

## Wie diese Zahlen gesammelt werden

Nur von Installationen, die **Einstellungen → Ortung → Hilf, PadSpan besser zu machen**
eingeschaltet haben: was PadSpan im Speicher hält, wie schnell neue Geräte dazukommen, wie oft Home
Assistant neu gestartet ist und wie stark Home Assistant und jeder Bildschirm arbeiten. Nur Zahlen
und Größenklassen ([Kapitel 24](24-privacy.md)). Hinweise für Bildschirme, nach Art des Geräts,
folgen, sobald es genug davon gibt.
