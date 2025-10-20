import { describe, it, expect, beforeEach, vi } from 'vitest';
import { measureTextWidth, estimateTitleWidth } from './measureText';

describe('measureTextWidth', () => {
  beforeEach(() => {
    const mockCanvas = {
      getContext: vi.fn(() => ({
        font: '',
        measureText: vi.fn((text: string) => ({
          width: text.length * 10,
        })),
      })),
    };
    document.createElement = vi.fn(() => mockCanvas as any);
  });

  it('measures text width using canvas', () => {
    const width = measureTextWidth('Hello');
    expect(width).toBeGreaterThan(0);
  });

  it('uses default font when not specified', () => {
    const width = measureTextWidth('Test');
    expect(typeof width).toBe('number');
  });

  it('accepts custom font parameter', () => {
    const width = measureTextWidth('Test', '14px Arial');
    expect(typeof width).toBe('number');
  });

  it('handles empty string', () => {
    const width = measureTextWidth('');
    expect(width).toBe(0);
  });

  it('handles long text', () => {
    const shortWidth = measureTextWidth('Short');
    const longWidth = measureTextWidth('This is a much longer text string');
    expect(longWidth).toBeGreaterThan(shortWidth);
  });
});

describe('estimateTitleWidth', () => {
  beforeEach(() => {
    const mockCanvas = {
      getContext: vi.fn(() => ({
        font: '',
        measureText: vi.fn((text: string) => ({
          width: text.length * 10,
        })),
      })),
    };
    document.createElement = vi.fn(() => mockCanvas as any);
  });

  it('estimates width for title only', () => {
    const result = estimateTitleWidth('My Title');
    expect(result).toHaveProperty('titleWidth');
    expect(result).toHaveProperty('shortTitleWidth');
    expect(result.titleWidth).toBeGreaterThan(0);
    expect(result.shortTitleWidth).toBe(result.titleWidth);
  });

  it('estimates width for title and short title', () => {
    const result = estimateTitleWidth('My Long Title', 'Short');
    expect(result.titleWidth).toBeGreaterThan(result.shortTitleWidth);
  });

  it('handles empty title', () => {
    const result = estimateTitleWidth('');
    expect(result.titleWidth).toBe(0);
    expect(result.shortTitleWidth).toBe(0);
  });

  it('uses title width when shortTitle is empty string', () => {
    const result = estimateTitleWidth('Title', '');
    expect(result.shortTitleWidth).toBeGreaterThan(0);
  });

  it('handles undefined shortTitle', () => {
    const result = estimateTitleWidth('Title', undefined);
    expect(result.shortTitleWidth).toBe(result.titleWidth);
  });
});
