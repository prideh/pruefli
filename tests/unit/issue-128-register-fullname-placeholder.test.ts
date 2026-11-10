import React from 'react';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import RegisterPage from '@/app/register/page';

describe('Issue #128: Registration full-name placeholder matches label', () => {
  it('uses a full-name example ("Anna Meier") instead of salutation + surname ("Frau Meier") on /register', () => {
    const registerFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/register/page.tsx'),
      'utf-8'
    );

    expect(registerFile).toContain('label="Vollständiger Name"');
    expect(registerFile).toContain('placeholder="Anna Meier"');
    expect(registerFile).not.toContain('placeholder="Frau Meier"');

    const html = renderToStaticMarkup(React.createElement(RegisterPage));
    expect(html).toContain('Vollständiger Name');
    expect(html).toContain('placeholder="Anna Meier"');
    expect(html).not.toContain('placeholder="Frau Meier"');
  });
});
