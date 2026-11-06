from django.urls import path
from . import views

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('profiles/', views.profiles, name='profiles'),
    path('profiles/<int:profile_id>/', views.profile_detail, name='profile_detail'),
    path('profiles/<int:profile_id>/edit/', views.profile_edit, name='profile_edit'),
    path('profiles/<int:profile_id>/switch/', views.profile_switch, name='profile_switch'),
    path('plans/', views.plans, name='plans'),
    path('plans/new/', views.plan_create, name='plan_create'),
    path('plans/<int:pk>/', views.plan_detail, name='plan_detail'),
    path('plans/<int:pk>/edit/', views.plan_edit, name='plan_edit'),
    path('plans/<int:pk>/add/', views.plan_add, name='plan_add'),
    path('plans/<int:pk>/start/', views.plan_start, name='plan_start'),
    path('plan-items/<int:pk>/edit/', views.plan_item_edit, name='plan_item_edit'),
    path('plan-items/<int:pk>/move/<str:direction>/', views.plan_item_move, name='plan_item_move'),
    path('plan-items/<int:pk>/delete/', views.plan_item_delete, name='plan_item_delete'),
    path('workouts/', views.history, name='history'),
    path('workouts/<uuid:pk>/', views.workout, name='workout'),
    path('exercises/', views.exercise_list, name='exercise_list'),
    path('exercises/<int:pk>/', views.exercise_detail, name='exercise_detail'),
    path('settings/', views.settings, name='settings'),
    path('export/profile.json', views.export_json, name='export_json'),
    path('export/workouts.csv', views.export_csv, name='export_csv'),
]
