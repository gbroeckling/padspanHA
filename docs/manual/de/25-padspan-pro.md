# 25. PadSpan Pro: Testzeitraum, Schlüssel, Zuhause, Tester, Einladungen

[Inhalt](README.md)

PadSpan HA ist kostenlos, und die Anwesenheitserkennung bleibt kostenlos: Räume, Grundrisse,
Kalibrierung, der Verlauf, die Sensoren in Home Assistant und die Alarme. **PadSpan Pro** ist ein
freiwilliger Schlüssel, der die kostenpflichtigen Teile auf derselben Installation freischaltet, ohne
dass du etwas neu installierst:

- genaues Platzieren im Atlas: Formen, Größen, Winkel, die Advanced-Steuerung von WLED, Automorph und
  Showcase ([Kapitel 15](15-the-atlas.md));
- Live Aboard, das 3D-Haus, mit Furnish ([Kapitel 16](16-live-aboard.md),
  [Kapitel 17](17-furnish.md));
- der Wandmodus ([Kapitel 18](18-wall-screens-and-kiosks.md));
- Whole house presets und der Urlaubsmodus;
- Forensik, Busy Times und Finden ([Kapitel 12](12-the-screens.md));
- die KI-Funktionen ([Kapitel 19](19-ai-features.md));
- alles, was später hinter Pro kommt.

Ein PadSpan-Pro-Schlüssel schaltet auch die Werkzeuge von PadSpan Bright frei. Preise und wo du
einen Schlüssel kaufst: [padspan.traks.ca](https://padspan.traks.ca). Ohne Pro schaltet ein Add-on
eine Funktion frei ([Add-ons](#add-ons)).

Alles unten steht unter **Einstellungen → Funktionen → PadSpan-Lizenz**, wenn nichts anderes
dasteht. Einen Testzeitraum starten, einen Schlüssel eintragen und sich als Tester anmelden braucht
einen Administrator von Home Assistant.

## 90 Tage kostenlos testen

**Start 90-day free trial** (auf der Lizenzkarte und auf der Karte zum Testzeitraum, die die
Übersicht zeigt, sobald PadSpan in deinem Haus arbeitet) gibt dir ganz Pro für 90 Tage. Keine
Kreditkarte, ein Testzeitraum pro Zuhause, und deine E-Mail-Adresse wird nur benutzt, um dir deinen
Schlüssel zu schicken.

Der Testzeitraum braucht den **Nutzungsbericht** an (**Einstellungen → Ortung → Hilf, PadSpan
besser zu machen**: anonyme Zahlen dazu, was benutzt wird und was kaputtgeht,
[Kapitel 24](24-privacy.md)). Ist er aus, bittet dich die Karte zum Testzeitraum, ihn im selben
Schritt einzuschalten. **Der Nutzungsbericht bleibt den ganzen Testzeitraum an** und lässt sich
nicht ausschalten, bis der Testzeitraum endet oder du einen gekauften Schlüssel einträgst.

Wenn der Testzeitraum endet, wird nichts gelöscht, was du eingerichtet hast. Wenn du kaufst, kommt
alles so zurück, wie du es verlassen hast.

## Einen Schlüssel eintragen

Wähle **Enter licence key** und füg ihn ein (`PSPAN-XXXX-XXXX-XXXX-XXXX`). Die Karte sagt
**Licence activated**. **Replace licence key** tauscht ihn aus; **Show licence key** zeigt ihn (nur
für Administratoren). Einmal am Tag prüft PadSpan den Schlüssel, damit ein erstatteter oder
widerrufener Schlüssel aufhört zu funktionieren; was diese Prüfung schickt, steht in
[Kapitel 24](24-privacy.md#die-lizenzprüfung).

## Ein Schlüssel, fünf Zuhause

Ein Schlüssel gilt für bis zu fünf Home Assistants (eine Hütte, das Haus der Eltern, eine
Testinstallation):

- **Zuhause 1 und 2** zählen immer.
- **Mit mehr als zwei Zuhause** muss jedes Zuhause auf dem Schlüssel seinen Nutzungsbericht anlassen,
  die ersten zwei eingeschlossen. Ein drittes Zuhause kann nur dazukommen, wenn jedes Zuhause, auch
  das neue, den Bericht an hat.
- Schaltet eines davon den Bericht aus, fällt der Schlüssel nach 14 Tagen auf seine ersten zwei
  Zuhause zurück. Die ersten zwei behalten Pro; die anderen machen bei ihrer nächsten Prüfung weiter,
  sobald der Bericht wieder an ist. Die 14 Tage summieren sich: Den Bericht kurz wieder einzuschalten
  setzt sie nicht zurück, und sie fangen erst wieder von vorn an, wenn jedes Zuhause den Bericht
  30 Tage lang an hatte. Die Lizenzkarte sagt, welches Zuhause ihn aus hat und bis wann, und auf
  einem solchen Schlüssel fragt das Ausschalten des Berichts erst nach.
- Ein Zuhause mit PadSpan vor 0.38.160 kann den Bericht nicht schicken und zählt deshalb als aus,
  bis es aktualisiert ist; die Lizenzkarte nennt es.
- Ein Zuhause, das sich 45 Tage nicht gemeldet hat, gibt seinen Platz frei, und ein neues oder neu
  installiertes Home Assistant kann den Platz eines Zuhauses einnehmen, das 14 Tage nicht gesehen
  wurde.

**Show this key's homes** listet sie auf, lässt dich dieses Zuhause benennen und eines entfernen,
das du nicht mehr nutzt. Wird ein Zuhause nicht gezählt, sagt die Lizenzkarte, warum.

## Add-ons

Ohne Pro eine Funktion nach der anderen: Jedes Add-on ist eine Zahlung für 2 Jahre, kein Abo, auf bis
zu drei Zuhause. **PadSpan Pro enthält sie alle.** Preise, und wo du eines kaufst:
[padspan.traks.ca/#addons](https://padspan.traks.ca/#addons).

| Add-on | Was es freischaltet |
| --- | --- |
| Audio | Lautstärke, Stummschalten und Aus für die Player jedes Raums: die Zeile Audio in der **⋯**-Liste auf dem neuen Layout, **Einstellungen → Atlas → Audio** auf dem klassischen ([Kapitel 15](15-the-atlas.md#audio)) |
| Alarm & Sicherheit | Scharf und unscharf schalten im Notfallknopf, der Test der Notbeleuchtung, die Karte einer Tür mit Öffner und Schloss, **Geräte → Türöffner** und Öffner und Schlösser aus Relais |
| WLAN-Abdeckung | Der Reiter Wi-Fi coverage |
| Klimakarte | Die ♨ Heatmap im Atlas |
| Zeitreise | Full house activity: der Tag noch einmal im Atlas abgespielt (Traceback → Playback) |
| Urlaubsmodus & Voreinstellungen | Der Urlaubsmodus und die Whole house presets |
| Looks-Paket | Die Themen Graphit, Ozean, Dämmerung und Tag; im Atlas Showcase mit seinen Themen, der West Coast Forest und die Presets-Leiste |
| Forensik | Die Aufzeichnung von Forensik |
| Präsenz-Auswertungen | Stoßzeiten und Finden |

Kostenlos auf jeder Installation, mit oder ohne sie: eine auslösende Alarmanlage (im Notfallknopf,
ohne etwas zum Drücken, und im roten Banner), Auf- und Zuschließen auf der Karte und in der Karte
eines Raums, Alert pulse, der Reiter Auswertungen und das 📍 Locate-Blinken eines Geräts.

- Deine Add-ons teilen sich einen Schlüssel: Kaufst du ein weiteres mit derselben E-Mail, kommt es
  zu diesem Schlüssel dazu. Trag ihn hier ein wie jeden Schlüssel; die Lizenzkarte zeigt jedes
  Add-on mit seinem Datum. Ein Add-on-Schlüssel ist kein Pro-Schlüssel.
- Jedes Add-on bekommt nach seinem Datum dieselben 14 Tage wie ein Schlüssel.
- Der Testzeitraum von 90 Tagen bleibt dir: Er legt den Add-on-Schlüssel beiseite und setzt ihn
  wieder ein, wenn er endet.
- Wo eine Funktion gesperrt ist, steht, was sie freischaltet: „PadSpan Pro oder das Add-on …“, mit
  dem Preis.

## OS 2 Local for Control4

Ein eigenes Spezial-Add-on für Zuhause mit einem Control4-Controller unter OS 2. Die Cloud-Dienste für Control4 OS 2 endeten am 1. November 2026, und die eingebaute Control4-Integration von
Home Assistant meldet sich über diese Cloud an. Mit OS-2-Controllern funktioniert sie deshalb nicht
mehr. **OS 2 Local for Control4** ist eine eigene Home-Assistant-Integration, die an die Stelle der
eingebauten tritt: Sie meldet sich mit dem Systempasswort des Controllers direkt beim Controller an, ohne Cloud-Konto, und macht jeden Raum zu einem Mediaplayer mit Lautstärke,
Stummschalten und Aus. Es ist eine Zahlung, die lebenslang gilt, und **PadSpan Pro enthält es**.
Seine eigene Seite:
[github.com/gbroeckling/control4-os2-local](https://github.com/gbroeckling/control4-os2-local).

### Aus PadSpan installieren

1. Öffne **Einstellungen → Ortung → Home Assistant und Integrationen → OS 2 Local for Control4**. Die
   Karte ist für Administratoren da, sobald Home Assistant Control4 hat (einen Eintrag oder einen
   gefundenen Controller) oder der Schlüssel das Add-on enthält. Die Übersicht bietet es auch an,
   wenn sich ein Control4-Eintrag nicht einrichten ließ oder der Controller mit OS 2 läuft.
2. Drücke **OS 2 Local for Control4 installieren** und bestätige. PadSpan lädt die neueste Version von
   der GitHub-Seite des Produkts (genau diese eine Datei, sonst nichts), prüft, dass es OS 2 Local for Control4 ist, verschiebt einen schon vorhandenen Ordner `custom_components/control4` nach
   `padspan_ha/control4_backups/` in deinem Konfigurationsordner und legt den neuen an seine Stelle.
3. Drücke **Home Assistant neu starten** und bestätige. PadSpan startet Home Assistant nie von sich
   aus neu.
4. Öffne **Einstellungen → Geräte & Dienste → Control4 → Konfigurieren**, gib das Systempasswort
   des Controllers und deinen Schlüssel ein (einen Schlüssel für OS 2 Local for Control4 oder deinen
   PadSpan Pro-Schlüssel) und drücke **Absenden**. Wenn du Control4 zum ersten Mal hinzufügst:
   **Integration hinzufügen → OS 2 Local for Control4**, mit der IP-Adresse des Controllers, seinem
   Systempasswort und dem Schlüssel.

**Nach einem Update suchen** auf derselben Karte fragt GitHub nach der neuesten Version; **Auf …
aktualisieren** installiert sie, die Version davor kommt in die Sicherungen.

### Rückgängig

**Rückgängig** auf der Karte legt den Ordner zurück, der vorher da war (nach einem Update die
Version davor), oder entfernt OS 2 Local for Control4, wenn vorher keiner da war, damit die eingebaute
Control4-Integration von Home Assistant zurückkommt. Starte Home Assistant danach neu. Rückgängig
geht auch ohne Schlüssel und rührt nie einen Ordner `custom_components/control4` an, der nicht
OS 2 Local for Control4 ist. Dein Control4-Eintrag und seine Entitäten bleiben; mit einem
OS-2-Controller kann sich die eingebaute Integration nicht verbinden.

Du kannst es stattdessen auch mit HACS installieren: Füge die GitHub-Seite des Produkts als
benutzerdefiniertes Repository vom Typ Integration hinzu.

Control4 ist eine Marke ihres Inhabers; keine Verbindung zu Control4, Snap One oder Resideo.

## Pro kostenlos bekommen, indem du es testest

**Become a tester** (auf der Lizenzkarte oder unter **Einstellungen → Ortung → Hilf, PadSpan besser
zu machen**) gibt dir zwei Jahre PadSpan Pro kostenlos (ein Jahr, wenn du ab dem 16. Dezember 2026 dazukommst), für Leute, die gern kontaktiert werden, um
Neues auszuprobieren, bevor es erscheint. Der Nutzungsbericht bleibt so lange an: Er lässt
sich nicht ausschalten, solange der Schlüssel läuft. Du gibst eine E-Mail-Adresse an und kannst
sagen, was du gern testen würdest; du siehst genau, was hinausgeht, bevor etwas gesendet wird, und
**Stop being a tester** zieht deine Anmeldung jederzeit zurück. Was gesendet und aufbewahrt wird:
[Kapitel 24](24-privacy.md#tester-werden).

## Einladungen

Hin und wieder wird eine Installation, die den Nutzungsbericht schickt, zu **einem kostenlosen Jahr
PadSpan Pro** eingeladen. Die Einladung erscheint in der Übersicht und auf der Lizenzkarte, nur für
Administratoren. Der Bericht bleibt während des kostenlosen Jahres an.

- **Claim my free year**: Gib eine E-Mail-Adresse ein, und der Schlüssel kommt dort an. Keine
  Kreditkarte, nichts verlängert sich.
- **Later**: fragt in einer Woche wieder.
- **No thanks**: endgültig; die Einladung kommt nicht wieder.

Nichts wird gesendet, außer du drückst einen dieser Knöpfe.

## Wandbildschirme

Ein Bildschirm, der mit `?kiosk=1` geöffnet ist, zeigt nie Angebote für einen Testzeitraum oder
eine Einladung ([Kapitel 18](18-wall-screens-and-kiosks.md)).
