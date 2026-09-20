// Workflow & permission tests (UC1–UC6, notifications, automatic escalation).
// Runs against an in-memory fake of the database, so it needs no Supabase keys:  npm test
process.env.SUPABASE_URL='x'; process.env.SUPABASE_SERVICE_KEY='k'; process.env.JWT_SECRET='s'; process.env.PORT='3222';
const path=require('path'); const fake=require('./fake');
require.cache[require.resolve('../supabaseClient')] = { id:'x', filename:'x', loaded:true, exports:fake };
const jwt=require('jsonwebtoken');
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
 r=await call('PATCH',`/incidents/${t1}/assign`,O,{assignTo:1}); check('cannot assign to an admin (400)',r.s===400);
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
 r=await call('PATCH',`/incidents/${t2}/assign`,A,{assignTo:5}); check('escalated ticket can be re-assigned',r.s===200&&inc2.status==='in_progress'&&inc2.assigned_to===5);
 // automatic escalation
 r=await call('POST','/incidents',O,{...good,priority:'critical'}); const t3=r.j.ticketNumber; const inc3=T.incidents.find(i=>i.ticket_number===t3);
 inc3.sla_deadline=new Date(Date.now()-3600*1000).toISOString();
 await require('../lib/sla').runSlaCheck(true);   // same check the server runs every minute
 r=await call('GET','/dashboard/summary',A); 
 check('SLA breach auto-escalates ticket (UC6 auto path)',inc3.status==='escalated'&&inc3.sla_breached===true,JSON.stringify(inc3));
 check('auto-escalation recorded in escalations + audit',T.escalations.some(e=>e.incident_id===inc3.incident_id&&e.escalation_reason==='sla_breach')&&T.audit_trail.some(a=>a.incident_id===inc3.incident_id&&a.action_description.startsWith('Automatic Escalation')));
 check('admins notified of SLA breach',T.notifications.some(n=>n.recipient_id===1&&n.notification_type==='sla_breach'));
 r=await call('GET','/notifications',A); check('admin can read notifications',r.s===200&&r.j.notifications&&Array.isArray(r.j.notifications));
 r=await call('PATCH','/notifications/read-all',A); check('mark all read',r.s===200&&T.notifications.filter(n=>n.recipient_id===1).every(n=>n.is_read));
 console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
