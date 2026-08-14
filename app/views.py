from django.shortcuts import render, redirect
from django.http import HttpResponse, HttpResponseNotAllowed
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .serializers import RegisterSerializer

# Create your views here.

def index_view(request):
    return render(request, 'app/index.html')

def profile_view(request):
    context = {
        "name" : "placeholder"
        } # will need to start on class forms next in forms.py
    return render(request, 'app/profile.html', context)

#API views

@api_view(["POST"])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.save()

        return Response(
            {
                "message": "Registration successful",
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "full_name": user.full_name,
                },
            },
            status=status.HTTP_201_CREATED,
        )

    return Response(
        serializer.errors,
        status=status.HTTP_400_BAD_REQUEST,
    )
