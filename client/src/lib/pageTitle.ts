const SITE = "RCSWA Wellbeing";

/** Browser tab title for a page, e.g. "Forum | RCSWA Wellbeing". */
export function pageTitle(page?: string): string {
	return page ? `${page} | ${SITE}` : SITE;
}

/** Browser tab title for an admin page, e.g. "Users | Admin | RCSWA Wellbeing". */
export function adminPageTitle(page: string): string {
	return pageTitle(`${page} | Admin`);
}
