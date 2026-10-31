import { describe, it, expect } from 'vitest';
import { parseRelaySessionResponse, getRelayNetworkErrorMessage } from '@/lib/relay-session';

describe('Mobile Relay Session Response Parsing & Error Handling (lib/relay-session.ts)', () => {
  it('liefert Erfolg und Daten bei erfolgreicher 200 OK Antwort mit JSON', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        teacherName: 'Frau Meier',
        exams: [{ id: 'ex-1', title: 'Mathe Test' }],
        recentUploads: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(true);
    expect(result.data?.teacherName).toBe('Frau Meier');
    expect(result.data?.exams).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it('erkennt JSON-Parse-Fehler bei 200 OK mit ungueltigem JSON Body', async () => {
    const mockResponse = new Response('<html><body>Login Portal</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Serverantwort konnte nicht verarbeitet werden (ungültiges JSON-Format).'
    );
    expect(result.isTokenExpired).toBe(false);
  });

  it('erkennt abgelaufenen oder ungueltigen Token bei 401 mit Standardmeldung', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        error:
          'Dieser QR-Code ist abgelaufen oder ungültig. Bitte generiere auf dem Desktop einen neuen QR-Code.',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.isTokenExpired).toBe(true);
    expect(result.error).toBe(
      'Dieser QR-Code ist abgelaufen oder ungültig. Bitte generiere auf dem Desktop einen neuen QR-Code.'
    );
  });

  it('faellt bei 401 ohne JSON-Body auf den QR-Erneuerungshinweis zurueck', async () => {
    const mockResponse = new Response('Unauthorized', { status: 401 });

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.isTokenExpired).toBe(true);
    expect(result.error).toBe(
      'Dieser QR-Code ist abgelaufen oder ungültig. Bitte generiere auf dem Desktop einen neuen QR-Code.'
    );
  });

  it('meldet HTTP-500-Fehler mit spezifischer JSON-Fehlermeldung vom Server', async () => {
    const mockResponse = new Response(
      JSON.stringify({ error: 'Datenbankverbindung fehlgeschlagen.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.isTokenExpired).toBe(false);
    expect(result.error).toBe('Datenbankverbindung fehlgeschlagen.');
  });

  it('unterscheidet 502/503 Proxy Cold Start HTML-Fehlerseiten von echten Netzwerkfehlern', async () => {
    const mockResponse = new Response(
      '<html><head><title>502 Bad Gateway</title></head><body>Render instance spinning up</body></html>',
      { status: 502, headers: { 'Content-Type': 'text/html' } }
    );

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.isTokenExpired).toBe(false);
    expect(result.error).toBe('Serverfehler (HTTP 502): Antwort ist kein valides JSON.');
  });

  it('meldet HTTP-Fehlerstatus ohne JSON-Body und ohne Text als HTTP-Statusfehler', async () => {
    const mockResponse = new Response('', { status: 503 });

    const result = await parseRelaySessionResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.isTokenExpired).toBe(false);
    expect(result.error).toBe('Serverfehler (HTTP 503).');
  });

  it('liefert die korrekte Netzwerkfehlermeldung fuer Verbindungsabbrueche', () => {
    const msg = getRelayNetworkErrorMessage();
    expect(msg).toBe('Netzwerkfehler: Verbindung zum Server fehlgeschlagen.');
  });
});
