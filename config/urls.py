from django.contrib import admin
from django.urls import include, path
from training import api

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/csrf/', api.csrf, name='api_csrf'),
    path('api/plans/<int:pk>/prepare/', api.prepare, name='api_prepare'),
    path('api/workouts/<uuid:pk>/', api.workout_data, name='api_workout'),
    path('api/workouts/<uuid:pk>/sync/', api.sync, name='api_sync'),
    path('service-worker.js', api.service_worker, name='service_worker'),
    path('manifest.webmanifest', api.manifest, name='manifest'),
    path('', include('training.urls')),
]
