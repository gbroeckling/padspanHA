# 16. Live Aboard

[Inhalt](README.md)

Live Aboard ist der Atlas in 3D: deine Etagen, Räume, Wände, Türen, Fenster, Lichter und Sensoren als
kleines Haus, das du drehen, zoomen und antippen kannst, so wie man bei The Sims in ein Haus schaut.
Es wird aus der Karte gebaut, die du schon gezeichnet hast, deshalb gibt es nichts Neues
einzurichten, bevor du es siehst. Es gehört zu PadSpan Pro und ist **experimentell**: Wenn in deinem
Haus etwas falsch aussieht, sag es bitte ([Kapitel 27](27-getting-help.md)).

## Einschalten

1. Öffne **Einstellungen → Atlas** und such **Atlas — Mapped Light Control**.
2. Schalte unter **Live Aboard** **Show Live Aboard on the Atlas** ein. Es speichert sofort.
3. Öffne den Atlas. Im Atlas der Seitenleiste tippst du auf **🏠** in der Leiste links, um zwischen
   der flachen Karte und Live Aboard zu wechseln. In **Karten → Atlas-Editor** nimmst du den
   Schalter **Map | Live Aboard** neben dem Zoom.

Dieselbe Karte hat:

- **Rain and snow**: fällt draußen um das Haus, wenn das Wetter des Atlas es sagt.
- **Look**: die Farben des Atlas, die eigenen von Live Aboard, oder **Studio** (seine eigenen Farben
  auf einer Bühne unter einem Himmel, der der Sonne folgt, mit weichem Licht und Schatten).
- **Back to home view**: wie lange der Atlas der Seitenleiste unberührt wartet, bevor er zu seiner
  Startansicht zurückfliegt (Off, 30 s, 1 min, 5 min).
- **Show people** und **Show tags & scanners**, auf der Karte und in Live Aboard.

**Set it up step by step** auf dieser Karte (oder **Set up Live Aboard** oben im Atlas-Editor)
öffnet einen Assistenten, der das Haus mit dir baut: Etagenhöhen, Räume, Geräte, Höhen, Türen und
Fenster, LED-Streifen, Möbel, die Extras, und es zu deinem Bildschirm machen (**Show the Atlas as
Overview**). Jeder Schritt sagt, was er gefunden hat und was noch fehlt.

Ist 🏠 ausgegraut, steht der Grund daneben (zum Beispiel ein Browser ohne WebGL). Tipp darauf, um es
noch einmal zu versuchen.

## Im Haus bewegen

In der Seitenleiste öffnet Live Aboard mit allen Etagen, auseinandergezogen (**⇕ Explode**), und die
Leisten der Seite sind aus dem Weg. **☰** (oben rechts) holt die Leisten zurück.

| Was | Wie |
|---|---|
| Das Haus drehen | Mit einem Finger oder der linken Maustaste ziehen |
| Es verschieben | Zwei Finger, oder die rechte Maustaste |
| Zoomen | Zwei Finger zusammenziehen oder spreizen, oder das Mausrad |
| Zu einem Raum gehen | Doppelt darauf tippen, oder ihn in **Rooms ▾** wählen |
| Gerade nach unten schauen / zurück zum üblichen Winkel | **Top** / **Iso** |
| Eine Vierteldrehung | **⟳ 90°** |
| Alles sehen | **Fit**, oder **Views ▾ → Whole house** |
| Norden oben | Auf den Kompass tippen |

**Walls** (unten links): **Cut** senkt die Wände vor dir; **Up** stellt jede Wand in voller Höhe auf
(am besten von außen, und nachts); **Down** legt sie alle niedrig; **Glass** macht die Wände vor dir
durchsichtig, sodass die Räume ihre Höhe behalten; **Roof** zeigt das Dach von außen, oder nie.

**Floors**: **▲ / ▼** gehen eine Etage hinauf oder hinunter und blenden die Etagen darüber aus;
**All** zeigt jede Etage; **⇕ Explode** (mit All) zieht sie auseinander. Auf einer Tastatur wechseln
**PgUp / PgDn** (Bild↑ / Bild↓) die Etage, und **Home** (Pos1) zeigt alle. Tipp auf den Namen einer
Etage für ihr Blatt.

**Views ▾** hat jede Etage, **Whole house** und Ansichten, die du mit **Save this view** behältst.
**Set as home** macht die aktuelle Ansicht zu der, mit der die Seitenleiste öffnet und zu der sie
zurückgeht. **Views ▾ → Look** wählt die Farben dieses Bildschirms: **Same as Settings**,
**Classic**, **Studio** oder ein Showcase-Thema. Hak **By the sun** an für einen Look am Tag und
einen anderen nach Sonnenuntergang.

**Rooms ▾** listet jeden Raum unter seiner Etage. Wähl einen: Die Ansicht fliegt zu ihm, und sein
Feld öffnet sich, mit den Geräten und Knöpfen des Raums (jeder Schalter mit **Undo**), seinen Szenen
und **More devices of the area**: was Home Assistant in diesem Bereich hat, das die Karte nicht
zeigt. Auf einem breiten Bildschirm setzt **Room chips along the top** in **⋯** die Raumnamen
stattdessen in eine Reihe.

## Das Haus lesen

Was du siehst, hängt davon ab, wie nah du bist:

- **Das ganze Haus**: ein Schild neben jeder Etage mit dem, was dort los ist („Main · 3 lights on ·
  1 open · 2 people“). Tipp darauf, um nur diese Etage zu sehen.
- **Eine Etage**: Raumnamen, Messwerte und Sensormarkierungen.
- **Ein Raum** (doppelt tippen oder hineinzoomen): die Gerätekürzel in diesem Raum; die anderen
  treten zurück.

Alarme (Wasser, Rauch, Gas, CO) erscheinen immer: Ringe über den Boden des Raums und ein rotes Wort
über allem (**WET**, **SMOKE**, **GAS**, **CO**, oder **ALARM**, solange der Alarm gehalten wird),
bis er über das Banner zurückgesetzt wird.

- **Lichter** leuchten in ihrer eigenen Farbe und Helligkeit. Ein Licht, das aus ist, ist eine
  kleine dunkle Leuchte.
- **Raum-Messwerte** (Temperatur, Feuchtigkeit, Luftqualität) stehen unter dem Namen. Einer, der
  seit über einer Stunde nicht gekommen ist, zeigt einen Strich („–°“), damit du nie einen alten
  Wert als aktuellen liest.
- **Bewegung**: Ein Sensor, der gerade auslöst, ist ein leuchtend blaues Abzeichen und tönt seinen
  Raum. Einer, der früher ausgelöst hat, ist in der Farbe seines Alters umrandet, von Blau (gerade
  eben) bis Rot (etwa 2 Stunden). Eine gestrichelte Linie führt von jedem Abzeichen hinunter dorthin,
  wo der Sensor wirklich ist. Der **Motion chip** oben nennt die neuesten Räume („Kitchen now ·
  Hall 12 min“).
- **Wärmekarte**: ☰ → **Temps** färbt jeden Raum mit einem Thermometer: blau, wenn es kühl ist,
  grün um 21°, rot ab 26°.
- **Fenster offen im Regen**: Ein offenes Fenster leuchtet blau, und eine Zeile unter dem Motion
  chip nennt es. Dafür muss das Fenster mit verknüpftem Sensor gezeichnet und das Wetter des Atlas
  eingerichtet sein.
- **Nachts** wird das Haus mit der echten Sonne dunkel, und bei aufgestellten Wänden leuchten die
  Fenster beleuchteter Räume.
- **Türen und Fenster**, die mit Sensoren verknüpft sind, öffnen und schließen sich wie sie. Ein
  Schloss, das mit einer Tür verknüpft ist, leuchtet rot, solange es offen ist.

**Mezzanine und Galerien**: Mach eine davon in Home Assistant zu einer eigenen Etage. Gib in
**Karten → 3D-Stapel → Etagenhöhen** der Halle darunter ihre volle Höhe und dem Mezzanin seine echte
Grundhöhe; Live Aboard zeichnet es dann in der Halle. Markier eine offene Kante in
**Karten → Bearbeiten → Signalwände** (**Offene Kante: Raumkante antippen**) und drück **Geländer**
in ihrer Zeile für ein Geländer
([Kapitel 10](10-walls-and-signal-loss.md#offene-kanten-räume-ohne-wand-dazwischen)).

## Benutzen

- **Tipp auf ein Licht**, um es zu schalten; **halte** es für Helligkeit, Farbe und Effekte.
- **Tipp auf einen Sensor oder einen Messwert** für seine Karte; die Karte eines Bewegungsmelders
  öffnet seinen Aktivitätskalender.
- **Tipp auf den Namen eines Raums** für sein Blatt: jedes Gerät, **All lights on / off**,
  Ventilatoren und die eigenen Szenen und Skripte des Raums.

## Bauen: Türen, Fenster, Höhen und Streifen

Gebaut wird in **Karten → Atlas-Editor**, in Live Aboard, mit **Edit**. Nichts wird gespeichert, bis
du **Save** drückst. **Undo**, **Redo** und **Discard** gehen durch deine Änderungen; **Done**
verlässt Edit und fragt zuerst, wenn etwas nicht gespeichert ist. Tasten: **Strg+Z** macht
rückgängig, **Strg+Y** wiederholt, **Esc** lässt los, **Entf** entfernt die gewählte Tür oder das
gewählte Fenster.

**Türen, Fenster und Durchgänge**

1. **Edit**, dann **Door**, **Window** oder **Doorway**. Die Ansicht schaut gerade nach unten.
2. Drück auf eine Wand und zieh an ihr entlang, oder tipp ihre beiden Enden an. Die Länge wird
   angezeigt, in Schritten von 5 cm.
3. Lass los: Das Blatt der Öffnung geht auf. Eine Tür hat eine Höhe, einen **Type** (Drehtür,
   Doppeltür, Schiebetür, Scheunentor, Taschentür, Falttür, Garagentor, Tor und andere), Anschlag
   und Öffnungsrichtung, und **Follows**: einen Tür- oder Garagensensor oder eine Abdeckung, sodass
   sie sich öffnet und schließt wie diese. Ein Fenster hat die Höhen **Sill** und **Head**.

Verschieb oder verändere einen Raum in **Karten → Aufteilung**, und seine Türen und Fenster gehen
mit, wenn du **Korrekturen speichern** drückst. Die, bei denen das nicht geht, bleiben, wo sie
waren, und die Meldung sagt, wie viele.

**Höhen**: **Edit → Heights**, tipp ein Gerät an und nimm den Schieber oder eine Stelle, die für
seine Art angeboten wird (**Ceiling**, **Corner**, **High on the wall**, **Switch height**,
**Table**, **Floor**…). **Reset to default** stellt es zurück; bei einem Licht sagt
**What is this?**, was es ist (ein Einbaustrahler, eine Pendelleuchte, eine Lampe). Das sind
dieselben Höhen wie in der Zeile **Height** des Atlas-Editors.

**Streifen** (LED-Streifen, Lichtblenden, Lichtvouten, Lichterketten): **Edit → Strip**, tipp das
Licht an oder wähl es aus **Lights to lay out**, dann **Round this room** (mit
**Leave gaps at doors** und Fenstern), **Under**, **Behind** oder **Top edge** eines Möbelstücks,
**Along a rail** oder **Draw**. Stell seine Höhe ein (Toe-kick, Counter, Under cabinets, Valance,
Cove, Ceiling edge, oder Zentimeter) und in welche Richtung es leuchtet. **Remove run** setzt es auf
PadSpans Schätzung zurück.

**Möbel**: **Karten → Einrichten**, [Kapitel 17](17-furnish.md).

## Aus deinen Plänen bauen, mit einer KI (experimentell)

Drei Reiter unter **Edit → Plans** lesen deine Grundrisse mit einer KI. Jeder ist ein Experiment:
Die KI macht Fehler, also prüf jeden Punkt. Sie brauchen PadSpan Pro und Schalter in
**Einstellungen → KI** ([Kapitel 19](19-ai-features.md)). Eine Cloud-KI bekommt eine Kopie der Pläne,
die sie liest.

- **Plans** (braucht **AI map-building research (experimental)** und einen AI Task): Die KI markiert
  Treppen, und wenn du **Lights** anhakst, Lichtsymbole, als nummerierte Pins über deinem Plan. Geh
  sie einzeln durch (**New**, **Correction**, **Failure**, **Looks right**, **Later**); es gibt kein
  Alles-übernehmen. Mit einer kleinen lokalen KI sind etwa 2 von 10 Treppenvorschlägen falsch. Sie
  platziert oder verschiebt nie ein Licht und schreibt immer nur in dein 3D-Haus.
- **Line up plans** (braucht **Build from plans** und Claude Opus 5.5 oder neuer über die
  Anthropic-Integration von Home Assistant): richtet mehrere Pläne einer Etage aneinander aus (einen
  vermessenen, ein Blatt vom Architekten, einen Scan). Nur das Bild eines Plans bewegt sich;
  Kalibrierpunkte, Räume, Empfänger und der Plan, der den Maßstab gesetzt hat, bleiben, wo sie sind.
  Vor jedem Speichern legt es zuerst eine Sicherung an.
- **Rooms from plans** (derselbe Schalter): Claude liest jeden Plan zweimal und schlägt Umrisse für
  die Räume vor, die du schon hast, zugeordnet danach, wo sie liegen, nie nach Namen. Räume, bei
  denen beide Lesungen übereinstimmen, sind angehakt; **Look closely** zeigt, wo sie sich
  unterscheiden, und **Read again** macht eine dritte Lesung. **Accept all for this floor** speichert
  nach einer Sicherung; **Undo this rooms session** nimmt es zurück.

## Auf einem Wandbildschirm

- Setz mit **Set as home** die Ansicht, auf der der Bildschirm ruhen soll, und wähl
  **Back to home view**. Er fliegt nach so langer Zeit ohne Berührung zurück, nie während du
  bearbeitest oder eine Karte offen hast.
- Der Knopf in der Ecke macht es bildschirmfüllend.
- Wenn sich nichts ändert, zeichnet Live Aboard nichts, ein ruhiges Haus kostet den Bildschirm also
  nichts.

Mehr in [Kapitel 18](18-wall-screens-and-kiosks.md).

## Wenn etwas nicht stimmt

- **Es zeigt stattdessen die flache Karte**: Der Browser konnte die 3D-Ansicht nicht ausführen (kein
  WebGL, zu langsam, oder seine Grafik ist neu gestartet). Der Knopf 🏠 sagt, warum; tipp darauf, um
  es noch einmal zu versuchen. Mehr in [Kapitel 26](26-troubleshooting.md#das-3d-haus-startet-nicht).
- **Die Temperatur eines Raums zeigt „–°“**: Sein Sensor hat seit über einer Stunde nichts
  gemeldet.
- **Ein Gerät schwebt an der falschen Stelle**: Stell seine Höhe in **Edit → Heights** ein, oder
  verschieb es auf der Karte.
- **Eine Tür oder ein Fenster fehlt**: Zeichne sie in Edit, oder auf der Karte mit verknüpftem
  Sensor.
