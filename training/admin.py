from django.contrib import admin

from .models import (
    BodyWeight,
    Exercise,
    OneRepMax,
    Phase,
    Plan,
    PlanItem,
    Profile,
    Recommendation,
    SyncReceipt,
    Workout,
    WorkoutExercise,
    WorkoutSet,
)


class BodyWeightInline(admin.TabularInline):
    model = BodyWeight
    extra = 0


class OneRepMaxInline(admin.TabularInline):
    model = OneRepMax
    extra = 0


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "rounding_step")
    search_fields = ("name",)
    inlines = (BodyWeightInline, OneRepMaxInline)


@admin.register(BodyWeight)
class BodyWeightAdmin(admin.ModelAdmin):
    list_display = ("profile", "date", "value")
    list_filter = ("profile",)
    date_hierarchy = "date"


@admin.register(OneRepMax)
class OneRepMaxAdmin(admin.ModelAdmin):
    list_display = ("profile", "exercise", "date", "value")
    list_filter = ("profile", "exercise")
    date_hierarchy = "date"


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "mode", "load_notation")
    list_filter = ("mode", "category")
    search_fields = ("name", "description")


class RecommendationInline(admin.StackedInline):
    model = Recommendation
    extra = 0


@admin.register(Phase)
class PhaseAdmin(admin.ModelAdmin):
    list_display = ("name", "is_demo", "source")
    list_filter = ("is_demo",)
    search_fields = ("name", "source")
    inlines = (RecommendationInline,)


@admin.register(Recommendation)
class RecommendationAdmin(admin.ModelAdmin):
    list_display = ("phase", "exercise", "basis", "sets_min", "sets_max")
    list_filter = ("phase", "basis")


class PlanItemInline(admin.StackedInline):
    model = PlanItem
    extra = 0
    ordering = ("position",)


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "profile", "phase")
    list_filter = ("profile", "phase")
    search_fields = ("name",)
    inlines = (PlanItemInline,)


@admin.register(PlanItem)
class PlanItemAdmin(admin.ModelAdmin):
    list_display = ("plan", "position", "exercise", "overridden")
    list_filter = ("plan", "overridden")
    ordering = ("plan", "position")


class HistoricalAdmin(admin.ModelAdmin):
    """Training records are viewable; corrections need a separate explicit flow."""

    def get_readonly_fields(self, request, obj=None):
        return tuple(field.name for field in self.model._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class HistoricalInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = True

    def get_readonly_fields(self, request, obj=None):
        return tuple(field.name for field in self.model._meta.fields)

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class WorkoutExerciseInline(HistoricalInline):
    model = WorkoutExercise


class WorkoutSetInline(HistoricalInline):
    model = WorkoutSet


@admin.register(Workout)
class WorkoutAdmin(HistoricalAdmin):
    list_display = ("training_date", "started_at", "profile", "plan_name", "phase_name", "status")
    list_filter = ("profile", "status")
    date_hierarchy = "started_at"
    inlines = (WorkoutExerciseInline,)


@admin.register(WorkoutExercise)
class WorkoutExerciseAdmin(HistoricalAdmin):
    list_display = ("workout", "position", "exercise", "skipped")
    inlines = (WorkoutSetInline,)


@admin.register(WorkoutSet)
class WorkoutSetAdmin(HistoricalAdmin):
    list_display = ("workout_exercise", "number", "weight", "reps", "seconds", "deleted")


@admin.register(SyncReceipt)
class SyncReceiptAdmin(HistoricalAdmin):
    list_display = ("id", "workout", "created_at")
