# 27. Hilfe bekommen

[Inhalt](README.md)

Bevor du fragst: [Kapitel 26](26-troubleshooting.md) hat die häufigen Probleme nach Symptom. Wenn du
fragst, spart ein Bericht aus PadSpan eine Runde Rückfragen. Es gibt drei, und sie enthalten
Verschiedenes.

## Die drei Berichte

| Bericht | Wo | Enthält |
|---|---|---|
| **Diagnose** (von PadSpan) | QA → **Go to Diagnostics** (QA steht unter Weitere Werkzeuge) | Versionen, die Zeitmessungen des Panels, PadSpans Status, die Namen deiner Grundrisse und **deine eigenen Geräte**: die, die du benannt hast, die mit Home Assistant verknüpften und Handys, die PadSpan an ihrem Schlüssel kennt, gehört in den letzten 24 Stunden. **Bericht herunterladen** speichert ihn als Datei; **Kopieren** kopiert ihn. |
| **Export for support** | Monitor → **Export for support** (Monitor steht unter Weitere Werkzeuge) | Dasselbe, dazu die Live-Ansicht, wie PadSpan sie gerade sieht: Geräte und Advertisements, gekürzt auf je 200 (alle deine eigenen Geräte bleiben drin), und die Empfänger. **Build export**, dann **Copy**. |
| **Diagnosedaten herunterladen** (von Home Assistant) | Einstellungen → Geräte & Dienste → PadSpan HA → ⋮ → **Diagnosedaten herunterladen** | Wenig: PadSpans Version, sein Konfigurationseintrag, sein Status und die gespeicherte Raumliste (`room_tag_map`). Nicht deine Geräte, Räume oder Empfänger. |

Für die meisten Probleme ist PadSpans **Diagnose** der Bericht, den du schickst. Für ein Gerät im
falschen Raum oder eines, das gar nicht auftaucht, zeigt **Export for support**, was die Empfänger
hören.

### Was sie weglassen und was nicht

- **Die Identitätsschlüssel (IRKs) von Handys sind nie darin.** Jeder wird durch `irk:hidden-1`,
  `irk:hidden-2` und so weiter ersetzt, für dasselbe Handy durchgehend dieselbe Nummer, damit der
  Bericht trotzdem verständlich bleibt.
- **Sie nennen deine Räume, Grundrisse und Geräte, mit ihren Bluetooth-Adressen.** Das macht sie
  nützlich, und deshalb solltest du einen Bericht durchsehen, bevor du ihn irgendwohin öffentlich
  schickst.
- **Fehler, die PadSpan still abgefangen hat** (auf dem Bildschirm Diagnose, für Administratoren),
  sind nicht im Bericht: Der Text eines Fehlers kann deine Räume und Geräte nennen. Fragt der
  Support danach, kopier die Zeilen, die du teilen magst.
- **Keiner von ihnen schickt etwas.** Sie erzeugen nur Text, den du kopierst oder speicherst.

### Logs

PadSpans eigenes Log steht unter **Verwalten → Logs**. Für das Log von Home Assistant mit mehr
Einzelheiten von PadSpan schalte auf der Seite von PadSpan HA unter Einstellungen → Geräte & Dienste
**Debug-Protokollierung aktivieren** ein, lös das Problem noch einmal aus und schalte es dann wieder
aus: Home Assistant bietet dir dabei das Log als Datei an.

## Wo du fragst

- **Ein Fehler**: Eröffne ein Issue auf
  [github.com/gbroeckling/padspanHA/issues](https://github.com/gbroeckling/padspanHA/issues) und
  wähl **Bug Report**. Issues sind öffentlich, also entferne aus allem, was du anhängst, was du
  lieber nicht zeigst (Namen, Adressen).
- **Per E-Mail**: hello@traks.ca. Eine E-Mail ist nicht öffentlich, ein Bericht kann also so mit,
  wie er ist.
- **Ein Sicherheitsproblem**: nicht in einem öffentlichen Issue. Siehe [SECURITY.md](../../../SECURITY.md).
- **Eine Idee**: das Formular **Feature request** in derselben Issue-Liste.

## Was dazugehört

1. **PadSpans Version und die von Home Assistant.** PadSpans steht unter seinem Namen oben im Menü
   des Panels und in jedem Bericht. Die von Home Assistant steht unter Einstellungen → Info.
2. **Wie PadSpan installiert wurde**: über den Marketplace, HACS oder von Hand.
3. **Deine Empfänger**: welche Art (ESPHome-Bluetooth-Proxy, Shelly, das eigene Bluetooth von Home
   Assistant, ESPresense, Tasmota) und wie viele.
4. **Was passiert ist und was du erwartet hast.** Bei einem Raumproblem: welches Gerät, welchen Raum
   es gezeigt hat und in welchem Raum es wirklich war, mit der Uhrzeit.
5. **Die Schritte**, mit denen es wieder passiert, wenn du sie kennst.
6. **Ein Bericht** (oben) und ein Screenshot des betreffenden Bildschirms.
7. **Alles, was sich kurz vorher geändert hat**: ein Update, ein neuer Empfänger, ein versetzter
   Empfänger, eine neue Kalibrierung.

Ein Bericht über einen falschen Raum ist am nützlichsten, solange der Raum noch falsch ist: Erstell
**Export for support** genau dann, bevor das Gerät weiterzieht.
