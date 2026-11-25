# 15. Der Atlas

[Inhalt](README.md)

Der Atlas ist PadSpans Gerätekarte: deine Etagen und Räume als Plan gezeichnet, mit Lichtern,
Ventilatoren, Schlössern, Sensoren, Türen und Fenstern da, wo sie wirklich sind. Ein Tippen schaltet
ein Licht oder einen Ventilator; ein Sensor sagt, was er misst, und bei einem Schloss oder einer
verknüpften Tür öffnet sich die zugehörige Karte. Er hieß „Lights“, bis er über die Beleuchtung hinauswuchs; der Filter-Chip
für Leuchten heißt immer noch **Lights**.

## Kostenlos und Pro

- **Kostenlos**: Etagen, Räume und eine Markierung pro Licht. Tipp auf eine Markierung oder ihre
  Zeile, um es zu schalten.
- **PadSpan Pro**: echte Platzierung, Formen und Größen, Sensoren, Automorph, Showcase, die
  Advanced-Steuerung für WLED, Whole house presets, Vacation Mode und Öffner aus Relais.

**Einstellungen → Funktionen → PadSpan-Lizenz** hat einen einmaligen kostenlosen Testzeitraum von
90 Tagen ([Kapitel 25](25-padspan-pro.md)). PadSpan Bright ist derselbe Atlas für sich allein, ohne
Anwesenheitserkennung, mit eigenem Bright-Pro-Schlüssel. Ein Bright-Pro-Schlüssel schaltet die
Platzierungswerkzeuge frei: Platzierung, Formen und Größen, die Advanced-Steuerung für WLED,
Automorph und Showcase. Whole house presets, Vacation Mode und die Heatmap brauchen PadSpan Pro oder
ihr Add-on.

Ohne Pro schaltet ein Add-on einen Teil des Atlas frei ([Kapitel 25](25-padspan-pro.md#add-ons)):
**Audio**; **Alarm & Sicherheit** (scharf und unscharf schalten im Notfallknopf, der Test der
Notbeleuchtung und die Karte einer Tür mit ihrem Öffner und ihrem Schloss); **Klimakarte** (die
Heatmap); **Urlaubsmodus & Voreinstellungen**; und das **Looks-Paket** (Showcase mit seinen Themen,
der West Coast Forest und die Presets-Leiste, auf der kostenlosen Karte: Platzieren bleibt bei Pro).

## So kommst du hin

- **Karten → Atlas-Editor**: wo du Geräte platzierst und bearbeitest.
- **Die Seite Atlas in der Seitenleiste von Home Assistant**: eine leichtere Ansicht derselben Karte,
  ohne den Rest von PadSpan. Sie ist ab Werk an; **Einstellungen → Atlas → Show the Atlas in the Home
  Assistant sidebar** schaltet sie aus.
- **Auf einem Wandbildschirm**: [Kapitel 18](18-wall-screens-and-kiosks.md).

Die Karte braucht zuerst deine Grundrisse und Räume: [Kapitel 9](09-setup-the-map.md).

## Geräte platzieren (Pro)

1. Such das Gerät in **Karten → Atlas-Editor** in der Zeilenliste. **Queue all unplaced** reiht
   mehrere auf einmal ein.
2. Zieh seinen pulsierenden Pin auf die Etage, oder wähl **+ Place** und tipp auf die Stelle der
   Karte, an die es gehört.
3. Stell im Inspektor seine Form, Größe und seinen Winkel ein: Ein Licht kann eine Pendelleuchte,
   eine Wandleuchte, ein Streifen oder ein Kronleuchter sein, in echten Zentimetern.

Lichter, Ventilatoren, Schlösser sowie Bewegungs-, Temperatur-, Feuchtigkeits-, Luftqualitäts- und
Wassermelder werden alle auf dieselbe Art platziert.

- Eine **Temperatur**-Markierung ist nach ihrem Messwert getönt: blau unter 20°, rot ab 20°,
  leuchtend orange über 34°. Ein **Feuchtigkeits**-Messwert erscheint als Prozentzahl.
- **Bewegung** sieht bei jedem Sensor gleich aus: ein kurzes Aufblitzen, dann ein Verblassen, je
  länger es ruhig war. Nach einem Neustart von Home Assistant bleibt Bewegung ein paar Minuten ruhig.
- **Geräte draußen** (alles, dessen Bereich auf einer Outside-Etage liegt: ein Schuppen, der Garten,
  die Einfahrt) haben auf der flachen Karte keine eigene Etage. Platzier sie auf einer Etagenplatte,
  außerhalb des Raums, neben dem sie stehen.

**Höhen.** Jedes platzierte Gerät hat eine Höhe über seiner Etage, die das 3D-Haus nutzt. Wähl ein
Gerät und nimm seine Zeile **Height**: eine der Stellen, die für seine Art angeboten werden (ein
Bewegungsmelder: Corner, Ceiling, High on the wall; ein Wassermelder: Floor), Zentimeter, oder
**Default**. Die Liste **Heights** zeigt jedes platzierte Gerät; hak mehrere an, um sie auf einmal
einzustellen.

## Die Karte benutzen

- **Ein Tippen schaltet** ein Licht oder einen Ventilator. Bei einem Sensor sagt ein Tippen, was er
  misst; bei einem Schloss öffnet es dessen Karte. **Halten** (ein goldener Ring füllt sich, während
  du hältst), oder Shift oder Alt mit einem Klick, **wählt** ein Gerät zum Bearbeiten **aus**. Ziehen
  verschiebt es.
- **Geräte übereinander**: Fahr mit der Maus darüber, oder halte den Finger darauf, und das Feld oben
  links nennt alles, was dort übereinanderliegt. **Alt+Klick** geht sie der Reihe nach durch.
- **Das Blatt eines Raums**: Tipp auf den Namen des Raums für jedes Gerät darin, **All lights on /
  off**, seine Ventilatoren und einen Knopf für jede Szene und jedes Skript des Raums in Home
  Assistant (bis zu sechs). Tipp auf das Abzeichen einer Etage für das Blatt der Etage.
- **Find active** scrollt zum ersten Gerät, das gerade etwas tut (ein Licht an, Bewegung), und zeigt
  darauf.
- Auf einem Touchscreen zoomen zwei Finger die Karte, und ein Verschieben übersteht das
  Aktualisieren der Karte.

## Türen, Fenster und Schlösser

Eine Tür oder ein Fenster, auf einer Wand markiert
([Kapitel 10](10-walls-and-signal-loss.md#türen-und-fenster-die-aufgehen)), zeigt nach seinem Sensor
offen oder zu. **Umkehren**, neben **Löschen** in der Wandliste, dreht einen Sensor um, der verkehrt
herum meldet: Zeigt eine Tür den falschen Zustand, prüf das zuerst. Ein Schloss auf der Karte zeigt
seinen Zustand. Ein Tippen schaltet es nicht: Tippen oder Halten öffnet seine Karte mit **Lock** oder
**Unlock**, und **Unlock** fragt vorher nach.

Eine Tür oder ein Fenster kann auch tragen, was sie öffnet und was sie abschließt (PadSpan Pro oder
das Add-on Alarm & Sicherheit; auch ein Bright-Pro-Schlüssel). Hak unter **Geräte → Türöffner** eine Abdeckung (ein Garagentor, ein Tor, ein
Rollo), einen Schalter, einen Taster oder ein Skript an und verknüpf sie dann in **Karten →
Atlas-Editor** mit der Tür oder dem Fenster, neben ihrem Sensor und ihrem Schloss. Ein Tippen auf
die Tür öffnet dann eine Karte: ob sie offen oder zu ist, **Open** oder **Close** für eine Abdeckung
(**Trigger** für einen Schalter, einen Taster oder ein Skript) und das Schloss. Eine Abdeckung, die
ohne Sensor verknüpft ist, meldet offen oder zu selbst.

## Alarme und das Notfall-Banner

Wasser-, Rauch-, Gas- und Kohlenmonoxidmelder werden als Pfütze oder als runder Melder gezeichnet
und zeigen **WET**, **SMOKE**, **GAS** oder **CO**, **ALARM**, solange der Alarm gehalten wird, und
**DRY** oder **CLEAR**, wenn sie ruhig sind. Geht einer los, läuft ein roter Ring durch seinen Raum,
und er bleibt 2 Tage lang im Alarm oder bis ihn jemand zurücksetzt, auch wenn der Sensor ruhig wird.
Ein Banner zeigt ihn auf jedem Bildschirm von PadSpan, mit eigenem **Zurücksetzen**. Zurücksetzen
löscht PadSpans Erinnerung an den Alarm, nicht den Sensor. Mehr in [Kapitel 13](13-alerts.md).

## Die Szenenleiste

Unter der Karte, und in Live Aboard, liegt eine Reihe von Kacheln: eine für jede Szene in Home
Assistant, die ein platziertes Licht setzt, und eine für jedes Whole house preset, dessen
eingeschaltete Lichter alle auf einer Etage liegen (mit **Preset** markiert). Eine Kachel ist eine
kleine Karte der Etage und zeigt, welche Lichter die Szene benutzt. Ein Tippen startet sie; sind
alle ihre Lichter schon an, schaltet ein Tippen sie aus. **+ New scene** und ✎ öffnen den
Szenen-Editor von Home Assistant, für einen Administrator, und nie auf einem Wandbildschirm.

## Audio

Hak im **⋯** der Karte (Show on this screen, in der Leiste neben der Karte, und im eigenen ⋯ der
3D-Ansicht) **Audio** an, und das Blatt jedes Raums (in 3D sein Feld) bekommt seine Musik, seine
Beschattung und sein Thermostat. Ab Werk ist es aus, bis ein Bildschirm es anhakt, und jeder
Bildschirm (ein Handy, eine Wand) hat seinen eigenen Haken. Aus sind die Karte und die Blätter genau
wie vorher. **Einrichten ›** in derselben Zeile öffnet die Zuordnungskarte (unten) gleich dort über
der Karte, angehakt oder nicht, für einen Administrator, auch auf einem Wandbildschirm.

- **Auf der Karte**: ein kleines rundes Lautsprecher-Abzeichen neben dem Namen eines Raums,
  solange einer seiner Player an ist, durchgestrichen, solange der erste Player des Raums stumm ist.
  Es hält Abstand zum Namen und zu den Werten des Raums (Temperatur, Luftfeuchtigkeit, Luft), damit
  ein Wert nie wie eine Lautstärke aussieht. Nichts, solange alle aus sind, und keine anderen neuen
  Zeichen. Tipp darauf oder auf den Namen für das Blatt des Raums: Ein Tippen auf die Karte ändert
  nie etwas. Die 3D-Ansicht zeigt dasselbe Abzeichen neben dem Namen und den Werten des Raums (sind
  die Namen ausgeblendet, neben den Werten); ein Tippen darauf öffnet das Feld des Raums, das sich
  unterhalb des Notfallknopfs öffnet, nie darunter verdeckt.
- **Das Blatt**: unter dem Namen des Raums seine Temperatur und Luftfeuchtigkeit (der mittlere Wert
  seiner Sensoren) und wer da ist. **Raum aus (n)** schaltet die Lichter und Player des Raums aus,
  nie ein Schloss, eine Beschattung, das Thermostat oder eine Steckdose, und erscheint nur, solange
  etwas an ist. Dann die Szenen wie bisher, und:
  - **Audio**: eine Zeile für jeden Player, mit seinem System benannt („Control4 · Great Room“,
    „Denon · Zone 2“), ob er an, aus oder stumm ist, **Stumm**, **−**, die Lautstärke, **+** und ⏻
    (dieser Player aus), diese fünf immer in einer Zeile. Jedes **−** oder **+** ändert die
    angezeigte Lautstärke sofort um einen Schritt (1 von 100 bei einem Player, der selbst schrittweise
    regelt, etwa einem Control4-Raum), und schnelle Tipps zählen zusammen; meldet Home Assistant eine
    Lautstärke, wird sie gezeigt. Was ein Player nicht kann, fehlt oder ist grau: Ein
    ausgeschalteter Player zeigt seine Lautstärke als —.
  - die Lichter des Raums wie bisher;
  - **Beschattung**: eine Zeile für alle Abdeckungen des Raums, **Öffnen**, **Stopp** und
    **Schließen** für alle zugleich, und wie weit sie offen sind. Garagentore, Tore und Türen bleiben
    auf der Karte ihrer Tür.
  - **Klima**: die Temperatur jedes Thermostats, sein Sollwert mit − und + und seine Betriebsart.

  Jeder Druck ist ein Aufruf an Home Assistant, ohne Rückfrage. Wer die Lichter schalten kann, kann
  sie benutzen, auch auf einem Wandbildschirm. Lehnt Home Assistant ab, sagt es mit eigenen Worten,
  warum.
- **Player den Räumen zuordnen**: Home Assistant weiß nicht, in welchem Raum die Zone eines
  Systems für das ganze Haus liegt, also ordnet ein Administrator sie einmal zu. **Räume zuordnen**
  am Ende des Audio-Teils (**Control4 mit HA abgleichen**, wo Control4 das einzige System ist)
  öffnet eine Karte mit jedem Player, nach System, und einem Raum für jeden, oder **Nicht auf der
  Karte**. Beim ersten Mal rät sie nach dem Bereich des Players in Home Assistant, sonst nach seinem
  Namen. **Einrichten ›** in der Zeile **Audio** im **⋯** öffnet sie auch, und **Audio** anzuhaken,
  solange nichts zugeordnet ist, öffnet sie sofort. Mehrere
  Player können sich einen Raum teilen (etwa eine Control4-Zone und eine Denon-Zone): ▲ und ▼ legen
  ihre Reihenfolge fest, und dem ersten folgt der Lautsprecher auf der Karte. Jede Wahl wird sofort
  gespeichert (beim ersten Öffnen auch die Vorschläge der Karte), also gibt es kein Speichern:
  **Fertig** schließt sie. Hat sie einmal eine Wahl gespeichert, schlägt sie nie wieder vor, also
  bleiben Player, die von der Karte genommen wurden, weg, und eine Zuordnung zu einem Player, den
  Home Assistant gerade nicht zeigt (ausgeblendet, noch nicht geladen), oder zu einem auf der Karte
  umbenannten Raum bleibt, wie sie war. Wer kein Administrator ist, sieht den Knopf grau.
- **Welche Player**: Control4, Crestron, Savant, Savant Audio, Russound, Nuvo, Monoprice, Xantech,
  Triad, Denon, Yamaha und Anthem, nach der Integration in Home Assistant, aus der sie kommen.
  **Lautsprecher aus Home Assistant einbeziehen** auf der Zuordnungskarte (aus, bis angehakt) nimmt
  jeden anderen Player mit Lautstärke dazu: Music Assistant, ESPHome, Cast, Fernseher.

Audio braucht PadSpan Pro oder das Add-on Audio. Die **⋯**-Liste gehört zum neuen Layout von
PadSpan Pro; auf dem klassischen Layout macht **Einstellungen → Atlas → Atlas — Mapped Light Control
→ Audio** (ab Werk aus, da, wo Audio freigeschaltet ist) dasselbe für das ganze Haus: den
Lautsprecher neben dem Namen eines Raums, in dem Musik läuft, auch in der 3D-Ansicht, und Audio im
Blatt mit **Räume zuordnen**. Dort ist es der einzige Schalter: Das **⋯** der 3D-Ansicht hat keine
eigene Audio-Zeile.

## Heatmap (Pro oder das Add-on Klimakarte)

**Einstellungen → Atlas → Atlas — Mapped Light Control → Heatmap chip on the Atlas (temperature,
humidity, CO₂)**, ab Werk aus, gibt dem Atlas einen Chip **♨ Heatmap**. Tipp darauf, um
**Temperature**, **Humidity** und **CO₂** durchzugehen (die Arten, für die dein Haus einen Sensor
hat), dann aus. Jeder Raum wird nach seinen eigenen Sensoren eingefärbt: den platzierten, oder, wenn
keiner platziert ist, dem Durchschnitt der Sensoren des Raums in seiner Mitte. Nichts geht durch
eine Wand, ein Raum ohne Sensor bleibt ungefärbt, und ein Messwert, der älter als eine Stunde ist,
wird nicht benutzt.

## Power-Teams

Smarte Farbbirnen in Fassungen, die an einem Wanddimmer oder Wandschalter hängen (zum Beispiel
Zigbee-Birnen an einem Control4-Dimmer), werden dunkel, wenn jemand an der Wand ausschaltet, und
kommen in der falschen Farbe zurück. Ein Power-Team macht den Dimmer und seine Birnen in Home
Assistant zu einem Licht.

**Eins anlegen**: **Einstellungen → Atlas → Power teams**, **+ Add a team**. Gib ihm einen Namen
(„Schlafzimmerlicht“), wähl **Power from** (den Wanddimmer oder Wandschalter, oder **None: these
lights always have power** für Farblichter mit eigener Stromversorgung, etwa LED-Lichterketten), hak
**Its bulbs** an und wähl **Save**. Ein Administrator legt Teams an und ändert sie. Jedes Team ist
dann ein Licht in Home Assistant unter seinem Namen (`light.<team>`,
[Kapitel 14](14-home-assistant-reference.md)): Gib ihm dort seinen Raum und platzier es dann auf
der Karte.

**Was es tut**

- **Einschalten** schaltet den Strom voll ein, schickt den Birnen ihre Helligkeit und Farbe noch
  einmal, während sie starten, und sagt, welche Birne nie geantwortet hat.
- **Ausschalten** tut, was du für das Team gewählt hast: **Turns the bulbs off, power stays on**
  (sie kommen sofort wieder, in der richtigen Farbe; neue Teams starten damit) oder
  **Cuts the power**.
- **Der Schalter an der Wand funktioniert weiter.** PadSpan sieht den Strom kommen und stellt die
  Birnen ein. Ein Dimmer, der an der Wand niedrig gehalten wird, legt fest, wie hell die Birnen
  werden, während der Dimmer selbst zurück auf voll geht: Smarte Birnen brauchen die ganze Welle.
- **Follow the day**: kühl und hell am Mittag, warm bei Sonnenaufgang und Sonnenuntergang, gedimmt
  und wärmer durch die Nacht, jede Minute mit einem langsamen Übergang nachgeführt. Wählst du selbst
  eine Farbe oder Helligkeit, hört es auf, bis das Team das nächste Mal eingeschaltet wird oder bis du
  wieder **Follow the day** wählst. **Sleep** ist eine gedimmte, warme Einstellung. Die Zahlen der
  Kurve (**Brightest, by day**, **Dimmest, at midnight**, **Coolest, at noon**,
  **Warmest, at sunrise and sunset**, **Sleep: brightness**, **Sleep: colour**) kannst du ändern.
- **Ein langsames Überblenden** von bis zu 100 Minuten, aus einer Automation: Solange es läuft,
  verändert der Tag das Licht nicht.

**Auf der Karte** ist ein Power-Team ein einziges Ding: Platzier den Dimmer, eine seiner Birnen oder
das Licht des Teams. Ein Tippen schaltet das Team, Ziehen dimmt es, und Halten öffnet seine Karte.
Ein Dimmer, der an ist, während seine Birnen aus sind, erscheint dunkel, so wie der Raum es ist.
**Show power teams** auf der Karte in den Einstellungen zeigt sie in der Liste.

**Die Karte des Teams** sagt, was das Team gerade tut (zum Beispiel **Off · the power is on, so it
comes on at once**, **Power on: the bulbs are starting**, **On · set by hand**, **Waking up: fading
in**), mit:

- **Follow the day** und **Sleep**;
- dem **Power** des Wanddimmers, mit **Cut power** und **Power on**;
- jeder Birne, mit **Try again** für eine, die nicht geantwortet hat;
- **A tap's off**: was ein Tippen auf der Karte tut, wenn das Team an ist;
- **The day's light**: wann der Tag dieses Lichts beginnt und endet: **Sunrise moved by** und
  **Sunset moved by** einige Minuten, oder **Day starts at a fixed time** und **Day ends at a fixed
  time** (ein Schlafzimmer, dessen Tag das ganze Jahr um 6:30 beginnt);
- einem Wecken (**wake-up**): An den Tagen und zu der Uhrzeit, die du wählst (**Full light at**,
  **Fading in over**), geht ein Team, das aus ist, auf seiner dunkelsten und wärmsten Stufe an und
  wird bis dahin voll hell. Ein Team, das schon an ist, bleibt, wie es ist. **Save the wake-up**;
- **Advanced: the day's curve**.

Ein Administrator ändert das Wecken und die Kurve. Die Sonnenkurve ist aus Adaptive Lighting
übernommen.

## Showcase, Automorph und Presets (Pro)

Showcase, seine Themen, der West Coast Forest und die Presets-Leiste gibt es auch mit dem Add-on
Looks-Paket, auf der kostenlosen Karte; Whole house presets mit dem Add-on Urlaubsmodus &
Voreinstellungen.

- **Showcase**: 20 Themen für die ganze Karte (Farbe, Raumkanten, Schein und Lichtflecken
  zusammen). Wähl eines in der Werkzeugleiste des Atlas unter **Presentation**.
- **Automorph**: ein weicher Schein, auf der Karte von einer Leuchte hinaus in ihren Raum gezeichnet,
  in verschiedenen Stilen zur Wahl (Werkzeugleiste → Automorph). Er ändert das Aussehen der Karte,
  nicht die Lichter.
- **Die Presets-Leiste** speichert einen ganzen Look (Thema, Automorph-Stil, und wenn du willst
  Etage, Abstand und Anordnung) unter einem Namen, und **Apply** holt ihn zurück.
- **Whole house presets** merkt sich das Haus selbst: **Set** hält den Zustand jedes Lichts und
  Ventilators fest (an oder aus, Helligkeit, Farbe, Effekt, Ventilatorstufe), und **Apply** stellt
  das ganze Haus wieder so her, nachdem es gefragt hat. Schlösser sind nie dabei.

## Vacation Mode (Pro oder das Add-on Urlaubsmodus & Voreinstellungen)

Der erste Eintrag in der Liste Whole house presets. Er lernt den Tagesablauf deines Hauses aus dem
Verlauf von Home Assistant (jedes Licht, jeder Wochentag) und schaltet weiter Lichter passend dazu,
mit etwas Zufall, damit es nicht nach einer Zeitschaltuhr aussieht, bis du ihn ausschaltest. Solange
er läuft, sitzt ein Banner in der Mitte des Atlas, mit einem Schieber **Energy saving** (100 % folgt
dem ganzen Tagesablauf; weniger schaltet weniger Lichter auf einmal ein). Ihn ein- oder
auszuschalten braucht einen Administrator.

- **Das Ausschalten fragt zuerst.** Home Assistant zeigt dann, wer ihn ausgeschaltet hat, wann und
  von wo, und dieselbe Nachricht geht an die Ziele deiner Alarme in Folgen.
- **Innerhalb von 3 Wochen nach einer Reise wieder eingeschaltet**, macht er mit dem Tagesablauf
  dieser Reise weiter, statt aus den Tagen zu lernen, an denen das Haus leer stand.
- **Optionen**, jede aus, bis du sie einstellst: **Only after dark**, **Ends** (ein Datum und eine
  Uhrzeit; er schaltet sich selbst aus und sagt es dir), **Pause while someone is home**,
  **Bedtime** (Lichter gehen ab etwa dieser Zeit bis 5 Uhr morgens aus, jede Nacht um bis zu 20
  Minuten verschoben), **Longest on**.
- `binary_sensor.padspan_vacation_mode` und das Ereignis `padspan_ha_vacation_mode` stehen in
  [Kapitel 14](14-home-assistant-reference.md). Eine PadSpan-Sicherung wiederherzustellen lässt ihn,
  wie er ist.

## Wetter draußen

Wenn es regnet oder schneit, fällt auf dem Atlas zarter Regen oder Schnee rund um das Haus, nie über
einem Raum. PadSpan Pro oder PadSpan Bright Pro animiert das Wetter; die kostenlose Karte zeigt es
unbewegt. Richte es ein unter
**Einstellungen → Atlas → Atlas — Mapped Light Control → Outdoor weather** (Modus Erweitert): der
Schalter (ab Werk an), ein Regensensor (freiwillig), die Wetter-Entität, der Warnungssensor (wird
von selbst gefunden) und **Strength** (0,5× bis 1,5×).

- **Leichter Regen**, wenn es nass ist: Ein Regensensor entscheidet, wenn du einen gewählt hast,
  sonst die Wetter-Entität.
- **Nichts**, wenn ein Ein/Aus-Regensensor nass meldet, die Wetter-Entität aber sonnig, klare Nacht
  oder teilweise bewölkt sagt: Tau und Reif machen einen Regensensor an klaren Morgen nass.
- **Die Antwort der Wetter-Entität**, wenn der Regensensor seit über 3 Stunden nichts gemeldet hat.
- **Starker Regen** nur bei einer Regenwarnung, oder wenn die Wetter-Entität Starkregen sagt.
- **Schnee**, wenn die Wetter-Entität Schnee sagt, oder bei 1 °C oder kälter. **Starker Schnee** nur
  bei einer Schneefallwarnung.

Warnungen werden von selbst gefunden, von Environment Canada, MeteoAlarm, DWD und NINA sowie
Météo-France. In den USA fügen die Custom-Integrationen weatheralerts oder nws_alerts sie hinzu.

## Test der Notbeleuchtung

Ein runder roter Knopf **Test emergency lighting** oben rechts auf der Karte, nur da, wenn PadSpan
Notlichter findet: eine Home-Assistant-Gruppe mit „emergency“ im Namen (auch verschachtelte
Gruppen), oder sonst WLED-Lichter, die „emergency“ heißen. Er braucht PadSpan Pro oder das Add-on
Alarm & Sicherheit (ein Bright-Pro-Schlüssel behält ihn); ohne beides gibt es keinen Test, und der
Knopf zeigt nur eine auslösende Alarmanlage.

- **Tipp auf die rote Mitte**: Jedes Notlicht geht an, und es zeigt **Test on — tap to end**.
  Lichter, die schon an waren, bleiben an, wenn er endet.
- **Tipp auf den Ring** für die Liste der Notlichter.
- **Force off** schaltet jedes Notlicht aus, auch die, die vorher an waren; es verlangt ein zweites
  Tippen.
- Solange eine Home-Assistant-Automation mit „emergency“ im Namen läuft (ein echter Notfall),
  schaltet der Test diese Lichter nicht unter ihr aus.
- Um den Knopf auf einem Bildschirm auszublenden, den jeder antippen kann:
  **Einstellungen → Atlas → Atlas — Mapped Light Control → Show the Test emergency lighting button on
  the Atlas**.
- **Deine Alarmanlage** ist im Knopf, wenn Home Assistant eine Alarmzentrale hat: Die Mitte wird
  ihr Schild in ihrer Farbe, und Mitte wie Ring öffnen eine Karte, oben die Alarmanlage (mit PadSpan
  Pro, dem Add-on Alarm & Sicherheit oder Bright Pro scharf und unscharf schalten, immer nach einer Frage und mit dem Code, wenn die
  Alarmanlage einen will), darunter die Notlichter mit **Start test**. Ein Haus mit Alarmanlage und
  ohne Notlichter bekommt den eigenen Knopf der Alarmanlage, einen schlichten Ring. Eine auslösende Alarmanlage
  erscheint dort in jeder Ausgabe. Siehe [Kapitel 13](13-alerts.md#deine-alarmanlage-am-notfallknopf).

## WLED: Advanced und Exact look (Pro oder Bright Pro)

Die Karte eines WLED-Lichts hat **Controls | Advanced**. Advanced ist eine ganze WLED-Werkbank in
Reitern: **Layout**, **Effect**, **Presets & playlists**, **LEDs**, **Sync & team**, **Exact look**,
**Settings**, **Backup** und **Info**.

**Exact look** sorgt dafür, dass ein WLED-Licht jedes Mal gleich aussieht, wenn es angeht:

1. Stell das Licht ein, wie du es magst, und wähl dann auf **Exact look** **Remember this look**
   (oder **Remember team look** für jedes Licht in seinem WLED-Sync-Team).
2. Wähl auf **Sync & team** unter **Who gives this light its instructions**
   **PadSpan (exact look)** statt **WLED sync**. WLEDs eigener Sync wird auf diesem Gerät
   abgeschaltet und wieder eingeschaltet, wenn du zurückwechselst.

Nur ein Administrator kann ändern, wer ein Licht steuert.

## Öffner, Schlösser und Lichter aus Relais (Pro)

Öffner und Schlösser gibt es auch mit dem Add-on Alarm & Sicherheit, ebenso das Anhaken eines Öffners
unter **Geräte → Türöffner**; ein Licht aus Relais bleibt bei Pro.

Ein Garagentor, ein Fensteröffner, ein Türöffner oder ein Licht an einfachen Relais?
**Öffner, Schloss oder Licht aus Relais bauen** (**+ Build an opener, lock, or light from relays**
in der Liste des Atlas-Editors) macht daraus eine richtige Abdeckung, ein Schloss oder ein Licht in
Home Assistant.

- **Öffner**: die Relais für Öffnen und Schließen (zwei verschiedene), die Laufzeit für ganz auf
  oder ganz zu, und ein Stellungssensor, wenn du einen hast (**Sensor umkehren**, wenn er verkehrt
  herum meldet). Ohne Sensor wird die Stellung aus den Befehlen gemerkt.
- **Schloss**: das Relais, der Entriegel-Impuls und die Zeit bis zum automatischen
  Wiederverriegeln, in Sekunden.
- **Licht**: das Relais und sein Impuls.

**Aufbauen** legt das Skript, die Automation und die Entität an; **Entfernen** nimmt sie wieder weg.
