from django.urls import path
from . import views

# app_name = "my_app" # placeholder name

urlpatterns = [
    path("", views.index_view, name="default_index_html"),
    path("index/", views.index_view, name="index_html"),
    path("profile/", views.profile_view, name="profile_html"),

    path("api/register/", views.register_view, name="register"),
    #path("api/login/", views.login_view, name="login"),
]
