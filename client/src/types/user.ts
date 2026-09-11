export type Role = "student" | "admin";

export type AuthUser = {
	id: number;
	email: string;
	full_name: string;
	role: Role;
};
