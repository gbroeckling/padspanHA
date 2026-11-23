# 1. Was PadSpan ist

[Inhalt](README.md)

PadSpan HA ist eine Home-Assistant-Integration für die Anwesenheit pro Raum über Bluetooth. Es hört
auf die Bluetooth-Empfänger, die dein Home Assistant schon hat (ESPHome-Bluetooth-Proxys, Shellys,
das eigene Bluetooth des Rechners, ESPresense oder Tasmota), ermittelt alle 5 Sekunden, in welchem
Raum jedes Handy, jede Uhr, jeder Tag und jeder Beacon ist, und gibt deinen Automationen für jedes
Gerät, das du benennst, einen Raum, eine Entfernung und zu Hause oder weg. Es läuft auf deinem Home
Assistant: Die Ortung braucht keine Cloud.

PadSpan hat eine eigene Seite in der Seitenleiste von Home Assistant. Dort siehst du, wer wo ist,
folgst einem Gerät, spielst ab, wo es war, und zeichnest, wenn du willst, dein Haus auf einen
Grundriss, damit du alles auf einer Karte siehst.

Du kannst es vor der Installation ausprobieren: [padspan.traks.ca/demo](https://padspan.traks.ca/demo/)
ist das echte Panel an einem Beispielhaus, in deinem Browser.

## Was du kostenlos bekommst

PadSpan HA ist kostenlos und Open Source (GPL v3). Ohne Schlüssel bekommst du:

- **Räume ohne Grundriss.** Der Raum jedes Empfängers ist sein Home-Assistant-Bereich. Ein Gerät
  kommt in den Raum, dessen Empfänger es am besten hört. Die Karte **Wer ist wo** in der Übersicht
  listet jeden Raum und wer darin ist.
- **Entitäten für deine Automationen.** Jedes Gerät, das du benennst, bekommt einen Device Tracker
  (sein Zustand ist der Raum oder `not_home`), einen Bereichssensor und Entfernungssensoren.
  Ereignisse werden ausgelöst, wenn ein benanntes Gerät ankommt, geht oder den Raum wechselt. Siehe
  [Kapitel 14](14-home-assistant-reference.md).
- **Eine Karte deines Hauses.** Lade einen Grundriss hoch (oder fang ohne an), leg seinen Maßstab
  fest, zeichne deine Räume und platziere deine Empfänger. Mit drei oder mehr Empfängern auf einem
  Grundriss mit Maßstab verortet PadSpan Geräte auch zwischen ihnen, sogar in einem Raum ohne
  eigenen Empfänger.
- **Kalibrierung.** Geh mit deinem Handy durchs Haus, damit PadSpan lernt, wie jede Stelle wirklich
  klingt.
- **Folgen**, mit Alarmen aufs Handy oder per E-Mail, wenn ein Gerät den Raum wechselt, ankommt oder
  geht.
- **Traceback**, eine Wiedergabe, wohin Geräte gegangen sind, mit **Insights** (Zeit in jedem Raum).
- **Belegung**, eine Schätzung, wie viele Leute im Gebäude sind.
- **Der Atlas**, die Lichtkarte deines Hauses: jedes Licht auf seiner Etage und in seinem Raum, und
  ein Tippen schaltet es.

## Was PadSpan Pro dazu bringt

Ein Lizenzschlüssel schaltet die kostenpflichtigen Teile auf derselben Installation frei. Nichts
neu installieren, nichts neu einrichten.

| Edition | Schlüssel | Was es ist |
|---|:---:|---|
| **PadSpan HA** | keiner | Anwesenheit pro Raum, Grundrisse, Kalibrierung, Bewegungsverlauf und die Sensoren für deine Automationen. Kostenlos. |
| **PadSpan Pro** | `pro` | Alles oben, dazu: genaues Platzieren im Atlas (Form, Größe und Winkel jedes Lichts, WLED, Automorph, Showcase), Live Aboard (dein Haus in 3D, experimentell) mit Furnish, der Wandbildschirm, Whole house presets und Vacation Mode, Forensik, Busy Times, Finden und die Designs Graphit, Ozean, Dämmerung und Tag. |
| [**PadSpan Bright**](https://github.com/gbroeckling/padspanBright) | keiner | Ein eigener, leichterer Download aus demselben Code: nur der Atlas, für ein Haus, das seine Lichter auf einer Karte will und keine Anwesenheitserkennung. |
| **PadSpan Bright Pro** | `bright` | Brights volle Atlas-Werkzeuge (Platzieren, Formen, WLED, Automorph, Showcase), auf einer Bright-Installation. |

Ein PadSpan-Pro-Schlüssel schaltet auch Brights Werkzeuge frei, wenn du stattdessen Bright
installierst.

Wenn ein Schlüssel abläuft, wird nichts gelöscht, was du eingerichtet hast. Die Platzierung der
Lichter ist dann schreibgeschützt, Forensik hört auf aufzuzeichnen (was es aufgezeichnet hat, bleibt
für seine Aufbewahrungszeit), und das 3D-Haus, der Wandbildschirm, Finden und Busy Times schalten
sich ab. Wenn du verlängerst, kommt alles so zurück, wie du es verlassen hast.

### Der kostenlose Testzeitraum

Ist kein Schlüssel auf der Installation, hat **Einstellungen → Funktionen → PadSpan licence** den
Knopf **Start 90-day free trial**: ganz Pro für 90 Tage, ohne Kreditkarte, ein Testzeitraum pro
Zuhause. Ein Administrator startet ihn. Dafür muss der Nutzungsbericht an sein, und er bleibt an, bis
der Testzeitraum endet. Schlüssel und Preise stehen auf [padspan.traks.ca](https://padspan.traks.ca).
Testzeitraum, Schlüssel, Zuhause und Tester erklärt [Kapitel 25](25-padspan-pro.md).

## Passt es zu mir?

PadSpan passt gut, wenn:

- **du wissen willst, in welchem Raum jemand ist**, nicht nur, ob er zu Hause ist. Dafür braucht es
  einen Empfänger in jedem Raum, den du unterscheiden willst. Ein Empfänger unterscheidet zu Hause
  von weg und mehr nicht.
- **du schon Bluetooth-Proxys hast**, oder Shellys (Gen2 oder neuer), oder in ein paar Räume ein
  ESP32-Board stellen kannst. PadSpan nutzt, was Home Assistant schon hört. Es braucht keine eigene
  Firmware.
- **die Leute, denen du folgen willst, ein Handy, eine Uhr oder einen Tag tragen.** Ein
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
  AirTags (MAC Rotation Bridging), kann sie aber nicht versprechen.
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
| Bewegungsverlauf | Wiedergabe (Traceback) | Der eigene Verlauf von HA | Pfadansicht in Companion |
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
