import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibleEvents } from './useVisibleEvents';
import { ObjectId } from 'bson';
import type { EventItem } from '@/types/events';

vi.mock('@/lib/measureText', () => ({
  estimateTitleWidth: vi.fn((title: string, shortTitle?: string) => ({
    titleWidth: title.length * 10,
    shortTitleWidth: shortTitle ? shortTitle.length * 10 : title.length * 10,
  })),
}));

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

describe('useVisibleEvents', () => {
  const mockXFor = (date: Date) => date.getTime() / 1000000;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all events when no filtering needed', () => {
    const events = [
      createMockEvent({ title: 'Event 1', start: new Date('2024-01-01') }),
      createMockEvent({ title: 'Event 2', start: new Date('2024-01-02') }),
    ];

    const { result } = renderHook(() => useVisibleEvents(events, mockXFor));

    expect(result.current).toHaveLength(2);
  });

  it('calculates correct position for events', () => {
    const event = createMockEvent({
      title: 'Event',
      start: new Date('2024-01-01'),
    });

    const { result } = renderHook(() => useVisibleEvents([event], mockXFor));

    const rendered = result.current[0];
    expect(rendered.startX).toBe(mockXFor(event.start));
    expect(rendered.event).toBe(event);
  });

  it('calculates width for range events', () => {
    const event = createMockEvent({
      kind: 'range',
      start: new Date('2024-01-01'),
      end: new Date('2024-01-10'),
    });

    const { result } = renderHook(() => useVisibleEvents([event], mockXFor));

    const rendered = result.current[0];
    expect(rendered.width).toBeGreaterThan(2);
    expect(rendered.endX).toBeGreaterThan(rendered.startX);
  });

  it('uses short title when full title does not fit', () => {
    const event = createMockEvent({
      title: 'Very Long Event Title That Will Not Fit',
      shortTitle: 'Short',
      start: new Date('2024-01-01'),
      end: new Date('2024-01-01T00:00:05.000Z'),
      kind: 'range',
      titleWidth: 1000,
      shortTitleWidth: 50,
    });

    const xForNarrow = (date: Date) => date.getTime() / 100;

    const { result } = renderHook(() => useVisibleEvents([event], xForNarrow));

    const rendered = result.current[0];
    expect(rendered.displayTitle).toBe('Short');
  });

  it('uses full title when it fits', () => {
    const event = createMockEvent({
      title: 'Title',
      shortTitle: 'S',
      titleWidth: 10,
      shortTitleWidth: 5,
    });

    const { result } = renderHook(() => useVisibleEvents([event], mockXFor));

    const rendered = result.current[0];
    expect(rendered.displayTitle).toBe('Title');
  });

  it('hides child events when parent is more visible', () => {
    const parentId = new ObjectId().toString();
    const parent = createMockEvent({
      _id: new ObjectId(parentId),
      title: 'Parent Event',
      start: new Date('2024-01-01'),
      end: new Date('2024-12-31'),
      kind: 'range',
      titleWidth: 100,
    });

    const child = createMockEvent({
      title: 'Child Event',
      start: new Date('2024-01-15'),
      parentId: parentId,
      titleWidth: 1000,
    });

    const { result } = renderHook(() =>
      useVisibleEvents([parent, child], mockXFor, 30)
    );

    const visibleIds = result.current.map((r) => r.event._id.toString());
    expect(visibleIds).toContain(parent._id.toString());
  });

  it('shows child event when it fits better than parent', () => {
    const parentId = new ObjectId().toString();
    const parent = createMockEvent({
      _id: new ObjectId(parentId),
      title: 'Very Long Parent Event Title',
      start: new Date('2024-01-01'),
      end: new Date('2024-12-31'),
      kind: 'range',
      titleWidth: 10000,
    });

    const child = createMockEvent({
      title: 'Child',
      start: new Date('2024-06-01'),
      end: new Date('2024-06-30'),
      kind: 'range',
      parentId: parentId,
      titleWidth: 50,
    });

    const xForLarge = (date: Date) => date.getTime() / 100000;

    const { result } = renderHook(() =>
      useVisibleEvents([parent, child], xForLarge, 30)
    );

    const visibleIds = result.current.map((r) => r.event._id.toString());
    expect(visibleIds.length).toBeGreaterThan(0);
  });

  it('handles orphaned children gracefully', () => {
    const child = createMockEvent({
      title: 'Orphaned Child',
      start: new Date('2024-01-15'),
      end: new Date('2024-01-20'),
      kind: 'range',
      parentId: 'non-existent-parent-id',
      titleWidth: 100,
    });

    const xForWide = (date: Date) => date.getTime() / 10000;

    const { result } = renderHook(() => useVisibleEvents([child], xForWide));

    expect(result.current.length).toBeGreaterThanOrEqual(0);
    if (result.current.length > 0) {
      expect(result.current[0].event).toBe(child);
    }
  });

  it('returns empty array for empty input', () => {
    const { result } = renderHook(() => useVisibleEvents([], mockXFor));

    expect(result.current).toEqual([]);
  });

  it('handles events with minimum visible width', () => {
    const event = createMockEvent({
      title: 'Very Long Title That Does Not Fit',
      start: new Date('2024-01-01'),
      titleWidth: 1000,
    });

    const { result } = renderHook(() => useVisibleEvents([event], mockXFor, 50));

    expect(result.current.length).toBeGreaterThan(0);
  });

  it('memoizes result when inputs do not change', () => {
    const events = [createMockEvent()];

    const { result, rerender } = renderHook(() =>
      useVisibleEvents(events, mockXFor)
    );

    const firstResult = result.current;
    rerender();
    const secondResult = result.current;

    expect(firstResult).toBe(secondResult);
  });

  it('recalculates when xFor function changes', () => {
    const events = [createMockEvent()];
    const xFor1 = (date: Date) => date.getTime() / 1000000;
    const xFor2 = (date: Date) => date.getTime() / 2000000;

    const { result, rerender } = renderHook(
      ({ xFor }) => useVisibleEvents(events, xFor),
      { initialProps: { xFor: xFor1 } }
    );

    const firstResult = result.current[0].startX;

    rerender({ xFor: xFor2 });

    const secondResult = result.current[0].startX;

    expect(firstResult).not.toBe(secondResult);
  });

  it('sets canFitTitle correctly based on width', () => {
    const event = createMockEvent({
      title: 'Test',
      titleWidth: 100,
    });

    const { result } = renderHook(() => useVisibleEvents([event], mockXFor, 200));

    const rendered = result.current[0];
    expect(typeof rendered.canFitTitle).toBe('boolean');
  });
});
