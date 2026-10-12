/** Display label for a module's week: week 0 is the program introduction. */
export function weekLabel(weekNumber: number): string {
	return weekNumber === 0 ? "Introduction" : `Week ${weekNumber}`;
}
