from django.shortcuts import render, redirect
from django.http import HttpResponse, HttpResponseNotAllowed

# Create your views here.

def index_view(request):
    return render(request, 'app/index.html')

def profile_view(request):
    context = {
        "name" : "placeholder"
        } # will need to start on class forms next in forms.py
    return render(request, 'app/profile.html', context)

