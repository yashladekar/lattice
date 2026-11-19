/** "1 page", "3 pages"; pass the plural when adding "s" is wrong. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
