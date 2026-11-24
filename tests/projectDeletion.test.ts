import { describe, expect, test } from 'bun:test';
import { requireDeletedProject } from '../src/lib/projectDeletion';

describe('confirmed project deletion', () => {
  test('zero deleted records must not report success', () => {
    expect(() => requireDeletedProject('qa-gaps', [])).toThrow('No project was deleted');
  });
  test('a different returned project cannot confirm the requested deletion', () => {
    expect(() => requireDeletedProject('qa-gaps', [{ id: 'independent-retest' }])).toThrow();
  });
  test('exactly the requested deleted record confirms success', () => {
    expect(() => requireDeletedProject('qa-gaps', [{ id: 'qa-gaps' }])).not.toThrow();
  });
});