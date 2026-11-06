from .models import Profile

def active_profile(request):
    profile = Profile.objects.filter(pk=request.session.get('active_profile_id')).first()
    if profile is None:
        profile = Profile.objects.order_by('id').first()
    return {'active_profile': profile}
