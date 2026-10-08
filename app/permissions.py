from rest_framework.permissions import BasePermission

from .models import Enrollment


class IsAdminOrStaff(BasePermission):
    """Module-level admin check, mirroring the getattr(u, "role"...) or u.is_staff
    pattern already used ad hoc across views.py/serializers.py."""

    def has_permission(self, request, view):
        u = request.user
        return bool(
            u and u.is_authenticated
            and (getattr(u, "role", None) == "admin" or u.is_staff)
        )


class IsAdminOrSelf(BasePermission):
    """Object-level check: the requester is editing their own record, or is an admin/staff."""

    def has_object_permission(self, request, view, obj):
        u = request.user
        return bool(
            u and u.is_authenticated
            and (obj.pk == u.pk or getattr(u, "role", None) == "admin" or u.is_staff)
        )


def user_is_approved(u):
    """Admins/staff, or anyone with an ACTIVE enrollment."""
    if not (u and u.is_authenticated):
        return False
    if getattr(u, "role", None) == "admin" or u.is_staff:
        return True
    return Enrollment.objects.filter(user=u, status=Enrollment.Status.ACTIVE).exists()


class IsApproved(BasePermission):
    """Authenticated AND approved. Use in place of IsAuthenticated."""

    message = "Your account is awaiting admin approval."

    def has_permission(self, request, view):
        return user_is_approved(request.user)
