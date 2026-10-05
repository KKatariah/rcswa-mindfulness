from rest_framework.permissions import BasePermission

from .access import can_edit_forum_item, is_admin


class IsAdminOrStaff(BasePermission):
    """Only app admins (see access.is_admin)."""

    def has_permission(self, request, view):
        return is_admin(request.user)


class IsAdminOrSelf(BasePermission):
    """Object-level check: the requester is editing their own record, or is an admin/staff."""

    def has_object_permission(self, request, view, obj):
        u = request.user
        return bool(u and u.is_authenticated and (obj.pk == u.pk or is_admin(u)))


class IsAuthorOrAdmin(BasePermission):
    """Forum threads and posts: only their author or an admin may change them."""

    def has_object_permission(self, request, view, obj):
        return can_edit_forum_item(request.user, obj)
