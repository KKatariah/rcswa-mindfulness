import type { ButtonHTMLAttributes, ReactNode } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { PlusIcon } from "@/components/ui/icons";
import Button from "@/components/ui/Button";

/** Page title card, the same as the student pages, with optional content (a count, a "New" button) on the right. */
export default function AdminPageHeader({
	title,
	description,
	eyebrow,
	back,
	children,
}: {
	title: string;
	description?: ReactNode;
	eyebrow?: string;
	back?: { href: string; label: string };
	children?: ReactNode;
}) {
	return <PageHeader title={title} description={description} eyebrow={eyebrow} back={back} actions={children} />;
}

export function CreateButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<Button
			type="button"
			variant="primary" size="md" className="px-4"
			{...props}
		>
			<PlusIcon className="size-4" />
			{children}
		</Button>
	);
}
