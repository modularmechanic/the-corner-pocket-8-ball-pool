/** Shared shelf slots keep the two bottle families from overlapping each other.
 * Each shelf has 20 bottles with a 0.75-unit pitch; alternate shelves shift 0.12 units. */
export function shelfBottlePositions(row: number, family: 'classic' | 'labelled'): number[] {
  const offset = family === 'classic' ? 0 : 1;
  return Array.from({ length: 10 }, (_, index) => -7.2 + (index * 2 + offset) * 0.75 + (row % 2) * 0.12);
}
