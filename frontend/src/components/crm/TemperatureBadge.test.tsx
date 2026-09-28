import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TemperatureBadge } from './TemperatureBadge';

describe('TemperatureBadge', () => {
  it.each([['Hot'], ['Warm'], ['Cold']] as const)('renders the %s label', (temp) => {
    render(<TemperatureBadge temperature={temp} />);
    expect(screen.getByText(temp)).toBeInTheDocument();
  });
});
