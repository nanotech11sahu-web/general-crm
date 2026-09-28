import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Inbox } from 'lucide-react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title, description, and triggers action', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={Inbox}
        title="No contacts found"
        description="Create your first contact to get started"
        actionLabel="Create contact"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('No contacts found')).toBeInTheDocument();
    expect(screen.getByText('Create your first contact to get started')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create contact' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action button when none is provided', () => {
    render(<EmptyState icon={Inbox} title="Nothing here" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
