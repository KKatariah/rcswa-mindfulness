from rest_framework.permissions import BasePermission

from .access import can_edit_forum_item, is_admin
from .models import Enrollment


class IsAdminOrStaff(BasePermission):
    """Only app admins (see access.is_admin)."""

    def has_permission(self, request, view):
        return is_admin(request.user)


class IsAdminOrSelf(BasePermission):
    """Object-level check: the requester is editing their own record, or is an admin/staff."""

    def has_object_permission(self, request, view, obj):
        u = request.user
        return bool(u and u.is_authenticated and (obj.pk == u.pk or is_admin(u)))


class HasAcceptedForumRules(BasePermission):
    message = "You must agree to the forum rules before using the forum."

    def has_permission(self, request, view):
        # Admins moderate the forum and aren't asked to accept the rules.
        return is_admin(request.user) or request.user.forum_rules_accepted_at is not None


class IsAuthorOrAdmin(BasePermission):
    """Forum threads and posts: only their author or an admin may change them."""

    def has_object_permission(self, request, view, obj):
        return can_edit_forum_item(request.user, obj)


def user_is_approved(u):
    """Admins/staff, or anyone with an ACTIVE enrollment."""
    if not (u and u.is_authenticated):
        return False
    if is_admin(u):
        return True
    return Enrollment.objects.filter(user=u, status=Enrollment.Status.ACTIVE).exists()


class IsApproved(BasePermission):
    """Authenticated AND approved. Use in place of IsAuthenticated."""

    message = "Your account is awaiting admin approval."

    def has_permission(self, request, view):
        return user_is_approved(request.user)
