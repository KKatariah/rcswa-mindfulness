import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types/user";

export function useRequireRole(role: Role) {
	const { user, isLoading } = useAuth();
	return {
		user,
		isLoading,
		allowed: !isLoading && !!user && user.role === role,
		denied: !isLoading && (!user || user.role !== role),
	};
}
