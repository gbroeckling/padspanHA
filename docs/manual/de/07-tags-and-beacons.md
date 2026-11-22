# 7. Tags, Beacons, AirTags und Gast-Tags

[Inhalt](README.md)

Damit du weißt, in welchem Raum deine Schlüssel, ein Hund oder ein Gast sind, muss Home Assistant
ihren Tag jedes Mal wiedererkennen, wenn ein Empfänger ihn hört. Ein einfacher Beacon mit fester
Kennung kann das. Die bekanntesten Tags sind gebaut, genau das nicht zu können: Ein AirTag wechselt
ständig seine Bluetooth-Adresse, damit ihm niemand folgen kann.

## Welcher Tag funktioniert

| Tag | Was er sendet | Raum für Raum? |
|---|---|---|
| Ein Beacon mit fester iBeacon-Kennung (Feasycom, Blue Charm, Minew und andere) | Jedes Mal dieselbe Kennung; bei vielen stellst du ein, wie oft | Ja. Kauf diese Art. |
| Alles mit einer festen Adresse (günstige Schlüsselfinder, Shelly BLU und andere BTHome-Geräte, Xiaomi-Thermometer, RuuviTag, einfache Uhren) | Jedes Mal dieselbe Bluetooth-Adresse | Ja, wenn es alle paar Sekunden sendet. Ein Sensor, der nur bei einem Ereignis sendet, hält keinen Raum. |
| Tile | Ältere behalten eine Adresse; neuere wechseln sie, wie berichtet wird | Vielleicht. Teste deinen, und kauf keinen dafür. |
| AirTag und andere Find-My-Tags | Etwa alle 15 Minuten eine neue Adresse in der Nähe des iPhones des Besitzers | Nicht zuverlässig. PadSpan kann einen benannten weiterführen, solange er in Reichweite bleibt (experimentell, unten). |
| Samsung SmartTag, Tags für Google Find Hub | Alle 15 bis 17 Minuten eine neue Kennung | Nein. |
| Ein Handy oder eine Smartwatch | Eine wechselnde Adresse, aber ein Schlüssel oder sein eigener Beacon verrät, wer es ist | Ja, nach einem Schritt pro Gerät: [Kapitel 6](06-phones-and-watches.md). |

Ein Beacon sendet jedes Mal dieselbe Kennung (eine UUID, Major und Minor) und wird deshalb auch dann
erkannt, wenn seine Adresse wechselt. Die Kehrseite: Jeder mit einem Bluetooth-Scanner kann diese
Kennung ebenfalls erkennen. Beim Hund ist das egal, aber denk darüber nach bei etwas, das du durch
die Stadt trägst.

## Worauf du achten solltest

- **Für Schlüssel**: ein kleiner Beacon mit einem Loch für den Schlüsselring, einer Knopfzelle, die
  du wechseln kannst, und einem Intervall, das du einstellen kannst. IP66 oder besser, wenn er in
  einer Hosentasche lebt.
- **Fürs Halsband**: wasserdicht (IPX7 oder IP67), leicht genug für das Tier und mit einem
  Batteriedeckel, der verschraubt oder versiegelt ist (eine verschluckte Knopfzelle kann einem
  Haustier schaden).
- **Für Gäste**: ein paar Beacons für den Schlüsselring, in einer Schublade. Mehrfachpacks können mit
  einer gemeinsamen Kennung kommen, also gib jedem in der App des Herstellers sein eigenes Minor.

**Wie oft er sendet.** Etwa einmal pro Sekunde ist ein guter Anfang. PadSpan nutzt keinen Messwert,
der älter als etwa 15 Sekunden ist, um einen Tag zu platzieren, also hält einer, der nur ab und zu
sendet, seinen Raum nicht. Ein schnelleres Intervall kostet Batterie: Die Angaben der Hersteller
für eine Knopfzelle reichen von unter einem Jahr bei 0,1 Sekunden bis zu mehreren Jahren bei einer
Sekunde.

## Teste einen Tag, bevor du dich auf ihn verlässt

Die Hersteller sagen selten, was ein Tag sendet, also sieh selbst nach.

1. Lass das Handy des Tags in der Nähe, falls er eins hat, mit dem Tag in seiner App eingerichtet.
   Ein Find-My-Tag fern von seinem Besitzer kann einen ganzen Tag lang eine Adresse behalten und
   dich täuschen.
2. Öffne den Bluetooth-Advertisement-Monitor von Home Assistant oder nRF Connect auf einem
   Android-Handy.
3. Halte den Tag neben einen Empfänger, um ihn an seinem Signal zu erkennen. Schreib seine Adresse
   auf (und bei einem Beacon seine UUID, Major und Minor).
4. Sieh nach einer Stunde noch einmal nach, und noch einmal nach einem Tag.

Dieselbe Adresse oder dieselbe Beacon-Kennung: Er lässt sich erkennen. Weg, solange sein Handy
verbunden ist: Er hört während einer Verbindung auf zu senden, also trenne ihn von seiner App oder
nimm einen anderen. Jedes Mal eine neue Adresse und keine feste Kennung: Nichts kann ihn erkennen.

## In PadSpan benennen

1. Halte den Tag neben einen Empfänger.
2. Öffne **Folgen** und **Tag zum Folgen wählen**. Die Liste beginnt mit dem stärksten Signal, dein
   Tag steht also weit oben, markiert mit **[Unerkannt]**.
3. Wähle ihn und dann **Diesen Tag benennen**. Halte den Namen kurz, etwa „Keys“.

Oder öffne auf der Karte **Objekte** der Übersicht (Modus Erweitert) **Alle Objekte**, wähle
**Benennen** in seiner Zeile, gib einen Namen ein und wähle **Namen speichern**. In der Nähe einer
belebten Straße ist diese Liste lang: Stell **Alle Zustände** auf **Erkannt** oder such.

Erst der Name gibt dem Tag seine Entitäten in Home Assistant. Für einen Tag namens Keys:

- `device_tracker.keys`: der Raum, `not_home`, sobald er so lange wie das **Abwesenheits-Timeout**
  nicht gehört wurde (in der Voreinstellung fünf Minuten), oder `unknown`, solange er keinen Raum
  hat.
- `sensor.keys_area`: der Raum, dazu Entfernungssensoren.

Jede Entität und jedes Attribut steht in [Kapitel 14](14-home-assistant-reference.md).

**Dinge, die niemand trägt.** Schlüssel auf dem Tisch im Flur, ein Tag an einer Tasche: In der
Voreinstellung gehen sie wie alles andere auf `not_home`, wenn sie nicht mehr gehört werden.
**Einstellungen → Ortung → Räume und Zeiten → Zuhause/Abwesend-Timeout → Dinge behalten ihren Raum**
behält stattdessen bis zu 48 Stunden lang ihren letzten Raum.

**Ein benannter Tag ist keine Person.** PadSpans Personenzählung lässt Schlüssel, Beacons, Kisten und
Fahrzeuge aus, damit Schlüssel zu Hause ein leeres Haus nicht bewohnt aussehen lassen.

**Was es nicht kann**: einen Tag klingeln lassen oder seine Batterie auslesen. Ein Tag mit leerer
Batterie sieht genauso aus wie einer, der das Haus verlassen hat.

**Folgen** hat auch für einen Tag **Bewegungsalarme** ([Kapitel 13](13-alerts.md)), und
**Traceback** behält seinen Verlauf.

## Eine erste Automation: Schlüssel vergessen

Für den Fall, dass du gehst und deine Schlüssel nicht. Die Person braucht einen Tracker, der weiß,
dass sie weg ist, etwa den der Companion App:

```yaml
alias: Keys left behind
triggers:
  - trigger: state
    entity_id: person.alex
    to: not_home
    for: "00:06:00"
conditions:
  - condition: not
    conditions:
      - condition: state
        entity_id: device_tracker.keys
        state: not_home
actions:
  - action: notify.mobile_app_alex_phone
    data:
      message: "Your keys are still at home: {{ states('device_tracker.keys') }}"
```

Die sechs Minuten sind länger als das **Abwesenheits-Timeout** von fünf Minuten, also stehen
Schlüssel in deiner Tasche auf `not_home`, wenn die Automation prüft. Hast du das Timeout erhöht,
erhöh auch diesen Wert.

## AirTags, die du schon hast

- **Zu Hause oder weg**: Find My weiß, wo sie sind, und manche bringen das auf anderen Wegen nach
  Home Assistant. Das ergibt Zonen, keine Räume.
- **In PadSpan (experimentell)**: Schalte **Einstellungen → Funktionen → MAC Rotation Bridging** ein
  (ab Werk aus) und benenne den Tag. Wechselt der Tag seine Adresse, übernimmt PadSpan Namen, Raum
  und Verlauf, wenn klar ist, welcher es ist: dieselbe Art Tag, die alte Adresse ist verstummt, die
  neue tauchte genau in dem Moment auf und wird am selben Ort gehört. Zwei Tags, die zusammen liegen
  und gleichzeitig wechseln, bleiben getrennt, und ein Tag, der außer Reichweite gewechselt hat,
  kommt als neues Gerät zurück, das du noch einmal benennst. Derselbe Schalter verknüpft andere
  Geräte mit wechselnder Adresse anhand dessen, was sie senden, und das kann gelegentlich das
  falsche verknüpfen.
- Es passt also zu einem Tag, der zu Hause bleibt, an einer Fernbedienung oder in einer Tasche,
  nicht zu Schlüsseln, die du aus dem Haus trägst.
- **Nichts für Gäste oder Haustiere.** Ein Gast mit deinem AirTag bekommt Apples Warnung, dass sich
  ein AirTag mit ihm bewegt, und ein AirTag fern von seinem Besitzer spielt einen Ton ab. Nimm für
  einen Gast einen Beacon.

## Gast-Tags

Leih einem Gast einen Tag (einer Haushüterin, einem Verwandten, einer Reinigungskraft, einem
Handwerker), und PadSpan folgt ihm Raum für Raum, solange der Gast ihn hat. Gibt er ihn zurück,
kommt der Tag wieder in die Schublade, und der Bericht des Aufenthalts wird so lange aufbewahrt,
wie du wählst. Gast-Tags sind kostenlos und aus, bis du sie einschaltest. Nur ein Administrator kann
sie einschalten, einen Tag verleihen oder einen Aufenthalt beenden.

### Einschalten

**Einstellungen → Ortung → Handys und Gast-Tags → Gast-Tags → Tags als Gast-Tags nutzen.** Hier
wählst du auch, wie lange der Bericht eines beendeten Aufenthalts aufbewahrt wird: gar nicht, 7, 30
(die Voreinstellung) oder 90 Tage. Im Menü erscheint der Bildschirm **Gäste**.

### Einen Tag zum Gast-Tag machen

Benenne zuerst einen freien Tag (oben), etwa „Guest tag 1“. Wähle ihn in **Gäste** unter
**Use as a guest tag** und dann **Add**.

Der Tag behält seinen eigenen Namen; der Name des Gastes gehört zum Aufenthalt. So bleibt
`device_tracker.guest_tag_1` von einem Gast zum nächsten dieselbe Entität, und deine Automationen
funktionieren weiter.

### Verleihen

Wähle am Tag **Lend to a guest**:

- **Guest's name**.
- **Until (optional — the stay ends by itself then)**.
- **Rooms they shouldn't go into**: Du bekommst Bescheid, wenn der Gast eine halbe Minute in einem
  davon war. Durch eine Tür gehen zählt nicht.
- **Tell me when they arrive**, **Tell me when they leave**.
- **Staying here (a house-sitter)**: zählt für den Urlaubsmodus als jemand zu Hause.
- **Send notices to**: ein Handy oder ein anderes notify-Ziel, oder **A Home Assistant notification**.
- **Quiet hours**: dann keine Hinweise zu Ankunft oder Abschied. Hinweise zu gesperrten Räumen
  kommen trotzdem.

Sag deinem Gast, dass der Tag geortet wird, und verleih ihn nur, wenn er einverstanden ist. Ein
Beacon warnt niemanden so, wie es ein AirTag tut, also liegt es an dir, es ihm zu sagen. In vielen
Ländern ist es verboten, eine Person ohne ihre Einwilligung zu orten.

### Während des Aufenthalts

**Gäste → Staying now** zeigt, wo der Gast ist (oder dass der Tag nicht gehört wird), seit wann, bis
wann und die bisherige Zeit in jedem Raum. **Change** bearbeitet den Aufenthalt. **Traceback** öffnet
den Verlauf des Tags für den Aufenthalt. In der Übersicht, im Atlas und in Live Aboard zeigt der Tag
den Namen des Gastes mit einem Abzeichen **Gast**. Solange ein Tag verliehen ist, bleiben seine
eigenen Alarme aus Folgen still; der Aufenthalt schickt seine eigenen.

### Wenn er ihn zurückgibt

Wähle **Tag returned**. Der Aufenthalt wandert mit seinem Bericht zu **Past stays**: wann der Gast
zuerst kam und zuletzt ging, wann er hinausging und wiederkam, die Zeit in jedem Raum, Besuche in
gesperrten Räumen und die gesendeten Hinweise. **Forget** löscht einen Aufenthalt sofort, mitsamt
Namen.

Vergessen, einen zu beenden? Wurde der Tag zwei Tage lang nicht gehört, fragt PadSpan, ob der
Aufenthalt vorbei ist. Nach einer Woche ohne Signal endet er von selbst.

### Für Automationen

`binary_sensor.padspan_guest_home`, die Gast-Attribute am Tracker des Tags und das Ereignis
`padspan_ha_guest` stehen in [Kapitel 14](14-home-assistant-reference.md). Die Hinweise stehen in
[Kapitel 13](13-alerts.md).

### Datenschutz der Gäste

Die Namen der Gäste bleiben in deinem Home Assistant. Sie stehen weder im Nutzungsbericht noch in
einem PadSpan-Backup. Ein beendeter Aufenthalt wird nach den Tagen gelöscht, die du eingestellt
hast, und ein Zurücksetzen auf Werkseinstellungen löscht alle Gast-Tags und Aufenthalte.

## Wenn ein Tag nicht auftaucht

- **Er steht gar nicht in der Liste.** Manche Tags schlafen, bis sie einmal gekoppelt wurden oder
  ein Knopf gedrückt wurde. Andere verstummen, solange sie mit ihrer App verbunden sind.
- **Sein Name verschwindet immer wieder.** Er wechselt seine Adresse: Mach den Test von oben.
- **Er wird gehört, bekommt aber nie einen Raum.** Seine Empfänger brauchen Bereiche in Home
  Assistant: **Zustand → Scanner → Raum** listet den Raum jedes Empfängers.
- **Er springt zwischen Räumen**: [Kapitel 26](26-troubleshooting.md#ein-gerät-zeigt-den-falschen-raum-oder-springt-zwischen-räumen).
  Tief am Halsband hat es ein Tag schwerer: Ein Haustier, das auf seinem Tag liegt, blockiert das
  Signal.
