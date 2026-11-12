import re
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from allauth.account.models import EmailAddress
from training.models import Profile, Plan, PlanItem, Exercise, Phase, Workout
from training.services import start_workout

@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class AccountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user('alice', 'alice@example.test', 'Strong-example-phrase-913!')
        self.other = get_user_model().objects.create_user('bob', 'bob@example.test', 'Strong-example-phrase-914!')
        EmailAddress.objects.create(user=self.user,email=self.user.email,verified=True,primary=True)
        self.mine = Profile.objects.create(owner=self.user,name='Prywatny Alice')
        self.theirs = Profile.objects.create(owner=self.other,name='Sekretny Bob')
        self.unclaimed = Profile.objects.create(name='Stary nieprzypisany')
        phase=Phase.objects.first()
        exercise=Exercise.objects.first()
        self.plan=Plan.objects.create(profile=self.theirs,name='Plan Boba',phase=phase)
        PlanItem.objects.create(plan=self.plan,exercise=exercise,basis='none')
        self.workout=start_workout(self.plan)

    def test_anonymous_cannot_read_html_api_or_exports(self):
        for path in ['/', '/profiles/', '/export/profile.json', '/export/workouts.csv',f'/workouts/{self.workout.pk}/']:
            self.assertEqual(self.client.get(path).status_code,302,path)
        self.assertEqual(self.client.get(f'/api/workouts/{self.workout.pk}/').status_code,401)

    def test_user_cannot_select_view_edit_export_or_sync_other_person(self):
        self.client.force_login(self.user)
        response=self.client.get('/profiles/')
        self.assertContains(response,self.mine.name)
        self.assertNotContains(response,self.theirs.name)
        self.assertNotContains(response,self.unclaimed.name)
        for suffix in ['', 'edit/']:
            self.assertEqual(self.client.get(f'/profiles/{self.theirs.pk}/{suffix}').status_code,404)
        self.assertEqual(self.client.post(f'/profiles/{self.theirs.pk}/switch/').status_code,404)
        session=self.client.session;session['active_profile_id']=self.theirs.pk;session.save()
        for path in [f'/plans/{self.plan.pk}/',f'/workouts/{self.workout.pk}/',f'/api/workouts/{self.workout.pk}/']:
            self.assertEqual(self.client.get(path).status_code,404,path)
        self.assertEqual(self.client.post(f'/api/workouts/{self.workout.pk}/sync/',{'operations':[]},content_type='application/json').status_code,404)
        response=self.client.get('/export/profile.json')
        self.assertNotContains(response,self.theirs.name)
        self.assertNotContains(response,self.plan.name)
        self.assertEqual(self.client.get('/').context['active_profile'],self.mine)

    def test_new_profiles_belong_to_logged_in_user(self):
        self.client.force_login(self.user)
        self.client.post('/profiles/',{'name':'Nowy profil','notes':''})
        self.assertEqual(Profile.objects.get(name='Nowy profil').owner,self.user)

    def test_superuser_can_open_other_users_history_and_graph(self):
        admin=get_user_model().objects.create_superuser('admin','admin@example.test','Strong-admin-phrase!')
        self.client.force_login(admin)
        self.assertContains(self.client.get('/profiles/'),self.theirs.name)
        self.assertEqual(self.client.post(f'/profiles/{self.theirs.pk}/switch/').status_code,302)
        self.assertContains(self.client.get('/workouts/'),self.plan.name)
        exercise=self.workout.exercises.first().exercise
        self.assertEqual(self.client.get(f'/exercises/{exercise.pk}/').status_code,200)

    def test_unverified_user_cannot_access_training(self):
        self.client.force_login(self.other)
        self.assertEqual(self.client.get('/').status_code,302)
        self.assertEqual(self.client.get('/api/csrf/').status_code,403)
        self.assertNotContains(self.client.get('/accounts/email/', follow=True), self.theirs.name)

    def test_signup_confirmation_and_email_login(self):
        password='Another-strong-phrase-915!'
        response=self.client.post('/accounts/signup/',{'email':'new@example.test','password1':password,'password2':password})
        self.assertEqual(response.status_code,302,response.content)
        address=EmailAddress.objects.get(email='new@example.test')
        self.assertFalse(address.verified)
        self.assertTrue(mail.outbox)
        confirmation=re.search(r'http://[^\s]+/accounts/confirm-email/[^\s]+/',mail.outbox[-1].body).group(0)
        from urllib.parse import urlsplit
        path=urlsplit(confirmation).path
        self.assertEqual(self.client.get(path).status_code,200)
        address.refresh_from_db();self.assertFalse(address.verified)
        self.assertEqual(self.client.post(path).status_code,302)
        address.refresh_from_db();self.assertTrue(address.verified)
        self.client.post('/accounts/logout/')
        response=self.client.post('/accounts/login/',{'login':'new@example.test','password':password})
        self.assertEqual(response.status_code,302,response.content)
        self.assertIn('_auth_user_id',self.client.session)

    def test_logout_is_post_only_and_requests_browser_storage_clear(self):
        self.client.force_login(self.user)
        self.client.get('/accounts/logout/')
        self.assertIn('_auth_user_id',self.client.session)
        response=self.client.post('/accounts/logout/')
        self.assertNotIn('_auth_user_id',self.client.session)
        self.assertEqual(response.headers['Clear-Site-Data'],'"cache", "storage"')

    def test_password_reset_sends_email(self):
        response=self.client.post('/accounts/password/reset/',{'email':self.user.email})
        self.assertEqual(response.status_code,302)
        self.assertTrue(mail.outbox)
        self.assertIn('/accounts/password/reset/key/',mail.outbox[-1].body)

    def test_assign_legacy_profile_preserves_existing_data(self):
        call_command('assign_profile',profile=self.unclaimed.pk,username=self.user.username,verbosity=0)
        self.unclaimed.refresh_from_db()
        self.assertEqual(self.unclaimed.owner,self.user)

    def test_demo_command_does_not_modify_a_users_profile_with_the_same_name(self):
        owned=Profile.objects.create(owner=self.user,name='Kolarz DEMO')
        call_command('seed_demo',verbosity=0)
        call_command('seed_demo',verbosity=0)
        self.assertFalse(owned.plans.exists())
        self.assertFalse(owned.body_weights.exists())
        self.assertEqual(Profile.objects.filter(name='Kolarz DEMO',owner=None).count(),1)

    def test_google_not_advertised_without_configuration(self):
        self.assertNotContains(self.client.get('/accounts/login/'),'Kontynuuj z Google')
        self.assertRedirects(self.client.post('/accounts/google/login/'),'/accounts/login/')

    @override_settings(GOOGLE_LOGIN_ENABLED=True,SOCIALACCOUNT_PROVIDERS={'google':{'APP':{'client_id':'test-client','secret':'test-only','key':''},'OAUTH_PKCE_ENABLED':True}})
    def test_google_link_uses_post_and_produces_oauth_redirect(self):
        self.assertContains(self.client.get('/accounts/login/'),'Kontynuuj z Google')
        response=self.client.post('/accounts/google/login/')
        self.assertEqual(response.status_code,302,response.content)
        self.assertIn('accounts.google.com',response.headers['Location'])
        self.assertIn('code_challenge=',response.headers['Location'])
