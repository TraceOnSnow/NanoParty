/**
 * Bundled items that were withdrawn after shipping. Deleting an item from its JSON file only
 * keeps it out of new installs: a database seeded earlier still has the row. The server retires
 * these ids at startup, so they stop being drawn while past rounds that used them stay readable.
 *
 * Withdrawn so far: number and trivia questions that are no fun to guess, because the answer is
 * stated in the question or is something everyone at the table knows exactly, and number
 * questions that are plain arithmetic.
 */
export const retiredContentIds: string[] = [
  "estimate-net-008",
  "estimate-net-018",
  "estimate-net-019",
  "estimate-net-020",
  "estimate-net-024",
  "estimate-net-029",
  "estimate-net-034",
  "estimate-net-037",
  "estimate-net-038",
  "estimate-net-040",
  "estimate-net-041",
  "estimate-net-049",
  "estimate-net-050",
  "estimate-net-061",
  "estimate-net-062",
  "estimate-net-063",
  "estimate-net-064",
  "estimate-demo-001",
  "estimate-demo-004",
  "estimate-demo-011",
  "estimate-demo-012",
  "fact-net-001",
  "fact-net-002",
  "fact-net-008",
  "fact-net-009",
  "fact-net-010",
  "fact-net-013",
  "fact-net-014",
  "fact-net-017",
  "fact-net-018",
  "fact-net-020",
  "estimate-net-001",
  "estimate-net-002",
  "estimate-net-003",
  "estimate-net-004",
  "estimate-net-005",
  "estimate-net-006",
  "estimate-net-007",
  "estimate-net-009",
  "estimate-net-010",
  "estimate-net-011",
  "estimate-net-012",
  "estimate-net-013",
  "estimate-net-014",
  "estimate-net-015",
];
