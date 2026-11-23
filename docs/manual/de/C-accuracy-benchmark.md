# Anhang C. Genauigkeits-Benchmark

[Inhalt](README.md)

Wie oft erkennt PadSpan in **deinem** Haus den richtigen Raum, gemessen auf Rundgängen, die es nie
gesehen hat? `tools/benchmark/` beantwortet das anhand eines aufgezeichneten Rundgangs, mit einer
schlichten Antwort „nächster Empfänger“ daneben. Es ist ein Werkzeug für Entwickler und erfahrene
Nutzer: Es wird nicht mit der Integration ausgeliefert und ändert nichts an einer Installation. Für
die alltägliche Bewertung nimm stattdessen **Kalibrierung → Modell**
([Kapitel 11](11-calibration.md#der-reiter-modell)).

## Warum zurückgehalten, und in Gruppen

Die meisten Bewertungen der Raumerkennung testen gegen denselben Rundgang, mit dem gerade kalibriert
wurde. Benachbarte Messwerte teilen die meisten ihrer Funkbedingungen, also wird ein weggelassener
Messwert von seinen Beinahe-Kopien beantwortet, und die Bewertung liegt nahe an perfekt.
Veröffentlichte Arbeiten zeigen, wie groß der Unterschied ist: k-NN hatte bei einer zufälligen
Aufteilung einen Median von 0,0 m und 9,4 m, als ganze Positionen zurückgehalten wurden
(arXiv 2610.22680).

Deshalb teilt der Benchmark Messwerte nie zufällig auf. Ein Messwert wird nur gegen Fingerabdrücke
aus anderen Gruppen getestet:

| `--group-by` | Zusammen zurückgehalten | Wann |
|---|---|---|
| `walk` (Standard bei 2+ Rundgängen) | Ein ganzer Rundgang | Du hast das Haus mehr als einmal aufgezeichnet, am besten an verschiedenen Tagen |
| `visit` (Standard bei 1 Rundgang) | Ein Aufenthalt in einem Raum | Du hast einen Rundgang |
| `position` | Ein Aufenthalt, dazu jeder Messwert innerhalb von 1,5 m seiner markierten Stellen (`--radius`) | Der Rundgang hat x/y-Markierungen |
| `--train-walk NAME` | Alles außer NAME | Ein Kalibrierrundgang und getrennte Testrundgänge |

`--settle 5` lässt die ersten 5 Sekunden jedes Aufenthalts weg (du standest noch in der Tür, als du
den Raum markiert hast).

## Einen Rundgang in PadSpan aufzeichnen

1. Schalte **Einstellungen → Funktionen → RSSI Vector Capture** ein (ab Werk aus).
2. Wähle in **Zustand** unter **RSSI-Aufnahme** **⏺ Aufnehmen**. Zuerst fragt es, wie viele Minuten
   es aufnehmen soll (1 bis 60, 5, wenn du nichts änderst): Gib genug für den ganzen Rundgang, denn
   die Aufnahme hört von selbst auf, wenn die Zeit um ist. Dann gib der Aufnahme einen Namen: Er wird
   der Name des Rundgangs.
3. Trag das Handy oder den Tag bei dir. Jedes Mal, wenn du in einem Raum ankommst, wähle ihn aus und
   wähle **Raum markieren**. Tippst du dazu die x/y der Stelle ein (in Metern, wie die Karte selbst
   sie zählt), bekommst du Fehler in Metern und `--group-by position`.
4. Bleib 1 bis 2 Minuten in jedem Raum und beweg dich dabei. **⏹ Stopp**, dann **.jsonl exportieren**.
5. Wiederhol das an einem anderen Tag für einen zweiten Rundgang.

```
python tools/benchmark/from_capture.py padspan-capture-*.jsonl -o walk.json
```

Nur Messwerte unter einer Markierung bleiben erhalten; die Räume und Positionen der Empfänger, die
Raummitten und was PadSpan damals angezeigt hat, kommen mit. `--device KEY` behält ein Gerät, wenn
mehrere markiert wurden.

Eine Aufnahme enthält die Adressen deiner Empfänger und Geräte und die Namen deiner Räume. Behalte sie
für dich, außer du willst sie bewusst teilen.

## Ein Rundgang aus einem anderen System

Ein Rundgangsprotokoll ist JSON:

```json
{
  "format": "padspan-walk", "version": 1,
  "scanners": {"kitchen_proxy": {"room": "Kitchen", "x": 2.0, "y": 3.5, "floor": "main", "z": 2.1}},
  "rooms":    {"Kitchen": {"floor": "main", "polygon": [[0,0],[4,0],[4,4],[0,4]]}},
  "floors":   {"main": 0.0},
  "polls": [
    {"ts": 1761300000.0, "walk": "sat-am", "device": "phone", "room": "Kitchen",
     "x": 1.2, "y": 2.0, "floor": "main",
     "rssi": {"kitchen_proxy": -61.0, "hall_proxy": -78.5}}
  ]
}
```

Jeder Messwert braucht `room` (den wahren Raum) und `rssi` (dBm für jeden Empfänger, der ihn gehört
hat). Optional: `ts` (nötig für `--settle`), `walk`, `device`, `x`/`y`/`floor` und `live` (was das
getestete System gesagt hat). Der `room` eines Empfängers speist die Vergleichsbasis; seine `x`/`y`
braucht die räumliche Methode. CSV geht auch: `ts,walk,device,room,x,y,floor` plus eine Spalte
`rssi:<scanner>` pro Empfänger, mit den Empfängern in einer zweiten CSV, angegeben mit `--scanners`.

## Ausführen

```
pip install voluptuous
python tools/benchmark/benchmark.py walk.json [more.json ...] [--group-by ...] [--json results.json]
```

Home Assistant muss nicht installiert sein: PadSpans Module werden direkt aus
`custom_components/padspan_ha` geladen. Was bewertet wird, alles mit PadSpans eigenem Code:

- **PadSpan k-NN**: der Kalibrierabgleich über die nicht zurückgehaltenen Messwerte.
- **PadSpan spatial**: die Pfadverlust-Rechnung, wobei die Anpassung jedes Empfängers aus den nicht
  zurückgehaltenen Messwerten neu berechnet wird. Braucht mindestens 3 platzierte Empfänger.
- **Nearest scanner**: der Raum des Empfängers, der das Gerät am lautesten hört.
- **PadSpan live (as recorded)**: nur aus einer Aufnahme. Nicht zurückgehalten, also ist es „was du
  gesehen hast“, keine faire Aufteilung.

**Die Ergebnisse lesen**: **rooms right** ist der Anteil der Messwerte, bei denen der Raum stimmte
(einer, den eine Methode nicht beantworten konnte, zählt als falsch; **answered** zeigt, wie viele sie
beantwortet hat). **median m** und **p75 m** sind Fehler in Metern über die Messwerte mit markierter
x/y. Das JSON fügt Anteile pro Raum hinzu und die häufigsten Fehlzuordnungen (wahrer Raum →
angezeigter Raum), die meist die beiden offen ineinander übergehenden Räume oder die Treppe nennen.

## Jeden Raumsensor von Home Assistant bewerten

```
python tools/benchmark/score_sensor.py walk.json history.json --entity sensor.phone_area [--map "living_room=Living Room"]
```

`history.json` ist der Verlauf von Home Assistant (seine REST-History oder die CSV aus
**Daten herunterladen** im Verlauf). Zu jedem Messwert ist der letzte Zustand des Sensors zu diesem
Moment oder davor seine Antwort; `unknown`, `unavailable` und `not_home` zählen als keine Antwort. Das
funktioniert für Bermuda, PadSpans eigene Sensoren und andere. Zwei Systeme nebeneinander auf
demselben Rundgang laufen zu lassen, ist der faire Vergleich; bitte veröffentliche nur Vergleiche, bei
denen jedes auf seine eigene dokumentierte Weise eingerichtet war.

## Ein öffentlicher Datensatz

Zenodo-Eintrag [4783076](https://zenodo.org/records/4783076) (CC BY 4.0): ein Haus mit 6 festen
Beacons und 10 Räumen, eine Kalibriersitzung (ein Laptop, 600 Fingerabdrücke) und zwei spätere
Testsitzungen (ein Laptop und ein Raspberry Pi, je 1.200).

```
python tools/benchmark/datasets/zenodo_4783076.py DATA_DIR -o house.json
python tools/benchmark/benchmark.py house.json --train-walk calibration-laptop
```

Ergebnis (der Code von PadSpan 0.38.165, 25. Oktober 2026), trainiert nur auf der Kalibriersitzung:

| Methode | Räume richtig | Test-Laptop | Test-Raspberry-Pi |
|---|---|---|---|
| PadSpan k-NN | 84,2 % | 88,4 % | 79,9 % |
| Nächster Beacon | 52,7 % | 53,6 % | 51,8 % |

Was das zeigt und was nicht:

- Die Funkgeräte sind andersherum als in einem PadSpan-Haus (feste Beacons, ein beweglicher
  Empfänger).
- Der Datensatz sagt nicht, wo die Beacons sind, also kann die räumliche Methode nicht laufen.
- Die Zeilen sind gemittelte Fingerabdrücke ohne Zeiten: k-NN ohne PadSpans Glättung über die Zeit,
  auf saubereren Eingaben als ein einzelner Messwert.
- Die Zeile Raspberry Pi ist ein anderer Empfänger als der der Kalibrierung.

## Grenzen, offen gesagt

- Jeder Messwert wird für sich bewertet, ein einzelner Ausreißer zählt also als falscher Raum. Das
  laufende PadSpan glättet Räume über die Zeit: Ein Ausreißer verschiebt kein Gerät, und solange du
  in einem Raum bleibst, liegt es meist öfter richtig, als diese Werte sagen. Es verschiebt ein Gerät
  aber erst, wenn der neue Raum eine Weile vorn bleibt (bis zur **Verzögerung beim Raumwechsel**, 40
  Sekunden, wenn du sie nicht geändert hast). Kurz nachdem du in einen anderen Raum gegangen bist,
  zeigt es also noch den, aus dem du kommst, und liegt öfter falsch, als die Werte sagen. Die Zeile
  `live` aus einer Aufnahme zeigt die geglättete Antwort.
- Ein Rundgang ist eine Person, ein Gerät, ein Nachmittag. Erst mehrere Rundgänge an verschiedenen
  Tagen, mit Türen in verschiedenen Stellungen, geben der Zahl eine Bedeutung.
- Der Raum, den du markierst, ist nur so richtig wie deine Markierung; `--settle` hilft.
- Die Vergleichsbasis ist bewusst einfach. Sie zu schlagen ist eine Untergrenze, keine Angeberei.
