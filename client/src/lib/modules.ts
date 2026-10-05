/** Confirmation text for deleting a module, saying how much student data goes with it. */
export function deleteModuleMessage(contentItemCount: number) {
	if (contentItemCount === 0) return "This module has no content items yet. This can't be undone.";
	const items = contentItemCount === 1 ? "content item" : "content items";
	const them = contentItemCount === 1 ? "it" : "them";
	return `This will permanently delete ${contentItemCount} ${items} and all student completion history for ${them}. This can't be undone.`;
}
