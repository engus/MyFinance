import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
  it('links to the Cashflow page', () => {
    render(
      <MemoryRouter>
        <DashboardPage user={{ id: '1', email: 'a@b.com' }} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /cashflow/i })).toHaveAttribute('href', '/cashflow');
  });
});
