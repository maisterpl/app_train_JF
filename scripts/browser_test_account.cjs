/* Local test fixture, never an application endpoint. Creates a verified QA
 * account/session and removes them when the browser context closes. */
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const python=process.env.BROWSER_TEST_PYTHON||path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
function django(code){const r=spawnSync(python,['-c',`import os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings');import django;django.setup();\n${code}`],{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout.trim();}
module.exports.authenticateBrowser=async(context,profileId=null)=>{
 const fixture=JSON.parse(django(`
import json,uuid
from django.contrib.auth import get_user_model
from django.test import Client
from django.contrib.sessions.models import Session
from allauth.account.models import EmailAddress
from training.models import Profile,Plan,PlanItem,BodyWeight,OneRepMax
from training.services import prescription_data
tag=str(uuid.uuid4())[:8]
u=get_user_model().objects.create_user(username='qa_browser_'+tag,email='qa_browser_'+tag+'@example.test')
EmailAddress.objects.create(user=u,email=u.email,verified=True,primary=True)
profile_id=${profileId===null?'None':Number(profileId)}
if profile_id:
 p=Profile.objects.get(pk=profile_id)
 assert p.owner_id is None and p.name.startswith('QA'), 'Refusing to reassign an existing real profile'
 p.owner=u;p.save(update_fields=['owner'])
else:
 source=Plan.objects.filter(profile__owner__isnull=True,profile__name="Kolarz DEMO",phase__is_demo=True,items__isnull=False).first()
 assert source, 'Najpierw seed_demo'
 p=Profile.objects.create(owner=u,name='QA browser '+tag,rounding_step=source.profile.rounding_step)
 plan=Plan.objects.create(profile=p,phase=source.phase,name=source.name)
 for item in source.items.all(): PlanItem.objects.create(plan=plan,exercise=item.exercise,position=item.position,**prescription_data(item))
 for row in source.profile.body_weights.all(): BodyWeight.objects.create(profile=p,date=row.date,value=row.value)
 for row in source.profile.one_rep_maxes.all(): OneRepMax.objects.create(profile=p,exercise=row.exercise,date=row.date,value=row.value)
c=Client();c.force_login(u)
print(json.dumps({'user':u.pk,'profile':p.pk,'session':c.cookies['sessionid'].value}))
`));
 const origin=new URL(process.env.APP_TEST_URL||process.env.APP_URL||'http://127.0.0.1:8000');
 await context.addCookies([{name:'sessionid',value:fixture.session,domain:origin.hostname,path:'/',httpOnly:true,secure:origin.protocol==='https:',sameSite:'Lax'}]);
 const cleanupProfile = profileId === null ? `Profile.objects.filter(pk=${fixture.profile},owner_id=${fixture.user}).delete()` : `Profile.objects.filter(pk=${fixture.profile},owner_id=${fixture.user}).update(owner=None)`;
 context.once('close',()=>django(`from django.contrib.auth import get_user_model;from django.contrib.sessions.models import Session;from training.models import Profile;${cleanupProfile};get_user_model().objects.filter(pk=${fixture.user}).delete();Session.objects.filter(session_key=${JSON.stringify(fixture.session)}).delete()`));
};
