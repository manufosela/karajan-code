// KJC-TSK-1600 (the maintainer, 2026-11-13): the labels over the robots covered the workshops'
// names and the robots themselves. By default only a host carries a short one, its owner; the robot
// pointed at shows its full label; and two that would overlap keep the more important one.
import { describe, expect, it } from 'vitest';

import { declutter, pickNear, tagText } from '../public/stage/robot-labels.js';

const own = { login: 'manufosela' };
const host = { agent: 'claude', role: 'host', name: 'kj-stage', tool: 'Bash' };
const coder = { agent: 'codex', role: 'coder' };

describe('tagText', () => {
  it('a host says only its owner, the agent when it has none', () => {
    expect(tagText(host, { own })).toBe('manufosela');
    expect(tagText({ ...host, owner: 'jorge' }, { own })).toBe('jorge');
    expect(tagText(host, { own: null })).toBe('claude');
  });

  it('any other robot says nothing until it is pointed at', () => {
    expect(tagText(coder, { own })).toBeNull();
  });

  it('the robot pointed at says everything', () => {
    expect(tagText(host, { own, pointed: true })).toBe('manufosela · kj-stage · Bash');
    expect(tagText(coder, { own, pointed: true })).toBe('codex');
  });
});

describe('pickNear', () => {
  const robots = [{ key: 'a', left: 100, top: 100 }, { key: 'b', left: 130, top: 100 }, { key: 'c', left: 400, top: 300 }];

  it('the robot nearest the pointer on screen, within reach', () => {
    expect(pickNear({ left: 125, top: 105 }, robots)).toBe('b');
    expect(pickNear({ left: 395, top: 290 }, robots)).toBe('c');
  });

  it('none when the pointer is away from every robot, or gone', () => {
    expect(pickNear({ left: 250, top: 200 }, robots)).toBeNull();
    expect(pickNear(null, robots)).toBeNull();
  });
});

describe('declutter', () => {
  const tag = (key, left, top, text, rank) => ({ key, left, top, text, rank });

  it('keeps every label that overlaps no other', () => {
    const tags = [tag('a', 100, 100, 'jorge', 1), tag('b', 400, 100, 'manufosela', 1)];
    expect(declutter(tags).map((t) => t.key)).toEqual(['a', 'b']);
  });

  it('of two that overlap, keeps the higher rank', () => {
    const tags = [tag('host', 100, 100, 'manufosela', 1), tag('pointed', 110, 105, 'codex', 2)];
    expect(declutter(tags).map((t) => t.key)).toEqual(['pointed']);
  });

  it('labels one above the other, clear of each other, both stay', () => {
    const tags = [tag('a', 100, 100, 'manufosela', 1), tag('b', 100, 140, 'jorge', 1)];
    expect(declutter(tags)).toHaveLength(2);
  });
});
