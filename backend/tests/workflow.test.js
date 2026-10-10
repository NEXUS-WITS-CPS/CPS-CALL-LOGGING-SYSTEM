// Workflow & permission tests (UC1–UC6, notifications, automatic escalation).
// Runs against an in-memory fake of the database, so it needs no Supabase keys:  npm test
process.env.SUPABASE_URL='x'; process.env.SUPABASE_SERVICE_KEY='k'; process.env.JWT_SECRET='s'; process.env.PORT='3222';
const path=require('path'); const fake=require('./fake');
require.cache[require.resolve('../supabaseClient')] = { id:'x', filename:'x', loaded:true, exports:fake };
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const T=fake.tables;
T.users.push(
 {user_id:1,full_name:'Ashley Admin',email:'a',role:'admin',is_active:true},
 {user_id:2,full_name:'Melissa Officer',email:'m',role:'officer',is_active:true},
 {user_id:3,full_name:'Vuyo Tech',email:'v',role:'technician',is_active:true},
 {user_id:5,full_name:'Other Tech',email:'t',role:'technician',is_active:true},
 {user_id:6,full_name:'Other Officer',email:'o',role:'officer',is_active:true});
require('../server.js');
const tok=(id,role,name)=>jwt.sign({userId:id,role,fullName:name,email:'x'},'s');
const A=tok(1,'admin','Ashley Admin'), O=tok(2,'officer','Melissa Officer'), TE=tok(3,'technician','Vuyo Tech'), T5=tok(5,'technician','Other Tech'), O6=tok(6,'officer','Other Officer');
const base='http://localhost:3222/api';
async function call(m,p,t,b){ const r=await fetch(base+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:b?JSON.stringify(b):undefined}); let j={}; try{j=await r.json()}catch(e){} return {s:r.status,j}; }
let pass=0, fail=0;
function check(name,cond,extra){ if(cond){pass++;console.log('PASS',name);} else {fail++;console.log('FAIL',name,extra||'');} }
const good={callerName:'Test Caller',callerContact:'011 717 1000',categoryId:'1',locationId:'2',priority:'high',description:'Broken boom gate at main entrance'};
(async()=>{
 await new Promise(r=>setTimeout(r,800));
 let r=await call('POST','/incidents',O,good); check('officer logs incident',r.s===201&&r.j.ticketNumber,JSON.stringify(r.j));
 const t1=r.j.ticketNumber;
 check('ticket has SLA deadline & open status',T.incidents[0].status==='open'&&!!T.incidents[0].sla_deadline);
 r=await call('POST','/incidents',O,{...good,categoryId:'access_control'}); check('text category id rejected (400)',r.s===400);
 r=await call('POST','/incidents',O,{...good,callerContact:'abc'}); check('bad contact number rejected (400)',r.s===400);
 r=await call('POST','/incidents',O,{...good,description:'short'}); check('short description rejected (400)',r.s===400);
 r=await call('POST','/incidents',TE,good); check('technician cannot log incident (403)',r.s===403);
 r=await call('POST','/incidents',null,good); check('no token rejected (401)',r.s===401);
 check('admin notified of new ticket',T.notifications.some(n=>n.recipient_id===1&&n.notification_type==='ticket_logged'));
 r=await call('PATCH',`/incidents/${t1}/resolve`,TE,{resolutionNotes:'Fixed the gate motor and reset',timeSpent:'30'}); check('cannot resolve an open ticket (409/403)',[403,409].includes(r.s),r.s);
 r=await call('PATCH',`/incidents/${t1}/assign`,TE,{assignTo:3}); check('technician cannot assign (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t1}/assign`,O,{assignTo:3}); check('officer cannot assign (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t1}/assign`,A,{assignTo:1}); check('cannot assign to an admin (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t1}/assign`,A,{assignTo:3,assignmentNotes:'Urgent'}); check('admin assigns to technician',r.s===200&&T.incidents[0].status==='in_progress');
 check('assignee notified',T.notifications.some(n=>n.recipient_id===3&&n.notification_type==='ticket_assigned'));
 check('audit notes stored',T.audit_trail.some(a=>a.action_description.includes('Notes: Urgent')));
 r=await call('GET',`/incidents/${t1}`,T5); check('other technician cannot view ticket (403)',r.s===403,r.s);
 r=await call('GET',`/incidents/${t1}/audit`,T5); check('other technician cannot view audit (403)',r.s===403);
 r=await call('GET',`/incidents/${t1}`,TE); check('assigned technician can view (200)',r.s===200);
 r=await call('GET','/incidents',T5); check('technician list only shows own tickets',r.s===200&&r.j.incidents.length===0);
 r=await call('PATCH',`/incidents/${t1}/resolve`,T5,{resolutionNotes:'Fixed the gate motor and reset',timeSpent:'30'}); check('other technician cannot resolve (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t1}/resolve`,TE,{resolutionNotes:'short',timeSpent:'30'}); check('short resolution notes rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t1}/resolve`,TE,{resolutionNotes:'Fixed the gate motor and reset',timeSpent:'30'}); check('assigned technician resolves',r.s===200&&T.incidents[0].status==='pending_confirmation');
 r=await call('PATCH',`/incidents/${t1}/resolve`,TE,{resolutionNotes:'Fixed the gate motor and reset',timeSpent:'30'}); check('cannot resolve twice (409)',r.s===409);
 r=await call('PATCH',`/incidents/${t1}/confirm`,TE,{action:'accept'}); check('technician cannot confirm (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t1}/confirm`,O6,{action:'accept'}); check('different officer cannot confirm (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t1}/confirm`,O,{action:'reject'}); check('reject needs a reason (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t1}/confirm`,O,{action:'accept',satisfactionRating:9}); check('rating out of range rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t1}/confirm`,O,{action:'reject',rejectionReason:'Gate still stuck'}); check('logging officer rejects -> reopened',r.s===200&&T.incidents[0].status==='open'&&T.incidents[0].assigned_to===null);
 await call('PATCH',`/incidents/${t1}/assign`,A,{assignTo:3});
 await call('PATCH',`/incidents/${t1}/resolve`,TE,{resolutionNotes:'Replaced the gate motor properly',timeSpent:'60'});
 r=await call('PATCH',`/incidents/${t1}/confirm`,O,{action:'accept',satisfactionRating:5}); check('logging officer accepts -> closed',r.s===200&&T.incidents[0].status==='closed'&&!!T.incidents[0].date_closed);
 r=await call('GET',`/incidents/${t1}`,A); const acc=(r.j.accountability||[]).map(c=>c.key);
 check('closed ticket shows who logged, assigned, resolved and closed it',['logged','assigned','resolved','closed'].every(k=>acc.includes(k)),acc.join(','));
 check('accountability names a person for every step',(r.j.accountability||[]).every(c=>c.name&&c.name!=='System'),JSON.stringify((r.j.accountability||[]).map(c=>c.name)));
 r=await call('PATCH',`/incidents/${t1}/confirm`,O,{action:'accept'}); check('cannot confirm closed ticket (409)',r.s===409);
 r=await call('PATCH',`/incidents/${t1}/assign`,A,{assignTo:3}); check('cannot assign closed ticket (409)',r.s===409);
 r=await call('PATCH',`/incidents/${t1}/escalate`,A,{escalationReason:'safety',escalateTo:'facilities',escalationNotes:'Needs facilities urgently'}); check('cannot escalate closed ticket (409)',r.s===409);
 // manual escalation
 r=await call('POST','/incidents',O,{...good,priority:'low'}); const t2=r.j.ticketNumber;
 await call('PATCH',`/incidents/${t2}/assign`,A,{assignTo:3});
 r=await call('PATCH',`/incidents/${t2}/escalate`,T5,{escalationReason:'safety',escalateTo:'facilities',escalationNotes:'Needs facilities urgently'}); check('unassigned technician cannot escalate (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t2}/escalate`,TE,{escalationReason:'safety',escalateTo:'facilities',escalationNotes:'short'}); check('short escalation notes rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t2}/escalate`,TE,{escalationReason:'safety',escalateTo:'facilities',escalationNotes:'Needs facilities urgently'}); const inc2=T.incidents.find(i=>i.ticket_number===t2);
 check('assigned technician escalates manually',r.s===200&&inc2.status==='escalated'&&inc2.priority==='critical');
 check('manual escalation does NOT falsely flag SLA breach',inc2.sla_breached===false);
 r=await call('PATCH',`/incidents/${t2}/escalate`,TE,{escalationReason:'safety',escalateTo:'facilities',escalationNotes:'Needs facilities urgently'}); check('cannot escalate twice (409)',r.s===409);
 r=await call('PATCH',`/incidents/${t2}/assign`,A,{assignTo:5}); check('re-assign without a reason rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t2}/assign`,A,{assignTo:3,assignmentNotes:'Same person again'}); check('re-assign to current assignee rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t2}/assign`,A,{assignTo:5,assignmentNotes:'Original technician unavailable'}); check('escalated ticket can be re-assigned',r.s===200&&inc2.status==='in_progress'&&inc2.assigned_to===5);
 check('re-assignment increments reassign_count',inc2.reassign_count>=1,String(inc2.reassign_count));
 // SLA pause / resume
 r=await call('POST','/incidents',O,{...good,priority:'high'}); const tp=r.j.ticketNumber; const incP=T.incidents.find(i=>i.ticket_number===tp);
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,TE,{reason:'third_party',notes:'Waiting for the contractor'}); check('cannot pause an unassigned (open) ticket (409/403)',[403,409].includes(r.s),r.s);
 await call('PATCH',`/incidents/${tp}/assign`,A,{assignTo:3});
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,T5,{reason:'third_party',notes:'Waiting for the contractor'}); check('other technician cannot pause (403)',r.s===403);
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,O,{reason:'third_party',notes:'Waiting for the contractor'}); check('officer cannot pause (403)',r.s===403);
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,TE,{reason:'bogus',notes:'Waiting for the contractor'}); check('pause needs a valid reason (400)',r.s===400);
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,TE,{reason:'third_party',notes:'x'}); check('pause needs an explanation (400)',r.s===400);
 r=await call('PATCH',`/incidents/${tp}/sla-resume`,TE,{}); check('cannot resume a ticket that is not paused (409)',r.s===409);
 const deadlineBefore=incP.sla_deadline;
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,TE,{reason:'awaiting_parts',notes:'Waiting for a new reader to be delivered'}); check('assigned technician pauses SLA',r.s===200&&!!incP.sla_paused_at);
 check('pause is audited with the reason',T.audit_trail.some(a=>a.action_description.startsWith('SLA Paused')&&a.action_description.includes('reader')));
 r=await call('PATCH',`/incidents/${tp}/sla-pause`,TE,{reason:'awaiting_parts',notes:'Waiting for a new reader to be delivered'}); check('cannot pause twice (409)',r.s===409);
 incP.sla_deadline=new Date(Date.now()-3600*1000).toISOString(); incP.sla_paused_at=new Date(Date.now()-2*3600*1000).toISOString();   // deadline passed 1h ago, but paused for 2h
 await require('../lib/sla').runSlaCheck(true);
 check('paused ticket is NOT auto-escalated',incP.status==='in_progress'&&incP.sla_breached===false);
 r=await call('GET','/incidents',A); check('list reports paused SLA status',r.j.incidents.find(i=>i.ticket_number===tp).slaStatus==='paused');
 const dl0=new Date(incP.sla_deadline).getTime();
 r=await call('PATCH',`/incidents/${tp}/sla-resume`,TE,{}); check('technician resumes SLA',r.s===200&&incP.sla_paused_at===null);
 check('resume extends the deadline by the paused time',new Date(incP.sla_deadline).getTime()-dl0>=2*3600*1000-5000&&incP.sla_paused_total_mins>=119,String(incP.sla_paused_total_mins));
 check('resume is audited',T.audit_trail.some(a=>a.action_description.startsWith('SLA Resumed')));
 // SLA milestones: accepted -> arrived -> repair started
 r=await call('PATCH',`/incidents/${tp}/progress`,T5,{step:'accepted'}); check('other technician cannot record progress (403)',r.s===403);
 r=await call('PATCH',`/incidents/${tp}/progress`,TE,{step:'bogus'}); check('unknown progress step rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${tp}/progress`,TE,{step:'arrived'}); check('cannot arrive before accepting (409)',r.s===409);
 r=await call('PATCH',`/incidents/${tp}/progress`,TE,{step:'accepted'}); check('technician accepts the job',r.s===200&&!!incP.date_accepted);
 r=await call('PATCH',`/incidents/${tp}/progress`,TE,{step:'accepted'}); check('cannot accept twice (409)',r.s===409);
 r=await call('PATCH',`/incidents/${tp}/progress`,TE,{step:'arrived'}); check('technician records arrival',r.s===200&&!!incP.date_arrived);
 r=await call('PATCH',`/incidents/${tp}/progress`,TE,{step:'repair_started'}); check('technician starts repair',r.s===200&&!!incP.date_repair_started);
 check('milestones are audited',T.audit_trail.filter(a=>a.action_description.startsWith('Work Progress')).length>=3);
 r=await call('GET',`/incidents/${tp}`,A); { const k=(r.j.timeline||[]).filter(x=>x.at).map(x=>x.key);
   check('ticket timeline lists logged, assigned, accepted, arrived, repair started',['logged','assigned','accepted','arrived','repair_started'].every(x=>k.includes(x)),k.join(',')); }
 r=await call('PATCH',`/incidents/${tp}/assign`,A,{assignTo:5,assignmentNotes:'Technician unavailable today'}); check('re-assign clears the new assignee\'s milestones',r.s===200&&incP.date_accepted===null&&incP.date_arrived===null&&incP.date_repair_started===null);
 r=await call('GET','/reports/sla-performance',TE); check('technician cannot view SLA report (403)',r.s===403);
 r=await call('GET','/reports/sla-performance',A); check('admin gets SLA compliance report',r.s===200&&r.j.overall.total>0&&Array.isArray(r.j.monthly)&&Array.isArray(r.j.technicians),r.s);
 check('SLA report success + breach = 100%',r.j.overall.successPct+r.j.overall.breachPct===100,JSON.stringify(r.j.overall));
 // SLA early warnings
 r=await call('POST','/incidents',O,{...good,priority:'high'}); const tw=r.j.ticketNumber; const incW=T.incidents.find(i=>i.ticket_number===tw);
 incW.date_logged=new Date(Date.now()-3.2*3600*1000).toISOString(); incW.sla_deadline=new Date(Date.now()+0.8*3600*1000).toISOString();   // 80% used
 await require('../lib/sla').runSlaCheck(true);
 check('75% SLA warning sent to admins',T.notifications.some(n=>n.incident_id===incW.incident_id&&n.notification_type==='sla_warning_75'&&n.recipient_id===1));
 check('no 90% warning at 80% used',!T.notifications.some(n=>n.incident_id===incW.incident_id&&n.notification_type==='sla_warning_90'));
 const nBefore=T.notifications.filter(n=>n.incident_id===incW.incident_id&&n.notification_type==='sla_warning_75').length;
 await require('../lib/sla').runSlaCheck(true);
 check('same warning is not sent twice',T.notifications.filter(n=>n.incident_id===incW.incident_id&&n.notification_type==='sla_warning_75').length===nBefore);
 incW.sla_deadline=new Date(Date.now()+0.2*3600*1000).toISOString();   // 95% used
 await require('../lib/sla').runSlaCheck(true);
 check('90% SLA warning sent when threshold crossed',T.notifications.some(n=>n.incident_id===incW.incident_id&&n.notification_type==='sla_warning_90'));
 incW.status='cancelled';
 // ===== ASSETS, SPARE PARTS, MOVEMENTS, MAINTENANCE, CRITICALITY SLA =====
 r=await call('POST','/assets',O,{assetTag:'cps-boom-9',name:'Test boom gate',criticality:'critical'}); check('officer cannot add equipment (403)',r.s===403);
 r=await call('POST','/assets',A,{assetTag:'',name:'Test boom gate'}); check('asset tag required (400)',r.s===400);
 r=await call('POST','/assets',A,{assetTag:'cps-boom-9',name:'Test boom gate',assetType:'bogus'}); check('invalid equipment type rejected (400)',r.s===400);
 r=await call('POST','/assets',A,{assetTag:'cps-boom-9',serialNumber:'SN-1',name:'Test boom gate',assetType:'boom_gate',criticality:'critical'}); const aId=r.j.asset&&r.j.asset.asset_id; check('admin adds equipment',r.s===201&&r.j.asset.asset_tag==='CPS-BOOM-9');
 r=await call('GET','/assets?q=sn-1',TE); check('technician can search equipment by serial',r.s===200&&r.j.assets.length===1);
 r=await call('POST','/incidents',O,{...good,priority:'low',assetId:'abc'}); check('invalid asset id rejected (400)',r.s===400);
 r=await call('POST','/incidents',O,{...good,priority:'low',assetId:String(aId)}); const ta=r.j.ticketNumber; const incA=T.incidents.find(i=>i.ticket_number===ta);
 check('ticket links to equipment',r.s===201&&incA.asset_id===aId);
 check('critical equipment tightens a low-priority SLA to 2 hours',Math.round((new Date(incA.sla_deadline)-new Date(incA.date_logged))/3600000)===2,incA.sla_deadline);
 r=await call('POST','/incidents',O,{...good,priority:'critical'}); { const x=T.incidents.find(i=>i.ticket_number===r.j.ticketNumber); check('ticket without equipment keeps its priority SLA',Math.round((new Date(x.sla_deadline)-new Date(x.date_logged))/3600000)===2); }
 await call('PATCH',`/incidents/${ta}/assign`,A,{assignTo:3});
 r=await call('POST',`/incidents/${ta}/parts`,T5,{partName:'Boom arm',quantity:1}); check('other technician cannot record parts (403)',r.s===403);
 r=await call('POST',`/incidents/${ta}/parts`,TE,{partName:'',quantity:1}); check('part name required (400)',r.s===400);
 r=await call('POST',`/incidents/${ta}/parts`,TE,{partName:'Boom arm',quantity:0}); check('part quantity must be at least 1 (400)',r.s===400);
 r=await call('POST',`/incidents/${ta}/parts`,TE,{partName:'Boom arm',partNumber:'BA-22',quantity:2}); check('technician records spare parts',r.s===201&&T.spare_parts_used.length===1);
 r=await call('GET',`/incidents/${ta}`,A); check('ticket shows parts used',(r.j.parts||[]).length===1&&r.j.parts[0].part_name==='Boom arm');
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'removed',notes:'Arm snapped, removed for repair'}); check('technician must link movement to a ticket (400)',r.s===400);
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'bogus',notes:'xxxxxx',ticketNumber:ta}); check('invalid movement action rejected (400)',r.s===400);
 r=await call('POST',`/assets/${aId}/movements`,T5,{action:'removed',notes:'Arm snapped, removed for repair',ticketNumber:ta}); check('technician cannot move equipment on another technician\'s ticket (403)',r.s===403);
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'removed',notes:'Arm snapped, removed for repair',ticketNumber:ta}); check('technician removes equipment',r.s===201&&T.assets.find(a=>a.asset_id===aId).status==='removed');
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'sent_for_repair',notes:'Sent to supplier workshop',expectedReturn:'2026-11-01',ticketNumber:ta}); check('equipment sent for repair',r.s===201&&T.assets.find(a=>a.asset_id===aId).status==='in_repair');
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'replaced',notes:'Fitted a new unit',ticketNumber:ta}); check('replacement needs the new serial (400)',r.s===400);
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'returned',notes:'Repaired and refitted',ticketNumber:ta}); check('equipment returned to service',r.s===201&&T.assets.find(a=>a.asset_id===aId).status==='in_service');
 r=await call('POST',`/assets/${aId}/movements`,TE,{action:'returned',notes:'Again for no reason',ticketNumber:ta}); check('cannot return equipment already in service (409)',r.s===409);
 check('equipment movements are audited on the ticket',T.audit_trail.some(a=>a.action_description.includes('CPS-BOOM-9')&&a.action_description.includes('sent for repair')));
 r=await call('GET',`/assets/${aId}`,A); check('asset history shows tickets and movements',r.s===200&&r.j.tickets.length===1&&r.j.movements.length===3,JSON.stringify(r.j.movements&&r.j.movements.length));
 r=await call('POST','/maintenance',TE,{assetId:aId,title:'Quarterly service',intervalDays:90,nextDue:'2026-12-01'}); check('technician cannot create maintenance schedules (403)',r.s===403);
 r=await call('POST','/maintenance',A,{assetId:aId,title:'Quarterly service',intervalDays:0,nextDue:'2026-12-01'}); check('maintenance interval must be positive (400)',r.s===400);
 r=await call('POST','/maintenance',A,{assetId:aId,title:'Quarterly service',intervalDays:90,nextDue:'2020-01-01'}); const sId=r.j.schedule&&r.j.schedule.schedule_id; check('admin creates a maintenance schedule',r.s===201);
 r=await call('GET','/maintenance',TE); check('overdue schedule is flagged',r.s===200&&r.j.schedules[0].state==='overdue');
 r=await call('GET','/dashboard/operations',A); check('operations dashboard counts overdue maintenance',r.s===200&&r.j.maintenance.overdue===1&&Array.isArray(r.j.workload),r.s);
 r=await call('GET','/dashboard/operations',TE); check('technician cannot open the operations dashboard (403)',r.s===403);
 r=await call('POST',`/maintenance/${sId}/complete`,TE,{notes:'Greased, tested limit switches'}); check('technician records maintenance done',r.s===200&&T.maintenance_log.length===1);
 r=await call('GET','/maintenance',A); check('next due moves forward by the interval',r.j.schedules[0].state==='ok'&&r.j.schedules[0].interval_days===90);
 r=await call('GET','/users/technicians',A); check('assign dropdown lists technicians only',r.s===200&&r.j.technicians.every(t=>t.role==='technician'));
 incA.status='cancelled';
 // ===== USER MANAGEMENT, CATEGORY SLA TIERS, MAINTENANCE TICKETS =====
 r=await call('POST','/auth/register',A,{fullName:'Zo',email:'zo@wits.ac.za',password:'pass1234',role:'technician'}); check('register needs a real name (400)',r.s===400);
 r=await call('POST','/auth/register',A,{fullName:'Zola Dube',email:'not-an-email',password:'pass1234',role:'technician'}); check('register needs a valid email (400)',r.s===400);
 r=await call('POST','/auth/register',A,{fullName:'Zola Dube',email:'zola@wits.ac.za',password:'short',role:'technician'}); check('register needs an 8+ character password (400)',r.s===400);
 r=await call('PATCH','/users/1/deactivate',A,{}); check('admin cannot deactivate themselves (400)',r.s===400);
 await call('POST','/auth/register',A,{fullName:'Temp Person',email:'tmp@wits.ac.za',password:'pass1234',role:'technician'});
 { const u=T.users.find(x=>x.email==='tmp@wits.ac.za'); await call('PATCH',`/users/${u.user_id}/deactivate`,A,{});
   r=await call('PATCH',`/users/${u.user_id}/activate`,O,{}); check('non-admin cannot reactivate a user (403)',r.s===403);
   r=await call('PATCH',`/users/${u.user_id}/activate`,A,{}); check('admin reactivates a user',r.s===200&&u.is_active===true);
   r=await call('PATCH',`/users/${u.user_id}/password`,A,{password:'abc'}); check('password reset needs 8+ characters (400)',r.s===400);
   r=await call('PATCH',`/users/${u.user_id}/password`,A,{password:'Temp-pass-99'}); check('admin resets a password',r.s===200&&await bcrypt.compare('Temp-pass-99',u.password_hash)); }
 T.categories.push({category_id:77,category_name:'Fire / Safety'});
 r=await call('POST','/incidents',O,{...good,priority:'low',categoryId:'77'}); { const x=T.incidents.find(i=>i.ticket_number===r.j.ticketNumber);
   check('safety-critical category tightens a low-priority SLA to 2 hours',Math.round((new Date(x.sla_deadline)-new Date(x.date_logged))/3600000)===2);
   check('SLA tier change is audited',T.audit_trail.some(a=>a.incident_id===x.incident_id&&a.action_description.startsWith('SLA tier tightened')));
   x.status='cancelled'; }
 T.locations.push({location_id:2,location_name:'Main Gate'}); if(!T.categories.find(c=>/infra/i.test(c.category_name))) T.categories.push({category_id:78,category_name:'Infrastructure'});
 { const before=T.incidents.length;
   const sch=T.maintenance_schedules.find(x=>x.schedule_id===sId); sch.next_due='2020-01-01';
   const n=await require('../lib/maintenance').runMaintenanceCheck(true);
   check('due maintenance raises a ticket',n===1&&T.incidents.length===before+1&&T.incidents[T.incidents.length-1].description.startsWith('Preventive maintenance due'),String(n));
   const n2=await require('../lib/maintenance').runMaintenanceCheck(true);
   check('same maintenance is not raised twice while its ticket is live',n2===0&&T.incidents.length===before+1);
   T.incidents[T.incidents.length-1].status='cancelled'; sch.next_due='2030-01-01'; }
 // automatic escalation
 r=await call('POST','/incidents',O,{...good,priority:'critical'}); const t3=r.j.ticketNumber; const inc3=T.incidents.find(i=>i.ticket_number===t3);
 inc3.sla_deadline=new Date(Date.now()-3600*1000).toISOString();
 await require('../lib/sla').runSlaCheck(true);   // same check the server runs every minute
 r=await call('GET','/dashboard/summary',A);
 { const m=r.j.summary; const parts=m.open+m.inProgress+m.escalated+m.pendingConfirmation+m.resolvedClosed+m.cancelled;
   check('dashboard status cards add up to total (no unaccounted tickets)',r.s===200&&parts===m.total,JSON.stringify(m));
   const expectRe=T.incidents.filter(i=>i.reassign_count>0&&['open','in_progress','escalated'].includes(i.status)).length;
   check('dashboard re-assigned count matches tickets assigned more than once',m.reassigned===expectRe&&m.reassigned>=1,JSON.stringify(m)); }
 check('SLA breach auto-escalates ticket (UC6 auto path)',inc3.status==='escalated'&&inc3.sla_breached===true,JSON.stringify(inc3));
 check('auto-escalation recorded in escalations + audit',T.escalations.some(e=>e.incident_id===inc3.incident_id&&e.escalation_reason==='sla_breach')&&T.audit_trail.some(a=>a.incident_id===inc3.incident_id&&a.action_description.startsWith('Automatic Escalation')));
 check('admins notified of SLA breach',T.notifications.some(n=>n.recipient_id===1&&n.notification_type==='sla_breach'));
 r=await call('GET','/notifications',A); check('admin can read notifications',r.s===200&&r.j.notifications&&Array.isArray(r.j.notifications));
 r=await call('PATCH','/notifications/read-all',A); check('mark all read',r.s===200&&T.notifications.filter(n=>n.recipient_id===1).every(n=>n.is_read));

 // ── Cancel Incident (soft delete) ──
 r=await call('POST','/incidents',O,good); const t4=r.j.ticketNumber; const inc4=T.incidents.find(i=>i.ticket_number===t4);
 r=await call('PATCH',`/incidents/${t4}/cancel`,TE,{reason:'No longer needed'}); check('technician cannot cancel (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t4}/cancel`,O,{reason:'no'}); check('cancel reason too short rejected (400)',r.s===400);
 r=await call('PATCH',`/incidents/${t4}/cancel`,O6,{reason:'Duplicate call logged twice'}); check('other officer cannot cancel (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t4}/cancel`,O,{reason:'Duplicate call logged twice'}); check('officer cancels own open ticket',r.s===200&&inc4.status==='cancelled',JSON.stringify(r.j));
 r=await call('PATCH',`/incidents/${t4}/cancel`,O,{reason:'Duplicate call logged twice'}); check('cannot cancel an already-cancelled ticket (409)',r.s===409);

 r=await call('POST','/incidents',O,good); const t5=r.j.ticketNumber; const inc5=T.incidents.find(i=>i.ticket_number===t5);
 await call('PATCH',`/incidents/${t5}/assign`,A,{assignTo:3});
 r=await call('PATCH',`/incidents/${t5}/cancel`,O,{reason:'Trying to cancel after assignment'}); check('officer cannot cancel once assigned (403)',r.s===403);
 r=await call('PATCH',`/incidents/${t5}/cancel`,A,{reason:'Officer requested cancellation'}); check('admin can cancel an in-progress ticket',r.s===200&&inc5.status==='cancelled');
 check('assignee notified of cancellation',T.notifications.some(n=>n.recipient_id===3&&n.notification_type==='ticket_cancelled'));
 check('cancellation recorded in audit trail',T.audit_trail.some(a=>a.incident_id===inc5.incident_id&&a.action_description.startsWith('Ticket Cancelled')));
 r=await call('PATCH',`/incidents/${t1}/cancel`,A,{reason:'Trying to cancel a closed ticket'}); check('cannot cancel a closed ticket (409)',r.s===409);

 // ── GET /auth/me ──
 r=await call('GET','/auth/me',O); check('officer can read own profile (/auth/me)',r.s===200&&r.j.user?.email==='m'&&r.j.user?.role==='officer',JSON.stringify(r.j));
 r=await call('GET','/auth/me',null); check('/auth/me without token rejected (401)',r.s===401);

 // ── POST /auth/register (admin only) ──
 r=await call('POST','/auth/register',O,{fullName:'New Tech',email:'newtech@wits.ac.za',password:'pass1234',role:'technician'});
 check('non-admin cannot register a user (403)',r.s===403);
 r=await call('POST','/auth/register',A,{fullName:'New Tech',email:'newtech@wits.ac.za',password:'pass1234',role:'technician'});
 check('admin registers a new user (201)',r.s===201&&r.j.user?.role==='technician',JSON.stringify(r.j));
 const newUserId=r.j.user?.user_id;
 r=await call('POST','/auth/register',A,{fullName:'Dup Tech',email:'newtech@wits.ac.za',password:'pass1234',role:'technician'});
 check('duplicate email on register rejected (409)',r.s===409);
 // fake DB has no password_hash comparison seam other than bcrypt, so confirm the route hashed it
 const newUserRow=T.users.find(u=>u.user_id===newUserId);
 check('registered user has a bcrypt password hash stored',await bcrypt.compare('pass1234',newUserRow?.password_hash||''));

 // ── PATCH /users/:userId/deactivate (admin only) — then login is blocked ──
 r=await call('PATCH',`/users/${newUserId}/deactivate`,O,{}); check('non-admin cannot deactivate a user (403)',r.s===403);
 r=await call('POST','/auth/login',null,{email:'newtech@wits.ac.za',password:'pass1234'});
 check('newly registered user can log in before deactivation (200)',r.s===200&&r.j.token,JSON.stringify(r.j));
 r=await call('PATCH',`/users/${newUserId}/deactivate`,A,{}); check('admin deactivates a user (200)',r.s===200&&newUserRow?.is_active===false,JSON.stringify(r.j));
 r=await call('POST','/auth/login',null,{email:'newtech@wits.ac.za',password:'pass1234'});
 check('deactivated user cannot log in (401)',r.s===401);

 // ── GET /dashboard/recent — role-scoped ──
 r=await call('GET','/dashboard/recent',A); check('admin sees recent tickets',r.s===200&&Array.isArray(r.j.incidents));
 r=await call('GET','/dashboard/recent',TE);
 check('technician recent tickets only include their own',r.s===200&&(r.j.incidents||[]).every(i=>i.assigned_to===3),JSON.stringify(r.j));

 // ── GET /incidents/status/pending-confirmation ──
 r=await call('POST','/incidents',O,good); const t6=r.j.ticketNumber;
 await call('PATCH',`/incidents/${t6}/assign`,A,{assignTo:3});
 await call('PATCH',`/incidents/${t6}/resolve`,TE,{resolutionNotes:'Replaced the faulty sensor and tested it',timeSpent:30});
 r=await call('GET','/incidents/status/pending-confirmation',O);
 check('pending-confirmation list includes the newly resolved ticket',r.s===200&&(r.j.incidents||[]).some(i=>i.ticket_number===t6),JSON.stringify(r.j));

 // ── GET /reports/technician-performance/:userId (admin-only drill-down) ──
 r=await call('GET',`/reports/technician-performance/3`,A); check('admin can drill down into a technician\'s performance',r.s===200);
 r=await call('GET',`/reports/technician-performance/3`,O); check('officer cannot access the technician drill-down report (403)',r.s===403);

 // ── Access requests, approval, bulk import, forced password change ──
 r=await call('POST','/auth/request-access',null,{fullName:'Sam Newcomer',email:'sam@gmail.com',password:'longenough1'}); check('access request rejects non-Wits email (400)',r.s===400);
 r=await call('POST','/auth/request-access',null,{fullName:'Sam Newcomer',email:'sam@wits.ac.za',password:'short'}); check('access request rejects short password (400)',r.s===400);
 r=await call('POST','/auth/request-access',null,{fullName:'Sam Newcomer',email:'Sam@Wits.ac.za',password:'longenough1',role:'admin'}); const sam=T.users.find(u=>u.email==='sam@wits.ac.za');
 check('access request creates a pending account with no privileges (even if a role is sent)',r.s===201&&sam&&sam.account_status==='pending'&&sam.is_active===false&&sam.role==='officer',JSON.stringify(r.j));
 r=await call('POST','/auth/request-access',null,{fullName:'Sam Again',email:'sam@wits.ac.za',password:'longenough1'}); check('duplicate request refused (409)',r.s===409);
 r=await call('POST','/auth/login',null,{email:'sam@wits.ac.za',password:'wrongpass'}); check('pending user with wrong password sees generic error (401)',r.s===401);
 r=await call('POST','/auth/login',null,{email:'sam@wits.ac.za',password:'longenough1'}); check('pending user cannot sign in (403, awaiting approval)',r.s===403&&/waiting/i.test(r.j.error||''),JSON.stringify(r.j));
 r=await call('PATCH',`/users/${sam.user_id}/activate`,A,{}); check('a pending request cannot be switched on without approval (400)',r.s===400&&sam.is_active===false);
 r=await call('PATCH',`/users/${sam.user_id}/approve`,O,{role:'officer'}); check('non-admin cannot approve a request (403)',r.s===403);
 r=await call('PATCH',`/users/${sam.user_id}/approve`,A,{role:'superuser'}); check('approval needs a valid role (400)',r.s===400);
 r=await call('PATCH',`/users/${sam.user_id}/approve`,A,{role:'technician'}); check('admin approves and assigns the role',r.s===200&&sam.role==='technician'&&sam.is_active===true&&sam.account_status==='active'&&sam.reviewed_by===1,JSON.stringify(r.j));
 r=await call('PATCH',`/users/${sam.user_id}/approve`,A,{role:'officer'}); check('an already-approved request cannot be approved again (400)',r.s===400);
 r=await call('POST','/auth/login',null,{email:'sam@wits.ac.za',password:'longenough1'}); check('approved user can now sign in',r.s===200&&r.j.user.role==='technician');
 r=await call('POST','/auth/request-access',null,{fullName:'Rita Decline',email:'rita@wits.ac.za',password:'longenough1'}); const rita=T.users.find(u=>u.email==='rita@wits.ac.za');
 r=await call('PATCH',`/users/${rita.user_id}/reject`,A,{}); check('admin declines a request',r.s===200&&rita.account_status==='rejected'&&rita.is_active===false);
 r=await call('POST','/auth/login',null,{email:'rita@wits.ac.za',password:'longenough1'}); check('declined user cannot sign in (403)',r.s===403);

 r=await call('POST','/users/bulk',O,{rows:[{fullName:'X Person',email:'x@wits.ac.za',role:'officer'}]}); check('officer cannot bulk import (403)',r.s===403);
 r=await call('POST','/users/bulk',A,{rows:[
   {fullName:'Bulk One',email:'bulk1@wits.ac.za',role:'officer'},{fullName:'Bulk Two',email:'bulk2@wits.ac.za',role:'technician'},
   {fullName:'Bulk One Again',email:'bulk1@wits.ac.za',role:'officer'},{fullName:'Bad Role',email:'bad@wits.ac.za',role:'boss'},
   {fullName:'No Mail',email:'nomail',role:'officer'},{fullName:'Sam Newcomer',email:'sam@wits.ac.za',role:'officer'}]});
 check('bulk import creates valid rows and reports the bad ones',r.s===201&&r.j.created===2&&r.j.failed===4,JSON.stringify(r.j));
 const b1=T.users.find(u=>u.email==='bulk1@wits.ac.za'); const tmpPw=r.j.results.find(x=>x.ok).tempPassword;
 check('bulk users get a temporary password and must change it',!!b1&&b1.must_change_password===true&&await bcrypt.compare(tmpPw,b1.password_hash)&&tmpPw.length>=8);
 r=await call('POST','/auth/login',null,{email:'bulk1@wits.ac.za',password:tmpPw}); const mcTok=r.j.token;
 check('login flags that the password must be changed',r.s===200&&r.j.user.mustChangePassword===true);
 r=await call('GET','/incidents',mcTok); check('everything else is blocked until the password is changed (403)',r.s===403&&r.j.code==='PASSWORD_CHANGE_REQUIRED');
 r=await call('POST','/auth/change-password',mcTok,{currentPassword:'nottheone',newPassword:'brandnew-pw1'}); check('change password needs the correct current password (401)',r.s===401);
 r=await call('POST','/auth/change-password',mcTok,{currentPassword:tmpPw,newPassword:'short'}); check('new password must be 8+ characters (400)',r.s===400);
 r=await call('POST','/auth/change-password',mcTok,{currentPassword:tmpPw,newPassword:'brandnew-pw1'}); check('user chooses their own password and gets a full token',r.s===200&&b1.must_change_password===false&&!!r.j.token);
 r=await call('GET','/incidents',r.j.token); check('normal access works after the change',r.s===200);
 r=await call('PATCH',`/users/${b1.user_id}/password`,A,{password:'Reset-temp-1'}); check('admin password reset forces a change at next sign-in',r.s===200&&b1.must_change_password===true);
 r=await call('GET','/users/audit',A); const acts=(r.j.events||[]).map(e=>e.action);
 check('account history records request, approval, decline, bulk create and reset',r.s===200&&['requested','approved','rejected','bulk_created','password_reset','password_changed'].every(a=>acts.includes(a)),JSON.stringify(acts));
 check('approval entry names who approved',(r.j.events||[]).some(e=>e.action==='approved'&&e.by==='Ashley Admin'&&e.user==='Sam Newcomer'));
 r=await call('GET','/users/audit',O); check('officer cannot read the account history (403)',r.s===403);
 r=await call('GET','/users/technicians',A); check('pending/declined people never appear in the assign list',!(r.j.technicians||[]).some(t=>t.email==='rita@wits.ac.za'));

 // login lockout: 5 failed sign-ins per account in 15 minutes; only failed sign-ins count; success resets the count
 const login=(email,password)=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 let refusedAt=0, remainingHeader=null;
 for(let i=1;i<=8;i++){ const rr=await login('nobody@wits.ac.za','wrong-password'); if(i===1)remainingHeader=rr.headers.get('ratelimit-remaining'); if(rr.status===429&&!refusedAt)refusedAt=i; }
 check('login is locked after 5 failed tries for the same account (6th is refused, 429)',refusedAt===6,'refused at '+refusedAt);
 check('rate-limit header tells the user how many tries are left',remainingHeader==='4',String(remainingHeader));
 for(let i=1;i<=5;i++) await login('bulk1@wits.ac.za','wrong-password');
 let lk=await login('bulk1@wits.ac.za','Reset-temp-1'); let lj={}; try{lj=await lk.json()}catch(e){}
 check('a locked account is refused even with the correct password, with a clear message',lk.status===429&&/try again in 15 minutes/.test(lj.error||''),lk.status+' '+JSON.stringify(lj));
 lk=await login('sam@wits.ac.za','longenough1'); check('other accounts can still sign in while one is locked',lk.status===200,String(lk.status));
 for(let i=1;i<=3;i++) await login('sam@wits.ac.za','wrong-password');
 lk=await login('sam@wits.ac.za','longenough1'); check('a correct sign-in is accepted before the limit is reached',lk.status===200,String(lk.status));
 let last=0; for(let i=1;i<=3;i++){ const rr=await login('sam@wits.ac.za','wrong-password'); last=rr.status; }
 check('a successful sign-in resets the failed-attempt count',last===401,String(last));

 console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
