"""Same-origin, CSRF-protected sync endpoints for a single-device outbox."""
import json
import hashlib
from datetime import date
from uuid import UUID

from django.core.exceptions import ValidationError
from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import FileResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from .models import Plan, Profile, Workout
from .services import apply_operations, serialize_workout, start_workout


def profile_for(request):
    profile = Profile.objects.filter(pk=request.session.get('active_profile_id')).first()
    if profile is None:
        profile = Profile.objects.order_by('id').first()
    if profile is not None:
        request.session['active_profile_id'] = profile.pk
    return profile


def payload(request):
    if len(request.body) > 1_000_000:
        raise ValueError('Zbyt duże żądanie synchronizacji.')
    data = json.loads(request.body or '{}')
    if not isinstance(data, dict):
        raise ValueError('Oczekiwano obiektu JSON.')
    return data


def error(exc, status=400):
    if isinstance(exc, ValidationError):
        message = '; '.join(exc.messages)
    else:
        message = str(exc)
    return JsonResponse({'error': message}, status=status)


@never_cache
@require_GET
def csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})


@never_cache
@require_POST
def prepare(request, pk):
    plan = get_object_or_404(Plan, pk=pk, profile=profile_for(request))
    try:
        data = payload(request)
        workout_id = UUID(str(data['workout_id']))
        training_date = date.fromisoformat(data['date']) if data.get('date') else timezone.localdate()
        with transaction.atomic():
            existing = Workout.objects.filter(pk=workout_id).first()
            if existing:
                if existing.profile_id != plan.profile_id or existing.plan_id != plan.pk:
                    return JsonResponse({'error': 'Identyfikator sesji jest już zajęty.'}, status=409)
                workout = existing
            else:
                workout = start_workout(plan, date=training_date, workout_id=workout_id)
        return JsonResponse({'workout': serialize_workout(workout)})
    except (ValueError, TypeError, KeyError, ValidationError) as exc:
        return error(exc)
    except IntegrityError:
        return JsonResponse({'error': 'Konflikt zapisu. Ponów przygotowanie sesji.'}, status=409)


@never_cache
@require_GET
def workout_data(request, pk):
    workout = get_object_or_404(Workout, pk=pk, profile=profile_for(request))
    return JsonResponse({'workout': serialize_workout(workout)})


@never_cache
@require_POST
def sync(request, pk):
    workout = get_object_or_404(Workout, pk=pk, profile=profile_for(request))
    try:
        data = payload(request)
        operations = data.get('operations')
        if not isinstance(operations, list) or len(operations) > 500:
            raise ValueError('Prześlij listę nie więcej niż 500 zmian.')
        if any(not isinstance(operation, dict) for operation in operations):
            raise ValueError('Niepoprawny format zmiany.')
        apply_operations(workout, operations)
        workout.refresh_from_db()
        return JsonResponse({
            'workout': serialize_workout(workout),
            'acknowledged': [str(operation['id']) for operation in operations],
        })
    except (ValueError, TypeError, KeyError, ValidationError) as exc:
        return error(exc)
    except IntegrityError:
        return JsonResponse({'error': 'Konflikt zapisu. Ponów synchronizację.'}, status=409)


@require_GET
def service_worker(request):
    # A changed shell must install a fresh cache, even when its URLs stay the same.
    digest = hashlib.sha256()
    assets = settings.BASE_DIR / 'training/static/training'
    for asset in sorted(assets.iterdir()):
        if asset.is_file():
            digest.update(asset.name.encode())
            digest.update(asset.read_bytes())
    response = render(request, 'training/service-worker.js', {'asset_version': digest.hexdigest()[:16]}, content_type='text/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


@require_GET
def manifest(request):
    return FileResponse((settings.BASE_DIR / 'training/static/training/manifest.webmanifest').open('rb'), content_type='application/manifest+json')
