from django.urls import path
from . import views

urlpatterns = [
    path("health/", views.health_view, name="health"),
    path("user/", views.current_user, name="current-user"),
    path("register/", views.register_view, name="register"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("google-login/", views.google_login_view, name="google-login"),
    path("dashboard/stats/", views.dashboard_stats_view, name="dashboard-stats"),
    path("program-status/", views.program_status_view, name="program-status"),
    path("forum/rules/", views.forum_rules_view, name="forum-rules"),
    path("forum/accept-rules/", views.accept_forum_rules_view, name="forum-accept-rules"),
    path("profile/", views.update_profile_view, name="update-profile"),
    path("change-password/", views.change_password_view, name="change-password"),
]
