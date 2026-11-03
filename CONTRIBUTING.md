# Contributing & Definition of Done (DoD)

Dieses Dokument definiert die verbindlichen Qualitäts-, Sicherheits- und Nachweispflichten für Änderungen an **prüefli**. Ein grüner Erfolgs-Testlauf („Happy Path ist grün“) reicht allein **nicht** als Nachweis für korrektes produktives Verhalten aus.

---

## Verbindliche Definition of Done für Auth- und Mandanten-Änderungen

Für jede Änderung an Authentifizierung, Session-Verwaltung, Edge-Routing (`proxy.ts`), Datenbankabfragen, Caching oder API-Endpunkten gehören folgende fünf Nachweise zwingend zur Fertigstellung:

### 1. Anonyme Matrix (Fail-Closed ohne Credentials)

- Jeder geschützte API- und Datei-Endpunkt wird **ohne Credentials** getestet – sowohl über den Edge-Proxy (`proxy.ts`) als auch direkt gegen den jeweiligen Route-Handler (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- Auch wenn im selben Server- oder Testprozess zuvor eine gültige Session erzeugt wurde, muss eine nachfolgende anonyme Anfrage strikt anonym bleiben.
- **Erwartung:** Ausschliesslich HTTP `401` (bzw. `403`), **niemals** HTTP `200` mit leeren Listen oder Daten.

### 2. Zwei-Konten-Isolation (Mandantentrennung Konto A vs. Konto B)

- **Konto A** darf Daten von **Konto B** weder lesen noch verändern.
- Dies wird systematisch über **Listen-, Detail- und Schreib-Endpunkte** sämtlicher Kernressourcen geprüft:
  - **Klassen** (`/api/classes`, `/api/classes/[id]`, `/api/classes/[id]/exams`, `/api/classes/[id]/students`)
  - **Prüfungen** (`/api/exams`, `/api/exams/[id]`, `/api/exams/[id]/approve`, `/api/exams/[id]/duplicate`, `/api/exams/[id]/feedback-sheets`, `/api/exams/[id]/regenerate-task`, `/api/exams/[id]/task-analysis`, `/api/exams/generate`)
  - **Schüler/innen** (`/api/classes/[id]/students`, `/api/students/[id]`)
  - **Einsendungen & Korrekturen** (`/api/submissions`, `/api/submissions/[id]`, `/api/submissions/[id]/add-task`, `/api/submissions/[id]/replace`, `/api/correct`)
  - **Scans, Fächer & Protokolle** (`/uploads/[...file]`, `/api/subjects`, `/api/logs`, `/api/mobile-relay`, `/api/mobile-relay/upload`)
- Cross-Tenant-Referenzen in Schreiboperationen (z. B. eigene Prüfung in fremde `targetClassId` duplizieren, eigenen Schüler in fremde `classId` verschieben oder eigene Einsendung einer fremden `examId`/`studentId` zuordnen) müssen strikt mit `400`/`403`/`404` abgewiesen werden, ohne fremde Datensätze zu verändern.

### 3. Negativtests je Auth-Pfad

Für jeden bestehenden oder neuen Authentifizierungs- und Token-Pfad werden neben dem Erfolgsfall explizit folgende Ablehnungsfälle getestet:

- **Abgelaufene Credentials** (`exp` überschritten, Inaktivitätslimit oder absolutes 7-Tage-Maximum erreicht) -> `401`
- **Widerrufene Credentials** (serverseitiger Widerruf via Logout `revokeSessionById` oder Passwort-Reset `revokeAllTeacherSessions`) -> `401`
- **Überholte Token-Versionen** (Replay eines alten Tokens nach Sliding Renewal / `tokenVersion`-Rotation) -> `401`
- **Manipulierte & fremdsignierte Tokens** (ungültige Signatur, fremdes Secret, nicht existentes Benutzerkonto) -> `401`
- **Zweckfremde Tokens (Purpose Confusion)** (Mobile-Relay-, E-Mail-Verifizierungs-, Passwort-Reset- oder OAuth-State-/Link-Tokens dürfen niemals als Session-Token akzeptiert werden und umgekehrt) -> `401`

### 4. Production-Modus-Lauf (`NODE_ENV=production`)

- Auth- und mandantenrelevante Suites (`tests/unit/auth-isolation-matrix.test.ts`, `tests/unit/session-cookie-fallback.test.ts`, `tests/unit/oauth-callback.test.ts` sowie die Smoke- und E2E-Suites gegen den gebauten Production-Server) laufen in der CI zusätzlich unter `NODE_ENV=production`.
- Dadurch ist sichergestellt, dass Test-only-Hilfsmechanismen (wie das In-Memory-Fallback-Cookie-Jar für direkte Funktionsaufrufe ohne HTTP-Request) niemals unbemerkt produktives Verhalten verfälschen.

### 5. Live-Verifikation nach Deploy

- **„CI ist grün“ allein gilt nicht als Fertigstellungsnachweis.**
- Nach jedem produktiven Deploy müssen gegen die Live-Instanz mindestens verifiziert werden:
  1. **Anonyme Prüfung:** Abruf geschützter Endpunkte (z. B. `/api/exams`, `/api/classes`, `/api/submissions`, `/api/subjects`, `/api/auth/me`) ohne Session-Cookie liefert strikt HTTP `401` und keinerlei Nutzdaten.
  2. **Zweit-Konto-Prüfung:** Ein zweites Konto sieht in allen Listen- und Detailansichten ausschliesslich eigene Ressourcen und kann keine IDs des ersten Kontos abrufen oder mutieren.

---

## Checkliste für Issues & Pull Requests (DoD-Nachweis)

Vor dem Abschliessen eines Issues oder Mergen eines Pull Requests ist diese Checkliste vollständig zu prüfen:

- [ ] **Anonyme Matrix:** Alle betroffenen/geschützten Endpunkte liefern ohne Credentials `401`/`403` und keine Daten.
- [ ] **Zwei-Konten-Isolation:** Listen-, Detail- und Schreibzugriffe zwischen Konto A und Konto B sind isoliert getestet (Prüfungen, Klassen, Schüler, Einsendungen, Korrekturen).
- [ ] **Negativtests:** Abgelaufene, widerrufene, manipulierte und zweckfremde Credentials werden abgelehnt.
- [ ] **Production-Modus (`NODE_ENV=production`):** Auth-relevante Tests laufen unter `NODE_ENV=production` grün.
- [ ] **Schweizer Rechtschreibung:** Kein Eszett (`ss` statt Eszett) in Code, UI-Texten, Kommentaren und Tests.
- [ ] **Live-Verifikation nach Deploy:** Anonyme Prüfung und Zweit-Konto-Prüfung gegen die produktive Instanz dokumentiert.
