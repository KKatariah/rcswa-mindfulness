from django.urls import path
from . import views

urlpatterns = [
    path("user/", views.current_user, name="current-user"),
    path("register/", views.register_view, name="register"),
    path("login/", views.login_view, name="login"),
    path("user/", views.current_user_view, name="current-user"),
    path("logout/", views.logout_view, name="logout"),
    path("google-login/", views.google_login_view, name="google-login"),
    path("dashboard/stats/", views.dashboard_stats_view, name="dashboard-stats"),
    path("program-status/", views.program_status_view, name="program-status"),
    path("profile/", views.update_profile_view, name="update-profile"),
    path("change-password/", views.change_password_view, name="change-password"),
]
