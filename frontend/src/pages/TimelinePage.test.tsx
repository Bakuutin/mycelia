import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as userEventLib from '@testing-library/user-event';

const userEvent = (userEventLib as any).default || userEventLib;
import { MemoryRouter } from 'react-router-dom';
import { ObjectId } from 'bson';
import TimelinePage from './TimelinePage';
import * as api from '@/lib/api';
import type { EventItem } from '@/types/events';

vi.mock('@/lib/api', () => ({
  callResource: vi.fn(),
}));

vi.mock('@/components/timeline/TimelineChart', () => ({
  TimelineChart: () => <div>Timeline Chart Mock</div>,
}));

const mockCallResource = vi.mocked(api.callResource);

const createMockEvent = (overrides?: Partial<EventItem>): EventItem => ({
  _id: new ObjectId(),
  kind: 'point',
  title: 'Test Event',
  icon: { text: '📅' },
  color: '#3b82f6',
  category: 'life',
  start: new Date('2024-01-01'),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const renderTimelinePage = () => {
  return render(
    <MemoryRouter>
      <TimelinePage />
    </MemoryRouter>
  );
};

describe('TimelinePage Multi-Select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Event Selection', () => {
    it('renders events with checkboxes', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('allows selecting individual events', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      const eventCheckbox = checkboxes[1];

      const user = userEvent.setup();
      await user.click(eventCheckbox);

      await waitFor(() => {
        expect(screen.getByText(/1 event selected/)).toBeInTheDocument();
      });
    });

    it('shows selection count when events are selected', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
        createMockEvent({ title: 'Event 3' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      const user = userEvent.setup();

      await user.click(checkboxes[1]);
      await user.click(checkboxes[2]);

      await waitFor(() => {
        expect(screen.getByText(/2 events selected/)).toBeInTheDocument();
      });
    });

    it('allows selecting all events', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const selectAllCheckbox = screen.getAllByRole('checkbox')[0];
      const user = userEvent.setup();
      await user.click(selectAllCheckbox);

      await waitFor(() => {
        expect(screen.getByText(/2 events selected/)).toBeInTheDocument();
      });
    });

    it('allows deselecting all events', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const selectAllCheckbox = screen.getAllByRole('checkbox')[0];

      await user.click(selectAllCheckbox);

      await waitFor(() => {
        expect(screen.getByText(/2 events selected/)).toBeInTheDocument();
      });

      await user.click(selectAllCheckbox);

      await waitFor(() => {
        expect(screen.queryByText(/events selected/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Bulk Parent Assignment', () => {
    it('shows parent selection UI when events are selected', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[1]);

      await waitFor(() => {
        expect(screen.getByText('Set parent:')).toBeInTheDocument();
        expect(screen.getByText('Apply')).toBeInTheDocument();
      });
    });

    it('excludes selected events from parent options', async () => {
      const event1 = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        title: 'Selected Event'
      });
      const event2 = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439012'),
        title: 'Available Parent'
      });

      mockCallResource.mockResolvedValue([event1, event2]);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Selected Event')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[1]);

      await waitFor(() => {
        expect(screen.getByText('Set parent:')).toBeInTheDocument();
      });

      expect(screen.getByText('Available Parent')).toBeInTheDocument();
      expect(screen.getByText('Selected Event')).toBeInTheDocument();
    });

    it('applies parent to all selected events', async () => {
      const parent = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439010'),
        title: 'Parent Event'
      });
      const child1 = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        title: 'Child 1'
      });
      const child2 = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439012'),
        title: 'Child 2'
      });

      let updateCalls = 0;
      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === 'find') {
          return Promise.resolve([parent, child1, child2]);
        }
        if (params.action === 'updateOne') {
          updateCalls++;
          return Promise.resolve({ modifiedCount: 1 });
        }
        return Promise.resolve(null);
      });

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Child 1')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const checkboxes = screen.getAllByRole('checkbox');

      await user.click(checkboxes[2]);
      await user.click(checkboxes[3]);

      await waitFor(() => {
        expect(screen.getByText(/2 events selected/)).toBeInTheDocument();
      });

      const comboboxes = screen.getAllByRole('combobox');
      const parentCombobox = comboboxes.find(cb =>
        cb.getAttribute('role') === 'combobox'
      );

      if (parentCombobox) {
        await user.click(parentCombobox);

        await waitFor(() => {
          const parentOptions = screen.getAllByText('Parent Event');
          expect(parentOptions.length).toBeGreaterThan(0);
        });

        const parentOptions = screen.getAllByText('Parent Event');
        const optionInDropdown = parentOptions.find(el =>
          el.closest('[role="option"]')
        );
        if (optionInDropdown) {
          await user.click(optionInDropdown);
        }
      }

      await waitFor(() => {
        const applyButton = screen.getByText('Apply');
        expect(applyButton).toBeInTheDocument();
      });

      const applyButton = screen.getByText('Apply');
      await user.click(applyButton);

      await waitFor(() => {
        expect(updateCalls).toBe(2);
      }, { timeout: 3000 });
    });

    it('clears selection after applying parent', async () => {
      const events = [
        createMockEvent({ title: 'Parent' }),
        createMockEvent({ title: 'Child' }),
      ];

      mockCallResource.mockImplementation((resource, params: any) => {
        if (params.action === 'find') {
          return Promise.resolve(events);
        }
        if (params.action === 'updateOne') {
          return Promise.resolve({ modifiedCount: 1 });
        }
        return Promise.resolve(null);
      });

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Child')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[2]);

      await waitFor(() => {
        expect(screen.getByText(/1 event selected/)).toBeInTheDocument();
      });

      const applyButton = screen.getByText('Apply');
      await user.click(applyButton);

      await waitFor(() => {
        expect(screen.queryByText(/event selected/)).not.toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('shows clear button when events are selected', async () => {
      const events = [
        createMockEvent({ title: 'Event 1' }),
        createMockEvent({ title: 'Event 2' }),
      ];

      mockCallResource.mockResolvedValue(events);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Event 1')).toBeInTheDocument();
      });

      const user = userEvent.setup();
      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[1]);

      await waitFor(() => {
        expect(screen.getByText('Clear')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Clear'));

      await waitFor(() => {
        expect(screen.queryByText(/event selected/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Parent Event Display', () => {
    it('shows parent event name for child events', async () => {
      const parent = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439010'),
        title: 'Parent Event'
      });
      const child = createMockEvent({
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        title: 'Child Event',
        parentId: parent._id.toString(),
      });

      mockCallResource.mockResolvedValue([parent, child]);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Child Event')).toBeInTheDocument();
      });

      expect(screen.getByText('Parent: Parent Event')).toBeInTheDocument();
    });

    it('does not show parent for top-level events', async () => {
      const event = createMockEvent({ title: 'Top Level Event' });

      mockCallResource.mockResolvedValue([event]);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('Top Level Event')).toBeInTheDocument();
      });

      expect(screen.queryByText(/Parent:/)).not.toBeInTheDocument();
    });
  });

  describe('Loading and Error States', () => {
    it('shows loading state', async () => {
      mockCallResource.mockImplementation(() => new Promise(() => {}));

      renderTimelinePage();

      expect(screen.getByText('Loading events...')).toBeInTheDocument();
    });

    it('shows error state', async () => {
      mockCallResource.mockRejectedValue(new Error('Network error'));

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      });
    });

    it('shows empty state', async () => {
      mockCallResource.mockResolvedValue([]);

      renderTimelinePage();

      await waitFor(() => {
        expect(screen.getByText('No events found')).toBeInTheDocument();
      });
    });
  });
});
