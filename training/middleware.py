from django.contrib.auth.views import redirect_to_login
from django.http import JsonResponse
from django.shortcuts import redirect
from django.conf import settings
from django.contrib import messages
from allauth.account.models import EmailAddress

class AccountBoundaryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/accounts/google/') and not settings.GOOGLE_LOGIN_ENABLED:
            messages.info(request, 'Logowanie Google nie jest jeszcze skonfigurowane. Użyj adresu e-mail.')
            return redirect('account_login')
        public = request.path.startswith(('/accounts/', '/admin/', '/static/')) or request.path in (
            '/service-worker.js', '/manifest.webmanifest', '/health/')
        if not public:
            if not request.user.is_authenticated:
                return JsonResponse({'error':'Zaloguj się ponownie. Zmiany pozostają na urządzeniu.'}, status=401) if request.path.startswith('/api/') else redirect_to_login(request.get_full_path())
            if not request.user.is_superuser and not EmailAddress.objects.filter(user=request.user, verified=True).exists():
                return JsonResponse({'error':'Potwierdź adres e-mail.'}, status=403) if request.path.startswith('/api/') else redirect('account_email_verification_sent')
        response = self.get_response(request)
        if not request.path.startswith('/static/'):
            response['Cache-Control'] = 'no-store'
        if request.path == '/accounts/logout/' and request.method == 'POST' and not request.user.is_authenticated:
            response['Clear-Site-Data'] = '"cache", "storage"'
        return response
