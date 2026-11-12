from django.contrib import admin

from .models import (
    BodyWeight,
    Exercise,
    OneRepMax,
    Phase,
    PhaseSlot,
    Plan,
    PlanItem,
    Profile,
    Recommendation,
    SyncReceipt,
    StrengthGoal,
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
    list_display = ("name", "owner", "rounding_step")
    search_fields = ("name", "owner__email", "owner__username")
    list_filter = ("owner",)
    inlines = (BodyWeightInline, OneRepMaxInline)


@admin.register(BodyWeight)
class BodyWeightAdmin(admin.ModelAdmin):
    list_display = ("profile", "date", "value")
    list_filter = ("profile",)
    date_hierarchy = "date"


@admin.register(OneRepMax)
class OneRepMaxAdmin(admin.ModelAdmin):
    list_display = ("profile", "exercise", "date", "value", "is_estimated")
    list_filter = ("profile", "exercise", "is_estimated")
    date_hierarchy = "date"


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "mode", "load_notation")
    list_filter = ("mode", "category")
    search_fields = ("name", "description")


class RecommendationInline(admin.StackedInline):
    model = Recommendation
    extra = 0


class PhaseSlotInline(admin.StackedInline):
    model = PhaseSlot
    extra = 0
    ordering = ('position',)
    filter_horizontal = ('allowed_exercises',)


class StrengthGoalInline(admin.TabularInline):
    model = StrengthGoal
    extra = 0


@admin.register(Phase)
class PhaseAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "is_demo", "sessions_min", "sessions_max", "weekly_min", "weekly_max")
    list_filter = ("is_demo",)
    search_fields = ("name", "source")
    inlines = (PhaseSlotInline, StrengthGoalInline, RecommendationInline)


@admin.register(PhaseSlot)
class PhaseSlotAdmin(admin.ModelAdmin):
    list_display = ('phase', 'position', 'title', 'category', 'parameter_code', 'default_exercise')
    list_filter = ('phase', 'category', 'parameter_code')
    filter_horizontal = ('allowed_exercises',)


@admin.register(StrengthGoal)
class StrengthGoalAdmin(admin.ModelAdmin):
    list_display = ('phase', 'exercise', 'multiplier_min', 'multiplier_max', 'target_reps')
    list_filter = ('phase',)


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
