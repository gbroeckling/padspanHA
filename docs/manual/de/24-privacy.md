# 24. Datenschutz: was das Haus verlässt

[Inhalt](README.md)

PadSpan arbeitet in deinem Home Assistant. Wo deine Handys, Tags und Personen sind, deine Räume,
deine Grundrisse, die Namen deiner Geräte und ihre Bluetooth-Adressen bleiben dort. Dieses Kapitel
listet jedes Mal auf, wenn etwas hinausgeht, was es enthält und wie du es abstellst. Die vollständige
Liste, Feld für Feld, steht im README unter [Updates & Privacy](../../../README.md#updates--privacy).

## Auf einen Blick

| Was | Geht an | Wann | Enthält | Aus |
|---|---|---|---|---|
| **Update-Prüfung** | `padspan.traks.ca` | Einmal am Tag | Nur deine PadSpan-Version | **Einstellungen → Ortung → Datenschutz, Updates und Feedback → Update-Prüfung → Deaktiviert** |
| **Lizenzprüfung** | `traks.ca` | Einmal am Tag, nur mit eingetragenem Lizenzschlüssel | Den Schlüssel, die Instanz-ID von Home Assistant, das Token dieses Zuhauses, die Version, den Namen des Zuhauses, ob der Nutzungsbericht an ist | Den Schlüssel entfernen |
| **Nutzungsbericht** | `padspan.traks.ca` | Höchstens einmal am Tag, nur wenn du zustimmst | Zahlen, Versionen und Flags | Aus, solange du ihn nicht einschaltest |
| **Tester-Anmeldung** | `padspan.traks.ca` | Nur wenn du **Send sign-up** drückst | Was du eintippst, und die Zeilen zur Einrichtung, die du angehakt lässt | Wird nie gesendet, außer du meldest dich an |
| **Eine Einladung, die du einlöst** | `traks.ca` | Nur wenn du **Claim** oder **No thanks** drückst | Das Token der Einladung, und bei Claim die E-Mail-Adresse, die du eintippst | Nichts tun |
| **Gemeinsame Möbelbibliothek** | `padspan.traks.ca` | Nur solange sie an ist, wenn jemand sie nutzt | Suchen, die ID eines Stücks, das Rezept eines geteilten Stücks | Ab Werk aus |
| **KI-Lesevorgänge** | Die KI hinter deinem eigenen AI Task | Nur wenn jemand einen startet | Ein Bild und PadSpans Anweisungen | Kein AI Task gewählt (die Voreinstellung) |
| **Alarme** | Deine eigenen notify-Dienste (Handy-App, E-Mail) | Wenn ein Alarm auslöst | Den Text des Alarms | Keine Alarme einrichten |

Wie bei jeder Webanfrage sieht jeder Server deine IP-Adresse.

## Die Update-Prüfung

Einmal am Tag fragt PadSpan bei `padspan.traks.ca` nach, ob es eine neuere Version gibt, und zeigt
eine Benachrichtigung in Home Assistant, wenn es eine gibt ([Kapitel 3](03-install-update-uninstall.md)).
Die Anfrage enthält nur deine installierte Versionsnummer. Auf deinem System wird keine Kennung
gespeichert, und die Prüfung allein zählt Anfragen, nicht Installationen. Die Antwort kann außerdem
PadSpans Angebote für kostenloses Pro (Tester werden, Einladungen) aus- oder einschalten, sodass ein
beendetes Angebot ohne Update verschwindet; sie enthält nur diese beiden Schalter und kann dem Panel
nichts hinzufügen.

## Die Lizenzprüfung

Nur mit einem Lizenzschlüssel (aus einem Testzeitraum oder gekauft): Einmal am Tag, ob die
Update-Prüfung an ist oder nicht, prüft PadSpan den Schlüssel bei `traks.ca`, damit ein erstatteter
oder widerrufener Schlüssel aufhört zu funktionieren. Es schickt im Body der Anfrage den Schlüssel,
die Instanz-ID von Home Assistant (der Server behält davon nur einen Einweg-Hash), das aktuelle Token
dieses Zuhauses (einen zufälligen Code, den der Server ihm gegeben hat), die PadSpan-Version, den
Namen, den du diesem Zuhause gegeben hast (falls es einen hat), und ob der Nutzungsbericht dieses
Zuhauses an ist. Ohne Schlüssel gibt es keine Lizenzprüfung. Schlüssel und Zuhause:
[Kapitel 25](25-padspan-pro.md).

## Der Nutzungsbericht (freiwillig)

**Einstellungen → Ortung → Hilf, PadSpan besser zu machen**, ab Werk aus. Das Panel fragt einmal,
mit der Vorschau neben der Frage; jede Antwort beendet das Fragen. Ein- oder Ausschalten braucht
einen Administrator.

Ist er an, schickt PadSpan höchstens einmal am Tag einen kleinen Bericht (fest begrenzt auf 32 KB)
aus **Zahlen, Versionen und Flags**: wie viele Empfänger, Etagen, Räume und platzierte Geräte;
welche Funktionsschalter an sind; wie oft jeder Bildschirm und jedes Werkzeug benutzt wurde; wie
stark der Rechner arbeitet; die Klasse des Rechners (Größenklasse des Speichers, Art des Prozessors,
Board-Familie); Fehler nach PadSpan-Dateiname. Er enthält eine zufällige Installations-ID, damit
Installationen gezählt werden, nicht Anfragen.

**Nie**: Bluetooth-Adressen, Handy-Schlüssel oder Lizenzschlüssel, den Namen oder die ID eines
Geräts, Raums, einer Etage oder Entität, IP-Adressen, Koordinaten oder Zeiten genauer als der Tag.
Vor jedem Senden prüft PadSpan jeden Wert und verweigert den ganzen Bericht, wenn einer wie eine
Adresse, ein Schlüssel, eine E-Mail-Adresse oder eine Entitäts-ID aussieht oder ein Text länger als
64 Zeichen ist.

- **Vorschau, was gesendet würde** zeigt den Bericht genau so, wie er gerade ist, vor oder nach der
  Zustimmung.
- **Neue anonyme ID** ersetzt die Installations-ID, jederzeit.
- **Wenn du PadSpan löschst**, während der Bericht an ist, schickt es einen letzten Bericht, der das
  sagt (die ID, den Tag, die Version), ohne etwas über das Haus.
- Eine freiwillige Frage, wo du von PadSpan gehört hast, kommt einmal, mit **Überspringen**.

Der kostenlose Testzeitraum braucht den Bericht an, bis der Testzeitraum endet, und eine Lizenz, die
in mehr als zwei Zuhause genutzt wird, braucht ihn in jedem davon ([Kapitel 25](25-padspan-pro.md)).

## Tester werden

Solange der Bericht an ist, bietet seine Karte **Become a tester** an: PadSpan Pro zwei Jahre
kostenlos, für Leute, die gern kontaktiert werden, um Neues auszuprobieren. Das ist die einzige
Stelle, an der PadSpan nach Kontaktdaten fragt, deshalb ist sie in jeder Hinsicht vom anonymen
Bericht getrennt: ein eigenes Einwilligungskästchen, ein eigener Knopf **Send sign-up**, eine eigene
Adresse und eine eigene zufällige ID. Was hinausgeht, ist, was du eintippst (eine E-Mail-Adresse und
wahlweise einen GitHub-Benutzernamen, einen Namen, Notizen, eine Zeitzone), dazu die Zeilen unter
**About your setup**, die du angehakt lässt. **Preview what will be sent** zeigt es vorher. Deine
anonymen Berichte werden nur damit verknüpft, wenn du **Link my anonymous usage reports** anhakst.
**Stop being a tester** löscht deine Anmeldung vom Server. Die Anmeldung braucht einen Administrator.

## Einladungen

Hin und wieder lädt der Entwickler einige Installationen, die den Bericht schicken, ein, etwas
auszuprobieren, etwa ein Jahr Pro kostenlos. Die Einladung kommt in der Antwort auf den Bericht
dieser Installation und erscheint als Karte. Nichts wird gesendet, außer du drückst einen Knopf:
**Claim** schickt das Token und die E-Mail-Adresse, die du eintippst, damit dir der Schlüssel gemailt
werden kann; **No thanks** schickt nur das Token.

## Die gemeinsame Möbelbibliothek

Live Aboard (Pro) kann Möbel mit anderen Häusern mit PadSpan tauschen. Ab Werk ist das aus, und nur
ein Administrator kann es einschalten (**Einstellungen → Atlas → Live Aboard → Shared library**).
Solange es an ist, schickt Home Assistant nur dann eine Anfrage, wenn jemand es benutzt: eine Suche
(die Wörter und Filter), der Blick auf ein Stück (seine Bibliotheks-ID), eine Meldung (das Stück und
ein Grund), ein Teilen (Form, Maße, Farben und Datenblatt des Stücks) oder das Zurückziehen eines
geteilten Stücks. Nie ein Foto, einen Grundriss, wo ein Stück steht, seinen Namen in deinem Haus oder
die ID des Nutzungsberichts. Text, der wie eine E-Mail-Adresse, eine Adresse, eine Telefonnummer oder
ein Schlüssel aussieht, wird abgelehnt, bevor etwas gesendet wird.

## KI-Lesevorgänge

PadSpan hat keine eigene KI. Ein paar Pro-Funktionen können den AI Task, den du unter
**Einstellungen → KI** gewählt hast, bitten, ein Bild zu lesen: das Foto eines Möbelstücks oder
einen Grundriss. Ab Werk ist keiner gewählt. Eine lokale KI behält das Bild bei dir zu Hause; eine
Cloud-KI schickt es an diese Firma. PadSpan fügt keine Namen, Adressen oder Positionen hinzu, aber
ein Grundriss geht so, wie er ist, mit allem, was darauf steht. Alles darüber:
[Kapitel 19](19-ai-features.md).

## Was nie das Haus verlässt

- **Handy-Schlüssel (IRKs)**: nur in deinem Home Assistant.
- **Positionen, Räume, Verlauf, Grundrisse**: nur in deinem Home Assistant.
- **Hersteller von Geräten**: PadSpan nennt den Hersteller eines Geräts aus dem, was das Gerät
  aussendet, und aus Listen, die in PadSpan eingebaut sind. Dafür wird nichts irgendwohin geschickt.
- **Namen von Gästen**: nicht im Nutzungsbericht und nicht in einem PadSpan-Backup.
- **Die Figuren von Personen** in Live Aboard: nur in der 3D-Datei dieses Hauses, nie geteilt.
- **Diagnose und Export for support**: entstehen auf deinem Rechner und gehen nur dorthin, wohin du
  sie schickst ([Kapitel 27](27-getting-help.md)).

## Wo PadSpan deine Daten aufbewahrt

Im Ordner `.storage` deines Home Assistant (die Dateien `padspan_ha.*`) und in `<config>/padspan_ha/`
(die Bilder der Grundrisse, außerhalb des Ordners, den Home Assistant ohne Anmeldung ausliefert).
Umziehen und entfernen: [Kapitel 22](22-backup-restore-moving.md) und
[Kapitel 3](03-install-update-uninstall.md).
