import { countCrossings, layeredLayout } from './flow-layout';

describe('layeredLayout', () => {
  it('places a chain left to right, one layer per hop', () => {
    const pos = layeredLayout(['c', 'b', 'a'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x);
    expect(pos.get('b')!.x).toBeLessThan(pos.get('c')!.x);
  });

  it('puts every edge pointing rightwards on an acyclic graph', () => {
    const edges = [
      { from: 'q', to: 'i' },
      { from: 'i', to: 'p' },
      { from: 'i', to: 'je1' },
      { from: 'p', to: 'je2' },
      { from: 'q', to: 'p' },
    ];
    const pos = layeredLayout(['q', 'i', 'p', 'je1', 'je2'], edges);
    for (const e of edges) expect(pos.get(e.from)!.x).toBeLessThan(pos.get(e.to)!.x);
  });

  it('terminates on a cycle and still places every node', () => {
    const pos = layeredLayout(['a', 'b', 'c'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ]);
    expect(pos.size).toBe(3);
    const xs = new Set([...pos.values()].map((p) => p.x));
    expect(xs.size).toBe(3);
  });

  it('ignores self loops, duplicates and edges to unknown nodes', () => {
    const pos = layeredLayout(['a', 'b'], [
      { from: 'a', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'ghost' },
    ]);
    expect(pos.get('b')!.x).toBeGreaterThan(pos.get('a')!.x);
  });

  it('never overlaps two nodes', () => {
    const keys = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const edges = keys.slice(1).map((k, i) => ({ from: keys[Math.floor(i / 3)], to: k }));
    const pos = layeredLayout(keys, edges);
    const spots = new Set([...pos.values()].map((p) => `${p.x}:${p.y}`));
    expect(spots.size).toBe(keys.length);
  });

  it('untangles a crossing the input order would draw', () => {
    // Two parallel chains given in an order that crosses them.
    const keys = ['a1', 'b1', 'b2', 'a2'];
    const edges = [
      { from: 'a1', to: 'a2' },
      { from: 'b1', to: 'b2' },
    ];
    expect(countCrossings(layeredLayout(keys, edges), edges)).toBe(0);
  });
});
