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
einen Schlüssel kaufst: [padspan.traks.ca](https://padspan.traks.ca).

Alles unten steht unter **Einstellungen → Funktionen → PadSpan licence**, wenn nichts anderes
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

## Pro kostenlos bekommen, indem du es testest

**Become a tester** (auf der Lizenzkarte oder unter **Einstellungen → Ortung → Hilf, PadSpan besser
zu machen**) gibt dir zwei Jahre PadSpan Pro kostenlos, für Leute, die gern kontaktiert werden, um
Neues auszuprobieren, bevor es erscheint. Der Nutzungsbericht bleibt diese zwei Jahre an: Er lässt
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
