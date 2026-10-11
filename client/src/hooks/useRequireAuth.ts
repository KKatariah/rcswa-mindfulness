import { useEffect } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/context/AuthContext";

/** useAuth() for pages that need a signed-in user: anyone signed out is sent to the home page. */
export function useRequireAuth() {
	const router = useRouter();
	const auth = useAuth();
	const { user, isLoading } = auth;

	useEffect(() => {
		if (!isLoading && !user) router.replace("/");
	}, [isLoading, user, router]);

	return auth;
}
