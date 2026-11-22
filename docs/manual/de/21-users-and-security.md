# 21. Benutzer und erweiterte Sicherheit

[Inhalt](README.md)

PadSpan nutzt die eigenen Benutzer von Home Assistant. Es gibt keine PadSpan-Konten oder
-Passwörter: Was jemand in PadSpan tun darf, folgt daraus, ob sein Home-Assistant-Benutzer ein
**Administrator** ist.

## Wer PadSpan öffnen kann

Jeder Benutzer von Home Assistant kann PadSpan und den Atlas in der Seitenleiste öffnen und alles
darauf sehen. Haushaltsmitglieder können immer die Lichter, den Notbeleuchtungstest und die
Testbenachrichtigung von Folgen nutzen, das Design ändern und die Auswahl ändern, die in ihrem
eigenen Browser gespeichert ist (Karte oder 3D, was der Atlas zeigt, Einfach oder Erweitert).

## Was immer einen Administrator braucht

Egal, wie es eingestellt ist, nur ein Administrator kann:

- Backups anlegen, wiederherstellen und löschen, und auf Werkseinstellungen zurücksetzen;
- IRKs (Handy-Schlüssel) hinzufügen, entfernen, testen oder nach ihnen suchen;
- Grundrisse hochladen oder löschen;
- den Nutzungsbericht ein- oder ausschalten und sich als Tester anmelden;
- die Schalter von Live Aboard einschalten, die Daten aus dem Haus lassen (die gemeinsame
  Möbelbibliothek), und den AI Task wählen;
- Gast-Tags einschalten, einen Tag verleihen und einen Aufenthalt beenden;
- Power-Teams anlegen und ändern;
- den Urlaubsmodus (Vacation Mode) ein- oder ausschalten;
- ändern, wer ein WLED-Licht steuert;
- die erweiterte Sicherheit ein- oder ausschalten.

Wer kein Administrator ist, bekommt das gesagt, wenn er es versucht.

## Erweiterte Sicherheit

Für Haushalte, in denen andere Leute Konten in Home Assistant haben.
**Einstellungen → Ortung → Datenschutz, Updates und Feedback → Erweiterte Sicherheit.** Eine neue
Installation beginnt damit eingeschaltet; ein Haus, das vor November 2026 eingerichtet wurde, lässt
sie aus, bis ein Administrator sie einschaltet.

Solange sie an ist, kann nur ein Administrator ändern, wie PadSpan für das Haus eingerichtet ist:

- Geräte: sie zusammenführen, löschen, umbenennen und benennen;
- Kalibrierpunkte und das Kalibriermodell;
- den Aufbau des Hauses: Räume, Empfänger, Lichter, Beacons, Wände, Etagenhöhen und Kartendetails;
- die Signalanpassung der Empfänger, und Empfänger ausschalten oder als verloren markieren;
- Folgen-Alarme, zur Ortung hinzugefügte Handys und Find-My-Verknüpfungen;
- den Verlauf löschen, verlorene Objekte vergessen und das Lernen aussetzen;
- Änderungen in Live Aboard, das Teilen in seine Bibliothek und seinen Fotoleser;
- das Protokoll von PadSpan;
- Einstellungen, die für das ganze Haus gelten (die Update-Prüfung, die Positionierung und der
  Rest), und Anzeigeeinstellungen, die jeden Bildschirm ändern (den Ruhigen Modus, den Atlas als
  Übersicht, das Layout des Atlas und sein Showcase-Design).

Haushaltsmitglieder können weiter alles wie oben ansehen und nutzen und einem Empfänger seinen Raum
geben (**Raum festlegen** auf der Karte **Wer ist wo** der Übersicht, oder **Zuweisen** unter
**Bluetooth-Funkempfänger**), was mit Absicht für alle offen bleibt. Versuchen sie etwas von der
Liste, sagt PadSpan **„Solange die erweiterte Sicherheit an ist, kann das nur ein Admin ändern“**.
Ist sie an, sieht nur ein Administrator **Verfolgen** neben einem Handy in **Wer ist wo**.

Später kommen vielleicht weitere Schutzmaßnahmen an denselben Schalter; die Karte dazu in den
Einstellungen listet immer, was er heute abdeckt.

## Ein Wandbildschirm oder ein gemeinsames Tablet

Ein Bildschirm im Flur oder in der Küche ist bei Home Assistant als irgendjemand angemeldet. Gib ihm
einen eigenen Home-Assistant-Benutzer, der **kein** Administrator ist, und schalte die erweiterte
Sicherheit ein. Dann kann jeder, der vorbeikommt, die Lichter nutzen und auf die Karte schauen, aber
nicht ändern, wie PadSpan eingerichtet ist, kein Backup anlegen und PadSpan nicht zurücksetzen.
Blende auch den Knopf für den Notbeleuchtungstest aus, wenn ihn nicht jeder drücken soll
([Kapitel 15](15-the-atlas.md#test-der-notbeleuchtung)). Den Bildschirm einrichten:
[Kapitel 18](18-wall-screens-and-kiosks.md).

## Was PadSpan sonst tut, um sicher zu bleiben

- Namen von Geräten, Empfängern, Räumen und Benutzern zeigt das Panel immer als reinen Text, damit
  ein Gerät, das wie ein Stück Code heißt, darin nicht ausgeführt werden kann.
- Hochgeladene und importierte Karten sind in der Größe begrenzt, und der Grundriss-Import lehnt
  unsichere Dateien ab.
- Folgen-Alarme und der Knopf Test schicken nur an Benachrichtigungsziele, und der Test schickt im
  Namen der Person, die ihn gedrückt hat.
- Handy-Schlüssel (IRKs) bleiben in deinem Home Assistant und verlassen es nie. Der Lizenzschlüssel
  geht nie mit den Einstellungen an den Browser.

**Ein Sicherheitsproblem gefunden?** Öffne kein öffentliches Issue: Melde es vertraulich, wie
[SECURITY.md](../../../SECURITY.md) es beschreibt, über die Security Advisories von GitHub oder per
E-Mail.
