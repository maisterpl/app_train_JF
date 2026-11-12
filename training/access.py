"""One policy for HTML, exports, API and administrator graph access."""
from .models import Profile
from allauth.account.models import EmailAddress

def visible_profiles(user):
    if not user.is_authenticated:
        return Profile.objects.none()
    if user.is_superuser:
        return Profile.objects.all()
    if not EmailAddress.objects.filter(user=user, verified=True).exists():
        return Profile.objects.none()
    return Profile.objects.filter(owner=user)

def active_for(request):
    profiles = visible_profiles(request.user)
    profile = profiles.filter(pk=request.session.get('active_profile_id')).first() or profiles.order_by('pk').first()
    if profile:
        request.session['active_profile_id'] = profile.pk
    else:
        request.session.pop('active_profile_id', None)
    return profile
