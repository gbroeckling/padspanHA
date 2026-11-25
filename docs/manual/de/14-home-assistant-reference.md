# 14. Home Assistant: Entitäten, Dienste, Ereignisse, Assist

[Inhalt](README.md)

Alles, was PadSpan Home Assistant für Automationen, Skripte, Dashboards und Assist gibt. Die
Tabellen entstehen mit `scripts/build_manual_reference.py` aus PadSpans Code, und ein Test schlägt
fehl, wenn sie und der Code nicht übereinstimmen. Sie beschreiben also die Version, mit der sie
ausgeliefert werden.

## Wie Entitäten benannt werden

PadSpan legt Entitäten nur für Geräte an, die du in PadSpan **benannt** hast (ein Name an einer
Bluetooth-Adresse, ein Handy oder eine Uhr, benannt über seinen Schlüssel, oder ein iBeacon). Die
Tausenden unbenannten Geräte, die ein Haus hört, bekommen keine.

Jedes benannte Gerät ist in Home Assistant ein Gerät mit dem Namen, den es in PadSpan hat. Seine
Entitäten bekommen ihre IDs aus diesem Namen, so wie Home Assistant es immer macht: kleingeschrieben,
Leerzeichen und Satzzeichen als `_`. Ein Tag namens „Car keys“ bekommt `device_tracker.car_keys`,
`sensor.car_keys_area` und `sensor.car_keys_distance`. Ist eine ID schon vergeben, hängt Home
Assistant `_2` an. Du kannst eine Entität in Home Assistant umbenennen; PadSpan folgt ihr über ihre
eindeutige ID, nicht über ihren Namen.

Welche Arten von Entitäten PadSpan anlegt, stellst du unter
**Verwalten → HA Entities → Entity Publishing Controls** ein: Der Tracker, der Bereichssensor, der
Entfernungssensor und die Entfernungssensoren pro Empfänger sind an, bis du ihr Häkchen wegnimmst;
der Belegungssensor und die Teilzonen sind aus, bis du sie anhakst. Eine Art ohne Häkchen ist im
Entitätsregister von Home Assistant deaktiviert, und wieder angehakt kommt sie zurück. PadSpan muss
neu laden, bevor eine neu angehakte Art für Geräte erscheint, die es schon hat.

„In HA's history“ in den Tabellen sagt, ob die Datenbank von Home Assistant dieses Attribut behält.
Die, die sich mit jeder Abfrage ändern (etwa alle 5 Sekunden), wie `rssi` und `age_s`, bleiben aus
der Datenbank heraus, damit sie klein bleibt. Sie stehen trotzdem an der Entität, Automationen und
Templates können sie also lesen.

`<device>` steht für den ID-Teil des Geräts, `<receiver>` für den Empfänger, wie PadSpan ihn nennt,
und `<sub-zone>` für den Namen der Teilzone.

## Entitäten

Die folgenden Tabellen sind englisch: Sie entstehen direkt aus PadSpans Code.

<!-- english:entities -->

## Dienste

Die folgenden Tabellen sind englisch: Sie entstehen direkt aus PadSpans Code.

<!-- english:services -->

`padspan_ha.dump_devices` kann seine Liste an den Aufrufer zurückgeben: Gib der Aktion in einem
Skript eine `response_variable` und lies daraus `devices` (die Daten jedes Geräts, unter PadSpans
Schlüssel dafür), `count`, `version` und `timestamp`. Mit `notify: false` gibt er nur die Liste
zurück.

`padspan_ha.set_room_tag_map` speichert eine Liste, welche PadSpan-Objekte in welchen Raum gehören.
PadSpan vergleicht sie mit dem, was es gerade hört, und zeigt die fehlenden. Die meisten Haushalte
brauchen das nie.

## Ereignisse

Jedes davon kann eine Automation auslösen (Auslöser **Ereignis**, mit dem Ereignistyp unten). Sie
kommen nur für Geräte, die du benannt hast.

Die folgenden Tabellen sind englisch: Sie entstehen direkt aus PadSpans Code.

<!-- english:events -->

Ist **Tag-Ereignisse bei Raumwechsel** an, kommt jedes `padspan_room_change` auch als eigener
Auslöser **Tag** von Home Assistant: PadSpan meldet einen Tag-Scan mit der Tag-ID `padspan_…` für
dieses Gerät. Die IDs stehen auf der Karte dazu unter Einstellungen → Ortung → Home Assistant und
Integrationen, bei HA-Tags-Integration. Home Assistant nimmt jeden solchen Tag in seine Liste der
Tags auf.

## Assist: „In welchem Raum ist Alex?“

Das eigene Assist von Home Assistant beantwortet „Wo ist Alex?“ für eine Person, und eine Person
übernimmt den Raum von einem PadSpan-Tracker nur, wenn kein anderer Tracker dieser Person mehr sagt:
Das GPS eines Handys oder das „zu Hause“ eines Routers gewinnt. Für eine Antwort, die immer den Raum
nennt, bringt PadSpan einen eigenen Intent mit. Er tut nichts, bis du Sätze dafür hinzufügst.
Speichere das hier als `config/custom_sentences/en/padspan.yaml` und starte Home Assistant neu (oder
lade es auf der Debug-Seite von Assist neu):

```yaml
language: "en"
intents:
  PadSpanWhereIs:
    data:
      - sentences:
          - "which room is {padspan_person} in"
          - "what room is {padspan_person} in"
          - "where in the house is {padspan_person}"
lists:
  padspan_person:
    wildcard: true
```

Das Folgende ist englisch: Es entsteht direkt aus PadSpans Code.

<!-- english:assist -->

Der Name ist der PadSpan-Name des Geräts („Alex“). Er passt auch zu einem Namen, der damit anfängt
(„Alex's Phone“, „Alex Watch“); passen mehrere, nimmt er das Gerät, das zuletzt gehört wurde. Du
musst Assist nichts freigeben. Der Intent liest nur PadSpans aktuellen Raum und ändert nichts. Die
Antworten sind auf Englisch. Mehr dazu, was die eigenen Sätze von Home Assistant tun: [Assist
fragen, wo jemand ist](../../GETTING_STARTED.md#ask-assist-where-someone-is).

## MQTT (experimentell)

Ist **Enable experimental MQTT publishing** angehakt (Verwalten → HA Entities → MQTT Publishing;
aus, bis du es anhakst) und die MQTT-Integration von Home Assistant eingerichtet, veröffentlicht
PadSpan außerdem jedes benannte Gerät nach jeder Abfrage, mit Retain. Hier ist `<device>` der Name,
kleingeschrieben, mit Leerzeichen als `_`. Die Topics können sich in einer späteren Version ändern.

Die folgende Tabelle ist englisch: Sie entsteht direkt aus PadSpans Code.

<!-- english:mqtt -->

## Licht folgt Personen

PadSpan kann Raumlichter selbst schalten, ohne dass du eine Automation schreibst. Das ist kostenlos
und aus, bis du es einschaltest: Einstellungen → Ortung → Home Assistant und Integrationen →
**Licht folgt Personen**, Haken bei **Raumlichter ein- und ausschalten, wenn Personen sich
bewegen**. Bis dahin wird nichts geschaltet.

- **Wenn jemand hereinkommt**: Kommt eine Person mit einem benannten Handy, einer Uhr oder einem
  Tag in einen Raum, den du eingerichtet hast, gehen dessen Lichter an. Nur beim Hereinkommen: Ein
  Licht, das jemand später ausschaltet, wird nicht wieder eingeschaltet, und auch die Dämmerung,
  während jemand im Raum sitzt, schaltet es nicht ein.
- **Wenn der Raum leer ist**: War so lange niemand im Raum, wie seine Ausschaltverzögerung sagt
  (2 Minuten, wenn du nicht 30 Sekunden bis eine Stunde wählst), gehen seine Lichter aus, einmal.
  Nur in einem Raum, in dem jemand Verfolgtes war: Ein Licht, das in einem Raum eingeschaltet
  wurde, in dem niemand Verfolgtes war, bleibt an. Wer das Haus verlässt, verlässt auch den Raum.
- **Ein Licht, das von Hand ausgeschaltet wurde, bleibt aus**: Schaltet jemand die Lichter des
  Raums aus, während er darin ist (am Schalter, in Home Assistant oder durch eine andere
  Automation), lässt PadSpan sie aus, bis alle den Raum eine Minute lang verlassen haben und jemand
  wiederkommt. Ein Gang zur Tür und zurück ist kein Verlassen.

Für jeden Raum, unter **Raum hinzufügen…**:

- **Lichter**: beliebige Lichter und Schalter. Ein neuer Raum beginnt mit den Lichtern des
  Home-Assistant-Bereichs mit demselben Namen. Ein Raum wird gespeichert, sobald er ein Licht hat.
- **Aus, wenn leer seit**: die Ausschaltverzögerung.
- **Einschalten**: immer, nur wenn die Sonne untergegangen ist, oder nur wenn ein
  Helligkeitssensor weniger misst als ein Wert, den du einstellst (in Lux). Eine Sonne oder ein
  Helligkeitssensor, die sich nicht lesen lassen, zählen als dunkel.
- **Ruhezeiten**: ein Zeitraum, in dem nichts eingeschaltet wird (er darf über Mitternacht gehen).
  Ist der Raum leer, gehen die Lichter trotzdem aus.
- **Sensoren**: Bewegungs-, Belegungs- oder Anwesenheitssensoren im Raum. Ein Raumwechsel wartet
  auf die Verzögerung beim Raumwechsel (Einstellungen → Ortung → Räume und Zeiten), 20 bis 40
  Sekunden, das Licht käme also spät. Setzt PadSpans letzte Messung jemanden schon in einen Raum
  und sieht der eigene Sensor dieses Raums Bewegung, gehen die Lichter sofort an. Ein neuer Raum
  beginnt mit den Bewegungsmeldern seines Bereichs. Ein Sensor allein, ohne verfolgte Person,
  schaltet nichts ein.

**Personen**: Jedes Gerät, dem du einen Namen gegeben hast, zählt, außer Gast-Tags
([Kapitel 7](07-tags-and-beacons.md#gast-tags)). Nimm den Haken bei jedem weg, der keine Lichter
schalten soll, und setz ihn bei einem Gast-Tag, der es soll. Ein Tag, das liegen bleibt
(Schlüssel, eine Tasche), hält seinen Raum hell: Nimm dort den Haken weg.

Was jeder Raum gerade hat (wer darin ist und ob ein Licht von Hand ausgeschaltet wurde), steht
unter dem Raum. Der freiwillige Nutzungsbericht zählt, wie oft Lichter geschaltet wurden und warum
nicht, nie einen Raum, einen Namen oder ein Licht
([Kapitel 24](24-privacy.md#der-nutzungsbericht-freiwillig)).

### Blueprints für eigene Automationen

Drei Blueprints für Home Assistant tun dasselbe mit den eigenen Automationen von Home Assistant,
aus PadSpans Bereichssensoren. Importiere einen und erstelle daraus eine Automation unter
Einstellungen → Automationen & Szenen → Blueprints.

- [Room lights follow people](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2Froom_lights_follow_people.yaml): die Lichter eines Raums an für
  die erste Person, die hereinkommt, aus, wenn eine Weile niemand Gewähltes darin war.
- [Lights on in whichever room you walk into](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2Flights_on_in_whichever_room.yaml): eine
  Automation für das ganze Haus, über den Bereich, der wie der Raum heißt.
- [Lights off when a room is empty](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2Froom_lights_off_when_empty.yaml): aus, wenn eine Weile
  weder ein Handy noch ein Bewegungsmelder jemanden gesehen hat.

Die Blueprints sind auf Englisch. Sie liegen im Repository unter
`blueprints/automation/padspan_ha/`.

## Drei Automationen

Jede ist eine ganze Automation: Füg sie in einer neuen Automation unter **In YAML bearbeiten** ein.
Die Namen sind Beispiele; nimm deine eigenen Entitäts-IDs.

**Ein Licht an, wenn Alex in die Küche kommt**, nur wenn PadSpan sich des Raums ziemlich sicher ist:

```yaml
alias: Kitchen light for Alex
trigger:
  - platform: state
    entity_id: sensor.alex_phone_area
    to: Kitchen
condition:
  - condition: numeric_state
    entity_id: sensor.alex_phone_area
    attribute: room_confidence
    above: 0.6
action:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
```

Der Zustand ist der Name des Raums, wie Home Assistant ihn hat, mit seinen Großbuchstaben.

**Ein Hinweis, wenn die Autoschlüssel das Haus verlassen**:

```yaml
alias: Car keys left
trigger:
  - platform: event
    event_type: padspan_device_departed
    event_data:
      label: Car keys
action:
  - action: notify.notify
    data:
      message: "The car keys have left the house."
```

Das Ereignis kommt, sobald die Schlüssel so lange wie das Abwesenheits-Timeout nicht gehört wurden
(5 Minuten, wenn du es nicht unter Einstellungen → Ortung → Räume und Zeiten →
Zuhause/Abwesend-Timeout geändert hast).

**Die Alarmanlage scharf schalten, solange der Urlaubsmodus (Vacation Mode) läuft**:

```yaml
alias: Alarm with Vacation Mode
trigger:
  - platform: state
    entity_id: binary_sensor.padspan_vacation_mode
    to: "on"
action:
  - action: alarm_control_panel.alarm_arm_away
    target:
      entity_id: alarm_control_panel.house
```

Mehr Rezepte: [Was kann Home Assistant, wenn es den Raum kennt?](https://padspan.traks.ca/guides/room-presence-automations/)
