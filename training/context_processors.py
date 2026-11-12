from django.conf import settings
from .access import active_for

def active_profile(request):
    return {'active_profile': active_for(request), 'google_login_enabled': settings.GOOGLE_LOGIN_ENABLED}
