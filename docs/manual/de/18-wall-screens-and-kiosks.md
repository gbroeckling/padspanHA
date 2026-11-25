# 18. Wandbildschirme und Kiosks

[Inhalt](README.md)

Wie du PadSpan auf ein Tablet oder einen Bildschirm an der Wand bringst und dort lässt.

## Der Bildschirm

PadSpan läuft in Home Assistant, also muss ein Bildschirm nur Home Assistant im Vollbild in einem
aktuellen Browser zeigen und Berührungen annehmen. Das 3D-Haus braucht WebGL 2. Drei verbreitete
Wege:

- **Ein Android-All-in-One**: ein Kiosk-Browser wie Fully Kiosk Browser, oder die Home Assistant
  Companion App als Startbildschirm-App. Ein Gerät, ein Kabel.
- **Ein Touch-Monitor und ein kleiner Computer** (ein Mini-PC oder ein Raspberry Pi), auf dem ein
  Browser im Kiosk-Modus läuft. Das Flexibelste.
- **Ein Fernseher mit Infrarot-Touch-Rahmen**, per USB an einen kleinen Computer angeschlossen.

1080p reicht für die meisten Wände; 4K ist aus der Nähe schärfer. Quer und hochkant gehen beide.
Mehr zur Wahl: [Welcher Touchscreen für ein PadSpan-Wanddisplay?](https://padspan.traks.ca/guides/wall-screens/)
und [Wo sind alle? Das ganze Haus live an einer Wand](https://padspan.traks.ca/guides/large-homes/).

## Welche Seite du zeigst

PadSpan hat zwei Seiten in der Seitenleiste von Home Assistant:

- **PadSpan HA** (`/padspan-ha`): alles, mit seinem Menü.
- **Atlas** (`/padspan-lights`): die Gerätekarte allein, gemacht für einen Bildschirm. Sie ist ab
  Werk an; **Einstellungen → Atlas → Den Atlas in der Seitenleiste von Home Assistant zeigen** schaltet sie aus
  oder ein (starte Home Assistant danach neu).

Für eine Wand ist meist die Atlas-Seite die richtige: Die Karte füllt den Bildschirm, und die
Bedienelemente klappen sich in eine schmale Leiste am linken Rand (☰ Etagen und Gerätearten,
★ Voreinstellungen, ⚙ Zoom und Ansicht, 🏠 Live Aboard, ‹ blendet die Leiste aus). Der Atlas selbst
steht in [Kapitel 15](15-the-atlas.md).

## Kiosk-Links für die Hauptseite

Häng diese an die Adresse der Seite PadSpan HA an:

| Adresse | Was sie tut |
|---|---|
| `/padspan-ha?kiosk=1` | Blendet PadSpans eigenes Menü und seine Leisten aus und zeigt nie Angebote für den Testzeitraum oder Einladungen |
| `/padspan-ha?view=follow` | Öffnet einen bestimmten Bildschirm (`overview`, `follow`, `traceback`, `maps`…), egal, welchen der Browser zuletzt benutzt hat |
| `/padspan-ha?view=maps&tab=lights&light=light.kitchen` | Öffnet Karten → Atlas-Editor mit einem gewählten Licht |

Sie lassen sich kombinieren: `/padspan-ha?view=follow&kiosk=1`. Um auch die Kopfzeile und die
Seitenleiste von Home Assistant selbst auszublenden, nimm ein Kiosk-Add-on (etwa kiosk-mode aus
HACS) oder den Kiosk-Browser des Tablets.

**Nach einem Update** lädt sich ein Bildschirm, der mit `?kiosk=1` geöffnet wurde, einmal selbst
neu, damit er nie alten Code ausführt. Jeder andere Browser zeigt stattdessen eine Leiste mit einem
Knopf **Neu laden**.

## Wandmodus: `/padspan-lights?kiosk=1`

Öffne die Atlas-Seite mit `?kiosk=1`, und sie wird zur Wand:

- das ganze Haus passt auf den Bildschirm, jede Etage von oben nach unten, und die Kopfzeile
  verschwindet;
- die Leiste, die Legenden, die Werkzeugleisten und Raumnamen der 3D-Ansicht und der Regen wachsen
  mit dem Bildschirm: ihre übliche Größe bei 1080p, doppelt so groß bei 4K, damit man sie quer
  durch den Raum lesen kann;
- der Bildschirm bleibt wach, solange die Seite offen ist, wenn Home Assistant über HTTPS erreicht
  wird (oder über `localhost` des Bildschirms selbst); sonst nimm die eigene Ruhezustand-Einstellung
  des Bildschirms;
- die Seitenleiste von Home Assistant ist in diesem Browser ausgeblendet. **Show HA** auf der
  Atlas-Seite, ohne `?kiosk=1` geöffnet, holt sie zurück;
- die Bedienelemente über der Karte blenden sich 30 Sekunden nach der letzten Berührung aus und
  kommen mit der nächsten zurück.

Der Wandmodus braucht das neue Layout des Atlas, das mit der Leiste (PadSpan Pro:
**Karten → Atlas-Editor → ▦ New layout**). Mit dem klassischen Layout lässt `?kiosk=1` nur die
Kopfzeile weg.

**Die Karte den Bildschirm füllen lassen**: **⛶** (unten rechts) schaltet sie auf Vollbild. Zoom
weiter hinein als das ganze Haus, und die Leisten gehen zur Seite; **☰** oder **Escape** holt sie
zurück. Tipp doppelt auf einen Raum, um auf ihn zu zoomen.

## Eine Wand für ihren Raum bemessen

**Einstellungen → Atlas → Wall screens** legt fest, wie groß eine Wand die Dinge zeichnet:

- **Size from the screen** (die Voreinstellung): Ein 4K-Bildschirm zeichnet doppelt so groß wie einer
  mit 1080p.
- **Size for my room**: Gib die Größe des Bildschirms an und wie weit weg die Leute meist stehen,
  oder tipp auf eine Vorgabe (Schreibtischmonitor, Küchentablet, Bildschirm im Flur, Fernseher im
  Wohnzimmer, großer Fernseher). Die Schrift wird danach bemessen, wie groß sie von dort aussieht,
  also bekommt ein 55-Zoll-Fernseher quer durch den Raum viel größere Schrift als ein 27-Zoll-Monitor
  auf einem Schreibtisch, obwohl beide 4K haben.
- **Text size** (Small, Comfortable, Large) verschiebt beides nach oben oder unten.
- **Dim at night** dunkelt die Wand zwischen Sonnenuntergang und Sonnenaufgang ab (dafür braucht es
  die Sonne von Home Assistant).
- **Protect against burn-in** verschiebt das Bild alle paar Minuten um ein, zwei Pixel, für
  OLED-Bildschirme.
- **Show each floor** (aus, bis du es einstellst): Alle 15 s bis 5 min zeigt die Wand die nächste
  Etage. Sie wartet, solange jemand die Wand bedient.
- **On Fully Kiosk tablets** (aus, bis du es einstellst): In Fully Kiosk Browser dreht die
  Nachtdimmung die Helligkeit des Bildschirms selbst herunter, und mit Fullys **Motion Detection**
  weckt jemand, der herantritt, einen schlafenden Bildschirm. Dafür braucht es
  **Enable JavaScript Interface** in Fullys Advanced Web Settings.

Die Vorschau der Karte zeigt einen 4K-Bildschirm maßstabsgetreu, mit der Höhe der Schrift in
Zentimetern. Wände übernehmen eine Änderung innerhalb einer halben Minute.

**Ein Bildschirm, seine eigene Größe**: Die Karte baut einen Link für einen einzelnen Bildschirm,
zum Beispiel `/padspan-lights?kiosk=1&wall_in=55&wall_m=2.5` (55 Zoll, die Leute 2,5 m entfernt);
häng `&wall_text=24` für größere Schrift an. Ein Bildschirm, der mit seinem eigenen Link geöffnet
wurde, ignoriert die Einstellung des Hauses.

## Hochkant-Wände

Ein Bildschirm, der hochkant hängt, funktioniert so gut wie ein breiter, und er wird in beiden Lagen
gleich bemessen.

- Dreht der Fernseher oder Stick sein Bild, wenn sich der Bildschirm dreht, musst du nichts
  einstellen.
- Die meisten Fernseher und Sticks können das nicht. Häng ihn auf die Seite gedreht auf und nimm
  **Einstellungen → Atlas → Wall screens → Screen orientation → Portrait: turn the picture clockwise**
  (oder anticlockwise, gegen den Uhrzeigersinn). Das hängt `&wall_rotate=90` (oder `270`) an den
  Link dieses Bildschirms an. Steht die Karte auf dem Kopf, nimm die andere Richtung.

## Live Aboard an einer Wand

- Stell die Ansicht ein, die du willst, und wähl **Views ▾ → Set as home**.
- Stell unter **Einstellungen → Atlas → Live Aboard** **Back to home view** ein (30 s, 1 min, 5 min
  oder aus). Der Bildschirm fliegt zurück zu dieser Ansicht, wenn ihn so lange niemand berührt hat,
  nie während jemand bearbeitet, eine Karte offen hat oder ihn von Hand auf Vollbild gestellt hat.
- Wenn sich nichts bewegt, zeichnet Live Aboard nichts, also kostet ein ruhender Bildschirm fast
  nichts.
- Bei der Qualität **Auto** oder **High** zeichnet eine Wand mit jedem Pixel, das der Bildschirm
  hat. Ein Grafikchip, der dafür zu langsam ist, zeichnet ein weicheres Bild, während sich die
  Kamera bewegt, dann etwa so viel wie bei 1440p, dann fällt Auto auf Low und High auf den flachen
  Atlas. **Low** bleibt auf jedem Bildschirm Low.

Mehr in [Kapitel 16](16-live-aboard.md).

## Mehrere Bildschirme auf einmal: Für viele Bildschirme optimieren

Jeder Bildschirm, der die Übersicht zeigt oder die 3D-Ansicht mit Personen, fragt Home Assistant alle
5 Sekunden nach dem ganzen Live-Bild: in einem belebten Haus jedes vorbeikommende Bluetooth-Gerät,
etwa 2,2 MB pro Bildschirm. Vier Bildschirme bewegen dann den ganzen Tag etwa 14 Mbit/s. Die flache
Atlas-Wand (`?kiosk=1`) fragt nicht danach.

**Einstellungen → Ortung → Leistung → Für viele Bildschirme optimieren** (ab Werk aus) senkt das:

- **Ein schlankes Update**: Die Übersicht und die 3D-Personen fragen nur nach dem, was sie zeichnen
  (Personen, Tags, benannte Geräte und solche, denen du folgst, alles, was in einem Raum platziert
  ist), plus die Zahlen: etwa 50 KB statt 2,2 MB in einem echten Haus.
- **Eine Zusammenstellung für alle Bildschirme**: Bildschirme, die innerhalb von 4,5 Sekunden
  voneinander fragen, teilen sich eine.
- **Nichts, solange ein Bildschirm aus ist**: Eine ausgeblendete Seite fragt nach nichts, bis sie
  wieder gezeigt wird.

Jeder andere Bildschirm bekommt weiter alles. Ist es an, zeigt die Liste hinter der Objektzahl der
Übersicht nur, was das schlanke Update mitbringt. Mehr in
[Kapitel 23](23-performance-and-small-machines.md).

## Tipps

- Lass Live Aboard auf einem alten oder langsamen Tablet auf der Qualität **Low**.
- Der Knopf **Test emergency lighting** sitzt oben rechts im Atlas. Auf einem Bildschirm, den jeder
  antippen kann, blendest du ihn aus ([Kapitel 15](15-the-atlas.md#test-der-notbeleuchtung)).
- Deine Alarmanlage darin funktioniert auf einem Wandbildschirm wie überall (PadSpan Pro, das
  Add-on Alarm & Sicherheit oder Bright Pro): Jedes Scharf- und Unscharfschalten fragt zuerst, mit dem Code, wenn die Alarmanlage einen
  will, und nichts auf ihrer Karte führt von der Seite weg
  ([Kapitel 13](13-alerts.md#deine-alarmanlage-am-notfallknopf)).
- Wer an einem gemeinsamen Bildschirm was ändern darf: [Kapitel 21](21-users-and-security.md).
