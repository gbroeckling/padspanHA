# 1. Was PadSpan ist

[Inhalt](README.md)

PadSpan HA ist ein Bedienfeld für dein Haus, direkt in Home Assistant. Es zeichnet deine Etagen und
Räume, setzt jedes Licht, jedes Schloss und jeden Sensor in seinen Raum und zeigt mit
Bluetooth-Empfängern, in welchem Raum jede Person ist. Ein Tippen auf ein Licht schaltet es. Ein
Wasser- oder Rauchalarm färbt seinen Raum rot, und ein rotes Banner zeigt ihn auf jedem
PadSpan-Bildschirm. Es kann so einfach oder so umfangreich sein, wie du es brauchst: Fang mit deinen
Räumen und ihren Lichtern an, nimm Empfänger dazu, um zu sehen, wer wo ist, und nimm PadSpan Pro
dazu, wenn du mehr willst.

PadSpan hat zwei Seiten in der Seitenleiste von Home Assistant. **PadSpan HA** ist das ganze Panel:
wer wo ist, **Folgen** für ein Handy oder einen Tag, das Abspielen, wo Geräte waren, Einrichtung und
Einstellungen. **Atlas** ist die Karte deines Hauses, gemacht für ein Handy oder einen Bildschirm an
der Wand. PadSpan läuft auf deinem Home Assistant, und die Ortung braucht keine Cloud.

Du kannst es vor der Installation ausprobieren: [padspan.traks.ca/demo](https://padspan.traks.ca/demo/)
ist das echte Panel an einem Beispielhaus, in deinem Browser. Die Demo zeigt PadSpan Pro, also auch
die kostenpflichtigen Teile.

## Was du kostenlos bekommst

PadSpan HA ist kostenlos und Open Source (GPL v3). Die kostenlose Version braucht keinen Schlüssel
und läuft nicht ab. Manche Funktionen brauchen PadSpan Pro oder ein Add-on, und PadSpan sagt dir an
Ort und Stelle, welches. Pro enthält jedes Add-on. Ohne Schlüssel bekommst du alles hier unten.

### Dein Haus auf einem Bildschirm

Dafür brauchst du nur Home Assistant, keinen Bluetooth-Empfänger.

- **Der Atlas**: deine Etagen und Räume, jedes Licht und jeder Ventilator in seinem Raum, und ein
  Tippen schaltet es. Tipp auf den Namen eines Raums für seine Karte: jedes Gerät darin, **Alle
  Lichter an / aus** und ein Knopf für jede Szene und jedes Skript des Raums in Home Assistant (bis
  zu sechs). Siehe [Kapitel 15](15-the-atlas.md).
- **Schlösser** auf der Karte: Ihre Karte verriegelt und entriegelt sie, und vor dem Entriegeln
  fragt sie nach.
- **Wasser-, Rauch-, Gas- und CO-Alarme** färben ihren Raum rot und bleiben 2 Tage lang stehen oder
  bis jemand sie zurücksetzt. Ein rotes Banner zeigt sie auf jedem PadSpan-Bildschirm, und du
  bekommst eine Benachrichtigung, wenn einer losgeht, und eine, wenn er wieder ruhig ist
  ([Kapitel 13](13-alerts.md)).
- **Eine Alarmanlage, die losgeht** (eine Alarmzentrale in Home Assistant, etwa Alarmo), erscheint
  am Notfallknopf des Atlas und als Zeile im roten Banner.
- **Alert pulse** (aus, bis du es einschaltest): Eine Tür, ein Fenster, ein Tor oder eine Abdeckung,
  die länger als 6 Stunden offen ist, oder ein Fenster oder eine Abdeckung, die bei Regen oder Schnee
  offen ist, bekommt einen gelben Ring um ihren Raum.
- **Regen und Schnee** rund ums Haus im Atlas, als stilles Bild, aus deiner Wetter-Entität oder einem
  Regensensor.
- **Offene Bildschirme** (aus, bis du es einschaltest): jede offene PadSpan-Seite in einer Liste, um
  eine oder alle neu zu laden, und, aus einer Automation, eine Nachricht mit Gong auf den
  Bildschirmen, die du nennst ([Kapitel 14](14-home-assistant-reference.md#dienste)).
- **Ein Kiosk-Link**, `/padspan-ha?kiosk=1`, blendet PadSpans Menü für ein Tablet aus
  ([Kapitel 18](18-wall-screens-and-kiosks.md)). Der Wandmodus auf der Atlas-Seite gehört zu
  PadSpan Pro.
- **Die Designs Nacht, Hell und Hoher Kontrast.** Das Panel spricht die Sprache deines Home
  Assistant: Englisch und Deutsch, und vieles davon auch Französisch und Niederländisch.

### Deine Lichter

Auch dafür brauchst du nur Home Assistant.

- **Jedes Licht im Atlas**, in seinem Raum, und ein Tippen schaltet es (siehe oben).
- **Power-Teams**: Ein Wanddimmer oder -schalter und die smarten Birnen dahinter werden in Home
  Assistant ein einziges Licht. Es folgt dem Tag, kann dich wecken und stellt die Birnen neu ein, wenn
  der Wandschalter sie wieder einschaltet ([Kapitel 15](15-the-atlas.md#power-teams)).

### Wer in welchem Raum ist

Dafür brauchst du mindestens einen Bluetooth-Empfänger. Einer unterscheidet zu Hause von weg; einer
in jedem Raum, den du unterscheiden willst, gibt dir Räume.

- **Räume ohne Grundriss.** Der Raum jedes Empfängers ist sein Home-Assistant-Bereich. Ein Gerät
  kommt in den Raum, dessen Empfänger es am besten hört. Die Karte **Wer ist wo** in der Übersicht
  listet jeden Raum und wer darin ist. **Raum festlegen** gibt einem Empfänger ohne Bereich seinen
  Raum, und **Verfolgen** nimmt ein Handy auf, das Home Assistant schon unterscheiden kann.
- **Entitäten für deine Automationen.** Jedes Gerät, das du benennst, bekommt einen Device Tracker
  (sein Zustand ist der Raum oder `not_home`), einen Bereichssensor und Entfernungssensoren.
  Ereignisse werden ausgelöst, wenn ein benanntes Gerät ankommt, geht oder den Raum wechselt, und
  Assist beantwortet „In welchem Raum ist Alex?“, sobald du seine Sätze hinzufügst. Siehe
  [Kapitel 14](14-home-assistant-reference.md).
- **Folgen**, für ein Gerät: sein Raum jetzt und seine Wege, mit Alarmen aufs Handy oder per E-Mail,
  wenn es den Raum wechselt, ankommt oder geht.
- **Live-Tracker**, eine Live-Karte über den ganzen Bildschirm, und **Belegung**, eine Schätzung, wie
  viele Leute im Gebäude sind.
- **Traceback**: 7 Tage, wohin deine Geräte gegangen sind, auf deinen Etagen abgespielt, mit
  **Insights** (Zeit in jedem Raum) und **New Objects** ([Kapitel 12](12-the-screens.md#traceback)).
- **Wiedergabe teilen**: ein Clip von 10 bis 30 Sekunden, in dem Leute durchs Haus gehen, mit
  verborgenen Namen, in deinem Browser gemacht. Nichts wird hochgeladen.
- **Gestern zu Hause** (aus, bis du es einschaltest): jeden Morgen eine Nachricht über den Vortag,
  mit Kommen und Gehen, Gästen, den am längsten leeren Räumen und Lichtern, die in leeren Räumen
  brannten ([Kapitel 13](13-alerts.md#gestern-zu-hause)).
- **Licht folgt Personen**: Die Lichter eines Raums gehen an, wenn jemand mit einem benannten Handy,
  einer Uhr oder einem Tag hereinkommt, und aus, wenn der Raum lange genug leer war. Ein Licht, das
  jemand von Hand ausschaltet, bleibt aus, bis alle gegangen sind
  ([Kapitel 14](14-home-assistant-reference.md#licht-folgt-personen)). Drei Blueprints für Home
  Assistant machen dasselbe in deinen eigenen Automationen.
- **Gast-Tags**: ein kleiner Bluetooth-Tag, den ein Gast für seinen Besuch bekommt, mit Räumen, die
  er nicht betreten soll, und einem Bericht über den Aufenthalt ([Kapitel 7](07-tags-and-beacons.md#gast-tags)).
- **Kalibrierung**, mit **Raum abgehen**: Trag dein Handy etwa 90 Sekunden durch einen Raum, damit
  PadSpan lernt, wie er klingt ([Kapitel 11](11-calibration.md#raum-abgehen)).
- **Positionen zwischen Empfängern.** Mit drei oder mehr Empfängern auf einem Grundriss mit Maßstab
  verortet PadSpan Geräte auch zwischen ihnen, sogar in einem Raum ohne eigenen Empfänger.

### Dein Grundriss, in jeder Form

Dafür brauchst du nur Home Assistant.

- **Ein grobes Haus aus deinen Home-Assistant-Räumen**: ein Kasten pro Bereich auf einer leeren
  Etage, mit **Zeigen, was angelegt wird** und **Grobes Haus anlegen**
  ([Kapitel 9](09-setup-the-map.md#mit-einem-groben-haus-beginnen)).
- **Jeder Plan, den du hast**: ein Bild oder ein Foto einer Skizze, ein PDF, eine leere Etage in
  einer Größe, die du eintippst, eine Plandatei aus Easy Floorplan, eine DXF- oder Floorplanner-Datei,
  eine Sweet-Home-3D-Datei, ein Raumscan von einem iPhone oder iPad Pro mit LiDAR (maßstabsgetreu,
  nichts zu messen) oder die Karte eines Saugroboters (experimentell). Siehe
  [Kapitel 9](09-setup-the-map.md).
- **Räume, Etagen und Höhen**: Zeichne jeden Raum, leg die Höhe jeder Etage fest und gib einem Raum
  seine Deckenhöhe und ein Halbgeschoss.
- **Wände und Türen**: Wandmaterialien und offene Kanten für das Signal, und Türen und Fenster an den
  Wänden, mit ihren Sensoren verknüpft ([Kapitel 10](10-walls-and-signal-loss.md)).
- **Die Übersicht** zeichnet deine Etagen übereinander als Haus. Das Haus in 3D, Live Aboard, gehört
  zu PadSpan Pro.

### Außerdem kostenlos

- **Erweiterte Sicherheit** (bei einer neuen Installation an): Nur Administratoren ändern die
  gemeinsame Einrichtung, und alle im Haus können sie ansehen und benutzen
  ([Kapitel 21](21-users-and-security.md)).
- **Sicherungen und Wiederherstellen**, und die eigene Sicherung von Home Assistant enthält ganz
  PadSpan ([Kapitel 22](22-backup-restore-moving.md)).
- **Training**, die animierten Rundgänge, und die Hilfe in PadSpan (das **?** neben einer
  Überschrift).

## Was PadSpan Pro dazu bringt

PadSpan Pro ist ein Schlüssel auf derselben Installation. Nichts neu installieren, nichts neu
einrichten. Es bringt:

- **Jedes Licht und jedes Gerät genau da, wo es ist**, in seiner echten Form, Größe und seinem
  Winkel, mit Automorph, Showcase, der Advanced-Steuerung für WLED und bewegtem Regen und Schnee
  ([Kapitel 15](15-the-atlas.md)).
- **Live Aboard**, dein Haus in 3D, wie der Blick in ein Haus bei Die Sims: erleuchtete Fenster in
  der Nacht, Regen und Schnee, der Studio-Himmel, ein Gang durchs Haus auf Augenhöhe und eine
  Ansicht, die zur Türklingel, zu einer Tür oder zu einem Alarm fliegt. Es ist experimentell
  ([Kapitel 16](16-live-aboard.md)).
- **Furnish**: Möbel, Treppen, Böden und Wandfarben, Geräte, die mitlaufen, wenn das echte läuft,
  und eine Figur für jede Person ([Kapitel 17](17-furnish.md)).
- **Den Wandmodus** auf der Atlas-Seite und das neue Layout des Atlas, in dem jeder Bildschirm
  wählt, was er zeigt ([Kapitel 18](18-wall-screens-and-kiosks.md)).
- **Den Atlas als deine Übersicht**, und Personen und Tags auf der Karte.
- **Die KI-Helfer**, die das Haus aus deinen Grundrissen bauen ([Kapitel 19](19-ai-features.md)).
- **Jedes Add-on** (siehe unten) und jede neue Funktion, solange der Schlüssel läuft.

Ein Pro-Schlüssel gilt für bis zu fünf Zuhause (bei mehr als zwei lässt jedes seinen
Nutzungsbericht an).

| Edition | Schlüssel | Was es ist |
|---|:---:|---|
| **PadSpan HA** | keiner | Alles aus der kostenlosen Liste oben. Kein Schlüssel, und es läuft nicht ab. |
| **PadSpan Pro** | `pro` | Alles oben, dazu: genaues Platzieren im Atlas (Form, Größe und Winkel jedes Lichts, WLED, Automorph, Showcase), Live Aboard (dein Haus in 3D, experimentell) mit Furnish, der Wandmodus und das neue Layout, der Atlas als Übersicht, Personen auf der Karte, die KI-Funktionen und jedes Add-on. |
| **Add-ons** | `free`, mit Add-ons | Je eine Funktion, für eine Installation ohne Pro: Audio, Alarm & Sicherheit, WLAN-Abdeckung, Klimakarte, Wiedergabe (in PadSpan 0.38.300 und 0.38.301 als „Zeitreise“ aufgeführt), Urlaubsmodus & Voreinstellungen, Looks-Paket, Forensik und Präsenz-Auswertungen. Jedes gilt 2 Jahre, auf bis zu drei Zuhause ([Kapitel 25](25-padspan-pro.md#add-ons)). |
| [**PadSpan Bright**](https://github.com/gbroeckling/padspanBright) | keiner | Ein eigener, leichterer Download aus demselben Code: nur der Atlas, für ein Haus, das seine Lichter auf einer Karte will und keine Anwesenheitserkennung. |
| **PadSpan Bright Pro** | `bright` | Brights Werkzeuge zum Platzieren (Platzieren, Formen, die Advanced-Steuerung für WLED, Automorph, Showcase) und die Alarmsteuerung, auf einer Bright-Installation. Verkauft bis zum 15. Dezember 2026. |

Ein PadSpan-Pro-Schlüssel öffnet auch Brights Werkzeuge, wenn du stattdessen Bright installierst.

Wenn ein Schlüssel abläuft, funktioniert er noch 14 Tage weiter. Danach wird nichts gelöscht, was du
eingerichtet hast. Die Platzierung der Lichter ist dann schreibgeschützt, Forensik hört auf
aufzuzeichnen (was es aufgezeichnet hat, bleibt für seine Aufbewahrungszeit), und das 3D-Haus, der
Wandbildschirm, Finden und Busy Times schalten sich ab. Wenn du verlängerst, kommt alles so zurück,
wie du es verlassen hast.

### Der kostenlose Testzeitraum

Ist kein Schlüssel auf der Installation, hat **Einstellungen → Funktionen → PadSpan-Lizenz** den
Knopf **Start 90-day free trial**: ganz Pro für 90 Tage, jedes Add-on dabei, ohne Kreditkarte, ein
Testzeitraum pro Zuhause. Ein Administrator startet ihn. Dafür muss der Nutzungsbericht an sein, und
er bleibt an, bis der Testzeitraum endet. Schlüssel und Preise stehen auf
[padspan.traks.ca](https://padspan.traks.ca). Testzeitraum, Schlüssel, Zuhause und Tester erklärt
[Kapitel 25](25-padspan-pro.md).

### Du willst nur eine Sache?

Ein Add-on bringt einer Installation ohne Pro eine Funktion. Eine Zahlung gilt 2 Jahre auf bis zu
drei Zuhause, und ein Schlüssel trägt jedes Add-on, das du kaufst. PadSpan Pro enthält sie alle. Was
jedes bringt, steht in [Kapitel 25](25-padspan-pro.md#add-ons), ausführlicher (auf Englisch) in
[PadSpan Pro and the add-ons](../../PADSPAN_PRO.md#just-want-one-thing-the-add-ons). Zu kaufen gibt
es sie auf [padspan.traks.ca/#addons](https://padspan.traks.ca/#addons).

## Passt es zu mir?

PadSpan passt gut, wenn:

- **du dein Haus auf einem Bildschirm willst**: die Lichter in ihren Räumen, nur ein Tippen entfernt,
  die Schlösser und die Alarme. Dafür brauchst du nur Home Assistant, keinen Empfänger.
- **du wissen willst, in welchem Raum jemand ist**, nicht nur, ob er zu Hause ist. Dafür braucht es
  einen Empfänger in jedem Raum, den du unterscheiden willst. Ein Empfänger unterscheidet zu Hause
  von weg und mehr nicht.
- **du schon Bluetooth-Proxys hast**, oder Shellys (Gen2 oder neuer), oder in ein paar Räume ein
  ESP32-Board stellen kannst. PadSpan nutzt, was Home Assistant schon hört. Es braucht keine eigene
  Firmware.
- **alle, die in einem Raum erscheinen sollen, ein Handy, eine Uhr oder einen Tag dabeihaben.** Ein
  Android-Handy mit der Home Assistant Companion App funktioniert nach einem Schalter in der App. Ein
  iPhone oder eine Apple Watch braucht einmal seinen Schlüssel (den IRK). Ein Beacon oder
  Schlüsselanhänger mit fester Adresse funktioniert, sobald du ihn benennst.
- **du es gern siehst.** PadSpan zeigt auf einer Karte deines Hauses, wer wo ist, und lässt dich es
  abspielen.

Überleg es dir noch einmal, oder fang klein an, wenn:

- **du genau wissen musst, wo jemand steht.** Bluetooth liefert einen Raum und mit genug Empfängern
  eine ungefähre Stelle darin. Wände, Körper und Möbel verändern das Signal, deshalb kann ein Gerät
  nahe einer Tür im Nebenraum erscheinen.
- **deine Geräte ihre Bluetooth-Adresse wechseln und keinen Schlüssel haben, an den du kommst.** Ein
  AirTag, ein Samsung SmartTag oder ein Handy ohne die Companion App oder seinen IRK ist zu hören,
  lässt sich aber nicht lange auseinanderhalten. PadSpan hat einen experimentellen Schalter für
  AirTags (MAC-Wechsel überbrücken), kann sie aber nicht versprechen.
- **dein Home Assistant auf einem Rechner mit 2 GB an einer belebten Straße läuft.** PadSpan hört
  jedes vorbeikommende Gerät. Mehr als 2 GB Speicher werden empfohlen. Siehe
  [Kapitel 2](02-requirements.md).
- **du es draußen willst, über einen großen Garten oder einen Bauernhof.** Räume kommen von
  Empfängern; draußen braucht jeder Bereich, den du unterscheiden willst, seinen eigenen.

Zum Anfangen brauchst du keinen Grundriss. Installier es, gib jedem Empfänger seinen Bereich, und
**Wer ist wo** zeigt noch am selben Tag Räume. [Kapitel 4](04-first-room.md) führt dich durch.

## Im Vergleich

[Bermuda](https://github.com/agittins/bermuda) und [ESPresense](https://espresense.com/) sind beide
gut, und viele nutzen sie. Hier steht, was jedes kann, nach ihren eigenen Dokumenten, Stand Oktober
2026. Ist hier etwas veraltet, [eröffne ein Issue](https://github.com/gbroeckling/padspanHA/issues).

| | PadSpan HA | Bermuda | ESPresense (+ Companion) |
|:--|:--|:--|:--|
| Anwesenheit pro Raum | Ja | Ja | Ja |
| Hardware | ESPHome-Bluetooth-Proxys, Shelly Gen2+, das eigene Bluetooth von HA oder ein USB-Adapter, oder ESPresense über MQTT, sobald eingeschaltet | ESPHome-Bluetooth-Proxys, Shelly Gen2+, USB-Adapter | Eigene Firmware auf ESP32-Knoten |
| Grundriss nötig? | Nein: Räume kommen aus dem HA-Bereich jedes Empfängers; die Karte ist optional | Nein | Für Räume nicht; die Karte von Companion braucht deine Räume als Koordinaten |
| Karte deines Zuhauses | Ja, Räume auf deinen Grundriss gezeichnet | Nein | Ja, in Companion |
| 3D-Ansicht über mehrere Etagen | Ja (das volle 3D-Haus, Live Aboard, ist Pro) | Nein (es hat einen Etagensensor) | Ja, in Companion |
| Position zwischen Empfängern | Ja, mit 3 oder mehr Empfängern auf einem Grundriss mit Maßstab | Nein | Ja, in Companion |
| Kalibrierung | Fingerabdrücke beim Rundgang und eine Signalanpassung pro Empfänger | Geführt: global, pro Proxy und pro Gerät | Von Hand an jedem Knoten; automatisch in Companion |
| iPhones und Apple Watches (IRK) | Ja, über Private BLE Device oder irk-capture, mit einer Einrichtungsanleitung | Ja, über Private BLE Device | Ja, auf der Webseite des Knotens eingetragen |
| Tags, die ihre Adresse wechseln (AirTag, SmartTag) | Experimentell | Nein | Nein (AirTags lassen sich nur zählen) |
| Entitäten für Raum, Entfernung und Tracker | Ja | Ja | Ein Raumsensor mit Entfernung; ein Tracker von Companion |
| Bewegungsverlauf | Abspielen in Traceback | Der eigene Verlauf von HA | Pfadansicht in Companion |
| Alarme, wenn ein Gerät den Raum wechselt | Eingebaut (Folgen) | Mit deinen eigenen Automationen | Mit deinen eigenen Automationen |
| Wo du es einrichtest | Eine PadSpan-Seite in der HA-Seitenleiste | Die Einrichtungsdialoge von Home Assistant | Die Webseite des Knotens und die Companion-App |

**Du nutzt schon Bermuda?** Behalte es. PadSpan läuft daneben auf denselben Proxys und lässt es, wie
es ist: [Bermuda und PadSpan zusammen](https://padspan.traks.ca/guides/bermuda/).

## Was PadSpan nie anfasst

PadSpan liest deine anderen Integrationen und lässt sie, wie sie sind. Wenn du es installierst,
deaktivierst oder entfernst, ändert das nichts an den Geräten, Entitäten oder Einstellungen einer
anderen Integration. Die einzigen Ausnahmen sind Knöpfe, die du selbst drückst, einen nach dem
anderen: den Schlüssel eines iPhones zu Private BLE Device hinzufügen, einem Empfänger seinen Bereich
geben, den Sensor BLE Transmitter eines Handys einschalten und die Löschknöpfe in Verwalten. Die
[README](../../../README.md#what-padspan-never-touches) hat die vollständige Liste, und was das Haus
verlässt, steht unter [Updates & Privacy](../../../README.md#updates--privacy).
