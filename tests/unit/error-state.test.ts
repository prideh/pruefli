import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorState from '@/components/ErrorState';

describe('ErrorState Component (components/ErrorState.tsx)', () => {
  it('rendert den Standardtitel und die uebergebene Fehlermeldung', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        message: 'Fehler beim Laden der Pruefungen.',
      })
    );

    expect(html).toContain('Fehler beim Laden');
    expect(html).toContain('Fehler beim Laden der Pruefungen.');
  });

  it('rendert einen benutzerdefinierten Titel', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        title: 'Netzwerkfehler',
        message: 'Verbindung fehlgeschlagen.',
      })
    );

    expect(html).toContain('Netzwerkfehler');
    expect(html).toContain('Verbindung fehlgeschlagen.');
  });

  it('rendert den Wiederholen-Button mit Standardbeschriftung wenn onRetry vorhanden ist', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        message: 'Fehler beim Laden.',
        onRetry: () => {},
      })
    );

    expect(html).toContain('Erneut versuchen');
    expect(html).toContain('button');
  });

  it('rendert eine benutzerdefinierte Button-Beschriftung', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        message: 'Fehler beim Laden.',
        onRetry: () => {},
        retryLabel: 'Nochmals laden',
      })
    );

    expect(html).toContain('Nochmals laden');
  });

  it('rendert keinen Button wenn onRetry nicht uebergeben wurde', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        message: 'Kritischer Fehler ohne Wiederholung.',
      })
    );

    expect(html).not.toContain('button');
    expect(html).not.toContain('Erneut versuchen');
  });

  it('enthaelt gemaess Schweizer Rechtschreibung kein Eszett (ß)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        title: 'Fehler beim Laden der Schliessen-Funktion',
        message: 'Aktion konnte nicht ausgefuehrt werden.',
        onRetry: () => {},
      })
    );

    expect(html).not.toContain('ß');
  });

  it('ersetzt redundanten Fliesstext (identisch zum Titel) durch einen hilfreichen Handlungshinweis (#119)', () => {
    const htmlExams = renderToStaticMarkup(
      React.createElement(ErrorState, {
        title: 'Fehler beim Laden der Prüfungen',
        message: 'Fehler beim Laden der Prüfungen.',
        onRetry: () => {},
      })
    );
    expect(htmlExams).toContain('Fehler beim Laden der Prüfungen');
    expect(htmlExams).not.toContain('Fehler beim Laden der Prüfungen.');
    expect(htmlExams).toContain('Bitte Verbindung prüfen und erneut versuchen.');

    const htmlSubmissions = renderToStaticMarkup(
      React.createElement(ErrorState, {
        title: 'Fehler beim Laden der Korrekturen',
        message: 'Fehler beim Laden der Korrekturen.',
        onRetry: () => {},
      })
    );
    expect(htmlSubmissions).toContain('Fehler beim Laden der Korrekturen');
    expect(htmlSubmissions).not.toContain('Fehler beim Laden der Korrekturen.');
    expect(htmlSubmissions).toContain('Bitte Verbindung prüfen und erneut versuchen.');
  });
});
