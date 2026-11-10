/**
 * Indian cities often appear under an old and a new name. A location detected
 * from GPS may say "Bengaluru" while a clinic address says "Bangalore", so
 * search matches any spelling in the same group.
 */
const GROUPS: string[][] = [
  ["Bengaluru", "Bangalore"],
  ["Mumbai", "Bombay"],
  ["Kolkata", "Calcutta"],
  ["Chennai", "Madras"],
  ["Gurugram", "Gurgaon"],
  ["Puducherry", "Pondicherry"],
  ["Thiruvananthapuram", "Trivandrum"],
  ["Kochi", "Cochin"],
  ["Mysuru", "Mysore"],
  ["Vadodara", "Baroda"],
  ["Prayagraj", "Allahabad"],
  ["Delhi", "New Delhi"],
];

/** Returns every known spelling for `city` (always including the input itself). */
export function cityAliases(city: string): string[] {
  const term = city.trim();
  const group = GROUPS.find((g) => g.some((name) => name.toLowerCase() === term.toLowerCase()));
  return group ? Array.from(new Set([term, ...group])) : [term];
}
