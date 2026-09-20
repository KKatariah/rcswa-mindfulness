from django.urls import path
from . import views

urlpatterns = [
    path("user/", views.current_user, name="current-user"),
    path("register/", views.register_view, name="register"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("google-login/", views.google_login_view, name="google-login"),
    path("user/", views.current_user, name="current-user"),
    path("profile/", views.update_profile_view, name="update-profile"),
    path("change-password/", views.change_password_view, name="change-password"),
]
