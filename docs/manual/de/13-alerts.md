# 13. Alarme und Benachrichtigungen

[Inhalt](README.md)

Alles, worüber PadSpan dich informiert, an einem Ort: was es beobachtet, wohin die Nachricht geht und
wie du es ein- oder ausschaltest.

| Was | Wo es erscheint | Einschalten |
|---|---|---|
| Ein Gerät wechselt den Raum, kommt nach Hause oder geht | Dein Handy oder deine E-Mail | Folgen → **Bewegungsalarme** |
| Ein Alarm wegen eines Wasserlecks, Rauch, Gas oder Kohlenmonoxid | Ein rotes Banner auf jedem PadSpan-Bildschirm; der Raum bekommt im Atlas einen roten Ring | Immer an |
| Deine Alarmanlage löst aus (die Alarmzentrale in Home Assistant) | Dasselbe rote Banner auf jedem PadSpan-Bildschirm, und auf dem Notfallknopf im Atlas | Immer an, in jeder Ausgabe |
| Eine offen gelassene Tür, oder ein offenes Fenster im Regen | Der Raum bekommt im Atlas einen gelben Ring; ein Banner auf einem Wandbildschirm | **Einstellungen → Atlas → Atlas — Mapped Light Control → Alert pulse** |
| Der Urlaubsmodus endet oder wird ausgeschaltet | Eine Home-Assistant-Benachrichtigung, und die Alarmziele aus Folgen | Immer, solange der Urlaubsmodus genutzt wird |
| Ein Gast kommt, geht oder betritt einen Raum, den er nicht betreten soll | Dein Handy oder eine Home-Assistant-Benachrichtigung | Wenn du einen Gast-Tag verleihst |
| Gestern zu Hause: wer kam und ging, Gäste, die am längsten leeren Räume, brennende Lichter | Dein Handy oder eine Home-Assistant-Benachrichtigung, jeden Morgen | **Einstellungen → Ortung → Handys und Gast-Tags → Gestern zu Hause** (aus, bis du es einschaltest) |
| PadSpan konnte ein Speichern nicht bestätigen | **Einstellungen → Reparaturen** von Home Assistant | Immer an |
| Eine neue stabile Version | Eine Home-Assistant-Benachrichtigung | Ab Werk an; siehe [Kapitel 3](03-install-update-uninstall.md) |
| Claudes Lesevorgänge überschreiten dein Monatslimit | Eine Home-Assistant-Benachrichtigung | **Einstellungen → KI** (aus, solange du es nicht einstellst) |

PadSpan sendet an dein Handy oder deine E-Mail über die eigenen **notify**-Dienste von Home
Assistant. Für ein Handy ist das die Home Assistant Companion App. Für E-Mail eine Mail-Integration
wie SMTP. Richte sie zuerst in Home Assistant ein, unter **Einstellungen → Geräte & Dienste**.

## Bewegungsalarme (Folgen)

Sie sagen dir, wenn ein Gerät von Raum zu Raum geht, nach Hause kommt oder geht.

1. Öffne **Folgen** und wähle das Gerät unter **Tag zum Folgen wählen**.
2. Unter der Karte des Geräts findest du **Bewegungsalarme**.
3. Wähle, wohin die Alarme gehen:
   - **Dein Handy**: Wähle es unter **Benachrichtigungsdienst** (das notify-Ziel der Companion
     App). Eine E-Mail ist nicht nötig.
   - **E-Mail**: Gib die Adresse unter **E-Mail-Adresse** ein und lass **Benachrichtigungsdienst** auf
     **Automatisch**, oder wähle deinen Maildienst.
4. Hak an, worüber du informiert werden willst. In Einfach: **Melde mir, wenn … sich bewegt**,
   **… nach Hause kommt**, **… geht**. In Erweitert: **Bei jedem Raumwechsel von „…“ melden**,
   **Melden, wenn „…“ nach Hause kommt**, **Melden, wenn „…“ geht**, und
   **Nur für diese Räume melden (nichts angehakt = alle):**, um nur einige Räume zu beobachten (ein
   Alarm kommt dann, wenn das Gerät einen davon betritt).
5. Wähle **Speichern**. Nichts ist aktiv, bevor du speicherst; die Karte zeigt dann **Aktiv**.
6. **Test senden** schickt sofort einen, genau dorthin, wohin die Alarme gehen, und sagt klar, wenn
   es dein Handy oder deinen Maildienst nicht erreichen konnte.

Was die Nachrichten sagen:

- **PadSpan: Alex's phone moved**: „Alex's phone moved from Kitchen to Hall“.
- **PadSpan: Alex's phone arrived**: „Alex's phone arrived (Kitchen)“.
- Wenn es geht: „Alex's phone left“.

Ein paar Regeln:

- **Höchstens ein Raumwechsel-Alarm pro Minute für jedes Gerät.** Ein Wechsel innerhalb dieser
  Minute geht nicht verloren: Wenn die Minute um ist, sagt ein Alarm, wohin es gegangen ist,
  ausgehend vom zuletzt gemeldeten Raum.
- **Kommen und Gehen** nutzen dasselbe Abwesenheits-Timeout wie das Abzeichen **Weg**, 5 Minuten,
  wenn du es nicht unter **Einstellungen → Ortung → Räume und Zeiten → Zuhause/Abwesend-Timeout**
  änderst.
- **Kein Alarm nach einem Neustart.** Der erste Raum eines Geräts nach dem Start von Home Assistant
  ist kein Wechsel.
- **Ein verliehener Gast-Tag** schickt stattdessen die Hinweise seines Aufenthalts (unten), nicht
  diese.

**Verwalten → Ereignisse** hat dieselben Alarme für alle Geräte an einem Ort: **Saved Alerts** listet
jeden, mit einem Löschknopf, und **Configure Alerts** richtet Raumwechsel-Alarme für jedes verfolgte
Gerät ein, mit **Test Notification**.

Kommen, Gehen und Raumwechsel lösen auch Ereignisse in Home Assistant aus (`padspan_device_arrived`,
`padspan_device_departed`, `padspan_room_change`), für deine eigenen Automationen: siehe
[Kapitel 14](14-home-assistant-reference.md).

**Kommt kein Alarm an?** Nimm zuerst **Test senden**: Es sagt, was schiefgegangen ist. Steht gar kein
notify-Dienst in der Liste, füg in Home Assistant die Companion App (für ein Handy) oder eine
Mail-Integration hinzu. Mehr in [Kapitel 26](26-troubleshooting.md).

## Wasser-, Rauch-, Gas- und CO-Alarme: der Alarm bleibt stehen

PadSpan beobachtet jeden binären Sensor von Home Assistant der Arten **moisture** (ein Wasserleck),
**smoke**, **gas** und **carbon monoxide**, ob er im Atlas platziert ist oder nicht.

Sobald einer einen Alarm meldet:

- **Der Alarm bleibt stehen.** Er bleibt in PadSpan **2 Tage lang oder bis jemand ihn zurücksetzt**
  im Alarm, auch wenn der Sensor selbst wieder still wird. Ein kurzer Moment Nässe ist trotzdem ein
  echtes Leck.
- **Ein rotes Banner** (🚨 und wie viele aktiv sind) erscheint auf jedem PadSpan-Bildschirm, nicht
  nur im Atlas, mit dem Namen jedes Alarms und einem Knopf **Zurücksetzen**. Auf einem Handy ist es
  eine kleine 🚨-Pille in der oberen Leiste.
- **Im Atlas** bekommt der Raum des Sensors einen roten Ring. Der Sensor sagt, was er gefunden hat
  (**WET**, **SMOKE**, **GAS**, **CO**), und **ALARM**, solange der Alarm steht.

**Zurücksetzen** fragt noch einmal (**Ja** / **Nein**), damit ein versehentliches Tippen keinen
echten Alarm wegwischt. Das Zurücksetzen löscht nur PadSpans Erinnerung an den Alarm; den echten
Zustand des Sensors fasst es nie an. Ein Sensor, der noch Alarm meldet, bleibt im Atlas rot, und das
Banner kommt wieder, wenn er das nächste Mal in Alarm geht.

Solange das Beispielhaus zu sehen ist, zeigt das Banner trotzdem die Alarme deines eigenen Hauses,
mit **Zu meinem Haus** statt Zurücksetzen.

**PadSpan schickt einen Wasser- oder Rauchalarm nicht an dein Handy.** Nimm dafür eine
Home-Assistant-Automation direkt auf dem Sensor: Sie hängt nicht von PadSpan ab.

## Deine Alarmanlage am Notfallknopf

Hat Home Assistant eine Alarmzentrale (eine Entität `alarm_control_panel`: Alarmo oder die eigene
Integration deiner Alarmanlage), legt PadSpan sie in den runden Notfallknopf im Atlas, oben rechts
auf der Karte. Der Knopf ändert sich mit dem, was dein Haus hat:

- **Notlichter, keine Alarmanlage**: der rote Knopf **Test emergency lighting**, wie bisher.
- **Eine Alarmanlage, keine Notlichter**: der eigene Knopf der Alarmanlage, ein schlichter Ring um
  ihr Schild.
- **Beides**: der rote Notfallring mit dem Schild der Alarmanlage als Mitte. Ein Druck auf die Mitte
  oder den Ring öffnet die Karte des Knopfs, oben die Alarmanlage, darunter die Notlichter. Der
  Lichttest startet dann mit **Start test** in der Karte, damit eine Hand, die zur Alarmanlage will,
  ihn nie startet.
- **Keins von beiden**: kein Knopf.

Der Test der Notbeleuchtung und das Scharf- und Unscharfschalten brauchen PadSpan Pro oder das
Add-on Alarm & Sicherheit (ein Bright-Pro-Schlüssel behält sie). Ohne beides ist der Knopf nur da,
solange die Alarmanlage auslöst.

**Wenn sie auslöst**, in jeder Ausgabe, auch in der kostenlosen:

- Eine Zeile im roten Banner auf jedem PadSpan-Bildschirm: „Alarm ausgelöst: Haus · Hintertür“. Auf
  einem Handy zählt die 🚨-Pille in der oberen Leiste sie mit.
- Das Schild im Notfallknopf wird rot und pulsiert; seine Karte sagt dasselbe.
- Der Sensor, der sie ausgelöst hat, wird genannt, wenn die Alarmanlage sagt, welcher es war
  (Alarmo tut das). Sonst wird nur die Alarmanlage genannt.

**Ihr Zustand, scharf und unscharf schalten** (PadSpan Pro, das Add-on Alarm & Sicherheit oder PadSpan Bright Pro):

- Das Schild im Knopf zeigt den Zustand der Alarmanlage mit seiner Farbe: grau unscharf, blau
  scharf, gelb ausstehend, rot ausgelöst. Halte den Zeiger darauf für den Zustand in Worten:
  **Unscharf**, **Scharf (zu Hause)**, **Scharf (abwesend)**, **Scharf (Nacht)**, **Scharf
  (Urlaub)**, **Scharf (benutzerdefiniert)**, **Wird scharf geschaltet**, **Ausstehend**, **Wird
  unscharf geschaltet** oder **Ausgelöst**. Bei mehreren Alarmanlagen zeigt es den dringendsten
  Zustand, und der Zeiger zeigt jede.
- Drück auf den Knopf für seine Karte, oben die Alarmanlage. Solange sie unscharf ist: **Scharf schalten (zu
  Hause)**, **(abwesend)**, **(Nacht)**, **(Urlaub)** und **(benutzerdefiniert)**, nur die, die
  diese Alarmanlage kann. Solange sie scharf ist, scharf geschaltet wird, verzögert oder ausgelöst
  hat: **Unscharf schalten**.
- **Jedes Scharf- und Unscharfschalten fragt zuerst** („Scharf schalten (abwesend): Haus?“, „Haus
  unscharf schalten?“), damit ein versehentliches Drücken nichts tut. Will die Alarmanlage einen
  Code, hat die Frage ein Feld dafür (nur Ziffern, wenn der Code eine Zahl ist). Der Knopf tut
  nichts, bis ein Code eingetippt ist. PadSpan behält den Code nie.
- **Ein falscher Code**: Home Assistant lehnt ab, und PadSpan sagt, was Home Assistant gesagt hat
  („Haus hat abgelehnt: …“). Die Alarmanlage bleibt, wie sie war.
- **Wer darf**: jeder, dessen Home-Assistant-Anmeldung die Alarmanlage bedienen kann, wie beim
  Aufschließen einer Tür im Atlas, auch auf Wandbildschirmen. Nichts auf der Karte führt von der
  Seite weg.
- Den Knopf Test emergency lighting auszublenden (Einstellungen → Atlas → Atlas — Mapped Light
  Control → **Show the Test emergency lighting button on the Atlas**) blendet nur den Test aus; der
  Knopf der Alarmanlage bleibt.

## Alert pulse (Atlas)

Aus, bis du es einschaltest: **Einstellungen → Atlas → Atlas — Mapped Light Control → Alert pulse**.
Es wird gespeichert, sobald du es anhakst.

Ist es an, bekommt ein Raum im Atlas einen gelben Ring, wenn:

- ein Fenster oder eine Abdeckung (ein Rollo, eine Jalousie, ein Fensterladen, eine Markise)
  **offen ist, während es regnet oder schneit** (nach dem eigenen Wetter des Atlas; siehe die
  [Atlas-Anleitung](../../ATLAS_GUIDE.md#outdoor-weather));
- eine Tür, ein Fenster, ein Garagentor, ein Tor oder eine Abdeckung, die der Atlas zeigt, länger
  als 6 Stunden **offen gelassen** wurde.

Auf einem Wandbildschirm (`?kiosk=1`) nennt ein Banner oben den schlimmsten Alarm und wo er ist
(„Leak · Laundry“, „Window open in the rain · Bedroom“), dazu wie viele es noch gibt, bis er vorbei
ist. Die Reihenfolge, der schlimmste zuerst: Rauch, Gas, CO, ein Leck, eine Öffnung im Regen, eine
offen gelassene Tür.

## Hinweise des Urlaubsmodus

Der Urlaubsmodus (PadSpan Pro oder das Add-on Urlaubsmodus & Voreinstellungen) steuert deine Lichter, während du weg bist
([Atlas-Anleitung](../../ATLAS_GUIDE.md)). Er sagt dir, wenn er aufhört:

- **PadSpan: Vacation Mode ended**: Er hat das für ihn festgelegte Enddatum erreicht.
- **PadSpan: Vacation Mode turned off**: Jemand hat ihn ausgeschaltet. Die Nachricht sagt, wann, wer
  und aus welcher App oder welchem Browser: „Vacation Mode was turned off Nov 21, 18:40 by Alex from
  the iPhone app. If nobody meant to, turn it back on in Whole House Presets: within 3 weeks it
  carries on with the routine it was using.“ Ein Zurücksetzen auf Werkseinstellungen sagt das
  ebenfalls.

Der Hinweis ist eine Home-Assistant-Benachrichtigung und geht außerdem an die Handys und
E-Mail-Adressen, die deine Alarme aus Folgen nutzen (bis zu fünf).

`binary_sensor.padspan_vacation_mode` und das Ereignis `padspan_ha_vacation_mode` gibt es für deine
eigenen Automationen.

## Hinweise zu Gästen

Wenn du einen Gast-Tag verleihst (**Gäste → Lend to a guest**; Gast-Tags werden unter
**Einstellungen → Ortung → Handys und Gast-Tags** eingeschaltet), hat der Aufenthalt eigene
Hinweise:

| Hinweis | Wann |
|---|---|
| **PadSpan: Sam arrived** | Der Tag wird im Haus gehört, wenn **Tell me when they arrive** angehakt ist. |
| **PadSpan: Sam left** | Der Tag wird nicht mehr gehört, wenn **Tell me when they leave** angehakt ist. Eine schwache Batterie kann genauso aussehen wie Gehen. |
| **PadSpan: Sam in the Office** | Der Gast ist eine halbe Minute lang in einem Raum, den du gesperrt hast (**Rooms they shouldn't go into**). |
| **PadSpan: is Sam's stay over?** | Der Tag wurde zwei Tage lang nicht gehört. |
| **PadSpan: Sam's stay ended** | Zum geplanten Ende des Aufenthalts, oder nach einer Woche, in der der Tag nicht gehört wurde. |

- **Tell me when they arrive** und **Tell me when they leave** sind am Anfang angehakt.
- **Send notices to**: ein Handy oder ein anderes notify-Ziel, oder
  **A Home Assistant notification** (die Voreinstellung).
- **Quiet hours**: dann keine Hinweise zu Ankunft oder Abschied. Hinweise zu gesperrten Räumen
  kommen trotzdem.

Jeder dieser Hinweise löst auch das Ereignis `padspan_ha_guest` aus. Die
[Anleitung zu Gast-Tags](../../GUEST_TAGS_GUIDE.md) hat den Rest.

## Gestern zu Hause

Eine kurze Nachricht jeden Morgen über den Vortag. Aus, bis du sie unter
**Einstellungen → Ortung → Handys und Gast-Tags → Gestern zu Hause** einschaltest (nur ein
Administrator).

- **Senden um**: die Uhrzeit, in der Zeitzone von Home Assistant (am Anfang 08:00). Ist Home
  Assistant dann aus, geht die Nachricht, sobald es wieder läuft, am selben Tag. Nach der heutigen
  Uhrzeit eingeschaltet, kommt die erste Nachricht morgen.
- **Senden an**: ein Handy oder ein anderes notify-Ziel (die Liste, die auch die Alarme aus Folgen
  nutzen), oder **Eine Benachrichtigung in Home Assistant** (die Voreinstellung).
- **Was sie sagt**: hake die Zeilen an, die du willst.

| Zeile | Was sie sagt |
|---|---|
| **Wer kam und ging, und wann** | Jedes benannte Gerät, das ging oder zurückkam: „Alex's phone left 08:09, back 17:40“. Fehlt es in Traceback länger als 15 Minuten, zählt das als Gehen; eine kürzere Lücke nicht. |
| **Gast-Tags, die ankamen oder gingen** | Ein an einen Gast verliehener Tag, während des Aufenthalts: „Jordan (Guest tag 1) left 09:59, arrived 14:00“. Braucht eingeschaltete Gast-Tags. Ein Gast-Tag steht nie in der Zeile darüber. |
| **Die Räume, die am längsten leer waren** | Die drei Räume mit der längsten Zeit ohne jemanden darin: „Garage all day; Living room until 17:40 (17 h 40 min); Kitchen from 08:09 (15 h 51 min)“. |
| **Lichter, die in Räumen brannten, in denen niemand war** | Ein Licht, das insgesamt eine halbe Stunde oder länger an war, während sein Raum leer war: „Ceiling light (Kitchen) 1 h 51 min“. |

Die Zahlen sind die von Traceback für diesen Tag, von Mitternacht bis Mitternacht. Die Nachricht
endet mit einem Link, der Traceback an diesem Tag öffnet, mit allen Geräten, zum Abspielen:
„Traceback for the day: https://…/padspan-ha?view=traceback&from=…&to=…“.

Ein Tag ohne etwas für die angehakten Zeilen bekommt **Nothing to report.** und den Link, nie eine
leere Nachricht. Eine Nachricht am Tag: Der Tag wird als erzählt markiert, bevor die Nachricht
geht, also schickt ein Neustart sie nie zweimal, und eine, die nicht ankam (etwa weil ein Handy
umbenannt wurde), wird auch nicht noch einmal geschickt. Das Protokoll sagt, warum.

Gut zu wissen:

- Die Räume sind die Räume mit einem Empfänger, und jeder Raum, in dem Traceback an dem Tag jemanden
  hatte.
- Alles, dem Traceback folgt, zählt als jemand im Raum, wie in **Traceback → Insights**: Schlüssel
  am Haken halten den Flur davon ab, leer zu sein.
- Die Lichter kommen aus dem Verlauf von Home Assistant, einem Raum über ihren Home-Assistant-Bereich
  zugeordnet.
- Die Zeilen zu leeren Räumen und Lichtern brauchen Traceback-Aufzeichnungen von vor dem Tag; eine
  neue Installation lässt sie an ihrem ersten Tag weg.
- Die Nachricht ist auf Englisch, wie alle Benachrichtigungen von PadSpan.

## Reparaturen

PadSpan meldet eine Art von Reparatur in Home Assistant, unter **Einstellungen → Reparaturen**:

> **PadSpan konnte ein Speichern nicht bestätigen (…)**: PadSpan hat seine Daten gespeichert, aber
> die Datei auf dem Datenträger enthält nicht das Gespeicherte oder ließ sich nicht wieder lesen.

Die letzten Änderungen sind dann vielleicht nur im Arbeitsspeicher und gehen beim nächsten Neustart
verloren. Prüf, ob der Datenträger, auf dem Home Assistant läuft, voll oder schreibgeschützt ist, und
such im Protokoll von Home Assistant nach dem Fehler. Der Hinweis verschwindet von selbst, sobald ein
Speichern das nächste Mal bestätigt wird. Er bleibt über einen Neustart erhalten.

## Andere Home-Assistant-Benachrichtigungen

- **PadSpan HA update available**, einmal für jede neue stabile Version. Zum Ausschalten:
  **Einstellungen → Ortung → Datenschutz, Updates und Feedback → Update-Prüfung**. Siehe
  [Kapitel 3](03-install-update-uninstall.md).
- **PadSpan: AI credit**, einmal im Monat, wenn Claudes Lesevorgänge durch PadSpan den Anteil
  überschreiten, den du für das Monatsguthaben gewählt hast, das du unter **Einstellungen → KI**
  eingetragen hast (**Deine KI: Warne mich**). Aus, solange du nicht beides einstellst.
- **padspan_ha.dump_devices**: die Liste der benannten Geräte, wenn du diesen Dienst selbst aufrufst.

## Nur im Panel

Diese erscheinen in PadSpan und senden nichts:

- **Der Statuspunkt** in der oberen Leiste, gelb oder rot, wenn etwas einen Blick braucht. Siehe
  [Kapitel 12](12-the-screens.md#zustand).
- **Zustand → Gefundene Probleme**: die Prüfungen deiner ganzen Einrichtung.
- **Erinnerungen zur Kalibriergenauigkeit** (**Einstellungen → Ortung → Positionierung und
  Kalibrierung**, ab Werk aus): eine Erinnerung im Panel, wenn die Kalibrierung Lücken hat oder alt
  wird.
