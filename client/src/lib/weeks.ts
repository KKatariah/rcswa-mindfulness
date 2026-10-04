/** Display label for a module's week: week 0 is the programme introduction. */
export function weekLabel(weekNumber: number): string {
	return weekNumber === 0 ? "Introduction" : `Week ${weekNumber}`;
}
