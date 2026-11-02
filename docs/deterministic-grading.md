# Deterministische KI-Korrektur: Qualifizierung und Absicherung

## 1. Ausgangslage & Zielsetzung

Im Korrekturalltag von Schweizer Lehrpersonen ist Verlässlichkeit und Konsistenz von zentraler Bedeutung: Dieselbe Schülerarbeit soll unter identischen Rahmenbedingungen (gleicher Scan, gleiche Prüfungsvorlage, gleiche Musterlösung, gleiches Modell und identische Konfiguration) zu einem konsistenten, nachvollziehbaren Bewertungsergebnis führen.

Dieses Dokument qualifiziert das Verhalten der KI-Korrektur in **prüefli**, dokumentiert die implementierten technischen Schutzmechanismen und definiert klare Toleranzgrenzen.

---

## 2. Technische Determinismus-Architektur

Um die Wiederholbarkeit frischer und gecachter Bewertungen maximal abzusichern, greift eine mehrstufige Architektur:

### 2.1 Content-Hash LLM-Cache mit vollständiger Parameterbindung

- **Zweck:** Identische Prüfungsdokumente und Bewertungsreferenzen werden persistent im Content-Hash-Cache (`lib/llm-cache.ts`) zwischengespeichert.
- **Vollständige Bindung:** Der kanonische SHA-256-Hash bindet sämtliche Eingabedaten sowie alle Ausführungsparameter:
  - Mandantentrennung (`teacherId`)
  - Modellname (`gemini-3.8-flash`)
  - Prompt-Version (`LLM_PROMPT_VERSIONS.grading: 2026-11-02-grading-v6-deterministic-repeatability`)
  - Ausführungskonfiguration (`executionConfig: { thinkingLevel: 'LOW', temperature: 0.0, seed: 42, attempt: 1 }` für Versuch 1 bzw. `{ seed: null, attempt: 2 }` für unseeded Versuch 2)
  - Seiten-Hashes der Schülerarbeit (kryptografischer SHA-256 über Rohdaten)
  - Normalisierte Musterlösung (`rubric`) & Vorlagenprüfung (`examTemplate`)
  - Zusätzliche Lehrkraftnotizen (`gradingNotes`), vordefinierte Aufgaben & Fach
- **Gemeinsame Konfigurationsquelle:** Die API-Aufrufparameter in `lib/gemini.ts` und die Cache-Key-Konfiguration in `lib/llm-cache.ts` teilen sich dieselbe Quelle (`DEFAULT_GRADING_EXECUTION_CONFIG` bzw. `buildGradingGenerationConfig`). Eine Desynchronisation zwischen tatsächlichem Request und Cache-Schlüssel ist dadurch architektonisch ausgeschlossen.
- **Ehrliche Schlüssel- und Cache-Eintragstrennung bei Retries:** Bei transienten Timeouts läuft Versuch 2 unseeded (`seed: null`). Das Ergebnis wird wahrheitsgetreu unter dem unseeded Cache-Key und mit `attempt: 2` / `seed: null` im Cache-Eintrag abgelegt — niemals unter dem Seed-42-Key von Versuch 1.
- **Automatische Invalidierung:** Jede Änderung von Modellparametern (`thinkingLevel`, `seed`, `temperature`) oder Prompt-Versionen ändert den kryptografischen Hash automatisch. Veraltete Cache-Ergebnisse können somit niemals still als aktuelles Modellverhalten missinterpretiert werden.

### 2.2 Deterministische Modell-Konfiguration

- **Temperatur:** `temperature: 0.0` für strikt greedy / deterministisches Sampling.
- **Konsistenter Seed im Initialversuch:** `seed: 42` wird im Initialversuch (Versuch 1) mit `temperature: 0.0` übergeben.
- **Thinking-Level:** `ThinkingLevel.LOW` für präzise mathematische OCR-Analyse und logische Zwischenschritt-Berechnung ohne unkontrollierte Reasoning-Drifts.

### 2.3 Mathematische Post-Processing-Normalisierung

LLMs können in Freitext-Zusammenfassungen minimale Rechen- oder Übertragungsfehler machen. In **prüefli** wird daher eine strikte deterministische Normalisierung erzwungen (`enforceStepFeedbackConsistency` in `lib/gemini.ts` und `auditAndEnforceCorrectionSecurity` in `lib/prompt-injection.ts`):

1. **Aufgabenpunkte:** `erzieltePunkte` jeder Aufgabe wird als exakte mathematische Summe der Teilschritt-Punkte berechnet (`sum(step.erreichtePunkte)`).
2. **Gesamtpunkte:** `gesamterzieltePunkte` wird strikt aus der Summe aller Aufgabenpunkte gebildet.
3. **Notenberechnung:** Die Schweizer Schulnote (`note`) wird nach der offiziellen Formel (`LINEAR_60`, `KNICK_50` oder `KNICK_66`) und der gewählten Rundung (`0.1`, `0.25`, `0.5`) mathematisch neu abgeleitet.
4. **Folgefehler-Konsistenz:** Teilschritte mit Folgefehlern behalten ihre verdienten Teilpunkte, ohne doppelt bestraft zu werden.

---

## 3. Was garantiert ist vs. Was nicht garantiert werden kann

### Garantiert ist:

- **Cache-Treffer (Wiederholter Upload identischer Bytes):** Liefert bit-identische Noten, Punkte und Begründungen.
- **Korrektur ersetzen (Cache-Bypass):** Nutzt identische Modellkonfiguration (`temperature: 0.0`, `seed: 42`, `thinkingLevel: LOW`).
- **Mathematische Konsistenz:** Die Notenskala und Summenregeln weichen niemals durch KI-Rechenfehler ab.
- **Prompt-Injection-Schutz:** Unzulässige Steuerungsanweisungen in Schülerarbeiten oder Referenzmaterialien werden in allen Durchläufen einheitlich ignoriert und für die Lehrperson gemeldet.
- **Schweizer Rechtschreibung:** Sämtliche Benutzeroberflächen-, Fehlermeldungs- und Feedback-Texte nutzen ausnahmslos Schweizer Hochdeutsch (strikt «ss», kein «ß»).

### Nicht garantiert (Systemgrenzen moderner LLMs):

- **Provider-Seed:** Der Gemini-API `seed`-Parameter ist als _best-effort_ spezifiziert. Aufgrund von GPU/TPU-Cluster-Parallelisierung, asynchronen Matrix-Operationen und verteilter Inferenz können minimale Wortlaut-Varianzen im Feedback entstehen.
- **Retry-Pfad bei Timeouts:** Ein Wiederholungsversuch (Versuch 2) nach transienten Netzwerk- oder Upstream-Timeouts läuft gemäss Issue #91 unseeded, um identische Timeouts auf blockierten GPU-Instanzen zu vermeiden. Ein solches Retry-Ergebnis wird transparent als unseeded (`seed: null`, `attempt: 2`) gecacht und niemals fälschlich als Seed-42-Lauf ausgegeben. Spätere Cache-Treffer auf den Standard-Key lesen ausschliesslich verifizierte Seed-42-Ergebnisse aus Versuch 1.
- **Modell-Updates:** Upstream-Aktualisierungen durch den Modell-Provider (Google) können das Generierungsverhalten über längere Zeiträume verändern.

---

## 4. Akzeptable Toleranzgrenzen & Qualitätskriterien

Für frische Korrekturen ohne Cache-Lesung gelten folgende Qualitätsrichtlinien:

| Dimension                  | Erwartetes Verhalten / Toleranz                                      | Absicherung                                                       |
| :------------------------- | :------------------------------------------------------------------- | :---------------------------------------------------------------- |
| **Gesamtnote**             | Exakt identisch bei eindeutiger Handschrift                          | Mathematische Neusynchronisation (`calculateSwissGrade`)          |
| **Gesamtpunkte**           | Identisch (Toleranz: maximal 0.5 Punkte bei schwer lesbaren Ziffern) | Ermessensspielräume werden mit `istUnsicher: true` markiert       |
| **Teilschritte**           | Gleiche Zuordnung zu Rechenfehlern vs. Folgefehlern                  | Explizite Zwischenwert-Nachrechnung im Prompt & Konsistenz-Filter |
| **Handschrift-Unklarheit** | Unleserliche Stellen werden transparent mit `[?]` gekennzeichnet     | Vorläufige Schätzung mit `istUnsicher: true` und Begründung       |
| **Sicherheit**             | 100% konsistente Abwehr von Noten-Overrides                          | Duale Sicherheitsüberprüfung vor und nach dem Modellaufruf        |

---

## 5. Leitfaden für manuelle Verifikationstests

Um frische Bewertungen im QA-Umfeld kontrolliert zu prüfen:

1. **Kein Re-Encoding nötig:** Verwende die Funktion «Korrektur ersetzen» (`app/api/submissions/[id]/replace`) auf einer bestehenden, abgeschlossenen Korrektur. Dieser Pfad umgeht den Lese-Cache und führt einen frischen Modellaufruf durch.
2. **Synthetische Test-Fixtures:** Führe Tests ausschliesslich auf synthetischen QA-Prüfungen durch (z. B. 2+2 / 5x3 / 8-5 mit 10 Maximalpunkten).
3. **Vergleichskriterien:** Vergleiche Gesamtpunkte, Teilschritt-Status (`Korrekt`, `Folgefehler`, `Fehler`) und Unsicherheitsmarkierungen (`istUnsicher`).
