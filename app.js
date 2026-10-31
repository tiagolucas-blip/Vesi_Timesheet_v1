(function(){
  "use strict";

  var DAYS = [];
  /* bukrs ties a project to the company it belongs to, so staffing stays
     thematically consistent: a payroll or WFM engagement is consulting
     work (PT01), a facilities engagement is building solutions (PT02).
     null means shared, open internal work, not tied to either theme. */
  var PROJECTS = [
    {code:"BNK-2026", wbs:"BNK-2026.1.3", name:"Banking, Payroll and ECP", act:"Functional consulting", proj:true, bukrs:"PT01", budget:480,
     sap:{rproj:"BNK-2026.1.3", lstar:"CONS01", skostl:"PT4010", rkostl:"", aufnr:""}},
    {code:"RTL-TT", wbs:"RTL-TT.2.1", name:"Retail, Time Tracking", act:"Functional consulting", proj:true, bukrs:"PT01", budget:360,
     sap:{rproj:"RTL-TT.2.1", lstar:"CONS01", skostl:"PT4010", rkostl:"", aufnr:""}},
    {code:"AER-WFM", wbs:"AER-WFM.4.2", name:"Airports, WFM rollout", act:"Project management", proj:true, bukrs:"PT01", budget:600,
     sap:{rproj:"AER-WFM.4.2", lstar:"PMGT01", skostl:"PT4010", rkostl:"", aufnr:""}},
    {code:"AXI-INT", wbs:"", name:"Internal, pre-sales and training", act:"Administrative", proj:false, bukrs:null,
     sap:{rproj:"", lstar:"ADMIN1", skostl:"PT4010", rkostl:"PT4010", aufnr:""}},
    {code:"HSP-FAC", wbs:"HSP-FAC.1.1", name:"Hospital campus, facilities maintenance", act:"Field service", proj:true, bukrs:"PT02", budget:300,
     sap:{rproj:"HSP-FAC.1.1", lstar:"MAINT01", skostl:"PT4010", rkostl:"", aufnr:""}},
    {code:"AER-FAC", wbs:"AER-FAC.2.1", name:"Airport terminal, facilities maintenance", act:"Field service", proj:true, bukrs:"PT02", budget:260,
     sap:{rproj:"AER-FAC.2.1", lstar:"MAINT01", skostl:"PT4010", rkostl:"", aufnr:""}}
  ];
  var PERNR = "00104567";
  var WORKDATES = [];
  var DAYCAP = 8;
  /* Every clock window (Z_BSRV) is assumed to carry its own 1h lunch break
     in the middle; worked hours are the span minus this, see slotHours. */
  var LUNCH_MIN = 60;

  /* ---------- companies, IT0001 and CATS data entry profiles ----------
     The entry mode is a business setting per company, never a user preference.
     The company comes from the employee's IT0001 (Organizational Assignment)
     and ZTIME_COMPANY_CFG maps it to a CATS data entry profile, with validity
     dates, so a retroactive entry keeps the profile that was in force then.
     Start and end are BEGUZ and ENDUZ, standard CATSDB fields whose visibility
     is controlled by the profile, not by code in this application. */
  var COMPANIES = [
    {bukrs:"PT01", name:"Consulting and digital services"},
    {bukrs:"PT02", name:"Building solutions and maintenance"}
  ];
  var PROFILES = {
    Z_CONS:{code:"Z_CONS", name:"Consultants",       clock:false, overnight:false, fields:"Date, project, duration"},
    Z_BSRV:{code:"Z_BSRV", name:"Building Solutions", clock:true,  overnight:true,  fields:"Date, project, start, end, computed duration"}
  };
  var ZTIME_COMPANY_CFG = [
    {bukrs:"PT01", begda:"20200101", endda:"99991231", profile:"Z_CONS"},
    {bukrs:"PT02", begda:"20200101", endda:"99991231", profile:"Z_BSRV"}
  ];
  var DEFAULT_PROFILE = "Z_CONS";

  /* IT0001 of the person using the application. The switch in the header changes
     it, which is the same as opening the sheet as someone assigned to the other
     company. Nothing else in the application decides the entry mode. My week is
     always a standard 8h/day schedule; reduced schedules are only modelled for
     named people on the Team (mass entry) roster, see TEAM below. */
  var IT0001 = {pernr:PERNR, bukrs:"PT01"};
  function dailyCapFor(){ return DAYCAP; }

  function profileCodeFor(bukrs, dateISO){
    var hit = ZTIME_COMPANY_CFG.filter(function(c){
      return c.bukrs === bukrs && c.begda <= dateISO && c.endda >= dateISO;
    })[0];
    return hit ? hit.profile : DEFAULT_PROFILE;
  }
  /* Read at the date of the entry, not today, so history is never reinterpreted. */
  function profileFor(dateISO, bukrs){
    return PROFILES[profileCodeFor(bukrs || IT0001.bukrs, dateISO || WORKDATES[0])];
  }
  function isClock(){ return profileFor(WORKDATES[0]).clock; }
  function companyName(bukrs){
    var c = COMPANIES.filter(function(x){ return x.bukrs === bukrs; })[0];
    return c ? c.name : bukrs;
  }

  /* ---------- period control, monthly, per company ----------
     A closed period rejects new entries and changes. Reopening is an HR action
     and leaves a trace. */
  var PERIODS = [
    {bukrs:"PT01", ym:"202608", open:false, by:"HR, 3 Sep 2026"},
    {bukrs:"PT01", ym:"202609", open:true,  by:""},
    {bukrs:"PT01", ym:"202610", open:true,  by:""},
    {bukrs:"PT02", ym:"202608", open:false, by:"HR, 3 Sep 2026"},
    {bukrs:"PT02", ym:"202609", open:true,  by:""},
    {bukrs:"PT02", ym:"202610", open:true,  by:""}
  ];
  function periodFor(dateISO, bukrs){
    var b = bukrs || IT0001.bukrs, ym = String(dateISO).slice(0,6);
    return PERIODS.filter(function(p){ return p.bukrs === b && p.ym === ym; })[0] || {bukrs:b, ym:ym, open:true, by:""};
  }
  function periodOpen(dateISO, bukrs){ return periodFor(dateISO, bukrs).open !== false; }
  function weekPeriodClosed(){
    for(var i=0; i<5; i++){ if(!periodOpen(WORKDATES[i])) return true; }
    return false;
  }

  /* ---------- wage type catalogue ----------
     Every allowance is a wage type valid in T512Z and authorised in the data
     entry profile. Quantity goes to ANZHL. The bonus is the only one carrying
     an amount, which CATSDB has no field for, so it travels in a customer
     field and is created by the project owner, never by the employee. */
  var WAGETYPES = [
    {code:"AJC_NAC", lgart:"1200", name:"Domestic per diem",  unit:"days",   amount:false, needProj:true,  noteLabel:"",                     selfEntry:true},
    {code:"AJC_INT", lgart:"1210", name:"Foreign per diem",   unit:"days",   amount:false, needProj:true,  noteLabel:"Country",              selfEntry:true},
    {code:"KMS",     lgart:"1300", name:"Own-car kilometres", unit:"km",     amount:false, needProj:true,  noteLabel:"Origin and destination", selfEntry:true},
    {code:"TURNO",   lgart:"1500", name:"Shift allowance",    unit:"days",   amount:false, needProj:false, noteLabel:"",                     selfEntry:true},
    {code:"BONUS",   lgart:"1400", name:"Project bonus",      unit:"amount", amount:true,  needProj:true,  noteLabel:"Reason",               selfEntry:false}
  ];
  /* ---------- public holidays ----------
     The national holidays and the municipal one of each company's office
     (Lisbon for PT01, Porto for PT02), as the holiday calendar of the work
     schedule has them: leave isn't deducted on these days and the
     timesheet expects no hours. Names follow the interface language. */
  var HOLIDAYS = [
    ["20260101","Ano Novo","New Year's Day","Jour de l'An"],
    ["20260403","Sexta-feira Santa","Good Friday","Vendredi saint"],
    ["20260405","Páscoa","Easter Sunday","Pâques"],
    ["20260425","Dia da Liberdade","Freedom Day","Jour de la Liberté"],
    ["20260501","Dia do Trabalhador","Labour Day","Fête du Travail"],
    ["20260604","Corpo de Deus","Corpus Christi","Fête-Dieu"],
    ["20260610","Dia de Portugal","Portugal Day","Fête du Portugal"],
    ["20260613","Santo António","St Anthony's Day","Saint-Antoine","PT01"],
    ["20260624","São João","St John's Day","Saint-Jean","PT02"],
    ["20260815","Assunção de Nossa Senhora","Assumption Day","Assomption"],
    ["20261005","Implantação da República","Republic Day","Fête de la République"],
    ["20261101","Todos os Santos","All Saints' Day","Toussaint"],
    ["20261201","Restauração da Independência","Restoration of Independence","Restauration de l'indépendance"],
    ["20261208","Imaculada Conceição","Immaculate Conception","Immaculée Conception"],
    ["20261225","Natal","Christmas Day","Noël"],
    ["20270101","Ano Novo","New Year's Day","Jour de l'An"],
    ["20270326","Sexta-feira Santa","Good Friday","Vendredi saint"],
    ["20270328","Páscoa","Easter Sunday","Pâques"],
    ["20270425","Dia da Liberdade","Freedom Day","Jour de la Liberté"],
    ["20270501","Dia do Trabalhador","Labour Day","Fête du Travail"],
    ["20270527","Corpo de Deus","Corpus Christi","Fête-Dieu"],
    ["20270610","Dia de Portugal","Portugal Day","Fête du Portugal"],
    ["20270613","Santo António","St Anthony's Day","Saint-Antoine","PT01"],
    ["20270624","São João","St John's Day","Saint-Jean","PT02"],
    ["20270815","Assunção de Nossa Senhora","Assumption Day","Assomption"],
    ["20271005","Implantação da República","Republic Day","Fête de la République"],
    ["20271101","Todos os Santos","All Saints' Day","Toussaint"],
    ["20271201","Restauração da Independência","Restoration of Independence","Restauration de l'indépendance"],
    ["20271208","Imaculada Conceição","Immaculate Conception","Immaculée Conception"],
    ["20271225","Natal","Christmas Day","Noël"]
  ];
  function holidayOn(dateISO, bukrs){
    var b = bukrs || IT0001.bukrs;
    for(var i=0; i<HOLIDAYS.length; i++){
      var h = HOLIDAYS[i];
      if(h[0] === dateISO && (!h[4] || h[4] === b)) return h;
    }
    return null;
  }
  function holidayName(h){ var l = typeof curLang === "function" ? curLang() : state.lang; return h ? (l === "pt" ? h[1] : l === "fr" ? h[3] : h[2]) : ""; }
  function wt(code){ return WAGETYPES.filter(function(w){ return w.code === code; })[0]; }
  function wtName(w){ var k = "wt_" + w.code, v = t(k); return v === k ? w.name : v; }
  function wtFor(bukrs){
    /* Shift allowance only makes sense where people work shifts. */
    return WAGETYPES.filter(function(w){ return w.code !== "TURNO" || (bukrs || IT0001.bukrs) === "PT02"; });
  }

  /* ---------- team, for the leader's mass entry ----------
     Scope is strictly by project ownership, never by line management: the
     team a leader sees in mass entry is everyone allocated to the project
     currently picked above the grid, whatever their manager in IT0001/OM
     is. Rui Tavares is the deliberate exception: he works on Pedro Alves's
     project (AER-WFM) and also on Ana Ferreira's (BNK-2026), independently
     of who he reports to in the org chart. Every other consultant sits on
     exactly one project - a Junior consultant showing up under a project
     they don't actually work on isn't a multi-project feature, it's wrong
     data - so Rui stays the one, named example of it, not the norm. Each
     project's roster is 5 people, a realistic engagement team size. A
     leader can still own more than one project at once, as Ricardo Nunes
     does here: switching the project picker switches which 5-person
     roster is on screen. */
  var LEADERS = [
    {id:"RN", name:"Ricardo Nunes", label:"RTL-TT + AXI-INT", projs:[1,3], bukrs:"PT01"},
    {id:"PA", name:"Pedro Alves",   label:"AER-WFM", projs:[2], bukrs:"PT01"},
    {id:"AF", name:"Ana Ferreira",  label:"BNK-2026", projs:[0], bukrs:"PT01"},
    {id:"CP", name:"Carlos Pinto",  label:"HSP-FAC", projs:[4], bukrs:"PT02"},
    {id:"MS", name:"Marco Silva",   label:"AER-FAC", projs:[5], bukrs:"PT02"}
  ];
  var TEAM = [
    /* BNK-2026 */
    {pernr:"00104501", name:"Marta Silva",     role:"Consultant",        bukrs:"PT01", projs:[0],   abs:{}, already:[8,8,4,0,0,0,0]},
    {pernr:"00104504", name:"Rui Tavares",     role:"Consultant",        bukrs:"PT01", projs:[0,2], abs:{}, already:[8,0,8,0,0,0,0]},
    {pernr:"00104513", name:"Beatriz Costa",   role:"Consultant",        bukrs:"PT01", projs:[0],   abs:{}, dailyHours:6, already:[6,6,0,0,0,0,0]},
    {pernr:"00104514", name:"Tiago Almeida",   role:"Consultant",        bukrs:"PT01", projs:[0],   abs:{3:"Medical appointment"}, already:[8,4,0,0,0,0,0]},
    {pernr:"00104515", name:"Mariana Neves",   role:"Junior consultant", bukrs:"PT01", projs:[0],   abs:{}, already:[0,8,8,0,0,0,0]},
    /* RTL-TT */
    {pernr:"00104502", name:"João Costa",      role:"Consultant",        bukrs:"PT01", projs:[1],   abs:{4:"Vacation"}, already:[4,4,4,4,0,0,0]},
    {pernr:"00104503", name:"Inês Braga",      role:"Junior consultant", bukrs:"PT01", projs:[1],   abs:{}, locked:true, already:[8,8,8,8,8,0,0]},
    {pernr:"00104516", name:"Vera Antunes",    role:"Consultant",        bukrs:"PT01", projs:[1],   abs:{}, already:[8,0,8,0,0,0,0]},
    {pernr:"00104517", name:"Gonçalo Pinheiro",role:"Senior consultant", bukrs:"PT01", projs:[1],   abs:{}, already:[8,8,8,0,0,0,0]},
    {pernr:"00104518", name:"Teresa Correia",  role:"Consultant",        bukrs:"PT01", projs:[1],   abs:{1:"Vacation"}, already:[8,0,4,0,0,0,0]},
    /* AER-WFM */
    {pernr:"00104505", name:"Sofia Marques",   role:"Architect",         bukrs:"PT01", projs:[2],   abs:{2:"Medical appointment"}, already:[0,4,4,8,0,0,0]},
    {pernr:"00104519", name:"Vasco Pereira",   role:"Architect",         bukrs:"PT01", projs:[2],   abs:{}, already:[8,8,4,0,0,0,0]},
    {pernr:"00104520", name:"Miguel Santos",   role:"Consultant",        bukrs:"PT01", projs:[2],   abs:{}, already:[4,4,0,0,0,0,0]},
    {pernr:"00104521", name:"Rita Nunes",      role:"Consultant",        bukrs:"PT01", projs:[2],   abs:{}, already:[8,0,0,0,0,0,0]},
    /* AXI-INT */
    {pernr:"00104523", name:"Bárbara Moreira", role:"Consultant",        bukrs:"PT01", projs:[3],   abs:{}, already:[4,0,0,0,0,0,0]},
    {pernr:"00104524", name:"Eduardo Cardoso", role:"Junior consultant", bukrs:"PT01", projs:[3],   abs:{},  already:[0,4,4,0,0,0,0]},
    {pernr:"00104525", name:"Sara Martins",    role:"Consultant",        bukrs:"PT01", projs:[3],   abs:{0:"Vacation"}, already:[0,4,0,0,0,0,0]},
    {pernr:"00104526", name:"Cláudia Ribeiro", role:"Architect",         bukrs:"PT01", projs:[3],   abs:{}, already:[8,0,4,0,0,0,0]},
    {pernr:"00104527", name:"Diogo Ferreira",  role:"Consultant",        bukrs:"PT01", projs:[3],   abs:{}, already:[0,0,0,4,0,0,0]},
    /* HSP-FAC */
    {pernr:"00104510", name:"Nuno Dias",       role:"Technician",        bukrs:"PT02", projs:[4],   abs:{}, already:[8,8,0,0,0,0,0]},
    {pernr:"00104511", name:"Hélder Rocha",    role:"Technician",        bukrs:"PT02", projs:[4],   abs:{}, dailyHours:6, already:[0,0,6,6,6,0,0]},
    {pernr:"00104512", name:"Hugo Matos",      role:"Technician",        bukrs:"PT02", projs:[4],   abs:{1:"Vacation"}, already:[8,0,8,8,0,0,0]},
    {pernr:"00104528", name:"Luís Teixeira",   role:"Technician",        bukrs:"PT02", projs:[4],   abs:{}, already:[8,8,8,0,0,0,0]},
    {pernr:"00104529", name:"Sandra Fonseca",  role:"Senior technician", bukrs:"PT02", projs:[4],   abs:{}, already:[0,8,8,8,0,0,0]},
    /* AER-FAC */
    {pernr:"00104530", name:"Ana Pires",       role:"Technician",        bukrs:"PT02", projs:[5],   abs:{}, already:[8,8,0,0,0,0,0]},
    {pernr:"00104531", name:"Bruno Alves",     role:"Technician",        bukrs:"PT02", projs:[5],   abs:{2:"Vacation"}, already:[8,0,8,0,0,0,0]},
    {pernr:"00104532", name:"Carla Sousa",     role:"Senior technician", bukrs:"PT02", projs:[5],   abs:{}, already:[0,8,8,8,0,0,0]},
    {pernr:"00104533", name:"Daniel Matos",    role:"Technician",        bukrs:"PT02", projs:[5],   abs:{}, dailyHours:6, already:[6,6,0,0,0,0,0]},
    {pernr:"00104534", name:"Elsa Carvalho",   role:"Technician",        bukrs:"PT02", projs:[5],   abs:{0:"Medical appointment"}, already:[0,8,8,0,0,0,0]},
    /* The project managers themselves: they record their own hours too, and
       can do it here, in the same mass entry as their team. When the one
       under test does, the hours also land in their own My Timesheet. */
    {pernr:"00104540", name:"Ricardo Nunes",   role:"Project manager",   bukrs:"PT01", projs:[1,3], abs:{}, already:[4,4,4,0,0,0,0], leaderOf:"RN"},
    {pernr:"00104541", name:"Pedro Alves",     role:"Project manager",   bukrs:"PT01", projs:[2],   abs:{}, already:[8,4,0,0,0,0,0], leaderOf:"PA"},
    {pernr:"00104401", name:"Ana Ferreira",    role:"Project manager",   bukrs:"PT01", projs:[0],   abs:{}, already:[8,8,4,0,0,0,0], leaderOf:"AF"},
    {pernr:"00104542", name:"Carlos Pinto",    role:"Project manager",   bukrs:"PT02", projs:[4],   abs:{}, already:[8,4,8,0,0,0,0], leaderOf:"CP"},
    {pernr:"00104543", name:"Marco Silva",     role:"Project manager",   bukrs:"PT02", projs:[5],   abs:{}, already:[4,8,0,0,0,0,0], leaderOf:"MS"}
  ];
  function leaderById(id){ return LEADERS.filter(function(l){ return l.id === id; })[0] || LEADERS[0]; }
  function teamOf(leaderId){
    var l = leaderById(leaderId);
    var pIdx = massProject();
    /* If the currently selected project isn't even one of this leader's
       own (mid leader-switch, before #mProj's options are re-synced),
       fall back to the union of their projects rather than an empty or
       wrong-leader team; renderTeam() re-syncs #mProj before this runs in
       the normal render path, so this only guards the edge case. */
    if(l.projs.indexOf(pIdx) === -1){
      return TEAM.filter(function(m){
        return m.projs.some(function(p){ return l.projs.indexOf(p) !== -1; });
      });
    }
    return TEAM.filter(function(m){ return isEligibleForProject(m, pIdx); });
  }
  function projectsOf(leaderId){
    return leaderById(leaderId).projs;
  }
  /* Hours, Allowances and Bonus each re-implement "is this team member
     actually on the project a mass entry is about to bill to" - the exact
     check an earlier pass missed for Allowances when leaders went from one
     project to several. One shared predicate instead of three copies, so
     the next feature can't leave it out the same way. */
  function isEligibleForProject(m, pIdx){
    return m.projs.indexOf(pIdx) !== -1;
  }
  /* Leaders stay in one company, whatever number of projects they own:
     "acting as" only offers leaders of the company IT0001 currently reads,
     the same rule Team entry already applies to who counts as someone's
     team. */
  function leadersForCompany(bukrs){
    return LEADERS.filter(function(l){ return l.bukrs === bukrs; });
  }
  function renderLeaderOptions(){
    var ls = $("leadSel");
    if(!ls) return;
    var opts = leadersForCompany(IT0001.bukrs);
    if(opts.indexOf(leaderById(state.leader)) === -1 && opts.length){
      state.leader = opts[0].id;
    }
    ls.innerHTML = "";
    opts.forEach(function(l){
      var o = document.createElement("option");
      o.value = l.id; o.textContent = l.name + " · " + l.label;
      ls.appendChild(o);
    });
    ls.value = state.leader;
  }
  /* Hours the person already has recorded this week, from their own sheet or a
     previous mass entry, so the leader can see day load before staging more.
     Sample only: weeks already posted or submitted are treated as complete on
     their working days, next week has nothing yet, and this week has the hand
     authored gaps in TEAM[].already, deliberately including someone already
     at capacity so the "day already full" case is visible without more clicks. */
  function alreadyHoursFor(m, weekNum){
    /* the project manager under test: their own sheet is the record */
    if(isSelfMember(m) && weekNum === WEEKS[weekIdx].num) return [0,1,2,3,4,5,6].map(function(d){ return dayTotal(d); });
    var base;
    var wk = WEEKS.filter(function(w){ return w.num === weekNum; })[0];
    var thisWeek = mondayOf(todayISO());
    if(wk && wk.start > thisWeek) base = [0,0,0,0,0,0,0];
    else if(wk && wk.start < thisWeek) base = [0,1,2,3,4].reduce(function(acc,d){ acc[d] = (m.abs[d] || holidayOn(datesFor(wk.start)[d], m.bukrs)) ? 0 : teamDailyCap(m); return acc; }, [0,0,0,0,0,0,0]);
    else base = (m.already || [0,0,0,0,0,0,0]).slice();
    /* the sample "already" figures are a static baseline and never move;
       without this, saving a mass entry made the read-only grid look like
       the save had been lost the moment it succeeded, since staged (now 0)
       was the only thing that had ever added to that baseline. */
    state.massLog.forEach(function(e){
      if(e.kind !== "hours" || e.pernr !== m.pernr) return;
      var idx = WORKDATES.indexOf(e.date);
      if(idx !== -1) base[idx] += e.hours;
    });
    return base;
  }
  /* Weekdays (Mon-Fri) with room left in this person's own daily capacity:
     not blocked by an approved absence, period open, and whatever's
     already saved plus staged doesn't already reach teamDailyCap(m) - a
     day sitting at 2h of an 8h day still has 6h missing, not just a day
     at exactly 0h. Computed up front so a "fill the gaps" request can
     target exactly the days that actually have room, one person at a
     time, instead of one day set forced onto everyone selected. */
  function missingWeekdaysFor(m){
    var already = alreadyHoursFor(m, WEEKS[weekIdx].num);
    var st = stagedOf(m.pernr);
    var days = [];
    for(var d=0; d<5; d++){
      if(memberBlocked(m,d)) continue;
      if(!periodOpen(WORKDATES[d], m.bukrs)) continue;
      if(teamDailyCap(m) - already[d] - (st.h[d]||0) <= 0) continue;
      days.push(d);
    }
    return days;
  }
  /* How much more this person can take on this day before hitting their
     own capacity - the actual amount missingWeekdaysFor's filter checks
     is > 0 for, exposed separately since the day list alone isn't enough
     to stage anything. */
  function teamGapFor(m, d){
    var already = alreadyHoursFor(m, WEEKS[weekIdx].num);
    var st = stagedOf(m.pernr);
    return Math.max(0, teamDailyCap(m) - already[d] - (st.h[d]||0));
  }

  var WEEKDAY_ABBR = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function datesFor(startISO){
    var y = +startISO.slice(0,4), m = +startISO.slice(4,6)-1, d = +startISO.slice(6,8);
    var base = new Date(Date.UTC(y,m,d));
    var out = [];
    for(var i=0; i<7; i++){
      var dt = new Date(base.getTime());
      dt.setUTCDate(base.getUTCDate()+i);
      out.push(dt.toISOString().slice(0,10).replace(/-/g,""));
    }
    return out;
  }
  function daysFor(dates){
    return dates.map(function(wd,i){ return WEEKDAY_ABBR[i] + " " + (+wd.slice(6,8)); });
  }
  /* "YYYYMMDD", local time, to compare directly against WORKDATES/datesFor
     entries without any timezone conversion in between. */
  /* ?today=YYYYMMDD pins "today", so the assistant's test suite reads
     relative dates ("tomorrow", "next week") the same way whatever day
     it runs. Without the parameter, it's the real date. */
  var FIXED_TODAY = (function(){
    var m = /[?&]today=(\d{8})(?:&|$)/.exec((window.location && window.location.search) || "");
    return m ? m[1] : null;
  })();
  function todayISO(){
    if(FIXED_TODAY) return FIXED_TODAY;
    var d = new Date();
    return "" + d.getFullYear() + ((d.getMonth()+1)<10?"0":"")+(d.getMonth()+1) + (d.getDate()<10?"0":"")+d.getDate();
  }
  /* "we"/"today" for whichever of the 7 columns of the currently loaded
     week (WORKDATES) index i falls on - shared by every grid keyed off
     that one week (My Timesheet, Already-recorded, Team mass entry).
     The month grid spans many weeks at once, so it compares full dates
     instead - see monthDayExtraClass. */
  function dayExtraClass(i){
    return (i>4 || holidayOn(WORKDATES[i]) ? " we" : "") + (WORKDATES[i] === todayISO() ? " today" : "");
  }
  function monthDayExtraClass(dayOfWeek, dateISO){
    return (dayOfWeek>4 || holidayOn(dateISO) ? " we" : "") + (dateISO === todayISO() ? " today" : "");
  }
  /* Builds the weekday name and date number as two separate lines, always,
     so every column header wraps the same way regardless of how wide each
     abbreviation happens to render (natural text wrap broke that: some
     day+number pairs fit one line, others didn't, at the same 58px width). */
  function appendDayLabel(cell, i){
    var hol = holidayOn(WORKDATES[i]);
    if(hol){ cell.title = holidayName(hol); cell.classList.add("hol"); }
    cell.appendChild(el("span","dname", WEEKDAY_ABBR[i]));
    cell.appendChild(el("span","dnum", "" + (+WORKDATES[i].slice(6,8))));
  }
  function weekLabelFor(dates, num){
    var s = dates[0], e = dates[6];
    var sD = +s.slice(6,8), sM = +s.slice(4,6)-1, eD = +e.slice(6,8), eM = +e.slice(4,6)-1, y = e.slice(0,4);
    /* a week across New Year names both years: 28 Dec 2026 to 3 Jan 2027 */
    var range = sM === eM
      ? t("label_range_same_month", {d1: sD, d2: eD, month: MONTHS[sM]})
      : t("label_range_diff_month", {d1: sD, m1: MONTHS[sM] + (s.slice(0,4) !== y ? " " + s.slice(0,4) : ""), d2: eD, m2: MONTHS[eM]});
    return t("label_week_n", {n: isoWeekOf(s), range: range, y: y});
  }
  /* The ISO week number of a date: the sample's own week counter keeps
     going past 53, the label shown never does. */
  function isoWeekOf(dateISO){
    var d = new Date(Date.UTC(+dateISO.slice(0,4), +dateISO.slice(4,6)-1, +dateISO.slice(6,8)));
    d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);
    var jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
  }

  /* Absences come from the Leave Request, read-only in this application. Sample data
     covers a few weeks: a posted week, a submitted one, the current draft, and an
     upcoming one, so week navigation has something real to show. */
  function absStatusLabel(status){ return t("status_" + status); }
  /* "Joule" is left as-is: it's the assistant's brand name, not a status word. */
  function originLabel(o){
    if(o === "Manual") return t("val_manual");
    if(o === "Suggested") return t("origin_suggested");
    if(o === "Copied") return t("origin_copied");
    return o;
  }
  /* Sample approval exceptions, translated by known value; an unrecognized
     note (shouldn't happen with the fixed sample data) falls back to itself. */
  function approvalNoteLabel(note){
    if(note === "Pending leave request overlaps recorded hours") return t("note_pending_leave_conflict");
    if(note === "Two empty working days") return t("note_two_empty_days");
    return note;
  }
  /* ---------- Entry detail: project effort and audit trail ----------
     The budget bar and audit fields used to be static markup, identical
     for every row. Actual hours are summed live from this company's own
     WEEKS; "created by"/"last changed" have no real history to read in
     this mockup, so they're a stable (not random - same row always shows
     the same values) pseudo date derived from a seed, not a live clock. */
  var EMPLOYEE_NAME = "Tiago Leal";
  function projectActualHours(pIdx){
    return WEEKS.reduce(function(a, w){
      return a + w.rows.filter(function(r){ return r.p === pIdx; }).reduce(function(x, r){ return x + rowTotal(r); }, 0);
    }, 0);
  }
  function stableSeed(parts){
    var s = parts.join("|"), h = 0;
    for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function auditTextFor(seed){
    var day = 10 + (seed % 10);
    var hour = 8 + (seed % 10);
    var minute = (seed * 7) % 60;
    var hh = (hour < 10 ? "0" : "") + hour, mm = (minute < 10 ? "0" : "") + minute;
    return EMPLOYEE_NAME + ", " + day + " " + MONTHS[8] + " 2026 " + hh + ":" + mm;
  }
  function setDetailBudgetAndAudit(pIdx, seedParts){
    var pr = PROJECTS[pIdx];
    var box = $("dtBudgetBox");
    if(box) box.hidden = !pr.budget;
    if(pr.budget){
      var actual = projectActualHours(pIdx);
      $("dtBudgetNum").textContent = fmt(actual) + " / " + pr.budget + " h";
      $("dtBudgetBar").style.width = Math.min(100, Math.round(actual / pr.budget * 100)) + "%";
    }
    var seed = stableSeed(seedParts);
    $("dtCreatedBy").textContent = auditTextFor(seed);
    $("dtLastChanged").textContent = auditTextFor(seed + 97);
  }
  /* Sample weeks are per company, keyed by the same num/start so the
     week navigator stays aligned: switching IT0001 is opening the sheet
     as someone assigned to that company, projects and absences included,
     not just a different input layout. */
  var WEEKS_PT01 = [
    { num:32, start:"20260803", submitted:true,
      absences:[
        {id:"ab32a", day:4, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500301"}
      ],
      rows:[
        {id:601, p:0, desc:"Payroll requirements review", h:[4,4,4,4,0,0,0], origin:"Manual"},
        {id:602, p:1, desc:"Time tracking rollout support", h:[4,4,4,4,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:33, start:"20260810", submitted:true,
      absences:[],
      rows:[
        {id:603, p:0, desc:"Payroll requirements review", h:[4,4,4,4,4,0,0], origin:"Manual"},
        {id:604, p:2, desc:"WFM rollout kickoff prep", h:[4,4,4,4,4,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:34, start:"20260817", submitted:true,
      absences:[
        {id:"ab34a", day:0, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500312"},
        {id:"ab34b", day:1, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500312"},
        {id:"ab34c", day:2, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500312"},
        {id:"ab34d", day:3, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500312"},
        {id:"ab34e", day:4, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500312"}
      ],
      rows:[],
      allow:[],
      sugs:[]
    },
    { num:35, start:"20260824", submitted:true,
      absences:[],
      rows:[
        {id:96, p:0, desc:"Payroll cutover planning", h:[4,4,4,4,4,0,0], origin:"Manual"},
        {id:97, p:1, desc:"Time tracking rollout scoping", h:[4,4,4,4,4,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:36, start:"20260831", submitted:true,
      absences:[],
      rows:[
        {id:101, p:0, desc:"Payroll cutover testing", h:[4,4,4,4,4,0,0], origin:"Manual"},
        {id:102, p:1, desc:"Time tracking rollout support", h:[4,4,4,4,4,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:37, start:"20260907", submitted:true,
      absences:[
        {id:"ab37a", day:4, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500198"}
      ],
      rows:[
        {id:103, p:0, desc:"Payroll parallel run", h:[4,4,4,4,0,0,0], origin:"Manual"},
        {id:104, p:2, desc:"WFM rollout kickoff", h:[4,4,4,4,0,0,0], origin:"Suggested"}
      ],
      allow:[],
      sugs:[]
    },
    { num:38, start:"20260914", submitted:false,
      absences:[
        {id:"ab1", day:2, type:"Medical appointment", awart:"0210", hours:4, status:"approved", src:"Request 4500219"},
        {id:"ab2", day:4, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500221"},
        {id:"ab3", day:3, type:"Vacation", awart:"0100", hours:8, status:"pending", src:"Request 4500230"}
      ],
      rows:[
        {id:1, p:0, desc:"Requirements workshop, payroll", h:[3,4,0,2,0,0,0], origin:"Manual"},
        {id:2, p:1, desc:"Time recording solution design", h:[2,0,2,0,0,0,0], origin:"Suggested"},
        {id:3, p:3, desc:"", h:[1,0,0,1.5,0,0,0], origin:"Manual"}
      ],
      allow:[
        {id:"al1", day:0, p:0, code:"AJC_NAC", qty:1,  amount:0, note:"", by:"00104567", onBehalf:"00104567"},
        {id:"al2", day:0, p:0, code:"KMS",     qty:86, amount:0, note:"Lisbon to Porto and back", by:"00104567", onBehalf:"00104567"},
        {id:"al3", day:1, p:2, code:"AJC_INT", qty:1,  amount:0, note:"Spain", by:"00104567", onBehalf:"00104567"}
      ],
      sugs:[
        {id:"s1", hours:2.5, day:2, p:2, why:"3 client meetings on the calendar", conf:"hi", desc:"Rollout follow-up meetings"},
        {id:"s2", hours:1.5, day:3, p:1, why:"12 changes in the project repository", conf:"hi", desc:"Time rules configuration"},
        {id:"s3", hours:2, day:4, p:0, why:"4 tickets handled in Cloud ALM", conf:"mid", desc:"Post-testing payroll fixes"},
        {id:"s4", hours:1, day:4, p:3, why:"Block with no attributable signal", conf:"low", desc:""}
      ]
    },
    { num:39, start:"20260921", submitted:false,
      absences:[
        {id:"ab39a", day:0, type:"Vacation", awart:"0100", hours:8, status:"pending", src:"Request 4500255"}
      ],
      rows:[
        {id:605, p:0, desc:"Payroll steering follow-up", h:[4,4,2,0,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[
        {id:"s5", hours:2, day:1, p:0, why:"2 client meetings on the calendar", conf:"hi", desc:"Payroll steering follow-up"}
      ]
    },
    { num:40, start:"20260928", submitted:false,
      absences:[
        {id:"ab40a", day:1, type:"Medical appointment", awart:"0210", hours:2, status:"approved", src:"Request 4500270"}
      ],
      rows:[
        {id:98, p:0, desc:"Payroll go-live support", h:[4,4,0,4,0,0,0], origin:"Manual"},
        {id:94, p:2, desc:"WFM rollout stabilization", h:[0,0,4,0,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[
        {id:"s6", hours:2, day:3, p:0, why:"3 tickets handled in Cloud ALM", conf:"hi", desc:"Payroll post-go-live fixes"}
      ]
    },
    { num:41, start:"20261005", submitted:false,
      absences:[],
      rows:[
        {id:95, p:1, desc:"Retail rollout wave 2 kickoff", h:[4,4,0,0,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:42, start:"20261012", submitted:false,
      absences:[],
      rows:[
        {id:607, p:0, desc:"Payroll go-live support", h:[4,4,4,4,0,0,0], origin:"Manual"},
        {id:608, p:2, desc:"WFM rollout stabilization", h:[4,4,0,4,4,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:43, start:"20261019", submitted:false,
      absences:[],
      rows:[
        {id:609, p:1, desc:"Retail rollout wave 2 support", h:[4,4,0,0,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:44, start:"20261026", submitted:false,
      absences:[],
      rows:[
        {id:610, p:0, desc:"Payroll go-live support", h:[4,0,0,0,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    }
  ];
  var WEEKS_PT02 = [
    { num:36, start:"20260831", submitted:true,
      absences:[],
      rows:[
        {id:501, p:4, desc:"Elevator preventive maintenance", h:[4,4,4,4,4,0,0], origin:"Manual"},
        {id:502, p:3, desc:"Site safety briefing", h:[1,0,1,0,0,0,0], origin:"Manual"}
      ],
      allow:[],
      sugs:[]
    },
    { num:37, start:"20260907", submitted:true,
      absences:[
        {id:"pb37a", day:3, type:"Medical appointment", awart:"0210", hours:2, status:"approved", src:"Request 4500205"}
      ],
      rows:[
        {id:503, p:4, desc:"HVAC filter replacement round", h:[4,4,4,0,4,0,0], origin:"Manual"},
        {id:504, p:4, desc:"Fire safety systems check", h:[0,0,0,3,0,0,0], origin:"Suggested"}
      ],
      allow:[],
      sugs:[]
    },
    { num:38, start:"20260914", submitted:false,
      absences:[
        {id:"pb1", day:2, type:"Medical appointment", awart:"0210", hours:4, status:"approved", src:"Request 4500219"},
        {id:"pb2", day:4, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500221"},
        {id:"pb3", day:3, type:"Vacation", awart:"0100", hours:8, status:"pending", src:"Request 4500230"}
      ],
      rows:[
        {id:511, p:4, desc:"Boiler room inspection", h:[3,4,0,2,0,0,0], origin:"Manual"},
        {id:512, p:4, desc:"Elevator call-out repair", h:[2,0,3,0,0,0,0], origin:"Suggested"},
        {id:513, p:3, desc:"", h:[1,0,0,1.5,0,0,0], origin:"Manual"}
      ],
      allow:[
        {id:"pal1", day:0, p:4, code:"TURNO", qty:1,  amount:0, note:"", by:"00104567", onBehalf:"00104567"},
        {id:"pal2", day:0, p:4, code:"KMS",   qty:42, amount:0, note:"Depot to hospital campus and back", by:"00104567", onBehalf:"00104567"}
      ],
      sugs:[
        {id:"ps1", hours:2.5, day:2, p:4, why:"3 work orders closed in the maintenance log", conf:"hi", desc:"Follow-up repairs"},
        {id:"ps2", hours:1.5, day:3, p:4, why:"12 changes in the maintenance ticket system", conf:"hi", desc:"HVAC configuration"},
        {id:"ps3", hours:2, day:4, p:4, why:"4 tickets handled in Cloud ALM", conf:"mid", desc:"Post-inspection fixes"},
        {id:"ps4", hours:1, day:4, p:3, why:"Block with no attributable signal", conf:"low", desc:""}
      ]
    },
    { num:39, start:"20260921", submitted:false,
      absences:[
        {id:"pb39a", day:0, type:"Vacation", awart:"0100", hours:8, status:"pending", src:"Request 4500255"}
      ],
      rows:[],
      allow:[],
      sugs:[
        {id:"ps5", hours:2, day:1, p:4, why:"2 work orders on the maintenance calendar", conf:"hi", desc:"Facilities steering follow-up"}
      ]
    },
    { num:40, start:"20260928", submitted:false,
      absences:[
        {id:"pb40a", day:2, type:"Vacation", awart:"0100", hours:8, status:"approved", src:"Request 4500281"}
      ],
      rows:[
        {id:514, p:4, desc:"Elevator preventive maintenance", h:[4,4,0,4,4,0,0], origin:"Manual"},
        {id:515, p:5, desc:"Terminal HVAC inspection round", h:[4,4,4,4,0,0,0], origin:"Manual"}
      ],
      allow:[
        {id:"pal3", day:0, p:5, code:"TURNO", qty:1, amount:0, note:"", by:"00104567", onBehalf:"00104567"}
      ],
      sugs:[
        {id:"ps6", hours:2, day:1, p:5, why:"3 work orders closed in the maintenance log", conf:"hi", desc:"Follow-up repairs"}
      ]
    },
    { num:41, start:"20261005", submitted:false,
      absences:[],
      rows:[
        {id:516, p:4, desc:"Boiler room inspection", h:[3,0,3,0,0,0,0], origin:"Manual"},
        {id:517, p:5, desc:"Baggage handling systems check", h:[0,4,4,0,0,0,0], origin:"Suggested"}
      ],
      allow:[],
      sugs:[
        {id:"ps7", hours:1.5, day:3, p:5, why:"12 changes in the maintenance ticket system", conf:"mid", desc:"Terminal configuration"}
      ]
    }
  ];
  /* The PT02 sample rows only ever specified a duration; Z_BSRV always
     needs a start and end too, so back-fill one for every week here,
     once, rather than leaving it to whichever week happens to be loaded
     when seedClock() next runs. */
  WEEKS_PT02.forEach(function(w){ seedClockRows(w.rows); });
  /* Leave requests look ahead far more often than they look back: empty
     weeks up to the end of the year, for both companies, so a request for
     November or Christmas lands in a week the timesheet can actually show.
     Nothing recorded, nothing submitted, they only exist to be filled. */
  function extendWeeksTo(weeks, untilISO){
    var w = weeks[weeks.length - 1];
    while(w.start <= untilISO){
      w = {num:w.num + 1, start:datesFor(datesFor(w.start)[6])[1], submitted:false, absences:[], rows:[], allow:[], sugs:[]};
      weeks.push(w);
    }
  }
  /* to the end of the year, or four months past today when that's later */
  var WEEKS_UNTIL = (function(){ var four = isoAdd(todayISO(), 120); return four > "20261231" ? four : "20261231"; })();
  extendWeeksTo(WEEKS_PT01, WEEKS_UNTIL);
  extendWeeksTo(WEEKS_PT02, WEEKS_UNTIL);
  /* every line with hours has a description, internal ones included */
  var DEFAULT_DESC = {0:"Payroll go-live support", 1:"Time tracking rollout support", 2:"WFM rollout stabilization",
    3:"Internal meetings and training", 4:"Elevator preventive maintenance", 5:"Terminal HVAC inspection round"};
  WEEKS_PT01.concat(WEEKS_PT02).forEach(function(w){
    w.rows.forEach(function(r){
      var tot = r.h.reduce(function(a, b){ return a + (b || 0); }, 0);
      if(tot > 0 && String(r.desc || "").trim().length < 10) r.desc = DEFAULT_DESC[r.p] || r.desc;
    });
  });
  var WEEKS = WEEKS_PT01;
  var weekIdx = 6; // placeholder until the sample is brought up to today, then today's week
  var ABSENCES = WEEKS[weekIdx].absences;
  WORKDATES = datesFor(WEEKS[weekIdx].start);
  DAYS = daysFor(WORKDATES);

  function absOn(day, status){
    return ABSENCES.filter(function(a){ return a.day === day && (!status || a.status === status); });
  }
  function absHours(day){
    return absOn(day, "approved").reduce(function(s,a){ return s + a.hours; },0);
  }
  function capacity(day){
    if(day > 4 || holidayOn(WORKDATES[day])) return 0;
    return Math.max(0, dailyCapFor() - absHours(day));
  }
  function isBlocked(day){ return day <= 4 && capacity(day) === 0; }
  function weekCapacity(){
    var c = 0;
    for(var i=0; i<5; i++) c += capacity(i);
    return c;
  }

  /* ---------- monthly reporting, consulting only ----------
     Building Solutions stays weekly, unchanged. Consulting reports by
     calendar month, so the weekly data underneath (still one object per
     week, with its own rows/absences/allow) is grouped and shown together
     instead of navigated week by week.
     The *Of() helpers below take a week explicitly and never read the
     app's single "current week" globals - a month cell's own input handler
     always has to use the capacity/absences of the week it actually sits
     in, whichever week the rest of the app happens to be pointed at. */
  function isMonthly(){ return IT0001.bukrs === "PT01"; }
  /* A week that spans two calendar months (e.g. starts the last Monday of
     August, mostly runs into September) belongs to whichever month has
     most of its 7 days, not to the month its start date happens to fall
     in - otherwise a week that's six-sevenths September gets filed under
     August, and the September grid opens on day 7 with nothing before it. */
  function monthKeyOf(week){
    var counts = {};
    datesFor(week.start).forEach(function(d){
      var k = d.slice(0,6);
      counts[k] = (counts[k] || 0) + 1;
    });
    var best = week.start.slice(0,6), bestN = -1;
    Object.keys(counts).forEach(function(k){ if(counts[k] > bestN){ bestN = counts[k]; best = k; } });
    return best;
  }
  /* All the calendar dates of a YYYYMM month, and which week+day-index
     (into the underlying WEEKS data) each one comes from. This is the
     actual rendering unit for the monthly view - not "the weeks this
     month owns" (monthKeyOf, used only to order months for prev/next) -
     so a day from a neighbouring month never shows, and every day this
     month actually has shows, even from a week whose majority belongs
     to a different month (its non-matching days just aren't in the
     list). */
  function monthDatesFor(ym){
    var y = +ym.slice(0,4), m = +ym.slice(4,6) - 1;
    var daysInMonth = new Date(Date.UTC(y, m+1, 0)).getUTCDate();
    var out = [];
    for(var d=1; d<=daysInMonth; d++) out.push(ym + (d < 10 ? "0"+d : ""+d));
    return out;
  }
  function weekDayFor(dateISO){
    for(var i=0; i<WEEKS.length; i++){
      var idx = datesFor(WEEKS[i].start).indexOf(dateISO);
      if(idx !== -1) return {week:WEEKS[i], day:idx};
    }
    return null;
  }
  function activeMonthDates(){
    return monthDatesFor(monthKeyOf(WEEKS[weekIdx])).filter(function(d){ return weekDayFor(d); });
  }
  function touchedWeeksFor(dates){
    var seen = {}, out = [];
    dates.forEach(function(d){
      var wd = weekDayFor(d);
      if(wd && !seen[wd.week.num]){ seen[wd.week.num] = 1; out.push(wd.week); }
    });
    return out;
  }
  function activeMonthWeeks(){ return touchedWeeksFor(activeMonthDates()); }
  function absHoursOf(week, day){
    return week.absences.filter(function(a){ return a.day === day && a.status === "approved"; })
      .reduce(function(s,a){ return s + a.hours; }, 0);
  }
  function capacityOf(week, day){
    if(day > 4 || holidayOn(datesFor(week.start)[day])) return 0;
    return Math.max(0, dailyCapFor() - absHoursOf(week, day));
  }
  function isBlockedOf(week, day){ return day <= 4 && capacityOf(week, day) === 0; }
  function dayTotalOf(week, day){
    return week.rows.reduce(function(a,r){ return a + (r.h[day] || 0); }, 0);
  }
  function cellLockedOf(week, day, v){
    return week.submitted || !periodOpen(datesFor(week.start)[day]) || (isBlockedOf(week, day) && !v);
  }
  /* Points the app's single-week globals at `week`, runs fn(), restores
     them. Safe only for code that finishes before this call returns -
     never for an event handler whose closure outlives it, which is why
     month grid cells use the *Of() helpers above instead of this. */
  function withWeek(week, fn){
    var savedIdx = weekIdx, savedRows = state.rows, savedAllow = state.allow, savedSugs = state.sugs,
        savedAbs = ABSENCES, savedDates = WORKDATES, savedDays = DAYS, savedSubmitted = state.submitted;
    weekIdx = WEEKS.indexOf(week);
    ABSENCES = week.absences;
    WORKDATES = datesFor(week.start);
    DAYS = daysFor(WORKDATES);
    state.rows = week.rows;
    state.allow = week.allow || (week.allow = []);
    state.sugs = week.sugs || [];
    state.submitted = week.submitted;
    var result = fn(week);
    weekIdx = savedIdx; ABSENCES = savedAbs; WORKDATES = savedDates; DAYS = savedDays;
    state.rows = savedRows; state.allow = savedAllow; state.sugs = savedSugs; state.submitted = savedSubmitted;
    return result;
  }
  /* Only the weeks still open need to be error-free to submit the month -
     an already-submitted week (its own history, frozen before this month
     even existed as a grouping) can carry an old conflict, like hours on
     a day whose period closed after the fact, without holding the weeks
     that still need submitting hostage to it. A day-specific error whose
     date falls outside this month (a boundary week straddling two months)
     doesn't block this month either - that day belongs to the other one. */
  function monthErrors(dates){
    var out = [];
    touchedWeeksFor(dates).filter(function(w){ return !w.submitted; }).forEach(function(w){
      withWeek(w, function(){
        validate().filter(function(m){ return m.sev === "e"; }).forEach(function(m){
          if(typeof m.day === "number" && dates.indexOf(datesFor(w.start)[m.day]) === -1) return;
          m.week = w;
          out.push(m);
        });
      });
    });
    return out;
  }
  function monthCapacityTotal(dates){
    return dates.reduce(function(a,d){ var wd = weekDayFor(d); return a + (wd ? capacityOf(wd.week, wd.day) : 0); }, 0);
  }
  function monthTotalHours(dates){
    return dates.reduce(function(a,d){ var wd = weekDayFor(d); return a + (wd ? dayTotalOf(wd.week, wd.day) : 0); }, 0);
  }
  /* One logical row per project across the whole month, sourced from
     whichever weeks already have a row for it; desc is shared, taken from
     the first week that has one. Hours stay per week, read through
     monthRowIn() below - there is no merged hours array. */
  function monthProjectRows(weeks){
    var byP = {}, order = [];
    weeks.forEach(function(w){
      w.rows.forEach(function(r){
        if(!byP[r.p]){ byP[r.p] = {p:r.p, desc:r.desc || ""}; order.push(r.p); }
        else if(!byP[r.p].desc && r.desc) byP[r.p].desc = r.desc;
      });
    });
    return order.map(function(p){ return byP[p]; });
  }
  function monthRowIn(week, p){
    return week.rows.filter(function(r){ return r.p === p; })[0] || null;
  }

  /* ---------- i18n ----------
     UI chrome (static markup, KPIs/chips/counts, toasts, validation
     messages, day/month names) is translated. Mock business data
     (employee names, project names, wage types, absence reasons) stays
     as-is, same as a real SAP system where only the interface, not
     master data, is language-dependent. The Joule assistant's own chat
     messages are a separate follow-up, not covered here yet. */
  var I18N = {
    en: {
      navg_timesheet:"Timesheet",
      aria_main_nav:"Main areas",
      navg_leave:"Leave Request",
      tab_ts_mine:"My entries",
      tab_ts_team:"Team entry",
      tab_ts_approval:"Approval",
      tab_lv_mine:"My requests",
      tab_lv_teamcal:"Team calendar",
      tab_lv_approval:"Approval",
      text_sugs_none:"No suggestion applied.",
      toast_sugg_day_full:"{day} already has all its hours, the suggestion wasn't applied.",
      toast_sugg_trimmed:"{day}: only {h} h fitted, the suggestion was trimmed to that.",
      text_sugs_applied:"{n} suggestions applied.",
      text_sugs_trimmed:"{n} trimmed to the hours left in the day.",
      text_sugs_skipped:"{n} left out, the day was already full.",
      text_sug_day_full:"Day already full",
      text_sug_trimmed_short:"of {h} h, the rest doesn't fit",
      text_sug_room:"Only {h} h left on this day: it will be trimmed.",
      btn_accept:"Accept",
      btn_dismiss:"Dismiss",
      bot_desc_too_short:"The description has to have at least 10 characters: add a bit more on the card, or write it here.",
      placeholder_desc_card:"What you worked on",
      hint_desc_min:"Description required, at least 10 characters",
      bot_confirm_entry_desc:"Confirm this entry? This line still has no description: tell me what you worked on, here or on the card, and then save.",
      bot_no_profile_switch:"I can only help with your own records: your hours, your absences and what's yours to approve.",
      attach_doc_0200:"medical certificate",
      attach_doc_0210:"certificate of attendance",
      attach_doc_0400:"supporting document",
      text_required_lower:"required",
      leave_err_attachment:"The attachment ({doc}) is required for this absence type.",
      lvw_no_attachment_doc:"No attachment ({doc})",
      bot_leave_confirm_attach:"Here's the request. This absence type needs an attachment ({doc}): add it on the card and then send it. It goes to your direct manager, nothing is sent until you confirm.",
      placeholder_dmy:"DD/MM/YYYY",
      aria_pick_date:"Pick a date",
      text_submit_approvers:"Goes for approval to {names}.",
      bot_reply_lang_note:"Answering in English, the language you wrote in. The screens keep the language chosen in Settings.",
      text_leave_sub_no_ts:"Requests go to {name}, your direct manager in the org structure.",
      nav_team_calendar:"Team calendar",
      text_tc_sub:"Your colleagues' absences, approved and pending, under the same manager.",
      text_tc_sub_manager:"Your direct reports' absences, one level further down on demand, and your peers'.",
      voice_blocked_short:"Voice dictation isn't available inside this page; click to see the alternative",
      bot_voice_blocked:"Browser voice dictation needs the microphone, and the claude.ai page this mockup runs in doesn't give it that access. What works here is your system's dictation, which types straight into the box: Windows key + H on Windows, press Fn (or the globe key) twice on a Mac, or the microphone on your phone's keyboard. Opened directly in the browser, the button works in Chrome and Edge.",
      bot_voice_unsupported:"This browser has no speech recognition. Use your system's dictation, which types straight into the box: Windows key + H on Windows, Fn twice on a Mac, or the microphone on your phone's keyboard.",
      bot_voice_network:"The browser's speech service didn't answer. Try again, or use your system's dictation: Windows key + H on Windows, Fn twice on a Mac.",
      voice_err_no_mic:"No microphone found.",
      nav_leave_approval:"Leave approval",
      hdr_leave_approval:"Leave approval",
      hdr_leave_from_reports:"Requests from my direct reports",
      aria_la_filter:"Which requests to show",
      hint_bulk_leave:"Bulk approval is only for requests without warnings. A rejection needs a reason, which the employee sees.",
      lvw_overlap:"Overlaps {names}",
      lvw_balance:"Balance goes negative",
      lvw_cancel:"Cancellation of an approved absence",
      lvw_retro:"Retroactive",
      lvw_no_attachment:"No medical certificate",
      hdr_decided_group:"Decided in this session",
      text_la_none_pending:"Nothing left to approve. Choose All to see what was decided.",
      aria_select_leave_for:"Select the request of {name}",
      text_n_also_out:"{n} more out",
      text_team_complete:"team complete",
      btn_view_request:"Request details",
      view_day:"Day",
      view_week:"Week",
      view_month:"Month",
      tab_direct_reports:"My direct reports",
      tab_peers:"My peers",
      hdr_my_hierarchy:"My reporting hierarchy",
      hdr_my_colleagues:"My colleagues",
      placeholder_search_people:"Search for people",
      label_absent_n:"Absent ({n})",
      n_direct_reports_one:"1 direct report",
      n_direct_reports_other:"{n} direct reports",
      text_you_suffix:"you",
      aria_fullscreen:"Full screen",
      aria_prev_period:"Previous",
      aria_next_period:"Next",
      aria_show_person:"Show {name}'s absences", aria_expand_reports:"Show {name}'s direct reports",
      label_week_short:"Week {n}",
      text_absent_generic:"Absent",
      text_tac_nobody:"Nobody to show with these filters.",
      text_tac_privacy:"Colleagues' health related absences show only as Absent.",
      lrmap_asof:"Balance on a date",
      lrmap_holidays:"Public holidays",
      lrmap_teamcal:"Team absence calendar",
      lrmap_mass:"Approving several at once",
      lrmap_change:"Changing a pending request",
      lrmap_attach:"Attachment",
      lrmap_onbehalf:"Recorded by the manager",
      hdr_my_time_off:"My time off",
      hdr_team_time_off:"Team time off",
      kpi_absent_today:"Absent today",
      acc_vacation:"Vacation {y}",
      text_acc_available_as_of:"days available on {date}",
      acc_entitlement:"Entitlement",
      acc_taken:"Taken",
      acc_planned:"Planned",
      acc_pending:"Pending",
      acc_available:"Available",
      acc_carryover_note:"Includes {n} days carried over from {y}.",
      text_acc_after_all:"{n} days left to request once every approved and pending request is counted.",
      btn_view_movements:"View movements",
      dlg_account_title:"Vacation {y}: movements",
      mv_entitlement:"Annual entitlement",
      mv_carryover:"Carried over from {y}",
      mv_used_before:"Taken earlier in the year",
      hint_cal_pick:"Click the first and then the last day to request time off.",
      hint_cal_pick_end:"From {date}: now click the last day (the same one for a single day).",
      legend_approved:"Approved",
      legend_pending:"Pending approval",
      legend_cancel:"Cancellation pending",
      legend_holiday:"Public holiday or weekend",
      legend_holiday_weekend:"Public holiday or weekend",
      legend_team:"Colleagues absent",
      text_no_requests_filter:"Nothing to show here.",
      btn_edit:"Edit",
      wf_submitted:"Sent by {name}",
      wf_onbehalf:"Recorded by {name} on behalf of the employee, approved on recording",
      wf_changed:"Changed by the employee",
      wf_waiting:"Waiting for approval by {name}",
      wf_approved:"Approved by {name}",
      wf_rejected:"Rejected by {name}",
      wf_withdrawn:"Withdrawn by the employee",
      wf_cancel_waiting:"Cancellation waiting for {name}",
      wf_cancelled:"Cancellation approved by {name}",
      wf_posted:"Recorded in the time data",
      dlg_leave_detail:"Leave request {id}",
      n_holidays_skipped_one:"1 public holiday not deducted",
      n_holidays_skipped_other:"{n} public holidays not deducted",
      label_attachment:"Attachment",
      hint_attach_required:"medical certificate",
      hint_attach_optional:"optional, for example a certificate of attendance",
      text_attach_local:"In this mockup only the file name is kept, the file stays on your computer.",
      toast_attached:"{file} attached to request {id}.",
      label_manager_comment:"Manager's comment",
      hdr_workflow:"Approval workflow",
      hdr_also_absent:"Also absent in this period",
      text_nobody_else:"Nobody else in the team.",
      btn_approve_selected_n:"Approve selected ({n})",
      n_leave_approved_one:"1 leave request approved.",
      n_leave_approved_other:"{n} leave requests approved.",
      filter_all_types:"All types",
      th_team_member:"Team member",
      btn_record_leave:"Record absence",
      dlg_edit_leave:"Change request {id}",
      dlg_leave_for:"Absence for {name}",
      btn_save_changes:"Send changes",
      text_balance_now_after:"Balance {now} days, {n} after this request",
      text_onbehalf_note:"Approved as it's recorded, since the approval is yours",
      text_also_absent_short:"Also absent: {list}",
      toast_leave_changed:"Request {id} changed, it goes back to {name} for approval.",
      toast_leave_onbehalf:"Absence recorded for {name} and approved.",
      leave_warn_attachment:"Attach the medical certificate. You can also do it later, in the request's details.",
      aria_prev_month:"Previous month",
      aria_next_month:"Next month",
      hdr_time_accounts:"Time accounts",
      label_balance_as_of:"Balance on",
      hdr_my_calendar:"My calendar",
      label_show_team:"Show my team's absences",
      btn_today:"Today",
      filter_upcoming:"Upcoming",
      filter_history:"History",
      filter_approved:"Approved",
      hdr_team_calendar:"Team absence calendar",
      hdr_team_balances:"Team vacation balances",
      th_date:"Date",
      th_movement:"Movement",
      th_days:"Days",
      bot_lang_followed:"Switched to English, the language you're writing in. You can change it in Settings.",
      chip_not_your_project:"{code} isn't one of your projects",
      bot_which_project_for:"Which project should the {dur} h on {when} go to?",
      bot_which_project_fill:"Which project should the missing hours go to?",
      bot_project_not_allocated:"You're not allocated to {code}, so I can't record hours there. Your projects are {list}.",
      text_every_weekday:"every working day this week",
      text_days_missing:"the days missing hours",
      bot_day_outside_week:"That day isn't in the week on screen. Open its week in My Timesheet, or tell me a day of this week.",
      wt_AJC_NAC:"Domestic per diem",
      wt_AJC_INT:"Foreign per diem",
      wt_KMS:"Own-car kilometres",
      wt_TURNO:"Shift allowance",
      wt_BONUS:"Project bonus",
      label_route:"Route",
      label_road_distance:"Road distance",
      label_to_record:"To record",
      label_trip_from:"From",
      label_destination:"To",
      label_round_trip:"Round trip",
      label_office_base:"{city} (office)",
      km_one_way:"one way",
      km_round_trip:"round trip",
      km_per_leg:"{km} km each way",
      km_estimated:"(estimate from the map)",
      bot_km_confirm:"Here are the kilometres. I worked out the distance between the two places; check it before I record it.",
      bot_km_confirm_given:"Here are the kilometres you gave me. I don't have the distance for that route, so check the figure before I record it.",
      bot_km_recorded:"Recorded {km} km on {day}, {route}, project {code}. It's in the week's allowances.",
      bot_km_which_route:"Between which places? For example: km from Lisbon to Porto yesterday.",
      bot_km_unknown_place:"I don't have the distance to {place} in this mockup. Tell me the kilometres (for example, 120 km) and I'll record them with that route.",
      bot_km_future:"Kilometres are recorded after the trip, and {date} hasn't come yet.",
      bot_km_no_week:"{date} is outside the weeks available in the timesheet.",
      bot_km_week_submitted:"The week of {date} has already been submitted, so no more allowances can go in.",
      bot_km_period_closed:"The period for {date} is closed, so no more allowances can go in.",
      bot_km_not_in_profile:"You have no projects to record kilometres against.",
      warn_km_differs:"You said {given} km; the distance worked out is {calc} km. I'll keep your figure.",
      chip_km_round:"Round trip",
      chip_km_one_way:"One way only",
      chip_km_example:"km from Lisbon to Porto yesterday",
      hint_km_route:"{route}: {km} km by road each way, {total} km to record.",
      hint_km_unknown:"No distance for this route in the mockup: enter the kilometres.",
      hint_km_enter_route:"Enter where the trip started and ended to work out the distance.",
      toast_km_route_needed:"Enter where the trip started and ended.",
      label_approval_week:"Timesheet approval, week {n}",
      label_approval_month:"Timesheet approval, {month}",
      ap_week_chip:"Wk {n} · {from} to {to} · {h}/{exp} h",
      text_approval_monthly:"In Consulting hours are approved by month, the same period the timesheet shows.",
      text_approval_weekly:"In Building Solutions hours are approved by week, the same period the timesheet shows.",
      label_you:"you",
      filter_pending:"To approve", filter_all:"All", aria_ap_filter:"Which timesheets to show", text_ap_none_pending:"Nothing left to approve. Choose All to see the approved ones.", btn_select_clean_one:"Select the {n} without warnings", btn_select_clean_other:"Select the {n} without warnings",
      settings_reference:"Technical reference", btn_open_mapping:"Open the SAP mapping", text_mapping_hint:"Field by field, what each screen writes to CATS and to the standard Leave Request, with the records and payloads generated live.",
      label_test:"Test", aria_change_test:"Change the test: company and profile",
      profile_employee:"Employee", profile_pm:"Project manager", profile_manager:"Line manager",
      setup_title:"What are you testing?", setup_language:"Language", setup_company:"Company", setup_profile:"Profile", setup_leader:"Project and manager",
      setup_intro:"Choose the company and the profile. You can change both at any time with the Test button at the top. What you record stays, so a request sent as the employee can be approved as the line manager.",
      setup_co_hint_pt01:"Consulting. Profile Z_CONS: hours are recorded as a duration, month by month.",
      setup_co_hint_pt02:"Building Solutions. Profile Z_BSRV: hours are recorded with a start and an end time, week by week.",
      setup_employee_desc:"Records their own time and requests absences.",
      setup_pm_desc:"Records their own time and the project team's, and approves the team's timesheets.",
      setup_manager_desc:"Approves the absence requests of their direct reports, from the org structure.",
      btn_start_test:"Start",
      text_approval_sub_pm:"Timesheets of the people allocated to {projects}, the projects you own. Approval follows project ownership, not the org structure.",
      bot_greeting_pm:"Hi {name}! You're the project manager of {projects}. I can record your own hours, record hours or allowances for the team (you included), fill in the days still missing, and approve the timesheets.",
      bot_alert_ts_pm_one:"You have {n} timesheet to approve, {x} with exceptions.", bot_alert_ts_pm_other:"You have {n} timesheets to approve, {x} with exceptions.",
      bot_ts_only_pm:"Timesheets are approved by the project manager, the person responsible for the project.",
      bot_team_only_pm:"Entering time for the team is done by the project manager.",
      bot_screen_not_in_profile:"{screen} isn't available to you.",
      chip_change_test:"Change test", bot_setup_opened:"Choose the new test in the window that just opened.",
      bot_test_changed:"Test changed: {co}, {profile}, {name}.",
      hdr_home_team_week:"Team {project}", btn_open_team:"Open team entry",
      text_acting_as_pm:"Acting as {name}, project manager of {projects}. Change it with the Test button at the top.",
      chip_conversation_log:"Learning mode", title_conversation_log:"This conversation is saved in the artifact so the assistant can be improved. Mockup data only.",
      fb_helpful:"Helpful", fb_not_helpful:"Not helpful", fb_placeholder:"What should it have done?", fb_send:"Send", fb_thanks:"Thanks", fb_noted:"Noted, it will be looked at in the next round of improvements.",
      /* Leave Request and the assistant as the entry point */
      nav_home:"Assistant", nav_leave:"Leave Request", label_view_as:"View as", aria_view_as:"View the app as the employee or as their direct manager",
      role_employee:"Employee", role_manager:"Direct manager",
      abs_0100:"Vacation", abs_0210:"Medical appointment", abs_0200:"Sick leave", abs_0300:"Training", abs_0400:"Justified absence",
      leave_range:"{from} to {to}", leave_time_range:"{b} to {e}",
      n_workdays_one:"{n} working day", n_workdays_other:"{n} working days",
      n_requests_one:"{n} request", n_requests_other:"{n} requests",
      lr_status_sent:"Pending approval", lr_status_approved:"Approved", lr_status_posted:"Approved, recorded",
      lr_status_rejected:"Rejected", lr_status_withdrawn:"Withdrawn", lr_status_cancel_requested:"Cancellation pending",
      leave_err_type:"Choose the absence type.", leave_err_dates:"Fill in the start and end dates.", leave_err_order:"The end date is before the start date.",
      leave_err_no_workdays:"The period has no working days.", leave_err_partial_type:"{type} can only be requested for whole days.",
      leave_err_partial_one_day:"Part of the day only applies to a single day.", leave_err_times:"Fill in a start and an end time, with the end after the start.",
      leave_err_hours:"Fill in how many hours.", leave_err_hours_full:"{cap} h or more is the whole day, untick part of the day.",
      leave_err_overlap:"Overlaps your request {id} ({period}).", leave_err_period_closed:"The period is closed for one or more of these days. Reopening is an HR action.",
      leave_err_quota:"Not enough vacation balance: {n} days requested, {avail} available.",
      leave_warn_hours:"You already have {h} h recorded on {days}. If the request is approved, those hours conflict and you'll be asked to move them.",
      leave_info_outside_sample:"Some days fall outside the sample weeks, they're kept in the request but don't show in the timesheet.",
      leave_info_retroactive:"Retroactive request, it starts in the past.",
      hdr_leave_request:"My leave requests", hdr_leave_to_approve:"Leave requests to approve", hdr_my_leave_requests:"My leave requests",
      text_leave_sub:"Requests go to {name}, your direct manager in the org structure. Approved and pending requests appear in your timesheet automatically.",
      text_leave_sub_manager:"Requests from {name}'s direct reports, in the org structure. Approving puts the absence in the employee's timesheet straight away.",
      kpi_leave_pending:"Pending", kpi_leave_soon:"Starting within 14 days", kpi_leave_days_requested:"Days requested", unit_days:"days",
      kpi_vacation_available:"Vacation available", kpi_vacation_entitlement:"Entitlement {y}", kpi_vacation_taken:"Taken", kpi_vacation_requested:"Requested, pending",
      origin_joule_short:"via assistant", btn_withdraw:"Withdraw", btn_request_cancel:"Request cancellation",
      toast_leave_withdrawn:"Request {id} withdrawn. It no longer shows in the timesheet.",
      toast_leave_cancel_requested:"Cancellation of {id} sent to {name}. The absence stays until it's approved.",
      toast_leave_sent:"Request {id} sent to {name}. It already shows in your timesheet as pending.",
      toast_leave_approved:"{name}'s request {id} approved.", toast_leave_rejected:"{name}'s request {id} rejected.",
      toast_leave_cancel_approved:"Cancellation of {name}'s request {id} approved.",
      text_leave_queue_empty:"Nothing waiting for approval.", text_starts_today_or_past:"Starts today or already started",
      text_starts_in_days_one:"Starts in {n} day", text_starts_in_days_other:"Starts in {n} days",
      text_no_overlap:"No overlap", text_overlaps_n:"{n} overlap(s) in the team", text_cancellation:"Cancellation",
      btn_reject:"Reject", chip_rejected:"Rejected", text_balance_after:"Balance after: {n} days", text_approver:"Approver: {name}",
      text_pending_short:"pending", text_home_week_total:"Recorded {tot} h of {exp} h expected, absences already deducted.",
      btn_open_timesheet:"Open the full timesheet", hdr_home_leave:"Absences", text_vacation_available:"{n} vacation days available",
      text_no_upcoming_leave:"No upcoming absences or pending requests.", btn_new_leave:"New leave request", btn_open_leave:"Open Leave Request",
      hdr_home_to_approve:"To approve: leave requests", text_now:"now", text_in_days_one:"in {n} day", text_in_days_other:"in {n} days",
      btn_open_leave_approvals:"Open leave approvals", hdr_home_timesheets:"To approve: timesheets",
      text_home_ts_pending:"{n} timesheets waiting, {x} with exceptions that need a closer look.", btn_open_ts_approvals:"Open timesheet approval",
      hdr_home_team_away:"Team away, next 60 days", text_nobody_away:"Nobody in the team has approved absences coming up.",
      text_acting_as_manager:"Acting as {name}, direct manager in the org structure. Change it with the Test button at the top.",
      chip_lr_standard:"Standard Leave Request, PTARQ", chip_my_inbox:"Decision through My Inbox, TASKPROCESSING",
      th_request:"Request", th_type:"Type", th_period:"Period", th_duration:"Duration", th_approver:"Approver",
      th_balance_after:"Balance after", th_overlap:"Team overlap", th_decision:"Decision", th_when:"When",
      privacy_leave_sync:"Requests go through the standard Leave Request service and its approval workflow, never through the timesheet. As soon as a request is sent it shows in the timesheet as pending, which warns without blocking. Once approved it closes the day, or reduces its capacity for part of the day. Rejected or withdrawn, it disappears.",
      hdr_leave_decided:"Decided in this session",
      dlg_new_leave_title:"New leave request", label_absence_type:"Absence type", label_from:"From", label_to:"To",
      label_partial_day:"Part of the day", label_hours:"Hours", placeholder_leave_note:"Optional, the manager sees it",
      btn_send_request:"Send request", dlg_reject_title:"Reject leave request", placeholder_reject_reason:"Required, the employee sees it",
      label_period:"Period", label_balance_after:"Balance after", label_approver:"Approver", label_service:"Standard service",
      placeholder_chat_home:"2h BNK payroll testing yesterday, or vacation 3 to 6 Nov",
      jfoot_text_home:"Never saves or sends without confirmation. What's created here is marked with origin <span class=\"num\">Joule</span> and goes through the same validations as the screens.",
      spec_e15:"Leave request and approval, a mask over the standard service", spec_e16:"Assistant as the entry point, with the data as a secondary view",
      hdr_lr_mapping:"Leave Request, standard PTARQ", chip_lr_service:"HCMFAB_LEAVE_REQUEST_CR_SRV",
      lr_step_sent:"Sent", lr_step_sent_sub:"PTREQ_HEADER, SENT", lr_step_approved:"Approved", lr_step_approved_sub:"WS12300111, My Inbox",
      lr_step_posted:"Posted", lr_step_posted_sub:"RPTARQPOST, IT2001", lr_step_read:"In the timesheet", lr_step_read_sub:"capacity, CATS",
      lr_rule_1:"The application only creates, reads and withdraws through the standard service. There is no absence logic here, no table written directly, and no second approval process.",
      lr_rule_2:"A request appears in the timesheet as soon as it's sent, as pending. On approval it closes the day or reduces its capacity, before RPTARQPOST runs, so a same-day approval isn't missed.",
      lr_rule_3:"Cancelling an approved request is itself a request, decided by the same manager in the same workflow step, as in the standard.",
      hdr_lr_fields:"Leave Request field by field", hdr_lr_payload:"Last request sent, as the standard service receives it",
      text_lr_payload_empty:"Send a request, from the assistant or the Leave Request screen, to see the payload here.",
      hint_lr_fields:"Entity and field names follow the standard HCM Fiori apps bundle service. Confirm them against the client system's $metadata before development.",
      lrmap_type:"Absence type", lrmap_dates:"From and to", lrmap_partial:"Part of the day", lrmap_note:"Note to the manager",
      lrmap_status:"Request status", lrmap_approver:"Approver", lrmap_balance:"Vacation balance", lrmap_decision:"Approve or reject",
      lrmap_posting:"Posting", lrmap_timesheet:"Absence in the timesheet", lrmap_withdraw:"Withdraw or cancel", lrmap_origin:"Created by the assistant",
      bot_leave_cant:"I can't send that request yet: {reason}", chip_my_leave:"My leave requests", chip_leave_form:"Open the request form",
      bot_leave_confirm:"Here's the request. It goes to your direct manager for approval, nothing is sent until you confirm.",
      bot_leave_sent:"Sent. Request {id} is with {name} for approval, and it already shows in your timesheet as pending.",
      bot_leave_list_intro:"Your upcoming and pending requests. You have {avail} vacation days available, plus {req} requested and waiting for approval.",
      chip_request_vacation:"Request vacation",
      bot_leave_balance:"Vacation {y}: {total} days of entitlement, {used} taken and {req} requested and waiting. You can still request {avail} days.",
      bot_leave_nothing_to_cancel:"You have no request that can be cancelled.", bot_leave_which_cancel:"Which one? Tell me the request number or a date it covers.",
      bot_leave_cannot_cancel:"Request {id} is {status}, it can't be cancelled from here.",
      bot_leave_confirm_withdraw:"Withdraw request {id}? It's still waiting, so it goes away straight away, from the timesheet too.",
      bot_leave_confirm_cancel:"Request {id} is already approved. Cancelling it goes back to your manager for approval, as in the standard. Ask for the cancellation?",
      bot_leave_withdrawn:"Request {id} withdrawn. The timesheet no longer shows it.",
      bot_leave_cancel_requested:"Cancellation of {id} sent to {name}. Until it's approved, the absence stays in the timesheet.",
      bot_nothing_pending:"Nothing waiting for you right now.",
      bot_alert_leave_one:"You have {n} leave request to approve.", bot_alert_leave_other:"You have {n} leave requests to approve.",
      when_today:"starting today", when_past:"already in the past", when_in_days_one:"starting in {n} day", when_in_days_other:"starting in {n} days",
      bot_notice_conflict:"You had {h} h recorded on {days}, they now conflict with the absence: open the timesheet to move them.",
      bot_alert_soonest:"The nearest is {name}, {type}, {when}.",
      bot_alert_ts_one:"And {n} timesheet waiting, {x} with exceptions.", bot_alert_ts_other:"And {n} timesheets waiting, {x} with exceptions.",
      chip_pending_approvals:"What do I have to approve?", chip_approve_leave_of:"Approve {name}'s leave request", chip_approve_ts_of:"Approve {name}'s timesheet",
      chip_approve_clean_ts:"Approve all timesheets without exceptions", chip_view_as_employee:"View as employee", chip_view_as_manager:"View as manager",
      bot_leave_only_manager:"Leave requests are approved by the direct manager ({name}).",
      bot_leave_decide_who:"Whose request? Tell me the name or the request number, or say all.",
      bot_leave_reason_needed:"What's the reason for rejecting {name}'s request? The employee will see it.",
      bot_leave_overlap_warn:"Overlaps in the team: {list}.",
      bot_leave_confirm_approve_one:"Approve this request?", bot_leave_confirm_approve_other:"Approve these {n} requests?",
      bot_leave_confirm_reject:"Reject with this reason?",
      bot_leave_approved_msg_one:"Approved. It's already in the employee's timesheet as an approved absence.",
      bot_leave_approved_msg_other:"Done, {n} approved. Each one is already in the employee's timesheet as an approved absence.",
      bot_leave_rejected_msg:"Rejected. {name} sees the reason in the request.",
      bot_leave_remaining_one:"{n} left in your inbox.", bot_leave_remaining_other:"{n} left in your inbox.", bot_leave_inbox_empty:"Your inbox is empty.",
      bot_greeting_home:"Hi {name}! This is where you record time and absences. Tell me what you worked on, or ask for a day off, and I'll prepare it for you to confirm. Your week and your absences stay on this screen, updated as we go.",
      bot_greeting_manager:"Hi {name}!",
      bot_now_manager:"You're now seeing the app as {name}, direct manager.", bot_now_employee:"Back as {name}.",
      bot_notice_approved:"Good news: {name} approved your request {id} ({period}). It's already in your timesheet.",
      bot_notice_rejected:"{name} rejected your request {id} ({period}). Reason: {reason}",
      bot_notice_cancel_approved:"{name} approved the cancellation of {id}. The absence is gone from your timesheet.",
      bot_notice_cancel_rejected:"{name} didn't approve the cancellation of {id}, the absence stays. Reason: {reason}",
      bot_leave_which_type:"What kind of absence?", bot_leave_when:"For which days is the {type}? For example 3 to 7 November, or tomorrow afternoon.",
      chip_leave_tomorrow:"Tomorrow", chip_leave_next_week:"Next week", bot_leave_form_opened:"Here's the form, already filled with what you told me.",
      bot_leave_ambiguous:"{name} has a leave request and a timesheet waiting. Which one?",
      bot_leave_need_more:"I need the type of absence and the dates.",
      bot_help_text_home:"A few things I can do: log your hours (<span class=\"num\">2h BNK payroll testing yesterday</span>), request an absence (<span class=\"num\">vacation 3 to 6 November</span>, <span class=\"num\">doctor tomorrow 14h to 17h</span>), record kilometres with the distance worked out (<span class=\"num\">km from Lisbon to Porto yesterday</span>), check, change or cancel your requests, your vacation balance on any date and its movements, tell you who approves, what blocks a submission, the public holidays and who's off in your team, fill in your missing hours, check the week, submit it, and, as a manager, see what's waiting and approve or reject. Just say it in plain language.",
      brand_title:"Time Recording", brand_subtitle:"Fiori Prototype",
      capture_on:"Suggestions on, private timeline", capture_off:"Capture paused",
      aria_it0001:"Company of the employee, from IT0001",
      aria_project_billing:"Project to bill and staff team entries for", aria_leader_scope:"Leader and scope",
      aria_mass_entry_section:"Team entry section",
      label_week_n:"Week {n}, {range} {y}", label_range_same_month:"{d1} to {d2} {month}", label_range_diff_month:"{d1} {m1} to {d2} {m2}",
      status_approved:"Approved", status_pending:"Pending request",
      dlg_new_entry_title:"New entry", origin_suggested:"Suggested", origin_copied:"Copied",
      dlg_submit_month_title:"Submit {month} {y}", dlg_submit_week_title:"Submit week {n}",
      ui_undo:"Undo", ui_resolve:"Resolve", ui_reopen:"Reopen",
      toast_bad_duration:"Couldn't read “{v}”. Use 1.5, 1:30 or 90m.",
      toast_only_available:" Only {left} h available.", toast_no_hours_available:" No hours available on this day.",
      toast_bad_clock:"Couldn't read “{v}”. Use 08:00 or 8.",
      toast_row_removed:"Row removed.",
      toast_month_submitted_no_rows:"This month is already submitted, no more rows can be added.",
      toast_all_projects_used_month:"Every project available to this company already has a row this month.",
      toast_no_earlier_months:"No earlier sample months.", toast_no_later_months:"No later sample months.",
      toast_sugg_blocked_absence:"{day} has an approved absence, the suggestion can't be applied.",
      toast_suggestion_accepted:"Suggestion accepted on {day}.",
      toast_suggestion_dismissed:"Suggestion dismissed. The pattern won't be proposed again.",
      toast_absence_approved_conflict:"Absence approved on {day}. The {h} h recorded that day are now in conflict.",
      toast_absence_approved_no_conflict:"Absence approved on {day}. The day is no longer available for time entry.",
      toast_hours_moved:"{h} h moved from {from} to {to}.",
      toast_hours_removed_no_capacity:"{h} h removed from {day}, no day had free capacity.",
      toast_allowance_removed:"{name} removed.",
      toast_week_submitted_no_allow_change:"The week is submitted, allowances can't be changed.",
      toast_week_closed_period:"This week falls in a closed period.",
      toast_qty_must_be_positive:"The quantity needs to be a number above zero.",
      toast_allowance_recorded:"{name} recorded on {day}.",
      toast_bad_number:"Couldn't read “{v}”.",
      toast_capacity_on_day:"{name}'s capacity is {cap} h on {day}.",
      toast_select_person_first:"Select at least one person first.",
      toast_give_duration_or_clock:"Give a duration, or a start and end time.",
      toast_pick_a_day:"Pick at least one day.",
      toast_cells_filled:"{n} cells filled for {people} people. Nothing is saved yet, review the grid first.",
      cells_skipped_field_one:" {n} cell skipped, needs the other field for that profile.",
      cells_skipped_field_other:" {n} cells skipped, needs the other field for that profile.",
      cells_skipped_capacity_one:" {n} cell skipped, over that person's daily capacity.",
      cells_skipped_capacity_other:" {n} cells skipped, over that person's daily capacity.",
      toast_team_entries_partial:"{saved} entries recorded for {who}. {left} on screen with the reason.",
      toast_team_entries_all:"{saved} entries recorded for {who}, on their behalf.",
      toast_team_entries_none:"Nothing was recorded. Every line has a reason next to it.",
      toast_give_qty_positive:"Give a quantity above zero.",
      toast_note_required_for:"{note} is required for {name}.",
      allow_lines_staged_one:"{n} allowance line staged for {people} people. Nothing is saved yet.",
      allow_lines_staged_other:"{n} allowance lines staged for {people} people. Nothing is saved yet.",
      toast_allow_skipped_company:" {n} skipped, the shift allowance doesn't apply to their company.",
      toast_allow_skipped_project:" {n} skipped, not allocated to {code}.",
      toast_nothing_staged:"Nothing staged.",
      allow_lines_recorded_one:"{n} allowance line recorded, on their behalf.",
      allow_lines_recorded_other:"{n} allowance lines recorded, on their behalf.",
      toast_nothing_to_save:"Nothing to save.", toast_changes_saved:"Changes saved.",
      toast_amount_must_be_positive:"The amount needs to be a number above zero.",
      toast_bonus_reason_required:"The bonus needs a reason. It is the only trace of why the project carried this cost.",
      toast_none_allocated:"None of the selected people are allocated to {code}.",
      toast_bonus_recorded:"{amount} EUR bonus recorded for {names}, approved in the same act.",
      toast_bonus_none_recorded:"Nothing was actually recorded.",
      toast_bonus_skipped_ineligible:" {names} skipped, not allocated to {code}.",
      toast_bonus_skipped_closed:" {names} skipped, every day this week falls in a closed period.",
      toast_week_submitted_no_rows:"This week is already submitted, no more rows can be added.",
      toast_all_projects_used_week:"Every project available to this company already has a row this week.",
      toast_copy_week_done:"Previous week's structure copied, without durations. {n} new rows.",
      toast_copy_week_none:"All of last week's rows are already present.",
      toast_no_earlier_weeks:"No earlier sample weeks.", toast_no_later_weeks:"No later sample weeks.",
      toast_template_applied:"Allocation template applied to working days.",
      toast_it0001_changed:"IT0001 now reads {bukrs}. ZTIME_COMPANY_CFG maps it to {code}: {fields}.",
      toast_week_submitted_locked:"The week is submitted, it can't be changed.",
      toast_day_absence_blocked:"{day} has an approved absence, doesn't accept time entries.",
      toast_day_closed_period:"{day} falls in a closed period, it can't take new hours.",
      toast_hours_recorded:"{h} h recorded in {code}, {day}.",
      toast_entry_added:"Entry added.",
      toast_row_exists_week:"{code} already has a row this week. Remove or merge it first.",
      toast_entry_updated:"Entry updated.",
      toast_row_exists_month:"{code} already has a row this month. Remove or merge it first.",
      weeks_submitted_approval_one:"{n} week submitted for approval.",
      weeks_submitted_approval_other:"{n} weeks submitted for approval.",
      toast_week_submitted_approval:"Week {n} submitted for approval.",
      toast_high_conf_applied:"{n} high-confidence suggestions applied. Medium and low confidence ones are still to review.",
      toast_timeline_deleted:"Raw timeline deleted. Pending suggestions disappeared with it.",
      toast_timesheets_approved:"{n} timesheets approved in a single call. Exceptions remain for review.",
      toast_voice_error:"Voice input error: {err}",
      toast_staged_entries_cleared:"Staged entries cleared. Nothing had been saved.",
      toast_staged_allow_cleared:"Staged allowances cleared. Nothing had been saved.",
      val_day_exceeds_24h:"The total for {day} exceeds 24 hours.",
      val_desc_required:"Every entry needs a description (at least 10 characters): {code}.",
      val_absence_move_hours:"{day} has an approved {type}. The {h} h recorded need to move off this day.",
      val_partial_absence_capacity:"{day} has an approved partial absence. Day capacity is {cap} h and {tot} h are recorded.",
      val_day_capacity:"{day}'s capacity is {cap} h; {tot} h are recorded.",
      val_pending_leave_conflict:"{day} has a pending leave request and recorded hours. If the request is approved, these hours will conflict.",
      val_day_empty:"{day} is empty.",
      val_week_below_expected:"The week has {tot} h recorded; the expected total with absences deducted is {expect} h.",
      val_closed_period:"{day} falls in period {ym}, closed for {bukrs}. Reopening is an HR action.",
      val_overlapping_windows:"{day} has overlapping time windows: {t1} to {t2} and {t3} to {t4}.",
      val_window_needs_both:"{day}, {code}: the window needs both a start and an end.",
      val_allow_note_needed:"{name} on {day} needs {noteLabel}.",
      val_allow_closed_period:"{name} on {day} falls in a closed period.",
      val_allow_no_amount:"{name} on {day} has no amount.",
      val_allow_no_qty:"{name} on {day} has no quantity.",
      n_suggestions_to_review2_one:"{n} suggestion still to review in the side panel.",
      n_suggestions_to_review2_other:"{n} suggestions still to review in the side panel.",
      suggestions_discarded_one:"{n} suggestion discarded for falling on days with an approved absence.",
      suggestions_discarded_other:"{n} suggestions discarded for falling on days with an approved absence.",
      th_project_wbs_activity:"Project, WBS and activity", row_total_per_day:"Total per day", btn_remove:"Remove",
      tip_approved_partial_absence:"Approved partial absence, capacity of {h} h this day",
      btn_copy_last_week:"Copy last week", btn_add_first_project:"Add the first project",
      btn_resume_suggestions:"Resume suggestions", btn_simulate_approval:"Simulate approval",
      tip_bonus_remove_restricted:"The bonus is removed by the project owner, on the team screen.",
      text_no_records_to_generate:"No hours and no allowances this week, so there are no records to generate.",
      voice_not_supported:"Voice input not supported in this browser",
      tip_absence_not_available:"Approved {type}, day not available for time entry",
      text_desc_required:"Description required", text_no_description:"No description",
      aria_remove_row:"Remove row {name}",
      tip_period_closed:"Period {ym} is closed for {bukrs}. Reopening is an HR action.",
      placeholder_desc_required_once:"Description (required once hours are logged)", placeholder_description_short:"Description",
      text_absence_generic:"absence",
      tip_approved_type:"Approved {type}", aria_select_name:"Select {name}",
      hdr_no_warnings_group:"No warnings, bulk approval available", hdr_exceptions_group:"Exceptions, need individual review",
      aria_select_timesheet_for:"Select timesheet for {name}",
      tip_clock_use_fields:"Z_BSRV records start and end. Use the Start/End fields above, for the people this applies to.",
      tip_closed_period_short:"Closed period",
      tip_week_submitted_n:"Week {n} was already submitted, not editable.", tip_approved_abs:"Approved {type}",
      aria_dur_cell:"Duration in hours, {proj}, {day}", aria_desc_cell:"Description, {proj}", aria_team_hours:"Hours for {name}, {day}",
      text_sugs_none_absence:"Nothing to propose. The suggestions that existed fell on days with an approved absence.",
      text_sugs_none_pending:"No pending suggestions. Good sign, the week is reviewed.",
      text_bonus_catsamount:"Amount goes to CATSAMOUNT, native CATSDB field. ANZHL goes to CATS as 1.",
      text_bonus_defined_by:"Defined and approved by {name}, in the same act",
      aria_voice_lang:"Voice input language: {lang}. Click to switch to {next}.", voice_lang_PT:"Portuguese", voice_lang_EN:"English", voice_lang_FR:"French",
      aria_start_time_for:"Start time, {name}, {day}", aria_end_time_for:"End time, {name}, {day}",
      sev_error:"ERROR", sev_warning:"WARNING", sev_info:"INFO",
      text_no_allowances_week:"No allowances recorded this week. Per diems, kilometres and shift allowances are recorded here, against a project and a date.",
      text_wage_type_label:"wage type {code}",
      text_recorded_by_behalf:"Recorded by {name}, on behalf of the employee",
      hint_allow_wage_type:"Wage type {code}, quantity in ANZHL, unit {unit}. No value is calculated here, payroll values it.",
      text_nothing_staged_yet:"Nothing staged yet.",
      text_nothing_recorded_behalf_week:"Nothing recorded on behalf of the team yet, this week.",
      text_no_bonus_recorded:"No bonus recorded on this project yet.",
      label_month_total:"Month total", label_week_total:"Week total",
      n_warnings_no_block_one:"{n} warning, they don't block submission", n_warnings_no_block_other:"{n} warnings, they don't block submission",
      label_deviation_justification:"Justification for the deviation from the expected total",
      placeholder_justification_month:"One line is enough. Stays in the month's history.",
      text_h_in_project:"{h} h in project", chip_warning_lower:"warning",
      msg_day_approved_type:"{day} has an approved {type}.", msg_day_capacity_simple:"{day}'s capacity is {cap} h.",
      badge_half_day:"half day",
      text_no_hours_week_yet:"No hours recorded this week yet.", text_no_hours_month_yet:"No hours recorded this month yet.",
      text_shortest_path:"Start with the shortest path.",
      conf_hi:"high confidence", conf_mid:"medium confidence", conf_low:"low confidence",
      tip_save_to_finish:"This already applies here; Save still reflects it in the database.",
      placeholder_justification_week:"One line is enough. Stays in the week's history.",
      chip_approved:"Approved",
      note_pending_leave_conflict:"Pending leave request overlaps recorded hours", note_two_empty_days:"Two empty working days",
      val_week_label_prefix:"Week {n}: {txt}", val_weeks_label_prefix:"Weeks {n}: {txt}",
      link_resolve_move_hours:"resolve, move the hours", link_go_to_day:"go to day",
      btn_shortcuts:"Shortcuts", aria_shortcuts:"Keyboard shortcuts",
      btn_settings:"Settings", aria_settings:"Language settings",
      nav_my_timesheet:"My Timesheet", nav_team:"Team entry",
      nav_approval:"Approval (manager)", nav_cats:"CATS mapping",
      aria_prev_week:"Previous week", aria_next_week:"Next week",
      state_draft:"Draft", state_in_approval:"In approval, read-only",
      btn_quick_add:"Quick add", btn_submit_week:"Submit week", btn_save:"Save",
      kpi_recorded:"Recorded", kpi_in_project:"In project", kpi_validation:"Validation",
      val_no_errors:"No errors",
      n_errors_one:"{n} error", n_errors_other:"{n} errors",
      n_messages_one:"{n} message", n_messages_other:"{n} messages",
      n_weeks_one:"{n} week", n_weeks_other:"{n} weeks",
      n_empty_days_one:"{n} empty working day", n_empty_days_other:"{n} empty working days",
      n_allowances_one:"{n} allowance", n_allowances_other:"{n} allowances",
      n_records_generated_one:"{n} record generated", n_records_generated_other:"{n} records generated",
      n_lines_left_one:"{n} line stayed", n_lines_left_other:"{n} lines stayed",
      err_mass_locked:"Week already approved, the line was left untouched.", err_mass_not_allocated:"{name} is not allocated to {code}.", err_mass_absence:"{day} has an approved {type}.",
      err_mass_closed:"{day} falls in a closed period.", err_mass_24h:"{day} is above 24 hours.", err_mass_capacity:"{day}'s capacity is {cap} h for {name}.", err_mass_window:"{day} needs both a start and an end for {name}.",
      n_people_one:"{n} person", n_people_other:"{n} people",
      n_entries_one:"{n} entry", n_entries_other:"{n} entries",
      n_suggestions_review_one:"{n} suggestion to review", n_suggestions_review_other:"{n} suggestions to review",
      btn_submit_month:"Submit month", btn_month_submitted:"Month submitted",
      btn_week_submitted:"Week submitted", chip_in_approval:"In approval",
      kextra_absences:"{h} h absences deducted", kextra_month_prefix:"{weeks} this month",
      n_selected_one:"{n} selected", n_selected_other:"{n} selected",
      lines_staged_suffix_one:"line staged", lines_staged_suffix_other:"lines staged", h_staged_suffix:"h staged",
      hdr_week_entries:"Week entries", aria_view:"View", btn_grid:"Grid", btn_calendar:"Calendar",
      hdr_how_it_works:"How it works?",
      how_step1:"Create or select the project", how_step2:"Enter the hours",
      how_step3:"Validate", how_step4:"Save or submit",
      aria_collapse_how:"Collapse how it works", aria_expand_how:"Expand how it works",
      legend_over:"Total per day: over capacity", legend_empty:"Empty working day",
      legend_unavailable:"Not available (absence or non-working day)", legend_submitted:"Week already submitted",
      btn_add_row:"Add row", btn_copy_week:"Copy previous week", btn_apply_template:"Apply template",
      hint_grid_entry:"Accepts 1.5 · 1:30 · 90m. Enter moves down, Tab moves across.",
      hint_calendar:"Click an empty slot to log time that day. Absences and public holidays are not editable.",
      hdr_validation_messages:"Validation messages", hdr_allowances:"Allowances",
      btn_add_allowance:"Add allowance",
      privacy_allowances:"Per diems, kilometres and shift allowances are recorded against a project and a date, as quantity and unit. No value is calculated here. The project bonus is the exception: it carries an amount and only the project owner records it.",
      aria_collapse_suggestions:"Collapse suggestions", aria_expand_suggestions:"Expand suggestions",
      aria_collapse_allowances:"Collapse allowances", aria_expand_allowances:"Expand allowances",
      hdr_suggestions:"Suggestions this week", btn_accept_high_confidence:"Accept high-confidence ones",
      privacy_suggestions_intro:"Nothing enters the timesheet without confirmation.",
      btn_data_collected:"What's collected and where it's stored",
      hdr_specmap:"How this prototype maps to the specification",
      text_specmap_intro:"Each screen below corresponds to a section of the specification document, so refinement with the development team happens on the same vocabulary.",
      spec_e1:"Weekly grid with inline editing, day and row totals, copy week",
      spec_e2:"Calendar view with project blocks and external events to convert",
      spec_e3:"Quick add with natural language and correctable chips",
      spec_e4:"Suggestions with reason, confidence level and explicit action",
      spec_e5:"Entry detail with budget context and history",
      spec_e6:"Three-severity validation and summary before submission",
      spec_e7:"Bulk approval with exceptions singled out",
      spec_e10:"Absences from the Leave Request, day blocking and partial capacity",
      spec_e11:"Conversational assistant with confirmation before saving",
      spec_e12:"Allowances against a project, wage type and quantity, bonus with an amount",
      spec_e13:"Start and end by data entry profile, derived from IT0001",
      spec_e14:"Team leader team entry with partial save and on-behalf-of trace",
      aria_expand_already:"Expand already recorded", aria_collapse_already:"Collapse already recorded",
      hdr_already_recorded:"Already recorded this week", hdr_already_allow:"Allowances recorded this week",
      chip_readonly:"Read-only",
      hint_already:"From each person's own sheet or an earlier team entry, plus whatever is staged below but not yet saved. Amber at 8h, red past it.",
      hint_already_allow:"Allowances already saved for this team this week, from each person's own sheet or an earlier team entry.",
      tab_hours:"Hours", tab_allowances:"Allowances", tab_bonus:"Bonus",
      hdr_team:"Team", hdr_fill_several:"Fill several people at once",
      label_duration:"Duration", label_start_time:"Start time", label_end_time:"End time", label_days:"Days",
      btn_apply_selected:"Apply to selected",
      btn_save_staged_entries:"Save staged entries", btn_clear:"Clear",
      hint_mass_save:"Saving is partial. Lines that fail stay on screen with the reason. Duration fills people on a duration profile, Start/End fills people on Z_BSRV, in the same click.",
      hdr_allowances_selected:"Allowances for selected people",
      label_wage_type:"Wage type", label_quantity:"Quantity", label_note:"Note",
      placeholder_note_required:"Required for this allowance",
      btn_stage_selected:"Stage for selected", btn_save_staged_allowances:"Save staged allowances",
      hint_mass_allow:"Billed to the Project picked at the top of the screen, the same one Hours uses. The bonus is recorded separately, in the Bonus tab.",
      hdr_project_bonus:"Project bonus", label_amount_eur:"Amount, EUR", label_reason:"Reason",
      placeholder_bonus_reason:"Go-live weekend, payroll cutover",
      btn_record_approve_selected:"Record and approve for selected",
      privacy_bonus:"The bonus is the only allowance the employee does not record. The project owner defines the amount and approves in the same act, because the project carries the cost. The amount lives in a customer field, since CATSDB is a quantity structure.",
      hdr_recorded_on_behalf:"Recorded on behalf",
      privacy_recorded_on_behalf:"Every line keeps CREATED_BY and ON_BEHALF_OF. There is no self-confirmation step: the employee sees the entry marked as recorded by the leader, which informs without blocking. On the CATS side the submitting user still lands in ERNAM.",
      kpi_selected:"Selected", kpi_staged_not_saved:"Staged, not saved", kpi_recorded_on_behalf:"Recorded on behalf",
      label_project:"Project", label_acting_as:"Acting as",
      chip_up_to_date:"Up to date", chip_save_to_finish:"Save to finish", hint_click_save:" Click Save to finish.",
      btn_select_no_warnings:"Select the 4 without warnings", chip_project_team:"Project team", btn_approve_selected:"Approve selected",
      text_approval_sub:"A different person's queue, not your own week. It covers the people on Sofia's consulting projects (Banking, Retail, Airports). Nothing you submit under My Timesheet lands here.",
      text_approval_sub_pt02:"A different person's queue, not your own week. It covers the people on Patrícia's facilities projects (Hospital campus, Airport terminal). Nothing you submit under My Timesheet lands here.",
      kpi_pending_approval:"Pending approval", kpi_hours_submitted:"Hours submitted",
      kpi_with_warnings:"With warnings", kpi_deviation_from_plan:"Deviation from plan",
      hdr_team_allocated:"Team allocated to my projects", chip_integrates:"Integrates with My Inbox and SAP Task Center",
      th_employee:"Employee", th_total:"Total", th_deviation:"Deviation", th_status:"Status",
      aria_select_all:"Select all",
      hint_bulk_approval:"Bulk approval is only available for rows without warnings. Rejection requires a reason, per the SAP standard.",
      label_cats_header:"From the interface to CATS", chip_annex_a:"Annex A of the specification",
      kpi_recording_target:"Recording target", kpi_assistance_layer:"Assistance layer",
      kpi_direct_table_write:"Direct table write", val_never:"Never", kpi_customer_fields:"Customer fields",
      hdr_state_chain:"State chain and transfer",
      step_draft:"Draft", step_draft_sub:"BTP only",
      step_saved:"Saved", step_saved_sub:"CATSDB, in process",
      step_in_approval:"In approval", step_in_approval_sub:"released, STATUS",
      step_approved:"Approved", step_approved_sub:"APNAM, APDAT",
      step_posted:"Posted", step_posted_sub:"CATA, CAT5, CAT7, CAT9",
      rule_1:"From <strong>In approval</strong> onward, editing is no longer a change. The correction creates a new record pointing to the original via <span class=\"num\">REFCOUNTER</span>, and goes back through approval.",
      rule_2:"Cell locking reflects what has already been transferred, not just what has been approved. The transfer runs as a job, so the interface shows the date of the next cycle instead of pretending it's instant.",
      hdr_field_mapping:"Field-by-field mapping", chip_cats_or_btp:"CATS, BTP or customer field",
      th_interface_element:"Interface element", th_sap_concept:"SAP concept", th_field:"Field", th_where_lives:"Where it lives",
      hdr_cats_records:"CATS records generated from the filled week", aria_format:"Format",
      btn_table:"Table", btn_api_payload:"API payload",
      hint_cats_table:"Generated live from the grid on the My Timesheet screen. LTXA1 is truncated to 40 characters, the field's real limit.",
      assistant_fab:"Assistant", assistant_title:"Assistant", chip_joule_pattern:"Joule pattern",
      btn_close:"Close", aria_close_assistant:"Close the assistant",
      placeholder_chat:"2h BNK payroll testing yesterday", btn_send:"Send",
      jfoot_text:"Never saves without confirmation. Entries created here are marked with origin <span class=\"num\">Joule</span> and go through the same validations.",
      aria_dictate:"Dictate by voice",
      /* Assistant chat content: greeting, quick-reply chips and every bot_*
         reply botSay/botCard send to #jlog. Kept apart from the rest of the
         dictionary only because there's so much of it - these were the one
         corner the original i18n pass (toasts, validation messages, static
         chrome) never reached, so the assistant kept replying in English
         (and, in a couple of spots, in hardcoded Portuguese) regardless of
         the language picked in Settings. */
      bot_greeting:"Hi {name}! I can log hours, for you or for the team, check the week, sort out absences, approve timesheets, or just take you to the right screen. What do you need?",
      bot_greeting_1:"Hey! What do you need, logging hours, checking the week, or something else?",
      bot_greeting_2:"Hi there. Tell me what you need and I'll sort it.",
      bot_greeting_3:"Hello! Hours to log, or something to check?",
      chip_done_saved:"Saved", chip_done_submitted:"Submitted", chip_done_sent:"Sent for approval", chip_done_withdrawn:"Withdrawn", chip_done_approved:"Approved", label_week_card:"Week", text_schedule_h_day:"{h} h/day schedule", fmt_week_range:"week {n} ({from} to {to})", fmt_week_range_bare:"{n} ({from} to {to})", tip_windows_overlap:"Two time windows overlap on this day.", chip_confirmed:"confirmed", chip_cancelled:"cancelled",
      bot_cancelled_no_save:"No problem, I didn't save anything.",
      bot_week_summary:"You have {tot} h recorded of {exp} h expected, already with absences deducted. ",
      bot_week_errors_block_one:"{n} error blocks submission.", bot_week_errors_block_other:"{n} errors block submission.",
      bot_week_no_errors_submit:"No errors, you can submit.",
      bot_absences_intro:"These are this week's absences, from the Leave Request. Days with an approved full-day absence don't accept time entries.",
      bot_help_text:"A few things I can do: log your hours (<span class=\"num\">2h BNK payroll testing yesterday</span>), log for someone on your team (<span class=\"num\">4h for João today</span>), check the week or your absences, copy last week, apply high-confidence suggestions, submit the week, approve timesheets, or jump to Team, Approval or CATS mapping. Just say it in plain language.",
      bot_switched_to:"Switched to {screen}.",
      bot_suggestions_available:"You have {n} suggestions to review in the side panel. I can apply the high-confidence ones, if you'd like.",
      bot_no_suggestions:"No suggestions to review.",
      bot_no_high_conf:"I don't have any pending high-confidence suggestions.",
      bot_confirm_apply_suggestions:"Confirm applying these suggestions?", btn_apply:"Apply",
      bot_suggestions_applied:"{n} suggestions applied. ",
      bot_copy_week_offer:"I can bring in last week's structure, without durations.",
      label_action:"Action", bot_copy_rows_value:"copy last week's rows",
      label_durations:"Durations", bot_stay_zero_value:"stay at zero", btn_copy:"Copy",
      bot_copy_week_done:"Done. The rows are created, durations still need filling in.",
      bot_week_already_submitted:"The week is already submitted and in approval.",
      bot_cant_submit_week_one:"I can't submit week {num} yet: {n} error blocks it.", bot_cant_submit_week_other:"I can't submit week {num} yet: {n} errors block it.",
      bot_cant_submit_month_one:"I can't submit {month} yet: {n} error blocks it.", bot_cant_submit_month_other:"I can't submit {month} yet: {n} errors block it.",
      bot_cant_submit_fix:"Fix it and ask me again, I'll submit it then.",
      bot_month_already_submitted:"{month} is already submitted and in approval.",
      bot_confirm_submit_month:"Do you confirm submitting {month} for approval? It covers every week of the month still open.",
      bot_month_submitted_msg:"{month} submitted. It's now in approval with {names}.",
      bot_submit_weekly_only:"Here the timesheet is weekly, so it's submitted week by week.",
      bot_month_summary:"In {month} you have {tot} h recorded of {exp} h expected, already with absences deducted. ",
      bot_month_no_errors_submit:"No errors, you can submit the month.",
      label_month:"Month", label_weeks:"Weeks", label_warnings:"Warnings", fmt_month_year:"{month} {y}",
      bot_confirm_submit_week:"Confirm submitting week {num}?",
      label_expected:"Expected", label_status_after_submit:"Status after submitting",
      bot_week_submitted_msg:"Week {num} submitted. It's now in approval with {names}.",
      bot_week_locked:"The week is already submitted, I can't change it. Want to see something else?",
      bot_day_absence_no_alt:"{day} has an approved {type} and there's no other day with free capacity. I didn't record anything.",
      bot_day_absence_suggest:"{day} has an approved {type}, so it doesn't accept hours. I suggest {alt}.",
      bot_day_closed:"{day} falls in a closed period, it can't take new hours. I didn't record anything.",
      bot_day_abs_cap:"{day} has an approved {type}.", bot_day_capacity:"{day}'s capacity is {cap} h.",
      bot_hours_left_suffix:" Only {left} h available, I didn't record anything.",
      bot_no_hours_suffix:" No hours available on this day, I didn't record anything.",
      bot_confirm_entry:"Confirm this entry?", label_receiver_object:"Receiver object",
      bot_receiver_pep:"PEP {code}", bot_receiver_cost_center:"Cost center {code}",
      bot_desc_tbd:"(to be filled in)", bot_entry_saved:"{dur} h saved on {day}, {code}. ",
      bot_every_day_blocked:"Every day in that range has an approved absence, falls in a closed period, or doesn't have room for that much. I didn't record anything.",
      bot_skip_absence_closed:"{days} (approved absence or closed period)", bot_skip_over_capacity:"{days} (over capacity)",
      bot_days_skipped_suffix:" ({parts} skipped)", label_duration_per_day:"Duration per day",
      bot_entry_saved_days_one:"{dur} h saved on {n} day ({total} h total), {code}. ",
      bot_entry_saved_days_other:"{dur} h saved on {n} days ({total} h total), {code}. ",
      bot_week_capacity_full:"Every working day this week is already at capacity.",
      bot_month_capacity_full:"Every working day this month is already at capacity.",
      bot_filled_saved_one:"{total} h saved across {n} day, {code}. ", bot_filled_saved_other:"{total} h saved across {n} days, {code}. ",
      bot_filled_saved_month_one:"{total} h saved across {n} day, {code}, this month. ",
      bot_filled_saved_month_other:"{total} h saved across {n} days, {code}, this month. ",
      bot_cant_stage:"Can't stage that: {list}.", bot_week_already_approved:"{name} (week already approved)",
      label_people:"People", label_time:"Time", label_duration_each:"Duration each", label_skipped:"Skipped",
      bot_confirm_register_staging:"Record this for the team, on their behalf?", btn_register:"Register",
      bot_staged_saved:"Recorded and saved for {names}, {days} of {week}, {code}, on their behalf. You'll find them in Team entry, Hours tab, on that week.",
      bot_staged_nothing:"Nothing was actually recorded.",
      bot_staged_not_saved_suffix:" {names} couldn't take it this way (not allocated to {code}, wrong profile for that field, absence, or closed period), the reason is on the Team screen.",
      bot_note_required:"{noteLabel} is required for {name}. What should it say?",
      label_quantity_each:"Quantity each",
      bot_staged_saved_allow:"Recorded and saved for {names}, {days} of {week}, {name}, on their behalf. You'll find them in Team entry, Allowances tab, on that week.",
      bot_staged_not_saved_allow_suffix:" {names} couldn't take it (not allocated to {code}, wrong company for that allowance, or closed period).",
      bot_team_nobody_missing:"Nobody on {code}'s team has missing working days this week.",
      bot_team_already_full:"{names} already at full capacity this week, on {code}'s team.",
      bot_team_person_not_found:"I couldn't find anyone called \"{name}\" on {code}'s team.",
      bot_confirm_fill_team:"Fill in these missing days up to each person's capacity?",
      btn_fill_and_register:"Fill in and register",
      bot_team_filled_saved:"Missing hours filled in and saved for {names}, on their behalf, in {week}. You'll find them in Team entry, Hours tab, on that week.",
      bot_team_filled_nothing:"Nothing was recorded.",
      bot_team_filled_not_saved_suffix:" {names} couldn't take it, the reason is on the Team grid.",
      bot_approval_ask_who:"Tell me who to approve, a name, or “approve everyone” for every timesheet without exceptions.",
      bot_approval_nothing:"Nothing to approve there, either everything's already approved or what's left has an exception that needs individual review.",
      bot_confirm_approve_all:"Approve these {n} timesheets, no exceptions?", btn_approve_all:"Approve all",
      bot_approved_all_msg:"{n} timesheets approved. Exceptions remain for individual review.",
      bot_already_approved:"{name}'s timesheet is already approved.",
      bot_has_exception:"{name}'s timesheet has an exception ({note}) and needs individual review on the Approval screen, that one can't be bulk-approved.",
      bot_confirm_approve_one:"Approve {name}'s timesheet?", label_in_project:"In project", btn_approve:"Approve",
      bot_approved_one_msg:"{name}'s timesheet approved.",
      fmt_week_n:"week {n}", bot_gap_row:"{day}: {h} of {cap} h, {left} h missing",
      bot_gaps_head_one:"In {period} you still have {n} day to complete, {h} h in total. You have {tot} h of {exp} h:", bot_gaps_head_other:"In {period} you still have {n} days to complete, {h} h in total. You have {tot} h of {exp} h:",
      bot_gaps_none:"Nothing missing in {period}: {tot} h of {exp} h recorded.",
      bot_recorded_head:"In {period} you have {tot} h recorded of {exp} h expected:", bot_recorded_none:"You have no hours recorded in {period} yet.",
      chip_fill_missing:"Fill in the missing hours", chip_what_missing:"What is missing?",
      bot_claude_unavailable:"I can't reach Claude right now, so I can't answer. Try again in a moment.",
      bot_parse_failed:"I couldn't understand what to record. Write the duration and the project, for example <span class=\"num\">2h BNK payroll testing yesterday</span>. I can also show the week's status or your absences.",
      bot_parse_failed_generic:"I didn't catch all the details of that entry. Could you write it another way?",
      bot_which_project:"Which project are those hours for?",
      bot_team_not_found:"couldn't find \"{name}\" on {code}'s team ({leader}). If they're on another project or with another leader, change the \"Acting as\" or \"Project\" selector at the top of the Team screen first",
      bot_team_who_unclear:"couldn't tell who this is about", bot_team_day_unclear:"couldn't tell the day",
      bot_team_amount_unclear:"couldn't tell {amount}", label_the_hours:"the hours", label_the_quantity:"the quantity",
      bot_also_unrecognized_wage_type:"I also didn't recognize the wage type.",
      chip_hours_i_have:"How many hours do I have?", chip_my_absences:"My absences", chip_bnk_example:"2h BNK testing yesterday",
      chip_submit_week:"Submit the week", chip_submit_month:"Submit the month", chip_copy_last_week:"Copy last week",
      chip_apply_high_conf:"Apply the high-confidence ones", chip_help:"Help",
      dlg_add_allowance_title:"Add allowance", chip_wage_type:"Wage type", label_allowance:"Allowance", label_day:"Day",
      btn_cancel:"Cancel", btn_record_allowance:"Record allowance",
      dlg_quick_add_title:"Quick add", label_write_natural:"Write in natural language",
      placeholder_quick_nl:"3h BNK requirements analysis yesterday", chip_waiting_text:"waiting for text",
      chip_duration_to_set:"duration to set", chip_project_to_choose:"project to choose", chip_activity_to_set:"activity to set", chip_desc_prefix:"description: {txt}",
      text_period_closed_paren:"(period closed)", hint_calendar_month:"Overview of the month, read only. Log or edit time on the Grid view.",
      text_week_already_approved:"week already approved", text_staged_not_saved_short:"staged, not saved", unit_h_per_day:"{h} h/day", text_n_staged:"{n} staged",
      text_quick_hint:"Each resolved field can be corrected. If the text isn't recognized, it goes into the description and nothing is invented.",
      btn_save_entry:"Save entry",
      dlg_entry_detail_title:"Entry detail", label_project_wbs:"Project and WBS",
      label_start:"Start", label_end:"End", label_activity_type:"Activity type", label_description:"Description",
      placeholder_description:"Required, at least 10 characters. The first 40 go to LTXA1",
      placeholder_description_optional:"Required, at least 10 characters. The first 40 go to LTXA1",
      label_project_effort:"Project effort, actual vs. planned",
      label_origin:"Origin", val_manual:"Manual", label_created_by:"Created by", label_last_changed:"Last changed",
      btn_back:"Back", btn_submit:"Submit",
      dlg_my_data_title:"My data", text_data_intro:"To propose entries, the app only uses metadata, at project level:",
      row_calendar_events:"Corporate calendar events", row_tickets_handled:"Tickets handled",
      row_repos_activity:"Repositories with activity", row_content_emails:"Content of emails, files or screenshots",
      row_raw_timeline:"Raw timeline retention",
      chip_metadata_only:"metadata only", chip_project_level:"project level", chip_never_collected:"never collected",
      val_14_days:"14 days", chip_or_until_confirmed:"or until confirmed",
      text_data_footer:"This timeline is visible only to you. The organization only sees the timesheet entries you submit. Legal basis and impact assessment to be validated with the DPO before the pilot.",
      btn_delete_timeline:"Delete timeline",
      dlg_shortcuts_title:"Keyboard shortcuts",
      row_open_close_assistant:"Go to the assistant", row_new_quick_add:"New quick add",
      row_copy_previous_week:"Copy previous week", row_prev_next_week:"Previous and next week",
      row_confirm_cell:"Confirm cell and move down", row_show_list:"Show this list",
      bot_balance_asof:"On {date} your vacation balance will be {avail} days: {total} of entitlement, {used} taken or approved by then and {req} requested and waiting.",
      bot_movements_intro:"Your vacation account for {y}, movement by movement. Available now: {avail} days.",
      bot_request_status:"Request {id}: {who}{type}, {period}. Status: {status}.",
      bot_request_not_found:"I can't find request {id} among yours. These are your requests:",
      bot_request_which:"Which request? These are yours:",
      bot_approvers_ts_month:"Your timesheet is submitted by month and approved by {names}.",
      bot_approvers_ts_week:"Your timesheet is submitted by week and approved by {names}.",
      bot_approvers_leave:"Your absences go to {name}.",
      bot_submit_check_ok_month:"Nothing blocks {month}: {total} h of {exp} h expected. It goes to {names} when you submit it.",
      bot_submit_check_ok_week:"Nothing blocks week {num}: {total} h of {exp} h expected. It goes to {names} when you submit it.",
      bot_holidays_next:"The next public holidays ({office} calendar), with no hours expected and not deducted from leave:",
      bot_holidays_month:"Public holidays in {month} ({office} calendar), with no hours expected and not deducted from leave:",
      bot_holidays_none:"No public holidays in {month} ({office} calendar).",
      bot_teamcal_intro:"Who's off, {when}:",
      bot_teamcal_none:"Nobody in your team calendar is off, {when}.",
      bot_team_balances_only_manager:"The team's balances are seen by the line manager ({name}). I can tell you your own.",
      bot_team_balances_intro:"Your team's vacation balances for {y}:",
      text_team_balance_row:"{name} · {avail} days available, {req} pending",
      bot_leave_nothing_to_change:"You have no pending request to change. An approved one is cancelled and requested again.",
      bot_leave_which_change:"Which request do you want to change? Only pending ones can be changed:",
      bot_leave_cannot_change:"Request {id} can't be changed any more ({status}). Only a pending request can; an approved one is cancelled and requested again.",
      bot_leave_change_what:"What should change in request {id}? Tell me the new dates or type, or open the form.",
      bot_leave_confirm_change:"Here's request {id} with the change. It goes back to {name} for approval.",
      bot_leave_changed_msg:"Changed. Request {id} is back with {name} for approval.",
      bot_leave_onbehalf_only_manager:"Only the line manager records an absence for someone else ({name}, for your team). I can request your own.",
      bot_leave_onbehalf_who:"Who is it for? I can record it for one of your direct reports: {list}.",
      bot_leave_onbehalf_confirm:"Recording this absence for {name}, approved as it's recorded.",
      bot_leave_onbehalf_done:"Recorded for {name}, already approved.",
      bot_allow_bonus_owner:"The project bonus is recorded by the project owner for the team, on Team entry, never on your own timesheet.",
      bot_allow_turno_pt02:"The shift allowance only exists in Building Solutions (PT02).",
      bot_allow_country:"Which country? The foreign per diem needs it.",
      bot_allow_which_project:"Which project is the {name} for?",
      bot_allow_confirm:"Here's the allowance to record. Nothing is saved until you confirm.",
      bot_allow_recorded:"Recorded: {name} on {day}, {qty} days.",
      bot_pending_in_month_one:"{n} leave request to decide touching {month}:", bot_pending_in_month_other:"{n} leave requests to decide touching {month}:",
      bot_pending_in_month_none:"Nothing waiting for you in {month}.",
      bot_ts_queue_month:"In Consulting each timesheet is the person's whole month, here {month}.",
      bot_ts_queue_week:"In Building Solutions each timesheet is one week."
    },
    pt: {
      navg_timesheet:"Timesheet",
      aria_main_nav:"Áreas principais",
      navg_leave:"Ausências",
      tab_ts_mine:"Os meus registos",
      tab_ts_team:"Lançamento da equipa",
      tab_ts_approval:"Aprovação",
      tab_lv_mine:"Os meus pedidos",
      tab_lv_teamcal:"Calendário da equipa",
      tab_lv_approval:"Aprovação",
      text_sugs_none:"Nenhuma sugestão aplicada.",
      toast_sugg_day_full:"{day} já tem as horas todas, a sugestão não foi aplicada.",
      toast_sugg_trimmed:"{day}: só cabiam {h} h, a sugestão foi ajustada.",
      text_sugs_applied:"{n} sugestões aplicadas.",
      text_sugs_trimmed:"{n} ajustadas às horas que restavam no dia.",
      text_sugs_skipped:"{n} ficaram de fora, o dia já estava completo.",
      text_sug_day_full:"Dia já completo",
      text_sug_trimmed_short:"de {h} h, o resto não cabe",
      text_sug_room:"Só restam {h} h neste dia: vai ser ajustada.",
      btn_accept:"Aceitar",
      btn_dismiss:"Descartar",
      bot_desc_too_short:"A descrição tem de ter pelo menos 10 caracteres: completa-a no cartão, ou escreve-a aqui.",
      placeholder_desc_card:"O que fizeste",
      hint_desc_min:"Descrição obrigatória, pelo menos 10 caracteres",
      bot_confirm_entry_desc:"Confirmas este lançamento? Esta linha ainda não tem descrição: diz-me o que fizeste, aqui ou no cartão, e depois grava.",
      bot_no_profile_switch:"Só posso ajudar com os teus próprios registos: as tuas horas, as tuas ausências e o que te cabe aprovar.",
      attach_doc_0200:"atestado médico",
      attach_doc_0210:"declaração de presença",
      attach_doc_0400:"comprovativo",
      text_required_lower:"obrigatório",
      leave_err_attachment:"O anexo ({doc}) é obrigatório neste tipo de ausência.",
      lvw_no_attachment_doc:"Sem anexo ({doc})",
      bot_leave_confirm_attach:"Aqui está o pedido. Este tipo de ausência precisa de anexo ({doc}): junta-o no cartão e depois envia. Vai para a tua chefia direta, nada é enviado sem confirmares.",
      placeholder_dmy:"DD/MM/AAAA",
      aria_pick_date:"Escolher data",
      text_submit_approvers:"Vai para aprovação de {names}.",
      bot_reply_lang_note:"A responder em português, a língua em que escreveste. Os ecrãs mantêm o idioma escolhido nas Definições.",
      text_leave_sub_no_ts:"Os pedidos vão para {name}, a tua chefia direta na estrutura organizativa.",
      nav_team_calendar:"Calendário da equipa",
      text_tc_sub:"As ausências dos teus colegas com a mesma chefia, aprovadas e pendentes.",
      text_tc_sub_manager:"As ausências dos teus colaboradores diretos, um nível abaixo quando quiseres, e as dos teus pares.",
      voice_blocked_short:"O ditado por voz não está disponível dentro desta página; clica para ver a alternativa",
      bot_voice_blocked:"O ditado por voz do browser precisa do microfone, e a página do claude.ai onde este mockup corre não lhe dá esse acesso. O que funciona aqui é o ditado do sistema, que escreve diretamente na caixa de texto: tecla Windows + H no Windows, carregar duas vezes em Fn (ou na tecla do globo) no Mac, ou o microfone do teclado no telemóvel. Aberto diretamente no browser, o botão funciona no Chrome e no Edge.",
      bot_voice_unsupported:"Este browser não tem reconhecimento de voz. Usa o ditado do sistema, que escreve diretamente na caixa de texto: tecla Windows + H no Windows, Fn duas vezes no Mac, ou o microfone do teclado no telemóvel.",
      bot_voice_network:"O serviço de voz do browser não respondeu. Tenta outra vez, ou usa o ditado do sistema: tecla Windows + H no Windows, Fn duas vezes no Mac.",
      voice_err_no_mic:"Não encontrei nenhum microfone.",
      nav_leave_approval:"Aprovação de ausências",
      hdr_leave_approval:"Aprovação de ausências",
      hdr_leave_from_reports:"Pedidos dos meus colaboradores diretos",
      aria_la_filter:"Que pedidos mostrar",
      hint_bulk_leave:"A aprovação em massa é só para os pedidos sem avisos. Rejeitar pede um motivo, que o colaborador vê.",
      lvw_overlap:"Sobrepõe-se a {names}",
      lvw_balance:"Saldo fica negativo",
      lvw_cancel:"Cancelamento de ausência aprovada",
      lvw_retro:"Retroativo",
      lvw_no_attachment:"Sem atestado médico",
      hdr_decided_group:"Decididos nesta sessão",
      text_la_none_pending:"Nada por aprovar. Escolhe Todos para ver o que foi decidido.",
      aria_select_leave_for:"Selecionar o pedido de {name}",
      text_n_also_out:"mais {n} ausentes",
      text_team_complete:"equipa completa",
      btn_view_request:"Detalhe do pedido",
      view_day:"Dia",
      view_week:"Semana",
      view_month:"Mês",
      tab_direct_reports:"Colaboradores diretos",
      tab_peers:"Os meus pares",
      hdr_my_hierarchy:"A minha hierarquia",
      hdr_my_colleagues:"Os meus colegas",
      placeholder_search_people:"Procurar pessoas",
      label_absent_n:"Ausentes ({n})",
      n_direct_reports_one:"1 colaborador direto",
      n_direct_reports_other:"{n} colaboradores diretos",
      text_you_suffix:"tu",
      aria_fullscreen:"Ecrã inteiro",
      aria_prev_period:"Anterior",
      aria_next_period:"Seguinte",
      aria_show_person:"Mostrar as ausências de {name}", aria_expand_reports:"Mostrar os colaboradores diretos de {name}",
      label_week_short:"Semana {n}",
      text_absent_generic:"Ausente",
      text_tac_nobody:"Ninguém a mostrar com estes filtros.",
      text_tac_privacy:"As ausências de saúde dos colegas aparecem só como Ausente.",
      lrmap_asof:"Saldo numa data",
      lrmap_holidays:"Feriados",
      lrmap_teamcal:"Calendário de ausências da equipa",
      lrmap_mass:"Aprovar vários de uma vez",
      lrmap_change:"Alterar um pedido pendente",
      lrmap_attach:"Anexo",
      lrmap_onbehalf:"Registado pela chefia",
      hdr_my_time_off:"As minhas ausências",
      hdr_team_time_off:"Ausências da equipa",
      kpi_absent_today:"Ausentes hoje",
      acc_vacation:"Férias {y}",
      text_acc_available_as_of:"dias disponíveis a {date}",
      acc_entitlement:"Direito",
      acc_taken:"Gozadas",
      acc_planned:"Planeadas",
      acc_pending:"Pendentes",
      acc_available:"Disponível",
      acc_carryover_note:"Inclui {n} dias transitados de {y}.",
      text_acc_after_all:"Ficam {n} dias por pedir depois de contados todos os pedidos aprovados e pendentes.",
      btn_view_movements:"Ver movimentos",
      dlg_account_title:"Férias {y}: movimentos",
      mv_entitlement:"Direito anual",
      mv_carryover:"Transitado de {y}",
      mv_used_before:"Gozado no início do ano",
      hint_cal_pick:"Clica no primeiro e depois no último dia para pedir uma ausência.",
      hint_cal_pick_end:"Desde {date}: agora clica no último dia (no mesmo, se for só um).",
      legend_approved:"Aprovada",
      legend_pending:"Pendente de aprovação",
      legend_cancel:"Cancelamento pendente",
      legend_holiday:"Feriado ou fim de semana",
      legend_holiday_weekend:"Feriado ou fim de semana",
      legend_team:"Colegas ausentes",
      text_no_requests_filter:"Nada a mostrar aqui.",
      btn_edit:"Alterar",
      wf_submitted:"Enviado por {name}",
      wf_onbehalf:"Registado por {name} em nome do colaborador, aprovado ao registar",
      wf_changed:"Alterado pelo colaborador",
      wf_waiting:"À espera de aprovação de {name}",
      wf_approved:"Aprovado por {name}",
      wf_rejected:"Rejeitado por {name}",
      wf_withdrawn:"Retirado pelo colaborador",
      wf_cancel_waiting:"Cancelamento à espera de {name}",
      wf_cancelled:"Cancelamento aprovado por {name}",
      wf_posted:"Registado nos dados de tempos",
      dlg_leave_detail:"Pedido de ausência {id}",
      n_holidays_skipped_one:"1 feriado não descontado",
      n_holidays_skipped_other:"{n} feriados não descontados",
      label_attachment:"Anexo",
      hint_attach_required:"atestado médico",
      hint_attach_optional:"opcional, por exemplo uma declaração de presença",
      text_attach_local:"Neste mockup só fica o nome do ficheiro, o ficheiro não sai do teu computador.",
      toast_attached:"{file} junto ao pedido {id}.",
      label_manager_comment:"Comentário da chefia",
      hdr_workflow:"Fluxo de aprovação",
      hdr_also_absent:"Também ausentes neste período",
      text_nobody_else:"Mais ninguém da equipa.",
      btn_approve_selected_n:"Aprovar selecionados ({n})",
      n_leave_approved_one:"1 pedido de ausência aprovado.",
      n_leave_approved_other:"{n} pedidos de ausência aprovados.",
      filter_all_types:"Todos os tipos",
      th_team_member:"Colaborador",
      btn_record_leave:"Registar ausência",
      dlg_edit_leave:"Alterar pedido {id}",
      dlg_leave_for:"Ausência de {name}",
      btn_save_changes:"Enviar alterações",
      text_balance_now_after:"Saldo {now} dias, {n} depois deste pedido",
      text_onbehalf_note:"Fica aprovado ao registar, porque a aprovação é tua",
      text_also_absent_short:"Também ausentes: {list}",
      toast_leave_changed:"Pedido {id} alterado, volta a {name} para aprovar.",
      toast_leave_onbehalf:"Ausência registada para {name} e aprovada.",
      leave_warn_attachment:"Junta o atestado médico. Também o podes fazer depois, no detalhe do pedido.",
      aria_prev_month:"Mês anterior",
      aria_next_month:"Mês seguinte",
      hdr_time_accounts:"Contas de tempo",
      label_balance_as_of:"Saldo a",
      hdr_my_calendar:"O meu calendário",
      label_show_team:"Mostrar ausências da equipa",
      btn_today:"Hoje",
      filter_upcoming:"Próximos",
      filter_history:"Histórico",
      filter_approved:"Aprovadas",
      hdr_team_calendar:"Calendário de ausências da equipa",
      hdr_team_balances:"Saldos de férias da equipa",
      th_date:"Data",
      th_movement:"Movimento",
      th_days:"Dias",
      bot_lang_followed:"Passei para português, a língua em que estás a escrever. Podes mudar nas Definições.",
      chip_not_your_project:"{code} não é um dos teus projetos",
      bot_which_project_for:"Em que projeto registo as {dur} h de {when}?",
      bot_which_project_fill:"Em que projeto registo as horas em falta?",
      bot_project_not_allocated:"Não estás alocado ao projeto {code}, por isso não posso registar horas lá. Os teus projetos são {list}.",
      text_every_weekday:"todos os dias úteis desta semana",
      text_days_missing:"os dias com horas em falta",
      bot_day_outside_week:"Esse dia não está na semana que tens no ecrã. Abre a semana dele em A Minha Folha, ou indica um dia desta semana.",
      wt_AJC_NAC:"Ajudas de custo nacionais",
      wt_AJC_INT:"Ajudas de custo no estrangeiro",
      wt_KMS:"Quilómetros em viatura própria",
      wt_TURNO:"Subsídio de turno",
      wt_BONUS:"Prémio de projeto",
      label_route:"Percurso",
      label_road_distance:"Distância por estrada",
      label_to_record:"A registar",
      label_trip_from:"Origem",
      label_destination:"Destino",
      label_round_trip:"Ida e volta",
      label_office_base:"{city} (escritório)",
      km_one_way:"só ida",
      km_round_trip:"ida e volta",
      km_per_leg:"{km} km por sentido",
      km_estimated:"(estimativa pelo mapa)",
      bot_km_confirm:"Aqui estão os quilómetros. Calculei a distância entre as duas localidades; confirma antes de eu registar.",
      bot_km_confirm_given:"Aqui estão os quilómetros que indicaste. Não tenho a distância desse percurso, por isso confirma o valor antes de eu registar.",
      bot_km_recorded:"Registados {km} km em {day}, {route}, projeto {code}. Já aparecem nos abonos da semana.",
      bot_km_which_route:"Entre que localidades? Por exemplo: km de Lisboa para o Porto ontem.",
      bot_km_unknown_place:"Não tenho a distância até {place} neste mockup. Diz-me os quilómetros (por exemplo, 120 km) e registo com esse percurso.",
      bot_km_future:"Os quilómetros registam-se depois da deslocação, e {date} ainda não chegou.",
      bot_km_no_week:"{date} fica fora das semanas disponíveis na timesheet.",
      bot_km_week_submitted:"A semana de {date} já foi submetida, por isso já não leva mais abonos.",
      bot_km_period_closed:"O período de {date} está fechado, por isso já não leva mais abonos.",
      bot_km_not_in_profile:"Não tens projetos onde registar quilómetros.",
      warn_km_differs:"Indicaste {given} km; a distância calculada é {calc} km. Fica o valor que indicaste.",
      chip_km_round:"Ida e volta",
      chip_km_one_way:"Só ida",
      chip_km_example:"km de Lisboa para o Porto ontem",
      hint_km_route:"{route}: {km} km por estrada em cada sentido, {total} km a registar.",
      hint_km_unknown:"Sem distância para este percurso no mockup: indica os quilómetros.",
      hint_km_enter_route:"Indica a origem e o destino para calcular a distância.",
      toast_km_route_needed:"Indica a origem e o destino da deslocação.",
      label_approval_week:"Aprovação de horas, semana {n}",
      label_approval_month:"Aprovação de horas, {month}",
      ap_week_chip:"Sem. {n} · {from} a {to} · {h}/{exp} h",
      text_approval_monthly:"Na Consultoria as horas aprovam-se ao mês, o mesmo período que a timesheet mostra.",
      text_approval_weekly:"Na Building Solutions as horas aprovam-se à semana, o mesmo período que a timesheet mostra.",
      label_you:"tu",
      filter_pending:"Por aprovar", filter_all:"Todas", aria_ap_filter:"Que timesheets mostrar", text_ap_none_pending:"Nada por aprovar. Escolhe Todas para ver as aprovadas.", btn_select_clean_one:"Selecionar a {n} sem avisos", btn_select_clean_other:"Selecionar as {n} sem avisos",
      settings_reference:"Referência técnica", btn_open_mapping:"Abrir o mapeamento SAP", text_mapping_hint:"Campo a campo, o que cada ecrã grava no CATS e no Leave Request standard, com os registos e os payloads gerados em tempo real.",
      label_test:"Teste", aria_change_test:"Mudar o teste: empresa e perfil",
      profile_employee:"Colaborador", profile_pm:"Gestor de projeto", profile_manager:"Chefia hierárquica",
      setup_title:"O que vais testar?", setup_language:"Idioma", setup_company:"Empresa", setup_profile:"Perfil", setup_leader:"Projeto e gestor",
      setup_intro:"Escolhe a empresa e o perfil. Podes mudar os dois a qualquer momento no botão Teste, no topo. O que registas fica guardado, por isso um pedido enviado como colaborador pode ser aprovado como chefia.",
      setup_co_hint_pt01:"Consultoria. Perfil Z_CONS: as horas registam-se como duração, mês a mês.",
      setup_co_hint_pt02:"Building Solutions. Perfil Z_BSRV: as horas registam-se com hora de início e de fim, semana a semana.",
      setup_employee_desc:"Regista as próprias horas e pede ausências.",
      setup_pm_desc:"Regista as próprias horas e as da equipa do projeto, e aprova as timesheets da equipa.",
      setup_manager_desc:"Aprova os pedidos de ausência dos colaboradores diretos, de acordo com a estrutura organizativa.",
      btn_start_test:"Começar",
      text_approval_sub_pm:"Timesheets das pessoas alocadas a {projects}, os projetos de que és responsável. A aprovação segue a responsabilidade pelo projeto, não a estrutura organizativa.",
      bot_greeting_pm:"Olá, {name}! És gestor de projeto de {projects}. Posso registar as tuas horas, lançar horas ou abonos para a equipa (incluindo para ti), preencher os dias em falta e aprovar as timesheets.",
      bot_alert_ts_pm_one:"Tens {n} timesheet para aprovar, {x} com exceções.", bot_alert_ts_pm_other:"Tens {n} timesheets para aprovar, {x} com exceções.",
      bot_ts_only_pm:"As timesheets são aprovadas pelo gestor de projeto, o responsável pelo projeto.",
      bot_team_only_pm:"O lançamento para a equipa é feito pelo gestor de projeto.",
      bot_screen_not_in_profile:"{screen} não está disponível para ti.",
      chip_change_test:"Mudar teste", bot_setup_opened:"Escolhe o novo teste na janela que acabou de abrir.",
      bot_test_changed:"Teste mudado: {co}, {profile}, {name}.",
      hdr_home_team_week:"Equipa {project}", btn_open_team:"Abrir lançamento da equipa",
      text_acting_as_pm:"A atuar como {name}, gestor de projeto de {projects}. Muda no botão Teste, no topo.",
      chip_conversation_log:"Modo aprendizagem", title_conversation_log:"Esta conversa fica guardada no artifact para melhorar o assistente. Só dados fictícios do mockup.",
      fb_helpful:"Útil", fb_not_helpful:"Não ajudou", fb_placeholder:"O que devia ter feito?", fb_send:"Enviar", fb_thanks:"Obrigado", fb_noted:"Registado, vai ser analisado na próxima ronda de melhorias.",
      /* Leave Request e o assistente como porta de entrada */
      nav_home:"Assistente", nav_leave:"Ausências", label_view_as:"Ver como", aria_view_as:"Ver a aplicação como o colaborador ou como a chefia direta",
      role_employee:"Colaborador", role_manager:"Chefia direta",
      abs_0100:"Férias", abs_0210:"Consulta médica", abs_0200:"Doença", abs_0300:"Formação", abs_0400:"Falta justificada",
      leave_range:"{from} a {to}", leave_time_range:"{b} às {e}",
      n_workdays_one:"{n} dia útil", n_workdays_other:"{n} dias úteis",
      n_requests_one:"{n} pedido", n_requests_other:"{n} pedidos",
      lr_status_sent:"Pendente de aprovação", lr_status_approved:"Aprovado", lr_status_posted:"Aprovado, lançado",
      lr_status_rejected:"Rejeitado", lr_status_withdrawn:"Retirado", lr_status_cancel_requested:"Cancelamento pendente",
      leave_err_type:"Escolhe o tipo de ausência.", leave_err_dates:"Preenche a data de início e de fim.", leave_err_order:"A data de fim é anterior à de início.",
      leave_err_no_workdays:"O período não tem dias úteis.", leave_err_partial_type:"{type} só pode ser pedido por dias inteiros.",
      leave_err_partial_one_day:"Parte do dia só se aplica a um único dia.", leave_err_times:"Preenche a hora de início e de fim, com o fim depois do início.",
      leave_err_hours:"Indica quantas horas.", leave_err_hours_full:"{cap} h ou mais é o dia inteiro, desmarca parte do dia.",
      leave_err_overlap:"Sobrepõe-se ao teu pedido {id} ({period}).", leave_err_period_closed:"O período está fechado para um ou mais destes dias. A reabertura é uma ação de RH.",
      leave_err_quota:"Saldo de férias insuficiente: {n} dias pedidos, {avail} disponíveis.",
      leave_warn_hours:"Já tens {h} h registadas em {days}. Se o pedido for aprovado, essas horas entram em conflito e vais poder movê-las.",
      leave_info_outside_sample:"Alguns dias ficam fora das semanas de exemplo, ficam no pedido mas não aparecem na timesheet.",
      leave_info_retroactive:"Pedido retroativo, começa no passado.",
      hdr_leave_request:"Os meus pedidos de ausência", hdr_leave_to_approve:"Pedidos de ausência para aprovar", hdr_my_leave_requests:"Os meus pedidos de ausência",
      text_leave_sub:"Os pedidos vão para {name}, a tua chefia direta na estrutura organizativa. Os pedidos aprovados e pendentes aparecem automaticamente na tua timesheet.",
      text_leave_sub_manager:"Pedidos dos colaboradores diretos de {name}, na estrutura organizativa. Ao aprovar, a ausência passa logo para a timesheet do colaborador.",
      kpi_leave_pending:"Pendentes", kpi_leave_soon:"Começam nos próximos 14 dias", kpi_leave_days_requested:"Dias pedidos", unit_days:"dias",
      kpi_vacation_available:"Férias disponíveis", kpi_vacation_entitlement:"Direito {y}", kpi_vacation_taken:"Gozadas", kpi_vacation_requested:"Pedidas, pendentes",
      origin_joule_short:"pelo assistente", btn_withdraw:"Retirar", btn_request_cancel:"Pedir cancelamento",
      toast_leave_withdrawn:"Pedido {id} retirado. Já não aparece na timesheet.",
      toast_leave_cancel_requested:"Cancelamento do {id} enviado a {name}. A ausência mantém-se até ser aprovado.",
      toast_leave_sent:"Pedido {id} enviado a {name}. Já aparece na tua timesheet como pendente.",
      toast_leave_approved:"Pedido {id} de {name} aprovado.", toast_leave_rejected:"Pedido {id} de {name} rejeitado.",
      toast_leave_cancel_approved:"Cancelamento do pedido {id} de {name} aprovado.",
      text_leave_queue_empty:"Nada à espera de aprovação.", text_starts_today_or_past:"Começa hoje ou já começou",
      text_starts_in_days_one:"Começa daqui a {n} dia", text_starts_in_days_other:"Começa daqui a {n} dias",
      text_no_overlap:"Sem sobreposição", text_overlaps_n:"{n} sobreposição(ões) na equipa", text_cancellation:"Cancelamento",
      btn_reject:"Rejeitar", chip_rejected:"Rejeitado", text_balance_after:"Saldo depois: {n} dias", text_approver:"Aprovador: {name}",
      text_pending_short:"pendente", text_home_week_total:"Registadas {tot} h de {exp} h esperadas, já com as ausências descontadas.",
      btn_open_timesheet:"Abrir a timesheet completa", hdr_home_leave:"Ausências", text_vacation_available:"{n} dias de férias disponíveis",
      text_no_upcoming_leave:"Sem ausências marcadas nem pedidos pendentes.", btn_new_leave:"Novo pedido de ausência", btn_open_leave:"Abrir Ausências",
      hdr_home_to_approve:"Para aprovar: ausências", text_now:"agora", text_in_days_one:"daqui a {n} dia", text_in_days_other:"daqui a {n} dias",
      btn_open_leave_approvals:"Abrir aprovação de ausências", hdr_home_timesheets:"Para aprovar: timesheets",
      text_home_ts_pending:"{n} timesheets à espera, {x} com exceções que pedem uma análise mais atenta.", btn_open_ts_approvals:"Abrir aprovação de timesheets",
      hdr_home_team_away:"Equipa ausente, próximos 60 dias", text_nobody_away:"Ninguém da equipa tem ausências aprovadas para os próximos dias.",
      text_acting_as_manager:"A atuar como {name}, chefia direta na estrutura organizativa. Muda no botão Teste, no topo.",
      chip_lr_standard:"Leave Request standard, PTARQ", chip_my_inbox:"Decisão pelo My Inbox, TASKPROCESSING",
      th_request:"Pedido", th_type:"Tipo", th_period:"Período", th_duration:"Duração", th_approver:"Aprovador",
      th_balance_after:"Saldo depois", th_overlap:"Sobreposição na equipa", th_decision:"Decisão", th_when:"Quando",
      privacy_leave_sync:"Os pedidos passam pelo serviço standard do Leave Request e pelo seu workflow de aprovação, nunca pela timesheet. Assim que um pedido é enviado aparece na timesheet como pendente, o que avisa sem bloquear. Depois de aprovado fecha o dia, ou reduz a capacidade no caso de parte do dia. Rejeitado ou retirado, desaparece.",
      hdr_leave_decided:"Decididos nesta sessão",
      dlg_new_leave_title:"Novo pedido de ausência", label_absence_type:"Tipo de ausência", label_from:"De", label_to:"Até",
      label_partial_day:"Parte do dia", label_hours:"Horas", placeholder_leave_note:"Opcional, a chefia vê",
      btn_send_request:"Enviar pedido", dlg_reject_title:"Rejeitar pedido de ausência", placeholder_reject_reason:"Obrigatório, o colaborador vê",
      label_period:"Período", label_balance_after:"Saldo depois", label_approver:"Aprovador", label_service:"Serviço standard",
      placeholder_chat_home:"2h BNK testes de payroll ontem, ou férias de 3 a 6 de novembro",
      jfoot_text_home:"Nunca grava nem envia sem confirmação. O que é criado aqui fica com origem <span class=\"num\">Joule</span> e passa pelas mesmas validações dos ecrãs.",
      spec_e15:"Pedido e aprovação de ausências, uma máscara sobre o serviço standard", spec_e16:"Assistente como porta de entrada, com os dados como vista secundária",
      hdr_lr_mapping:"Leave Request, standard PTARQ", chip_lr_service:"HCMFAB_LEAVE_REQUEST_CR_SRV",
      lr_step_sent:"Enviado", lr_step_sent_sub:"PTREQ_HEADER, SENT", lr_step_approved:"Aprovado", lr_step_approved_sub:"WS12300111, My Inbox",
      lr_step_posted:"Lançado", lr_step_posted_sub:"RPTARQPOST, IT2001", lr_step_read:"Na timesheet", lr_step_read_sub:"capacidade, CATS",
      lr_rule_1:"A aplicação só cria, lê e retira pelo serviço standard. Não há lógica de ausências aqui, nenhuma tabela escrita diretamente, nem um segundo processo de aprovação.",
      lr_rule_2:"Um pedido aparece na timesheet assim que é enviado, como pendente. Na aprovação fecha o dia ou reduz a capacidade, antes de o RPTARQPOST correr, para que uma aprovação no próprio dia não passe despercebida.",
      lr_rule_3:"Cancelar um pedido aprovado é também um pedido, decidido pela mesma chefia no mesmo passo do workflow, como no standard.",
      hdr_lr_fields:"Leave Request campo a campo", hdr_lr_payload:"Último pedido enviado, como o serviço standard o recebe",
      text_lr_payload_empty:"Envia um pedido, pelo assistente ou pelo ecrã Ausências, para ver aqui o payload.",
      hint_lr_fields:"Os nomes de entidades e campos seguem o serviço do HCM Fiori apps bundle. Confirmar no $metadata do sistema do cliente antes do desenvolvimento.",
      lrmap_type:"Tipo de ausência", lrmap_dates:"De e até", lrmap_partial:"Parte do dia", lrmap_note:"Nota para a chefia",
      lrmap_status:"Estado do pedido", lrmap_approver:"Aprovador", lrmap_balance:"Saldo de férias", lrmap_decision:"Aprovar ou rejeitar",
      lrmap_posting:"Lançamento", lrmap_timesheet:"Ausência na timesheet", lrmap_withdraw:"Retirar ou cancelar", lrmap_origin:"Criado pelo assistente",
      bot_leave_cant:"Ainda não consigo enviar esse pedido: {reason}", chip_my_leave:"Os meus pedidos de ausência", chip_leave_form:"Abrir o formulário",
      bot_leave_confirm:"Aqui está o pedido. Vai para a tua chefia direta aprovar, nada é enviado sem confirmares.",
      bot_leave_sent:"Enviado. O pedido {id} está com {name} para aprovação e já aparece na tua timesheet como pendente.",
      bot_leave_list_intro:"Os teus pedidos marcados e pendentes. Tens {avail} dias de férias disponíveis, mais {req} pedidos à espera de aprovação.",
      chip_request_vacation:"Pedir férias",
      bot_leave_balance:"Férias {y}: {total} dias de direito, {used} gozados e {req} pedidos à espera. Ainda podes pedir {avail} dias.",
      bot_leave_nothing_to_cancel:"Não tens nenhum pedido que possa ser cancelado.", bot_leave_which_cancel:"Qual? Diz-me o número do pedido ou uma data que ele abranja.",
      bot_leave_cannot_cancel:"O pedido {id} está {status}, não pode ser cancelado daqui.",
      bot_leave_confirm_withdraw:"Retirar o pedido {id}? Ainda está à espera, por isso sai logo, também da timesheet.",
      bot_leave_confirm_cancel:"O pedido {id} já está aprovado. Cancelá-lo volta à tua chefia para aprovação, como no standard. Peço o cancelamento?",
      bot_leave_withdrawn:"Pedido {id} retirado. A timesheet já não o mostra.",
      bot_leave_cancel_requested:"Cancelamento do {id} enviado a {name}. Até ser aprovado, a ausência mantém-se na timesheet.",
      bot_nothing_pending:"Não tens nada à espera neste momento.",
      bot_alert_leave_one:"Tens {n} pedido de ausência para aprovar.", bot_alert_leave_other:"Tens {n} pedidos de ausência para aprovar.",
      when_today:"a começar hoje", when_past:"já no passado", when_in_days_one:"a começar daqui a {n} dia", when_in_days_other:"a começar daqui a {n} dias",
      bot_notice_conflict:"Tinhas {h} h registadas em {days}, que agora entram em conflito com a ausência: abre a timesheet para as mover.",
      bot_alert_soonest:"O mais próximo é de {name}, {type}, {when}.",
      bot_alert_ts_one:"E {n} timesheet à espera, {x} com exceções.", bot_alert_ts_other:"E {n} timesheets à espera, {x} com exceções.",
      chip_pending_approvals:"O que tenho para aprovar?", chip_approve_leave_of:"Aprovar o pedido de ausência de {name}", chip_approve_ts_of:"Aprovar a timesheet de {name}",
      chip_approve_clean_ts:"Aprovar todas as timesheets sem exceções", chip_view_as_employee:"Ver como colaborador", chip_view_as_manager:"Ver como chefia",
      bot_leave_only_manager:"Os pedidos de ausência são aprovados pela chefia direta ({name}).",
      bot_leave_decide_who:"De quem é o pedido? Diz-me o nome ou o número do pedido, ou diz todos.",
      bot_leave_reason_needed:"Qual é o motivo para rejeitar o pedido de {name}? O colaborador vai vê-lo.",
      bot_leave_overlap_warn:"Sobreposições na equipa: {list}.",
      bot_leave_confirm_approve_one:"Aprovar este pedido?", bot_leave_confirm_approve_other:"Aprovar estes {n} pedidos?",
      bot_leave_confirm_reject:"Rejeitar com este motivo?",
      bot_leave_approved_msg_one:"Aprovado. Já está na timesheet do colaborador como ausência aprovada.",
      bot_leave_approved_msg_other:"Feito, {n} aprovados. Cada um já está na timesheet do colaborador como ausência aprovada.",
      bot_leave_rejected_msg:"Rejeitado. {name} vê o motivo no pedido.",
      bot_leave_remaining_one:"Fica {n} na tua caixa.", bot_leave_remaining_other:"Ficam {n} na tua caixa.", bot_leave_inbox_empty:"A tua caixa está vazia.",
      bot_greeting_home:"Olá, {name}! É aqui que registas horas e ausências. Diz-me em que trabalhaste, ou pede um dia de folga, e eu preparo tudo para confirmares. A tua semana e as tuas ausências ficam neste ecrã, sempre atualizadas.",
      bot_greeting_manager:"Olá, {name}!",
      bot_now_manager:"Estás agora a ver a aplicação como {name}, chefia direta.", bot_now_employee:"De volta como {name}.",
      bot_notice_approved:"Boa notícia: {name} aprovou o teu pedido {id} ({period}). Já está na tua timesheet.",
      bot_notice_rejected:"{name} rejeitou o teu pedido {id} ({period}). Motivo: {reason}",
      bot_notice_cancel_approved:"{name} aprovou o cancelamento do {id}. A ausência saiu da tua timesheet.",
      bot_notice_cancel_rejected:"{name} não aprovou o cancelamento do {id}, a ausência mantém-se. Motivo: {reason}",
      bot_leave_which_type:"Que tipo de ausência?", bot_leave_when:"Para que dias queres marcar {type}? Por exemplo, 3 a 7 de novembro, ou amanhã à tarde.",
      chip_leave_tomorrow:"Amanhã", chip_leave_next_week:"Próxima semana", bot_leave_form_opened:"Aqui está o formulário, já preenchido com o que me disseste.",
      bot_leave_ambiguous:"{name} tem um pedido de ausência e uma timesheet à espera. Qual dos dois?",
      bot_leave_need_more:"Preciso do tipo de ausência e das datas.",
      bot_help_text_home:"Algumas coisas que posso fazer: registar as tuas horas (<span class=\"num\">2h BNK testes de payroll ontem</span>), pedir uma ausência (<span class=\"num\">férias de 3 a 6 de novembro</span>, <span class=\"num\">consulta médica amanhã das 14h às 17h</span>), registar quilómetros com a distância calculada (<span class=\"num\">km de Lisboa para o Porto ontem</span>), consultar, alterar ou cancelar os teus pedidos, o saldo de férias em qualquer data e os seus movimentos, dizer quem aprova, o que bloqueia uma submissão, os feriados e quem está ausente na equipa, preencher as horas em falta, ver a semana e submetê-la e, como chefia, ver o que está à espera e aprovar ou rejeitar. Escreve em linguagem normal.",
      brand_title:"Registo de Horas", brand_subtitle:"Protótipo Fiori",
      capture_on:"Sugestões ativas, linha do tempo privada", capture_off:"Captura em pausa",
      aria_it0001:"Empresa do colaborador, a partir do IT0001",
      aria_project_billing:"Projeto a faturar e a alocar aos lançamentos da equipa", aria_leader_scope:"Líder e âmbito",
      aria_mass_entry_section:"Secção de lançamento da equipa",
      label_week_n:"Semana {n}, {range} {y}", label_range_same_month:"{d1} a {d2} {month}", label_range_diff_month:"{d1} {m1} a {d2} {m2}",
      status_approved:"Aprovada", status_pending:"Pedido pendente",
      dlg_new_entry_title:"Novo lançamento", origin_suggested:"Sugerido", origin_copied:"Copiado",
      dlg_submit_month_title:"Submeter {month} {y}", dlg_submit_week_title:"Submeter semana {n}",
      ui_undo:"Desfazer", ui_resolve:"Resolver", ui_reopen:"Reabrir",
      toast_bad_duration:"Não consegui ler “{v}”. Usa 1.5, 1:30 ou 90m.",
      toast_only_available:" Só há {left} h disponíveis.", toast_no_hours_available:" Sem horas disponíveis neste dia.",
      toast_bad_clock:"Não consegui ler “{v}”. Usa 08:00 ou 8.",
      toast_row_removed:"Linha removida.",
      toast_month_submitted_no_rows:"Este mês já está submetido, não é possível adicionar mais linhas.",
      toast_all_projects_used_month:"Todos os projetos disponíveis para esta empresa já têm linha este mês.",
      toast_no_earlier_months:"Sem meses de exemplo anteriores.", toast_no_later_months:"Sem meses de exemplo seguintes.",
      toast_sugg_blocked_absence:"{day} tem uma ausência aprovada, a sugestão não pode ser aplicada.",
      toast_suggestion_accepted:"Sugestão aceite em {day}.",
      toast_suggestion_dismissed:"Sugestão dispensada. O padrão não voltará a ser proposto.",
      toast_absence_approved_conflict:"Ausência aprovada em {day}. As {h} h registadas nesse dia estão agora em conflito.",
      toast_absence_approved_no_conflict:"Ausência aprovada em {day}. O dia deixou de estar disponível para lançamentos.",
      toast_hours_moved:"{h} h movidas de {from} para {to}.",
      toast_hours_removed_no_capacity:"{h} h removidas de {day}, nenhum dia tinha capacidade livre.",
      toast_allowance_removed:"{name} removido.",
      toast_week_submitted_no_allow_change:"A semana está submetida, os abonos não podem ser alterados.",
      toast_week_closed_period:"Esta semana cai num período fechado.",
      toast_qty_must_be_positive:"A quantidade tem de ser um número acima de zero.",
      toast_allowance_recorded:"{name} registado em {day}.",
      toast_bad_number:"Não consegui ler “{v}”.",
      toast_capacity_on_day:"A capacidade de {name} é {cap} h em {day}.",
      toast_select_person_first:"Seleciona primeiro pelo menos uma pessoa.",
      toast_give_duration_or_clock:"Indica uma duração, ou uma hora de início e fim.",
      toast_pick_a_day:"Escolhe pelo menos um dia.",
      toast_cells_filled:"{n} células preenchidas para {people} pessoas. Ainda não está gravado, revê a grelha primeiro.",
      cells_skipped_field_one:" {n} célula ignorada, precisa do outro campo para esse perfil.",
      cells_skipped_field_other:" {n} células ignoradas, precisam do outro campo para esse perfil.",
      cells_skipped_capacity_one:" {n} célula ignorada, acima da capacidade diária dessa pessoa.",
      cells_skipped_capacity_other:" {n} células ignoradas, acima da capacidade diária dessa pessoa.",
      toast_team_entries_partial:"{saved} lançamentos registados para {who}. {left} ficaram no ecrã com o motivo.",
      toast_team_entries_all:"{saved} lançamentos registados para {who}, em nome deles.",
      toast_team_entries_none:"Nada foi registado. Cada linha tem um motivo ao lado.",
      toast_give_qty_positive:"Indica uma quantidade acima de zero.",
      toast_note_required_for:"{note} é obrigatório para {name}.",
      allow_lines_staged_one:"{n} linha de abono em staging para {people} pessoas. Ainda não está gravado.",
      allow_lines_staged_other:"{n} linhas de abono em staging para {people} pessoas. Ainda não está gravado.",
      toast_allow_skipped_company:" {n} ignorados, o abono de turno não se aplica à empresa deles.",
      toast_allow_skipped_project:" {n} ignorados, não alocados a {code}.",
      toast_nothing_staged:"Nada em staging.",
      allow_lines_recorded_one:"{n} linha de abono registada, em nome deles.",
      allow_lines_recorded_other:"{n} linhas de abono registadas, em nome deles.",
      toast_nothing_to_save:"Nada para gravar.", toast_changes_saved:"Alterações gravadas.",
      toast_amount_must_be_positive:"O montante tem de ser um número acima de zero.",
      toast_bonus_reason_required:"O bónus precisa de um motivo. É o único rasto de porque é que o projeto suportou este custo.",
      toast_none_allocated:"Nenhuma das pessoas selecionadas está alocada a {code}.",
      toast_bonus_recorded:"Bónus de {amount} EUR registado para {names}, aprovado no mesmo ato.",
      toast_bonus_none_recorded:"Nada foi efetivamente registado.",
      toast_bonus_skipped_ineligible:" {names} ignorados, não alocados a {code}.",
      toast_bonus_skipped_closed:" {names} ignorados, todos os dias desta semana caem num período fechado.",
      toast_week_submitted_no_rows:"Esta semana já está submetida, não é possível adicionar mais linhas.",
      toast_all_projects_used_week:"Todos os projetos disponíveis para esta empresa já têm linha esta semana.",
      toast_copy_week_done:"Estrutura da semana anterior copiada, sem durações. {n} linhas novas.",
      toast_copy_week_none:"Todas as linhas da semana anterior já estão presentes.",
      toast_no_earlier_weeks:"Sem semanas de exemplo anteriores.", toast_no_later_weeks:"Sem semanas de exemplo seguintes.",
      toast_template_applied:"Modelo de alocação aplicado aos dias úteis.",
      toast_it0001_changed:"O IT0001 passa a ler {bukrs}. O ZTIME_COMPANY_CFG mapeia isso para {code}: {fields}.",
      toast_week_submitted_locked:"A semana está submetida, não pode ser alterada.",
      toast_day_absence_blocked:"{day} tem uma ausência aprovada, não aceita lançamentos de horas.",
      toast_day_closed_period:"{day} cai num período fechado, não pode receber novas horas.",
      toast_hours_recorded:"{h} h registadas em {code}, {day}.",
      toast_entry_added:"Lançamento adicionado.",
      toast_row_exists_week:"{code} já tem uma linha esta semana. Remove ou junta primeiro.",
      toast_entry_updated:"Lançamento atualizado.",
      toast_row_exists_month:"{code} já tem uma linha este mês. Remove ou junta primeiro.",
      weeks_submitted_approval_one:"{n} semana submetida para aprovação.",
      weeks_submitted_approval_other:"{n} semanas submetidas para aprovação.",
      toast_week_submitted_approval:"Semana {n} submetida para aprovação.",
      toast_high_conf_applied:"{n} sugestões de alta confiança aplicadas. As de confiança média e baixa continuam por rever.",
      toast_timeline_deleted:"Linha do tempo em bruto eliminada. As sugestões pendentes desapareceram com ela.",
      toast_timesheets_approved:"{n} folhas de horas aprovadas numa só ação. As exceções continuam por rever.",
      toast_voice_error:"Erro na entrada de voz: {err}",
      toast_staged_entries_cleared:"Lançamentos em staging limpos. Nada tinha sido gravado.",
      toast_staged_allow_cleared:"Abonos em staging limpos. Nada tinha sido gravado.",
      val_day_exceeds_24h:"O total de {day} excede 24 horas.",
      val_desc_required:"Todos os lançamentos precisam de uma descrição (pelo menos 10 caracteres): {code}.",
      val_absence_move_hours:"{day} tem uma {type} aprovada. As {h} h registadas precisam de sair desse dia.",
      val_partial_absence_capacity:"{day} tem uma ausência parcial aprovada. A capacidade do dia é {cap} h e estão registadas {tot} h.",
      val_day_capacity:"A capacidade de {day} é {cap} h; estão registadas {tot} h.",
      val_pending_leave_conflict:"{day} tem um pedido de ausência pendente e horas registadas. Se o pedido for aprovado, estas horas entram em conflito.",
      val_day_empty:"{day} está vazio.",
      val_week_below_expected:"A semana tem {tot} h registadas; o total esperado com as ausências deduzidas é {expect} h.",
      val_closed_period:"{day} cai no período {ym}, fechado para {bukrs}. Reabrir é uma ação de RH.",
      val_overlapping_windows:"{day} tem janelas horárias sobrepostas: {t1} a {t2} e {t3} a {t4}.",
      val_window_needs_both:"{day}, {code}: a janela precisa de início e fim.",
      val_allow_note_needed:"{name} em {day} precisa de {noteLabel}.",
      val_allow_closed_period:"{name} em {day} cai num período fechado.",
      val_allow_no_amount:"{name} em {day} não tem montante.",
      val_allow_no_qty:"{name} em {day} não tem quantidade.",
      n_suggestions_to_review2_one:"{n} sugestão ainda por rever no painel lateral.",
      n_suggestions_to_review2_other:"{n} sugestões ainda por rever no painel lateral.",
      suggestions_discarded_one:"{n} sugestão dispensada por cair em dias com ausência aprovada.",
      suggestions_discarded_other:"{n} sugestões dispensadas por caírem em dias com ausência aprovada.",
      th_project_wbs_activity:"Projeto, WBS e atividade", row_total_per_day:"Total por dia", btn_remove:"Remover",
      tip_approved_partial_absence:"Ausência parcial aprovada, capacidade de {h} h neste dia",
      btn_copy_last_week:"Copiar semana passada", btn_add_first_project:"Adicionar o primeiro projeto",
      btn_resume_suggestions:"Retomar sugestões", btn_simulate_approval:"Simular aprovação",
      tip_bonus_remove_restricted:"O bónus é removido pelo dono do projeto, no ecrã da equipa.",
      text_no_records_to_generate:"Sem horas nem abonos esta semana, por isso não há registos a gerar.",
      voice_not_supported:"Entrada de voz não suportada neste browser",
      tip_absence_not_available:"{type} aprovada, dia indisponível para lançamentos",
      text_desc_required:"Descrição obrigatória", text_no_description:"Sem descrição",
      aria_remove_row:"Remover linha {name}",
      tip_period_closed:"O período {ym} está fechado para {bukrs}. Reabrir é uma ação de RH.",
      placeholder_desc_required_once:"Descrição (obrigatória assim que há horas lançadas)", placeholder_description_short:"Descrição",
      text_absence_generic:"ausência",
      tip_approved_type:"{type} aprovada", aria_select_name:"Selecionar {name}",
      hdr_no_warnings_group:"Sem avisos, aprovação em massa disponível", hdr_exceptions_group:"Exceções, precisam de revisão individual",
      aria_select_timesheet_for:"Selecionar folha de horas de {name}",
      tip_clock_use_fields:"O Z_BSRV regista início e fim. Usa os campos Início/Fim acima, para as pessoas a quem se aplica.",
      tip_closed_period_short:"Período fechado",
      tip_week_submitted_n:"A semana {n} já foi submetida, não é editável.", tip_approved_abs:"Ausência aprovada: {type}",
      aria_dur_cell:"Duração em horas, {proj}, {day}", aria_desc_cell:"Descrição, {proj}", aria_team_hours:"Horas de {name}, {day}",
      text_sugs_none_absence:"Nada a propor. As sugestões que existiam calhavam em dias com ausência aprovada.",
      text_sugs_none_pending:"Sem sugestões pendentes. Bom sinal, a semana está revista.",
      text_bonus_catsamount:"O montante vai para CATSAMOUNT, campo nativo do CATSDB. O ANZHL vai para o CATS como 1.",
      text_bonus_defined_by:"Definido e aprovado por {name}, no mesmo ato",
      aria_voice_lang:"Língua do ditado: {lang}. Clica para mudar para {next}.", voice_lang_PT:"Português", voice_lang_EN:"Inglês", voice_lang_FR:"Francês",
      aria_start_time_for:"Hora de início, {name}, {day}", aria_end_time_for:"Hora de fim, {name}, {day}",
      sev_error:"ERRO", sev_warning:"AVISO", sev_info:"INFO",
      text_no_allowances_week:"Sem abonos registados esta semana. As ajudas de custo, quilómetros e abonos de turno são registados aqui, contra um projeto e uma data.",
      text_wage_type_label:"tipo de rúbrica {code}",
      text_recorded_by_behalf:"Registado por {name}, em nome do colaborador",
      hint_allow_wage_type:"Tipo de rúbrica {code}, quantidade em ANZHL, unidade {unit}. Nenhum valor é calculado aqui, o payroll valoriza.",
      text_nothing_staged_yet:"Nada em staging ainda.",
      text_nothing_recorded_behalf_week:"Nada registado em nome da equipa ainda, esta semana.",
      text_no_bonus_recorded:"Nenhum bónus registado neste projeto ainda.",
      label_month_total:"Total do mês", label_week_total:"Total da semana",
      n_warnings_no_block_one:"{n} aviso, não bloqueia a submissão", n_warnings_no_block_other:"{n} avisos, não bloqueiam a submissão",
      label_deviation_justification:"Justificação para o desvio face ao total esperado",
      placeholder_justification_month:"Uma linha chega. Fica no histórico do mês.",
      text_h_in_project:"{h} h em projeto", chip_warning_lower:"aviso",
      msg_day_approved_type:"{day} tem uma {type} aprovada.", msg_day_capacity_simple:"A capacidade de {day} é {cap} h.",
      badge_half_day:"meio dia",
      text_no_hours_week_yet:"Ainda sem horas registadas esta semana.", text_no_hours_month_yet:"Ainda sem horas registadas este mês.",
      text_shortest_path:"Começa pelo caminho mais curto.",
      conf_hi:"confiança alta", conf_mid:"confiança média", conf_low:"confiança baixa",
      tip_save_to_finish:"Isto já está em vigor; o Save só reflete na base de dados.",
      placeholder_justification_week:"Uma linha chega. Fica no histórico da semana.",
      chip_approved:"Aprovada",
      note_pending_leave_conflict:"Pedido de ausência pendente sobrepõe-se a horas registadas", note_two_empty_days:"Dois dias úteis vazios",
      val_week_label_prefix:"Semana {n}: {txt}", val_weeks_label_prefix:"Semanas {n}: {txt}",
      link_resolve_move_hours:"resolver, mover as horas", link_go_to_day:"ir para o dia",
      btn_shortcuts:"Atalhos", aria_shortcuts:"Atalhos de teclado",
      btn_settings:"Definições", aria_settings:"Definições de idioma",
      nav_my_timesheet:"A Minha Folha", nav_team:"Lançamento da equipa",
      nav_approval:"Aprovação (gestor)", nav_cats:"Mapeamento CATS",
      aria_prev_week:"Semana anterior", aria_next_week:"Semana seguinte",
      state_draft:"Rascunho", state_in_approval:"Em aprovação, só leitura",
      btn_quick_add:"Adicionar rápido", btn_submit_week:"Submeter semana", btn_save:"Gravar",
      kpi_recorded:"Registado", kpi_in_project:"Em projeto", kpi_validation:"Validação",
      val_no_errors:"Sem erros",
      n_errors_one:"{n} erro", n_errors_other:"{n} erros",
      n_messages_one:"{n} mensagem", n_messages_other:"{n} mensagens",
      n_weeks_one:"{n} semana", n_weeks_other:"{n} semanas",
      n_empty_days_one:"{n} dia útil vazio", n_empty_days_other:"{n} dias úteis vazios",
      n_allowances_one:"{n} abono", n_allowances_other:"{n} abonos",
      n_records_generated_one:"{n} registo gerado", n_records_generated_other:"{n} registos gerados",
      n_lines_left_one:"{n} linha", n_lines_left_other:"{n} linhas",
      err_mass_locked:"Semana já aprovada, a linha ficou como estava.", err_mass_not_allocated:"{name} não está alocado a {code}.", err_mass_absence:"{day} tem uma ausência aprovada ({type}).",
      err_mass_closed:"{day} está num período fechado.", err_mass_24h:"{day} passa das 24 horas.", err_mass_capacity:"A capacidade de {name} em {day} é de {cap} h.", err_mass_window:"{day} precisa de início e fim para {name}.",
      n_people_one:"{n} pessoa", n_people_other:"{n} pessoas",
      n_entries_one:"{n} lançamento", n_entries_other:"{n} lançamentos",
      n_suggestions_review_one:"{n} sugestão a rever", n_suggestions_review_other:"{n} sugestões a rever",
      btn_submit_month:"Submeter mês", btn_month_submitted:"Mês submetido",
      btn_week_submitted:"Semana submetida", chip_in_approval:"Em aprovação",
      kextra_absences:"{h} h de ausências deduzidas", kextra_month_prefix:"{weeks} este mês",
      n_selected_one:"{n} selecionado", n_selected_other:"{n} selecionados",
      lines_staged_suffix_one:"linha em staging", lines_staged_suffix_other:"linhas em staging", h_staged_suffix:"h em staging",
      hdr_week_entries:"Lançamentos da semana", aria_view:"Vista", btn_grid:"Grelha", btn_calendar:"Calendário",
      hdr_how_it_works:"Como funciona?",
      how_step1:"Criar ou selecionar o projeto", how_step2:"Inserir as horas",
      how_step3:"Validar", how_step4:"Guardar ou submeter",
      aria_collapse_how:"Colapsar Como funciona", aria_expand_how:"Expandir Como funciona",
      legend_over:"Total por dia: acima da capacidade", legend_empty:"Dia útil vazio",
      legend_unavailable:"Indisponível (ausência ou dia não útil)", legend_submitted:"Semana já submetida",
      btn_add_row:"Adicionar linha", btn_copy_week:"Copiar semana anterior", btn_apply_template:"Aplicar modelo",
      hint_grid_entry:"Aceita 1.5 · 1:30 · 90m. Enter desce, Tab avança.",
      hint_calendar:"Clica numa vaga para lançar horas nesse dia. Ausências e feriados não são editáveis.",
      hdr_validation_messages:"Mensagens de validação", hdr_allowances:"Abonos",
      btn_add_allowance:"Adicionar abono",
      privacy_allowances:"Ajudas de custo, quilómetros e abonos de turno são registados contra um projeto e uma data, como quantidade e unidade. Não é calculado nenhum valor aqui. O bónus de projeto é a exceção: tem um montante e só o dono do projeto o regista.",
      aria_collapse_suggestions:"Colapsar sugestões", aria_expand_suggestions:"Expandir sugestões",
      aria_collapse_allowances:"Colapsar abonos", aria_expand_allowances:"Expandir abonos",
      hdr_suggestions:"Sugestões desta semana", btn_accept_high_confidence:"Aceitar as de alta confiança",
      privacy_suggestions_intro:"Nada entra na folha de horas sem confirmação.",
      btn_data_collected:"O que é recolhido e onde é guardado",
      hdr_specmap:"Como este protótipo se relaciona com a especificação",
      text_specmap_intro:"Cada ecrã abaixo corresponde a uma secção do documento de especificação, para o refinamento com a equipa de desenvolvimento usar o mesmo vocabulário.",
      spec_e1:"Grelha semanal com edição inline, totais por dia e por linha, copiar semana",
      spec_e2:"Vista de calendário com blocos de projeto e eventos externos a converter",
      spec_e3:"Adicionar rápido em linguagem natural com chips corrigíveis",
      spec_e4:"Sugestões com motivo, nível de confiança e ação explícita",
      spec_e5:"Detalhe do lançamento com contexto de orçamento e histórico",
      spec_e6:"Validação em três níveis de gravidade e resumo antes da submissão",
      spec_e7:"Aprovação em massa com exceções destacadas",
      spec_e10:"Ausências vindas do Leave Request, bloqueio de dias e capacidade parcial",
      spec_e11:"Assistente conversacional com confirmação antes de gravar",
      spec_e12:"Abonos contra um projeto, tipo de rúbrica e quantidade, bónus com um montante",
      spec_e13:"Início e fim conforme o perfil de lançamento, derivado do IT0001",
      spec_e14:"Lançamento da equipa pelo team leader, com gravação parcial e rasto em nome de",
      aria_expand_already:"Expandir já registado", aria_collapse_already:"Colapsar já registado",
      hdr_already_recorded:"Já registado esta semana", hdr_already_allow:"Abonos registados esta semana",
      chip_readonly:"Só leitura",
      hint_already:"Da folha de cada pessoa ou de um lançamento da equipa anterior, mais o que está em staging abaixo mas ainda não gravado. Âmbar aos 8h, vermelho depois disso.",
      hint_already_allow:"Abonos já gravados para esta equipa esta semana, da folha de cada pessoa ou de um lançamento da equipa anterior.",
      tab_hours:"Horas", tab_allowances:"Abonos", tab_bonus:"Bónus",
      hdr_team:"Equipa", hdr_fill_several:"Preencher várias pessoas de uma vez",
      label_duration:"Duração", label_start_time:"Hora de início", label_end_time:"Hora de fim", label_days:"Dias",
      btn_apply_selected:"Aplicar aos selecionados",
      btn_save_staged_entries:"Gravar lançamentos em staging", btn_clear:"Limpar",
      hint_mass_save:"A gravação é parcial. As linhas que falham ficam no ecrã com o motivo. Duração preenche pessoas num perfil de duração, Início/Fim preenche pessoas em Z_BSRV, no mesmo clique.",
      hdr_allowances_selected:"Abonos para as pessoas selecionadas",
      label_wage_type:"Tipo de rúbrica", label_quantity:"Quantidade", label_note:"Nota",
      placeholder_note_required:"Obrigatório para este abono",
      btn_stage_selected:"Pôr em staging para os selecionados", btn_save_staged_allowances:"Gravar abonos em staging",
      hint_mass_allow:"Faturado ao Projeto escolhido no topo do ecrã, o mesmo que Horas usa. O bónus é registado à parte, no separador Bónus.",
      hdr_project_bonus:"Bónus de projeto", label_amount_eur:"Montante, EUR", label_reason:"Motivo",
      placeholder_bonus_reason:"Fim de semana de go-live, corte de payroll",
      btn_record_approve_selected:"Registar e aprovar para os selecionados",
      privacy_bonus:"O bónus é o único abono que o colaborador não regista. O dono do projeto define o montante e aprova no mesmo ato, porque é o projeto que suporta o custo. O montante vive num campo de cliente, já que a CATSDB é uma estrutura de quantidades.",
      hdr_recorded_on_behalf:"Registado em nome de",
      privacy_recorded_on_behalf:"Cada linha mantém CREATED_BY e ON_BEHALF_OF. Não há passo de autoconfirmação: o colaborador vê o lançamento marcado como registado pelo líder, o que informa sem bloquear. Do lado do CATS, o utilizador que submete continua a ficar em ERNAM.",
      kpi_selected:"Selecionados", kpi_staged_not_saved:"Em staging, não gravado", kpi_recorded_on_behalf:"Registado em nome de",
      label_project:"Projeto", label_acting_as:"A atuar como",
      chip_up_to_date:"Atualizado", chip_save_to_finish:"Gravar para terminar", hint_click_save:" Clica em Gravar para terminar.",
      btn_select_no_warnings:"Selecionar os 4 sem avisos", chip_project_team:"Equipa do projeto", btn_approve_selected:"Aprovar selecionados",
      text_approval_sub:"A fila de outra pessoa, não a tua própria semana. Cobre as pessoas nos projetos de consultoria da Sofia (Banking, Retail, Airports). Nada do que submetes em A Minha Folha aparece aqui.",
      text_approval_sub_pt02:"A fila de outra pessoa, não a tua própria semana. Cobre as pessoas nos projetos de facilities da Patrícia (Hospital campus, Airport terminal). Nada do que submetes em A Minha Folha aparece aqui.",
      kpi_pending_approval:"Pendente de aprovação", kpi_hours_submitted:"Horas submetidas",
      kpi_with_warnings:"Com avisos", kpi_deviation_from_plan:"Desvio face ao plano",
      hdr_team_allocated:"Equipa alocada aos meus projetos", chip_integrates:"Integra com My Inbox e SAP Task Center",
      th_employee:"Colaborador", th_total:"Total", th_deviation:"Desvio", th_status:"Estado",
      aria_select_all:"Selecionar tudo",
      hint_bulk_approval:"A aprovação em massa só está disponível para linhas sem avisos. A rejeição exige um motivo, conforme o standard SAP.",
      label_cats_header:"Da interface para o CATS", chip_annex_a:"Anexo A da especificação",
      kpi_recording_target:"Destino do registo", kpi_assistance_layer:"Camada de apoio",
      kpi_direct_table_write:"Escrita direta na tabela", val_never:"Nunca", kpi_customer_fields:"Campos de cliente",
      hdr_state_chain:"Cadeia de estados e transferência",
      step_draft:"Rascunho", step_draft_sub:"Só BTP",
      step_saved:"Gravado", step_saved_sub:"CATSDB, em processo",
      step_in_approval:"Em aprovação", step_in_approval_sub:"libertado, STATUS",
      step_approved:"Aprovado", step_approved_sub:"APNAM, APDAT",
      step_posted:"Contabilizado", step_posted_sub:"CATA, CAT5, CAT7, CAT9",
      rule_1:"A partir de <strong>Em aprovação</strong>, editar deixa de ser uma alteração. A correção cria um novo registo que aponta para o original via <span class=\"num\">REFCOUNTER</span>, e volta a passar por aprovação.",
      rule_2:"O bloqueio de células reflete o que já foi transferido, não só o que foi aprovado. A transferência corre como um job, por isso a interface mostra a data do próximo ciclo em vez de fingir que é instantâneo.",
      hdr_field_mapping:"Mapeamento campo a campo", chip_cats_or_btp:"CATS, BTP ou campo de cliente",
      th_interface_element:"Elemento de interface", th_sap_concept:"Conceito SAP", th_field:"Campo", th_where_lives:"Onde vive",
      hdr_cats_records:"Registos CATS gerados a partir da semana preenchida", aria_format:"Formato",
      btn_table:"Tabela", btn_api_payload:"Payload da API",
      hint_cats_table:"Gerado ao vivo a partir da grelha do ecrã A Minha Folha. LTXA1 é truncado a 40 caracteres, o limite real do campo.",
      assistant_fab:"Assistente", assistant_title:"Assistente", chip_joule_pattern:"Padrão Joule",
      btn_close:"Fechar", aria_close_assistant:"Fechar o assistente",
      placeholder_chat:"2h BNK teste de payroll ontem", btn_send:"Enviar",
      jfoot_text:"Nunca grava sem confirmação. Os lançamentos criados aqui ficam marcados com origem <span class=\"num\">Joule</span> e passam pelas mesmas validações.",
      aria_dictate:"Ditar por voz",
      bot_greeting:"Olá, {name}! Posso registar horas, para ti ou para a equipa, consultar a semana, tratar de ausências, aprovar folhas de horas, ou levar-te diretamente ao ecrã certo. Em que posso ajudar?",
      bot_greeting_1:"Olá! Em que posso ajudar: registar horas, consultar a semana, ou outra coisa?",
      bot_greeting_2:"Olá. Diz-me o que precisas e eu trato disso.",
      bot_greeting_3:"Olá! Horas para registar, ou algo para consultar?",
      chip_done_saved:"Gravado", chip_done_submitted:"Submetido", chip_done_sent:"Enviado para aprovação", chip_done_withdrawn:"Retirado", chip_done_approved:"Aprovado", label_week_card:"Semana", text_schedule_h_day:"horário de {h} h/dia", fmt_week_range:"semana {n} ({from} a {to})", fmt_week_range_bare:"{n} ({from} a {to})", tip_windows_overlap:"Há duas janelas horárias sobrepostas neste dia.", chip_confirmed:"confirmado", chip_cancelled:"cancelado",
      bot_cancelled_no_save:"Sem problema, não gravei nada.",
      bot_week_summary:"Tens {tot} h registadas de {exp} h esperadas, já com as ausências deduzidas. ",
      bot_week_errors_block_one:"{n} erro bloqueia a submissão.", bot_week_errors_block_other:"{n} erros bloqueiam a submissão.",
      bot_week_no_errors_submit:"Sem erros, já podes submeter.",
      bot_absences_intro:"Estas são as ausências desta semana, vindas do pedido de férias/ausência. Dias com uma ausência de dia inteiro aprovada não aceitam lançamentos.",
      bot_help_text:"Algumas coisas que posso fazer: registar as tuas horas (<span class=\"num\">2h BNK payroll testing yesterday</span>), registar para alguém da equipa (<span class=\"num\">4h for João today</span>), consultar a semana ou as ausências, copiar a semana anterior, aplicar as sugestões de maior confiança, submeter a semana, aprovar folhas de horas, ou ir para Equipa, Aprovação ou Mapeamento CATS. Escreve em linguagem normal.",
      bot_switched_to:"Mudei para {screen}.",
      bot_suggestions_available:"Tens {n} sugestões para rever no painel lateral. Posso aplicar as de maior confiança, se quiseres.",
      bot_no_suggestions:"Sem sugestões para rever.",
      bot_no_high_conf:"Não tenho nenhuma sugestão de alta confiança pendente.",
      bot_confirm_apply_suggestions:"Confirmas aplicar estas sugestões?", btn_apply:"Aplicar",
      bot_suggestions_applied:"{n} sugestões aplicadas. ",
      bot_copy_week_offer:"Posso trazer a estrutura da semana anterior, sem durações.",
      label_action:"Ação", bot_copy_rows_value:"copiar as linhas da semana anterior",
      label_durations:"Durações", bot_stay_zero_value:"ficam a zero", btn_copy:"Copiar",
      bot_copy_week_done:"Feito. As linhas estão criadas, as durações ainda precisam de ser preenchidas.",
      bot_week_already_submitted:"A semana já está submetida e em aprovação.",
      bot_cant_submit_week_one:"Ainda não posso submeter a semana {num}: há {n} erro que o impede.", bot_cant_submit_week_other:"Ainda não posso submeter a semana {num}: há {n} erros que o impedem.",
      bot_cant_submit_month_one:"Ainda não posso submeter o mês de {month}: há {n} erro que o impede.", bot_cant_submit_month_other:"Ainda não posso submeter o mês de {month}: há {n} erros que o impedem.",
      bot_cant_submit_fix:"Corrige e pede-me de novo, que eu submeto logo.",
      bot_month_already_submitted:"O mês de {month} já está submetido e em aprovação.",
      bot_confirm_submit_month:"Confirmas submeter o mês de {month} para aprovação? Inclui todas as semanas do mês ainda abertas.",
      bot_month_submitted_msg:"Mês de {month} submetido. Está agora em aprovação com {names}.",
      bot_submit_weekly_only:"Aqui a timesheet é semanal, por isso a submissão é feita à semana.",
      bot_month_summary:"Em {month} tens {tot} h registadas de {exp} h esperadas, já com as ausências deduzidas. ",
      bot_month_no_errors_submit:"Sem erros, já podes submeter o mês.",
      label_month:"Mês", label_weeks:"Semanas", label_warnings:"Avisos", fmt_month_year:"{month} de {y}",
      bot_confirm_submit_week:"Confirmas submeter a semana {num}?",
      label_expected:"Esperado", label_status_after_submit:"Estado após submeter",
      bot_week_submitted_msg:"Semana {num} submetida. Está agora em aprovação com {names}.",
      bot_week_locked:"A semana já está submetida, não a posso alterar. Queres ver outra coisa?",
      bot_day_absence_no_alt:"{day} tem uma {type} aprovada e não há outro dia com capacidade livre. Não registei nada.",
      bot_day_absence_suggest:"{day} tem uma {type} aprovada, por isso não aceita horas. Sugiro {alt}.",
      bot_day_closed:"{day} está num período fechado, não pode receber novas horas. Não registei nada.",
      bot_day_abs_cap:"{day} tem uma {type} aprovada.", bot_day_capacity:"A capacidade de {day} é {cap} h.",
      bot_hours_left_suffix:" Só há {left} h disponíveis, não registei nada.",
      bot_no_hours_suffix:" Não há horas disponíveis nesse dia, não registei nada.",
      bot_confirm_entry:"Confirmas este lançamento?", label_receiver_object:"Objeto recetor",
      bot_receiver_pep:"PEP {code}", bot_receiver_cost_center:"Centro de custo {code}",
      bot_desc_tbd:"(por preencher)", bot_entry_saved:"{dur} h gravadas em {day}, {code}. ",
      bot_every_day_blocked:"Todos os dias desse intervalo têm uma ausência aprovada, caem num período fechado, ou não têm espaço para essa quantidade. Não registei nada.",
      bot_skip_absence_closed:"{days} (ausência aprovada ou período fechado)", bot_skip_over_capacity:"{days} (acima da capacidade)",
      bot_days_skipped_suffix:" ({parts} ignorados)", label_duration_per_day:"Duração por dia",
      bot_entry_saved_days_one:"{dur} h gravadas em {n} dia ({total} h no total), {code}. ",
      bot_entry_saved_days_other:"{dur} h gravadas em {n} dias ({total} h no total), {code}. ",
      bot_week_capacity_full:"Todos os dias úteis desta semana já estão à capacidade.",
      bot_month_capacity_full:"Todos os dias úteis deste mês já estão à capacidade.",
      bot_filled_saved_one:"{total} h gravadas em {n} dia, {code}. ", bot_filled_saved_other:"{total} h gravadas em {n} dias, {code}. ",
      bot_filled_saved_month_one:"{total} h gravadas em {n} dia, {code}, este mês. ",
      bot_filled_saved_month_other:"{total} h gravadas em {n} dias, {code}, este mês. ",
      bot_cant_stage:"Não consigo colocar isso em preparação: {list}.", bot_week_already_approved:"{name} (semana já aprovada)",
      label_people:"Pessoas", label_time:"Horário", label_duration_each:"Duração de cada", label_skipped:"Ignorados",
      bot_confirm_register_staging:"Registar isto para a equipa, em nome de cada pessoa?", btn_register:"Registar",
      bot_staged_saved:"Registado e gravado para {names}, {days} da {week}, {code}, em nome de cada pessoa. Estão no Lançamento da equipa, separador Horas, nessa semana.",
      bot_staged_nothing:"Não foi registado nada.",
      bot_staged_not_saved_suffix:" {names} não conseguiu(ram) desta forma (não alocado a {code}, perfil errado para esse campo, ausência, ou período fechado), o motivo está no ecrã Equipa.",
      bot_note_required:"{noteLabel} é obrigatório para {name}. O que deve dizer?",
      label_quantity_each:"Quantidade de cada",
      bot_staged_saved_allow:"Registado e gravado para {names}, {days} da {week}, {name}, em nome de cada pessoa. Estão no Lançamento da equipa, separador Abonos, nessa semana.",
      bot_staged_not_saved_allow_suffix:" {names} não conseguiu(ram) (não alocado a {code}, empresa errada para esse abono, ou período fechado).",
      bot_team_nobody_missing:"Ninguém na equipa de {code} tem dias úteis por preencher esta semana.",
      bot_team_already_full:"{names} já está(ão) com a capacidade completa esta semana, na equipa de {code}.",
      bot_team_person_not_found:"Não encontrei ninguém chamado \"{name}\" na equipa de {code}.",
      bot_confirm_fill_team:"Preencher estes dias em falta até à capacidade de cada pessoa?",
      btn_fill_and_register:"Preencher e registar",
      bot_team_filled_saved:"Horas em falta preenchidas e gravadas para {names}, em nome de cada pessoa, na {week}. Estão no Lançamento da equipa, separador Horas, nessa semana.",
      bot_team_filled_nothing:"Não foi registado nada.",
      bot_team_filled_not_saved_suffix:" {names} não conseguiu(ram), o motivo está na grelha da Equipa.",
      bot_approval_ask_who:"Diz-me quem aprovar, um nome, ou “aprovar todos” para todas as folhas de horas sem exceções.",
      bot_approval_nothing:"Não há nada para aprovar aí, ou já está tudo aprovado, ou o que resta tem uma exceção que precisa de revisão individual.",
      bot_confirm_approve_all:"Aprovar estas {n} folhas de horas, sem exceções?", btn_approve_all:"Aprovar todas",
      bot_approved_all_msg:"{n} folhas de horas aprovadas. As exceções ficam para revisão individual.",
      bot_already_approved:"A folha de horas de {name} já está aprovada.",
      bot_has_exception:"A folha de horas de {name} tem uma exceção ({note}) e precisa de revisão individual no ecrã de Aprovação, essa não pode ser aprovada em bloco.",
      bot_confirm_approve_one:"Aprovar a folha de horas de {name}?", label_in_project:"No projeto", btn_approve:"Aprovar",
      bot_approved_one_msg:"Folha de horas de {name} aprovada.",
      fmt_week_n:"semana {n}", bot_gap_row:"{day}: {h} de {cap} h, faltam {left} h",
      bot_gaps_head_one:"Em {period} ainda tens {n} dia por completar, {h} h no total. Tens {tot} h de {exp} h:", bot_gaps_head_other:"Em {period} ainda tens {n} dias por completar, {h} h no total. Tens {tot} h de {exp} h:",
      bot_gaps_none:"Não falta nada em {period}: {tot} h de {exp} h registadas.",
      bot_recorded_head:"Em {period} tens {tot} h registadas de {exp} h esperadas:", bot_recorded_none:"Ainda não tens horas registadas em {period}.",
      chip_fill_missing:"Preencher as horas em falta", chip_what_missing:"O que me falta?",
      bot_claude_unavailable:"Neste momento não consigo ligar ao Claude, por isso não consigo responder. Tenta de novo daqui a pouco.",
      bot_parse_failed:"Não consegui perceber o que registar. Escreve a duração e o projeto, por exemplo <span class=\"num\">2h BNK payroll testing yesterday</span>. Também posso mostrar o estado da semana ou as tuas ausências.",
      bot_parse_failed_generic:"Não consegui confirmar todos os detalhes desse registo. Podes escrever de outra forma?",
      bot_which_project:"A que projeto se destinam essas horas?",
      bot_team_not_found:"não encontrei \"{name}\" na equipa de {code} ({leader}). Se está noutro projeto ou com outro líder, muda o seletor \"Acting as\" ou \"Project\" no topo do ecrã Team primeiro",
      bot_team_who_unclear:"não percebi de quem se trata", bot_team_day_unclear:"não percebi o dia",
      bot_team_amount_unclear:"não percebi {amount}", label_the_hours:"as horas", label_the_quantity:"a quantidade",
      bot_also_unrecognized_wage_type:"Também não reconheci o tipo de rúbrica.",
      chip_hours_i_have:"Quantas horas tenho?", chip_my_absences:"As minhas ausências", chip_bnk_example:"2h BNK teste de payroll ontem",
      chip_submit_week:"Submeter a semana", chip_submit_month:"Submeter o mês", chip_copy_last_week:"Copiar a semana anterior",
      chip_apply_high_conf:"Aplicar as de maior confiança", chip_help:"Ajuda",
      dlg_add_allowance_title:"Adicionar abono", chip_wage_type:"Tipo de rúbrica", label_allowance:"Abono", label_day:"Dia",
      btn_cancel:"Cancelar", btn_record_allowance:"Registar abono",
      dlg_quick_add_title:"Adicionar rápido", label_write_natural:"Escreve em linguagem natural",
      placeholder_quick_nl:"3h BNK análise de requisitos ontem", chip_waiting_text:"à espera de texto",
      chip_duration_to_set:"duração por definir", chip_project_to_choose:"projeto por escolher", chip_activity_to_set:"atividade por definir", chip_desc_prefix:"descrição: {txt}",
      text_period_closed_paren:"(período fechado)", hint_calendar_month:"Vista do mês só de leitura. Lança ou altera horas na vista Grelha.",
      text_week_already_approved:"semana já aprovada", text_staged_not_saved_short:"em staging, não gravado", unit_h_per_day:"{h} h/dia", text_n_staged:"{n} em staging",
      text_quick_hint:"Cada campo resolvido pode ser corrigido. Se o texto não for reconhecido, vai para a descrição e nada é inventado.",
      btn_save_entry:"Gravar lançamento",
      dlg_entry_detail_title:"Detalhe do lançamento", label_project_wbs:"Projeto e WBS",
      label_start:"Início", label_end:"Fim", label_activity_type:"Tipo de atividade", label_description:"Descrição",
      placeholder_description:"Obrigatória, pelo menos 10 caracteres. Os primeiros 40 vão para o LTXA1",
      placeholder_description_optional:"Obrigatória, pelo menos 10 caracteres. Os primeiros 40 vão para o LTXA1",
      label_project_effort:"Esforço do projeto, real vs. planeado",
      label_origin:"Origem", val_manual:"Manual", label_created_by:"Criado por", label_last_changed:"Última alteração",
      btn_back:"Voltar", btn_submit:"Submeter",
      dlg_my_data_title:"Os meus dados", text_data_intro:"Para propor lançamentos, a app só usa metadados, ao nível do projeto:",
      row_calendar_events:"Eventos do calendário corporativo", row_tickets_handled:"Tickets tratados",
      row_repos_activity:"Repositórios com atividade", row_content_emails:"Conteúdo de emails, ficheiros ou capturas de ecrã",
      row_raw_timeline:"Retenção da linha do tempo em bruto",
      chip_metadata_only:"só metadados", chip_project_level:"nível de projeto", chip_never_collected:"nunca recolhido",
      val_14_days:"14 dias", chip_or_until_confirmed:"ou até confirmar",
      text_data_footer:"Esta linha do tempo só é visível para ti. A organização só vê os lançamentos que submetes. Base legal e avaliação de impacto a validar com o DPO antes do piloto.",
      btn_delete_timeline:"Eliminar linha do tempo",
      dlg_shortcuts_title:"Atalhos de teclado",
      row_open_close_assistant:"Ir para o assistente", row_new_quick_add:"Novo adicionar rápido",
      row_copy_previous_week:"Copiar semana anterior", row_prev_next_week:"Semana anterior e seguinte",
      row_confirm_cell:"Confirmar célula e descer", row_show_list:"Mostrar esta lista",
      bot_balance_asof:"A {date} o teu saldo de férias será de {avail} dias: {total} de direito, {used} gozados ou aprovados até lá e {req} pedidos à espera.",
      bot_movements_intro:"A tua conta de férias de {y}, movimento a movimento. Disponível agora: {avail} dias.",
      bot_request_status:"Pedido {id}: {who}{type}, {period}. Estado: {status}.",
      bot_request_not_found:"Não encontro o pedido {id} entre os teus. Estes são os teus pedidos:",
      bot_request_which:"Qual pedido? Estes são os teus:",
      bot_approvers_ts_month:"A tua timesheet é submetida ao mês e aprovada por {names}.",
      bot_approvers_ts_week:"A tua timesheet é submetida à semana e aprovada por {names}.",
      bot_approvers_leave:"As tuas ausências vão para {name}.",
      bot_submit_check_ok_month:"Nada bloqueia o mês de {month}: {total} h de {exp} h esperadas. Quando o submeteres, vai para {names}.",
      bot_submit_check_ok_week:"Nada bloqueia a semana {num}: {total} h de {exp} h esperadas. Quando a submeteres, vai para {names}.",
      bot_holidays_next:"Os próximos feriados (calendário de {office}), sem horas esperadas e sem desconto nas férias:",
      bot_holidays_month:"Feriados em {month} (calendário de {office}), sem horas esperadas e sem desconto nas férias:",
      bot_holidays_none:"Não há feriados em {month} (calendário de {office}).",
      bot_teamcal_intro:"Quem está ausente, {when}:",
      bot_teamcal_none:"Ninguém do teu calendário da equipa está ausente, {when}.",
      bot_team_balances_only_manager:"Os saldos da equipa são vistos pela chefia ({name}). Posso dizer-te o teu.",
      bot_team_balances_intro:"Saldos de férias da tua equipa em {y}:",
      text_team_balance_row:"{name} · {avail} dias disponíveis, {req} pendentes",
      bot_leave_nothing_to_change:"Não tens nenhum pedido pendente para alterar. Um pedido aprovado cancela-se e pede-se de novo.",
      bot_leave_which_change:"Que pedido queres alterar? Só os pendentes podem ser alterados:",
      bot_leave_cannot_change:"O pedido {id} já não pode ser alterado ({status}). Só um pedido pendente pode; um aprovado cancela-se e pede-se de novo.",
      bot_leave_change_what:"O que muda no pedido {id}? Diz-me as novas datas ou o tipo, ou abre o formulário.",
      bot_leave_confirm_change:"Aqui está o pedido {id} com a alteração. Volta para {name} aprovar.",
      bot_leave_changed_msg:"Alterado. O pedido {id} voltou para {name} aprovar.",
      bot_leave_onbehalf_only_manager:"Só a chefia regista uma ausência em nome de outra pessoa ({name}, na tua equipa). Posso pedir a tua.",
      bot_leave_onbehalf_who:"Para quem é? Posso registá-la para alguém que reporta diretamente a ti: {list}.",
      bot_leave_onbehalf_confirm:"Vou registar esta ausência para {name}, aprovada no momento do registo.",
      bot_leave_onbehalf_done:"Registada para {name}, já aprovada.",
      bot_allow_bonus_owner:"O bónus de projeto é registado pelo responsável do projeto para a equipa, no Lançamento da equipa, nunca na tua própria timesheet.",
      bot_allow_turno_pt02:"O subsídio de turno só existe na Building Solutions (PT02).",
      bot_allow_country:"Em que país? A ajuda de custo no estrangeiro precisa dele.",
      bot_allow_which_project:"Para que projeto é a {name}?",
      bot_allow_confirm:"Aqui está o abono a registar. Nada é gravado sem confirmares.",
      bot_allow_recorded:"Registado: {name} em {day}, {qty} dias.",
      bot_pending_in_month_one:"{n} pedido de ausência por decidir em {month}:", bot_pending_in_month_other:"{n} pedidos de ausência por decidir em {month}:",
      bot_pending_in_month_none:"Nada à tua espera em {month}.",
      bot_ts_queue_month:"Na Consultoria cada timesheet é o mês inteiro da pessoa, aqui {month}.",
      bot_ts_queue_week:"Na Building Solutions cada timesheet é uma semana."
    },
    fr: {
      navg_timesheet:"Feuille de temps",
      aria_main_nav:"Zones principales",
      navg_leave:"Absences",
      tab_ts_mine:"Mes saisies",
      tab_ts_team:"Saisie d'équipe",
      tab_ts_approval:"Approbation",
      tab_lv_mine:"Mes demandes",
      tab_lv_teamcal:"Calendrier de l'équipe",
      tab_lv_approval:"Approbation",
      text_sugs_none:"Aucune suggestion appliquée.",
      toast_sugg_day_full:"{day} a déjà toutes ses heures, la suggestion n'a pas été appliquée.",
      toast_sugg_trimmed:"{day} : seules {h} h tenaient, la suggestion a été ajustée.",
      text_sugs_applied:"{n} suggestions appliquées.",
      text_sugs_trimmed:"{n} ajustées aux heures restantes du jour.",
      text_sugs_skipped:"{n} laissées de côté, le jour était déjà complet.",
      text_sug_day_full:"Jour déjà complet",
      text_sug_trimmed_short:"sur {h} h, le reste ne tient pas",
      text_sug_room:"Il ne reste que {h} h ce jour : elle sera ajustée.",
      btn_accept:"Accepter",
      btn_dismiss:"Ignorer",
      bot_desc_too_short:"La description doit avoir au moins 10 caractères : complétez-la sur la carte, ou écrivez-la ici.",
      placeholder_desc_card:"Ce que vous avez fait",
      hint_desc_min:"Description obligatoire, au moins 10 caractères",
      bot_confirm_entry_desc:"Confirmer cette saisie ? Cette ligne n'a pas encore de description : dites-moi ce que vous avez fait, ici ou sur la carte, puis enregistrez.",
      bot_no_profile_switch:"Je ne peux vous aider qu'avec vos propres données : vos heures, vos absences et ce qu'il vous revient d'approuver.",
      attach_doc_0200:"certificat médical",
      attach_doc_0210:"attestation de présence",
      attach_doc_0400:"justificatif",
      text_required_lower:"obligatoire",
      leave_err_attachment:"La pièce jointe ({doc}) est obligatoire pour ce type d'absence.",
      lvw_no_attachment_doc:"Sans pièce jointe ({doc})",
      bot_leave_confirm_attach:"Voici la demande. Ce type d'absence demande une pièce jointe ({doc}) : ajoutez-la sur la carte puis envoyez. Elle part chez votre responsable direct, rien n'est envoyé sans votre confirmation.",
      placeholder_dmy:"JJ/MM/AAAA",
      aria_pick_date:"Choisir une date",
      text_submit_approvers:"Part pour approbation chez {names}.",
      bot_reply_lang_note:"Réponse en français, la langue dans laquelle vous écrivez. Les écrans gardent la langue choisie dans les Paramètres.",
      text_leave_sub_no_ts:"Les demandes vont à {name}, votre responsable direct dans la structure organisationnelle.",
      nav_team_calendar:"Calendrier de l'équipe",
      text_tc_sub:"Les absences de vos collègues sous le même responsable, approuvées et en attente.",
      text_tc_sub_manager:"Les absences de vos collaborateurs directs, un niveau plus bas à la demande, et celles de vos pairs.",
      voice_blocked_short:"La dictée vocale n'est pas disponible dans cette page ; cliquez pour voir l'alternative",
      bot_voice_blocked:"La dictée vocale du navigateur a besoin du micro, et la page claude.ai où tourne cette maquette ne lui donne pas cet accès. Ce qui marche ici, c'est la dictée du système, qui écrit directement dans la zone de texte : touche Windows + H sous Windows, deux appuis sur Fn (ou la touche globe) sur Mac, ou le micro du clavier du téléphone. Ouvert directement dans le navigateur, le bouton fonctionne dans Chrome et Edge.",
      bot_voice_unsupported:"Ce navigateur n'a pas de reconnaissance vocale. Utilisez la dictée du système, qui écrit directement dans la zone de texte : touche Windows + H sous Windows, deux fois Fn sur Mac, ou le micro du clavier du téléphone.",
      bot_voice_network:"Le service vocal du navigateur n'a pas répondu. Réessayez, ou utilisez la dictée du système : touche Windows + H sous Windows, deux fois Fn sur Mac.",
      voice_err_no_mic:"Aucun micro trouvé.",
      nav_leave_approval:"Approbation des absences",
      hdr_leave_approval:"Approbation des absences",
      hdr_leave_from_reports:"Demandes de mes collaborateurs directs",
      aria_la_filter:"Quelles demandes afficher",
      hint_bulk_leave:"L'approbation groupée concerne seulement les demandes sans avertissement. Un refus demande un motif, que le collaborateur voit.",
      lvw_overlap:"Chevauche {names}",
      lvw_balance:"Solde négatif",
      lvw_cancel:"Annulation d'une absence approuvée",
      lvw_retro:"Rétroactive",
      lvw_no_attachment:"Sans certificat médical",
      hdr_decided_group:"Décidées dans cette session",
      text_la_none_pending:"Rien à approuver. Choisissez Tous pour voir ce qui a été décidé.",
      aria_select_leave_for:"Sélectionner la demande de {name}",
      text_n_also_out:"{n} autres absents",
      text_team_complete:"équipe au complet",
      btn_view_request:"Détail de la demande",
      view_day:"Jour",
      view_week:"Semaine",
      view_month:"Mois",
      tab_direct_reports:"Collaborateurs directs",
      tab_peers:"Mes pairs",
      hdr_my_hierarchy:"Ma hiérarchie",
      hdr_my_colleagues:"Mes collègues",
      placeholder_search_people:"Rechercher des personnes",
      label_absent_n:"Absents ({n})",
      n_direct_reports_one:"1 collaborateur direct",
      n_direct_reports_other:"{n} collaborateurs directs",
      text_you_suffix:"vous",
      aria_fullscreen:"Plein écran",
      aria_prev_period:"Précédent",
      aria_next_period:"Suivant",
      aria_show_person:"Afficher les absences de {name}", aria_expand_reports:"Afficher les collaborateurs directs de {name}",
      label_week_short:"Semaine {n}",
      text_absent_generic:"Absent",
      text_tac_nobody:"Personne à afficher avec ces filtres.",
      text_tac_privacy:"Les absences pour raison de santé des collègues apparaissent seulement comme Absent.",
      lrmap_asof:"Solde à une date",
      lrmap_holidays:"Jours fériés",
      lrmap_teamcal:"Calendrier des absences de l'équipe",
      lrmap_mass:"Approuver plusieurs à la fois",
      lrmap_change:"Modifier une demande en attente",
      lrmap_attach:"Pièce jointe",
      lrmap_onbehalf:"Saisie par le responsable",
      hdr_my_time_off:"Mes absences",
      hdr_team_time_off:"Absences de l'équipe",
      kpi_absent_today:"Absents aujourd'hui",
      acc_vacation:"Congés payés {y}",
      text_acc_available_as_of:"jours disponibles au {date}",
      acc_entitlement:"Droit",
      acc_taken:"Pris",
      acc_planned:"Planifiés",
      acc_pending:"En attente",
      acc_available:"Disponible",
      acc_carryover_note:"Dont {n} jours reportés de {y}.",
      text_acc_after_all:"Il reste {n} jours à demander une fois comptées toutes les demandes approuvées et en attente.",
      btn_view_movements:"Voir les mouvements",
      dlg_account_title:"Congés payés {y} : mouvements",
      mv_entitlement:"Droit annuel",
      mv_carryover:"Report de {y}",
      mv_used_before:"Pris plus tôt dans l'année",
      hint_cal_pick:"Cliquez sur le premier puis sur le dernier jour pour demander une absence.",
      hint_cal_pick_end:"À partir du {date} : cliquez maintenant sur le dernier jour (le même pour un seul jour).",
      legend_approved:"Approuvée",
      legend_pending:"En attente d'approbation",
      legend_cancel:"Annulation en attente",
      legend_holiday:"Jour férié ou week-end",
      legend_holiday_weekend:"Jour férié ou week-end",
      legend_team:"Collègues absents",
      text_no_requests_filter:"Rien à afficher ici.",
      btn_edit:"Modifier",
      wf_submitted:"Envoyée par {name}",
      wf_onbehalf:"Saisie par {name} pour le collaborateur, approuvée à la saisie",
      wf_changed:"Modifiée par le collaborateur",
      wf_waiting:"En attente d'approbation par {name}",
      wf_approved:"Approuvée par {name}",
      wf_rejected:"Refusée par {name}",
      wf_withdrawn:"Retirée par le collaborateur",
      wf_cancel_waiting:"Annulation en attente de {name}",
      wf_cancelled:"Annulation approuvée par {name}",
      wf_posted:"Enregistrée dans les données de temps",
      dlg_leave_detail:"Demande d'absence {id}",
      n_holidays_skipped_one:"1 jour férié non décompté",
      n_holidays_skipped_other:"{n} jours fériés non décomptés",
      label_attachment:"Pièce jointe",
      hint_attach_required:"certificat médical",
      hint_attach_optional:"facultatif, par exemple une attestation de présence",
      text_attach_local:"Dans cette maquette, seul le nom du fichier est gardé, le fichier reste sur votre ordinateur.",
      toast_attached:"{file} joint à la demande {id}.",
      label_manager_comment:"Commentaire du responsable",
      hdr_workflow:"Circuit d'approbation",
      hdr_also_absent:"Également absents sur cette période",
      text_nobody_else:"Personne d'autre dans l'équipe.",
      btn_approve_selected_n:"Approuver la sélection ({n})",
      n_leave_approved_one:"1 demande d'absence approuvée.",
      n_leave_approved_other:"{n} demandes d'absence approuvées.",
      filter_all_types:"Tous les types",
      th_team_member:"Collaborateur",
      btn_record_leave:"Saisir une absence",
      dlg_edit_leave:"Modifier la demande {id}",
      dlg_leave_for:"Absence de {name}",
      btn_save_changes:"Envoyer les modifications",
      text_balance_now_after:"Solde {now} jours, {n} après cette demande",
      text_onbehalf_note:"Approuvée à la saisie, puisque l'approbation vous revient",
      text_also_absent_short:"Également absents : {list}",
      toast_leave_changed:"Demande {id} modifiée, elle repart chez {name} pour approbation.",
      toast_leave_onbehalf:"Absence saisie pour {name} et approuvée.",
      leave_warn_attachment:"Joignez le certificat médical. Vous pouvez aussi le faire plus tard, dans le détail de la demande.",
      aria_prev_month:"Mois précédent",
      aria_next_month:"Mois suivant",
      hdr_time_accounts:"Comptes de temps",
      label_balance_as_of:"Solde au",
      hdr_my_calendar:"Mon calendrier",
      label_show_team:"Afficher les absences de l'équipe",
      btn_today:"Aujourd'hui",
      filter_upcoming:"À venir",
      filter_history:"Historique",
      filter_approved:"Approuvées",
      hdr_team_calendar:"Calendrier des absences de l'équipe",
      hdr_team_balances:"Soldes de congés de l'équipe",
      th_date:"Date",
      th_movement:"Mouvement",
      th_days:"Jours",
      bot_lang_followed:"Passage au français, la langue dans laquelle vous écrivez. Vous pouvez la changer dans les Paramètres.",
      chip_not_your_project:"{code} ne fait pas partie de vos projets",
      bot_which_project_for:"Sur quel projet dois-je saisir les {dur} h de {when} ?",
      bot_which_project_fill:"Sur quel projet dois-je saisir les heures manquantes ?",
      bot_project_not_allocated:"Vous n'êtes pas affecté au projet {code}, je ne peux donc pas y saisir d'heures. Vos projets sont {list}.",
      text_every_weekday:"tous les jours ouvrés de cette semaine",
      text_days_missing:"les jours où il manque des heures",
      bot_day_outside_week:"Ce jour n'est pas dans la semaine affichée. Ouvrez sa semaine dans Ma feuille, ou indiquez un jour de cette semaine.",
      wt_AJC_NAC:"Indemnité journalière nationale",
      wt_AJC_INT:"Indemnité journalière à l'étranger",
      wt_KMS:"Kilomètres en véhicule personnel",
      wt_TURNO:"Prime d'équipe",
      wt_BONUS:"Prime de projet",
      label_route:"Trajet",
      label_road_distance:"Distance par la route",
      label_to_record:"À enregistrer",
      label_trip_from:"Départ",
      label_destination:"Arrivée",
      label_round_trip:"Aller-retour",
      label_office_base:"{city} (bureau)",
      km_one_way:"aller simple",
      km_round_trip:"aller-retour",
      km_per_leg:"{km} km par trajet",
      km_estimated:"(estimation d'après la carte)",
      bot_km_confirm:"Voici les kilomètres. J'ai calculé la distance entre les deux lieux ; vérifiez avant que je l'enregistre.",
      bot_km_confirm_given:"Voici les kilomètres indiqués. Je n'ai pas la distance de ce trajet, vérifiez donc le chiffre avant que je l'enregistre.",
      bot_km_recorded:"{km} km enregistrés le {day}, {route}, projet {code}. Ils figurent dans les indemnités de la semaine.",
      bot_km_which_route:"Entre quels lieux ? Par exemple : km de Lisbonne à Porto hier.",
      bot_km_unknown_place:"Je n'ai pas la distance jusqu'à {place} dans cette maquette. Indiquez les kilomètres (par exemple, 120 km) et je les enregistre avec ce trajet.",
      bot_km_future:"Les kilomètres s'enregistrent après le déplacement, et le {date} n'est pas encore arrivé.",
      bot_km_no_week:"Le {date} est en dehors des semaines disponibles dans le relevé.",
      bot_km_week_submitted:"La semaine du {date} a déjà été soumise, elle ne prend plus d'indemnités.",
      bot_km_period_closed:"La période du {date} est clôturée, elle ne prend plus d'indemnités.",
      bot_km_not_in_profile:"Vous n'avez pas de projet sur lequel saisir des kilomètres.",
      warn_km_differs:"Vous avez indiqué {given} km ; la distance calculée est de {calc} km. Je garde votre chiffre.",
      chip_km_round:"Aller-retour",
      chip_km_one_way:"Aller simple",
      chip_km_example:"km de Lisbonne à Porto hier",
      hint_km_route:"{route} : {km} km par la route par trajet, {total} km à enregistrer.",
      hint_km_unknown:"Pas de distance pour ce trajet dans la maquette : indiquez les kilomètres.",
      hint_km_enter_route:"Indiquez le départ et l'arrivée pour calculer la distance.",
      toast_km_route_needed:"Indiquez le départ et l'arrivée du déplacement.",
      label_approval_week:"Approbation des temps, semaine {n}",
      label_approval_month:"Approbation des temps, {month}",
      ap_week_chip:"Sem. {n} · {from} au {to} · {h}/{exp} h",
      text_approval_monthly:"En Conseil, les heures s'approuvent au mois, la même période que la feuille de temps.",
      text_approval_weekly:"En Building Solutions, les heures s'approuvent à la semaine, la même période que la feuille de temps.",
      label_you:"vous",
      filter_pending:"À approuver", filter_all:"Toutes", aria_ap_filter:"Feuilles de temps à afficher", text_ap_none_pending:"Plus rien à approuver. Choisissez Toutes pour voir celles approuvées.", btn_select_clean_one:"Sélectionner la {n} sans avertissement", btn_select_clean_other:"Sélectionner les {n} sans avertissement",
      settings_reference:"Référence technique", btn_open_mapping:"Ouvrir le mapping SAP", text_mapping_hint:"Champ par champ, ce que chaque écran enregistre dans CATS et dans le Leave Request standard, avec les enregistrements et payloads générés en direct.",
      label_test:"Test", aria_change_test:"Changer le test : entreprise et profil",
      profile_employee:"Collaborateur", profile_pm:"Chef de projet", profile_manager:"Responsable hiérarchique",
      setup_title:"Que voulez-vous tester ?", setup_language:"Langue", setup_company:"Entreprise", setup_profile:"Profil", setup_leader:"Projet et chef de projet",
      setup_intro:"Choisissez l'entreprise et le profil. Vous pouvez changer les deux à tout moment avec le bouton Test, en haut. Ce que vous saisissez est conservé : une demande envoyée en tant que collaborateur peut être approuvée en tant que responsable.",
      setup_co_hint_pt01:"Conseil. Profil Z_CONS : les heures se saisissent en durée, mois par mois.",
      setup_co_hint_pt02:"Building Solutions. Profil Z_BSRV : les heures se saisissent avec une heure de début et de fin, semaine par semaine.",
      setup_employee_desc:"Saisit ses propres heures et demande des absences.",
      setup_pm_desc:"Saisit ses propres heures et celles de l'équipe du projet, et approuve les feuilles de temps de l'équipe.",
      setup_manager_desc:"Approuve les demandes d'absence de ses collaborateurs directs, selon la structure organisationnelle.",
      btn_start_test:"Commencer",
      text_approval_sub_pm:"Feuilles de temps des personnes affectées à {projects}, les projets dont vous êtes responsable. L'approbation suit la responsabilité du projet, pas la structure organisationnelle.",
      bot_greeting_pm:"Bonjour {name} ! Vous êtes chef de projet de {projects}. Je peux saisir vos heures, saisir des heures ou des indemnités pour l'équipe (vous compris), compléter les jours manquants et approuver les feuilles de temps.",
      bot_alert_ts_pm_one:"Vous avez {n} feuille de temps à approuver, dont {x} avec exceptions.", bot_alert_ts_pm_other:"Vous avez {n} feuilles de temps à approuver, dont {x} avec exceptions.",
      bot_ts_only_pm:"Les relevés sont approuvés par le chef de projet, le responsable du projet.",
      bot_team_only_pm:"La saisie pour l'équipe est faite par le chef de projet.",
      bot_screen_not_in_profile:"{screen} ne vous est pas accessible.",
      chip_change_test:"Changer de test", bot_setup_opened:"Choisissez le nouveau test dans la fenêtre qui vient de s'ouvrir.",
      bot_test_changed:"Test modifié : {co}, {profile}, {name}.",
      hdr_home_team_week:"Équipe {project}", btn_open_team:"Ouvrir la saisie d'équipe",
      text_acting_as_pm:"Vous agissez en tant que {name}, chef de projet de {projects}. Changez-le avec le bouton Test, en haut.",
      chip_conversation_log:"Mode apprentissage", title_conversation_log:"Cette conversation est enregistrée dans l'artifact pour améliorer l'assistant. Données fictives uniquement.",
      fb_helpful:"Utile", fb_not_helpful:"Pas utile", fb_placeholder:"Qu'aurait-il dû faire ?", fb_send:"Envoyer", fb_thanks:"Merci", fb_noted:"Noté, ce sera examiné lors de la prochaine série d'améliorations.",
      /* Leave Request et l'assistant comme point d'entrée */
      nav_home:"Assistant", nav_leave:"Absences", label_view_as:"Voir en tant que", aria_view_as:"Voir l'application en tant que collaborateur ou responsable direct",
      role_employee:"Collaborateur", role_manager:"Responsable direct",
      abs_0100:"Congés payés", abs_0210:"Rendez-vous médical", abs_0200:"Arrêt maladie", abs_0300:"Formation", abs_0400:"Absence justifiée",
      leave_range:"du {from} au {to}", leave_time_range:"de {b} à {e}",
      n_workdays_one:"{n} jour ouvré", n_workdays_other:"{n} jours ouvrés",
      n_requests_one:"{n} demande", n_requests_other:"{n} demandes",
      lr_status_sent:"En attente d'approbation", lr_status_approved:"Approuvée", lr_status_posted:"Approuvée, enregistrée",
      lr_status_rejected:"Refusée", lr_status_withdrawn:"Retirée", lr_status_cancel_requested:"Annulation en attente",
      leave_err_type:"Choisissez le type d'absence.", leave_err_dates:"Renseignez les dates de début et de fin.", leave_err_order:"La date de fin est antérieure à la date de début.",
      leave_err_no_workdays:"La période ne contient aucun jour ouvré.", leave_err_partial_type:"{type} ne peut être demandé que par journées entières.",
      leave_err_partial_one_day:"Une partie de journée ne s'applique qu'à un seul jour.", leave_err_times:"Renseignez une heure de début et de fin, la fin après le début.",
      leave_err_hours:"Indiquez le nombre d'heures.", leave_err_hours_full:"{cap} h ou plus correspond à la journée entière, décochez partie de journée.",
      leave_err_overlap:"Chevauche votre demande {id} ({period}).", leave_err_period_closed:"La période est clôturée pour un ou plusieurs de ces jours. La réouverture est une action RH.",
      leave_err_quota:"Solde de congés insuffisant : {n} jours demandés, {avail} disponibles.",
      leave_warn_hours:"Vous avez déjà {h} h saisies le {days}. Si la demande est approuvée, ces heures seront en conflit et vous pourrez les déplacer.",
      leave_info_outside_sample:"Certains jours sont hors des semaines d'exemple, ils restent dans la demande mais n'apparaissent pas dans la feuille de temps.",
      leave_info_retroactive:"Demande rétroactive, elle commence dans le passé.",
      hdr_leave_request:"Mes demandes d'absence", hdr_leave_to_approve:"Demandes d'absence à approuver", hdr_my_leave_requests:"Mes demandes d'absence",
      text_leave_sub:"Les demandes vont à {name}, votre responsable direct dans la structure organisationnelle. Les demandes approuvées et en attente apparaissent automatiquement dans votre feuille de temps.",
      text_leave_sub_manager:"Demandes des collaborateurs directs de {name}, dans la structure organisationnelle. L'approbation place aussitôt l'absence dans la feuille de temps du collaborateur.",
      kpi_leave_pending:"En attente", kpi_leave_soon:"Commencent sous 14 jours", kpi_leave_days_requested:"Jours demandés", unit_days:"jours",
      kpi_vacation_available:"Congés disponibles", kpi_vacation_entitlement:"Droits {y}", kpi_vacation_taken:"Pris", kpi_vacation_requested:"Demandés, en attente",
      origin_joule_short:"via l'assistant", btn_withdraw:"Retirer", btn_request_cancel:"Demander l'annulation",
      toast_leave_withdrawn:"Demande {id} retirée. Elle n'apparaît plus dans la feuille de temps.",
      toast_leave_cancel_requested:"Annulation de {id} envoyée à {name}. L'absence reste jusqu'à son approbation.",
      toast_leave_sent:"Demande {id} envoyée à {name}. Elle apparaît déjà dans votre feuille de temps comme en attente.",
      toast_leave_approved:"Demande {id} de {name} approuvée.", toast_leave_rejected:"Demande {id} de {name} refusée.",
      toast_leave_cancel_approved:"Annulation de la demande {id} de {name} approuvée.",
      text_leave_queue_empty:"Rien en attente d'approbation.", text_starts_today_or_past:"Commence aujourd'hui ou a déjà commencé",
      text_starts_in_days_one:"Commence dans {n} jour", text_starts_in_days_other:"Commence dans {n} jours",
      text_no_overlap:"Aucun chevauchement", text_overlaps_n:"{n} chevauchement(s) dans l'équipe", text_cancellation:"Annulation",
      btn_reject:"Refuser", chip_rejected:"Refusée", text_balance_after:"Solde après : {n} jours", text_approver:"Approbateur : {name}",
      text_pending_short:"en attente", text_home_week_total:"{tot} h saisies sur {exp} h attendues, absences déjà déduites.",
      btn_open_timesheet:"Ouvrir la feuille de temps complète", hdr_home_leave:"Absences", text_vacation_available:"{n} jours de congés disponibles",
      text_no_upcoming_leave:"Aucune absence prévue ni demande en attente.", btn_new_leave:"Nouvelle demande d'absence", btn_open_leave:"Ouvrir Absences",
      hdr_home_to_approve:"À approuver : absences", text_now:"maintenant", text_in_days_one:"dans {n} jour", text_in_days_other:"dans {n} jours",
      btn_open_leave_approvals:"Ouvrir l'approbation des absences", hdr_home_timesheets:"À approuver : feuilles de temps",
      text_home_ts_pending:"{n} feuilles de temps en attente, dont {x} avec des exceptions à examiner de plus près.", btn_open_ts_approvals:"Ouvrir l'approbation des feuilles de temps",
      hdr_home_team_away:"Équipe absente, 60 prochains jours", text_nobody_away:"Personne dans l'équipe n'a d'absence approuvée à venir.",
      text_acting_as_manager:"Vous agissez en tant que {name}, responsable direct dans la structure organisationnelle. Changez-le avec le bouton Test, en haut.",
      chip_lr_standard:"Leave Request standard, PTARQ", chip_my_inbox:"Décision via My Inbox, TASKPROCESSING",
      th_request:"Demande", th_type:"Type", th_period:"Période", th_duration:"Durée", th_approver:"Approbateur",
      th_balance_after:"Solde après", th_overlap:"Chevauchement dans l'équipe", th_decision:"Décision", th_when:"Quand",
      privacy_leave_sync:"Les demandes passent par le service standard du Leave Request et son workflow d'approbation, jamais par la feuille de temps. Dès qu'une demande est envoyée, elle apparaît dans la feuille de temps comme en attente, ce qui avertit sans bloquer. Une fois approuvée, elle ferme la journée, ou réduit sa capacité pour une partie de journée. Refusée ou retirée, elle disparaît.",
      hdr_leave_decided:"Décidées pendant cette session",
      dlg_new_leave_title:"Nouvelle demande d'absence", label_absence_type:"Type d'absence", label_from:"Du", label_to:"Au",
      label_partial_day:"Partie de journée", label_hours:"Heures", placeholder_leave_note:"Facultatif, le responsable le voit",
      btn_send_request:"Envoyer la demande", dlg_reject_title:"Refuser la demande d'absence", placeholder_reject_reason:"Obligatoire, le collaborateur le voit",
      label_period:"Période", label_balance_after:"Solde après", label_approver:"Approbateur", label_service:"Service standard",
      placeholder_chat_home:"2h BNK tests de paie hier, ou congés du 3 au 6 novembre",
      jfoot_text_home:"N'enregistre ni n'envoie jamais rien sans confirmation. Ce qui est créé ici porte l'origine <span class=\"num\">Joule</span> et passe par les mêmes validations que les écrans.",
      spec_e15:"Demande et approbation d'absences, un masque sur le service standard", spec_e16:"L'assistant comme point d'entrée, avec les données en vue secondaire",
      hdr_lr_mapping:"Leave Request, standard PTARQ", chip_lr_service:"HCMFAB_LEAVE_REQUEST_CR_SRV",
      lr_step_sent:"Envoyée", lr_step_sent_sub:"PTREQ_HEADER, SENT", lr_step_approved:"Approuvée", lr_step_approved_sub:"WS12300111, My Inbox",
      lr_step_posted:"Comptabilisée", lr_step_posted_sub:"RPTARQPOST, IT2001", lr_step_read:"Dans la feuille de temps", lr_step_read_sub:"capacité, CATS",
      lr_rule_1:"L'application ne crée, ne lit et ne retire que par le service standard. Il n'y a ici aucune logique d'absence, aucune table écrite directement, ni de second processus d'approbation.",
      lr_rule_2:"Une demande apparaît dans la feuille de temps dès son envoi, comme en attente. À l'approbation, elle ferme la journée ou réduit sa capacité, avant l'exécution de RPTARQPOST, pour qu'une approbation du jour même ne passe pas inaperçue.",
      lr_rule_3:"Annuler une demande approuvée est aussi une demande, décidée par le même responsable à la même étape du workflow, comme dans le standard.",
      hdr_lr_fields:"Leave Request champ par champ", hdr_lr_payload:"Dernière demande envoyée, telle que le service standard la reçoit",
      text_lr_payload_empty:"Envoyez une demande, depuis l'assistant ou l'écran Absences, pour voir le payload ici.",
      hint_lr_fields:"Les noms d'entités et de champs suivent le service du HCM Fiori apps bundle. À confirmer dans le $metadata du système client avant le développement.",
      lrmap_type:"Type d'absence", lrmap_dates:"Du et au", lrmap_partial:"Partie de journée", lrmap_note:"Note au responsable",
      lrmap_status:"Statut de la demande", lrmap_approver:"Approbateur", lrmap_balance:"Solde de congés", lrmap_decision:"Approuver ou refuser",
      lrmap_posting:"Comptabilisation", lrmap_timesheet:"Absence dans la feuille de temps", lrmap_withdraw:"Retirer ou annuler", lrmap_origin:"Créée par l'assistant",
      bot_leave_cant:"Je ne peux pas encore envoyer cette demande : {reason}", chip_my_leave:"Mes demandes d'absence", chip_leave_form:"Ouvrir le formulaire",
      bot_leave_confirm:"Voici la demande. Elle part chez votre responsable direct pour approbation, rien n'est envoyé sans votre confirmation.",
      bot_leave_sent:"Envoyée. La demande {id} est chez {name} pour approbation, et elle apparaît déjà dans votre feuille de temps comme en attente.",
      bot_leave_list_intro:"Vos demandes à venir et en attente. Vous avez {avail} jours de congés disponibles, plus {req} demandés en attente d'approbation.",
      chip_request_vacation:"Demander des congés",
      bot_leave_balance:"Congés {y} : {total} jours de droits, {used} pris et {req} demandés en attente. Vous pouvez encore demander {avail} jours.",
      bot_leave_nothing_to_cancel:"Vous n'avez aucune demande pouvant être annulée.", bot_leave_which_cancel:"Laquelle ? Donnez-moi le numéro de la demande ou une date qu'elle couvre.",
      bot_leave_cannot_cancel:"La demande {id} est {status}, elle ne peut pas être annulée d'ici.",
      bot_leave_confirm_withdraw:"Retirer la demande {id} ? Elle est encore en attente, elle disparaît donc tout de suite, de la feuille de temps aussi.",
      bot_leave_confirm_cancel:"La demande {id} est déjà approuvée. L'annuler repasse par votre responsable pour approbation, comme dans le standard. Je demande l'annulation ?",
      bot_leave_withdrawn:"Demande {id} retirée. La feuille de temps ne l'affiche plus.",
      bot_leave_cancel_requested:"Annulation de {id} envoyée à {name}. Tant qu'elle n'est pas approuvée, l'absence reste dans la feuille de temps.",
      bot_nothing_pending:"Rien ne vous attend pour le moment.",
      bot_alert_leave_one:"Vous avez {n} demande d'absence à approuver.", bot_alert_leave_other:"Vous avez {n} demandes d'absence à approuver.",
      when_today:"qui commence aujourd'hui", when_past:"déjà dans le passé", when_in_days_one:"qui commence dans {n} jour", when_in_days_other:"qui commence dans {n} jours",
      bot_notice_conflict:"Vous aviez {h} h saisies le {days}, elles sont maintenant en conflit avec l'absence : ouvrez la feuille de temps pour les déplacer.",
      bot_alert_soonest:"La plus proche est celle de {name}, {type}, {when}.",
      bot_alert_ts_one:"Et {n} feuille de temps en attente, dont {x} avec exceptions.", bot_alert_ts_other:"Et {n} feuilles de temps en attente, dont {x} avec exceptions.",
      chip_pending_approvals:"Qu'est-ce que j'ai à approuver ?", chip_approve_leave_of:"Approuver la demande d'absence de {name}", chip_approve_ts_of:"Approuver la feuille de temps de {name}",
      chip_approve_clean_ts:"Approuver toutes les feuilles de temps sans exception", chip_view_as_employee:"Voir en tant que collaborateur", chip_view_as_manager:"Voir en tant que manager",
      bot_leave_only_manager:"Les demandes d'absence sont approuvées par le responsable direct ({name}).",
      bot_leave_decide_who:"La demande de qui ? Donnez-moi le nom ou le numéro de la demande, ou dites toutes.",
      bot_leave_reason_needed:"Quel est le motif du refus de la demande de {name} ? Le collaborateur le verra.",
      bot_leave_overlap_warn:"Chevauchements dans l'équipe : {list}.",
      bot_leave_confirm_approve_one:"Approuver cette demande ?", bot_leave_confirm_approve_other:"Approuver ces {n} demandes ?",
      bot_leave_confirm_reject:"Refuser avec ce motif ?",
      bot_leave_approved_msg_one:"Approuvée. Elle est déjà dans la feuille de temps du collaborateur comme absence approuvée.",
      bot_leave_approved_msg_other:"C'est fait, {n} approuvées. Chacune est déjà dans la feuille de temps du collaborateur comme absence approuvée.",
      bot_leave_rejected_msg:"Refusée. {name} voit le motif dans la demande.",
      bot_leave_remaining_one:"Il en reste {n} dans votre boîte.", bot_leave_remaining_other:"Il en reste {n} dans votre boîte.", bot_leave_inbox_empty:"Votre boîte est vide.",
      bot_greeting_home:"Bonjour {name} ! C'est ici que vous saisissez vos heures et vos absences. Dites-moi sur quoi vous avez travaillé, ou demandez un jour de congé, et je prépare tout pour que vous confirmiez. Votre semaine et vos absences restent sur cet écran, toujours à jour.",
      bot_greeting_manager:"Bonjour {name} !",
      bot_now_manager:"Vous voyez maintenant l'application en tant que {name}, responsable direct.", bot_now_employee:"De retour en tant que {name}.",
      bot_notice_approved:"Bonne nouvelle : {name} a approuvé votre demande {id} ({period}). Elle est déjà dans votre feuille de temps.",
      bot_notice_rejected:"{name} a refusé votre demande {id} ({period}). Motif : {reason}",
      bot_notice_cancel_approved:"{name} a approuvé l'annulation de {id}. L'absence a disparu de votre feuille de temps.",
      bot_notice_cancel_rejected:"{name} n'a pas approuvé l'annulation de {id}, l'absence reste. Motif : {reason}",
      bot_leave_which_type:"Quel type d'absence ?", bot_leave_when:"Pour quels jours ({type}) ? Par exemple du 3 au 7 novembre, ou demain après-midi.",
      chip_leave_tomorrow:"Demain", chip_leave_next_week:"La semaine prochaine", bot_leave_form_opened:"Voici le formulaire, déjà rempli avec ce que vous m'avez dit.",
      bot_leave_ambiguous:"{name} a une demande d'absence et une feuille de temps en attente. Laquelle ?",
      bot_leave_need_more:"J'ai besoin du type d'absence et des dates.",
      bot_help_text_home:"Voici ce que je peux faire : saisir vos heures (<span class=\"num\">2h BNK tests de paie hier</span>), demander une absence (<span class=\"num\">congés du 3 au 6 novembre</span>, <span class=\"num\">médecin demain de 14h à 17h</span>), enregistrer des kilomètres avec la distance calculée (<span class=\"num\">km de Lisbonne à Porto hier</span>), consulter, modifier ou annuler vos demandes, votre solde de congés à n'importe quelle date et ses mouvements, dire qui approuve, ce qui bloque une soumission, les jours fériés et qui est absent dans l'équipe, compléter vos heures manquantes, voir la semaine et la soumettre et, en tant que responsable, voir ce qui attend et approuver ou refuser. Écrivez simplement en langage naturel.",
      brand_title:"Saisie des temps", brand_subtitle:"Prototype Fiori",
      capture_on:"Suggestions activées, historique privé", capture_off:"Capture en pause",
      aria_it0001:"Société de l'employé, à partir de l'IT0001",
      aria_project_billing:"Projet à facturer et à affecter aux saisies d'équipe", aria_leader_scope:"Chef d'équipe et périmètre",
      aria_mass_entry_section:"Section de saisie d'équipe",
      label_week_n:"Semaine {n}, {range} {y}", label_range_same_month:"{d1} au {d2} {month}", label_range_diff_month:"{d1} {m1} au {d2} {m2}",
      status_approved:"Approuvée", status_pending:"Demande en attente",
      dlg_new_entry_title:"Nouvelle saisie", origin_suggested:"Suggéré", origin_copied:"Copié",
      dlg_submit_month_title:"Soumettre {month} {y}", dlg_submit_week_title:"Soumettre la semaine {n}",
      ui_undo:"Annuler", ui_resolve:"Résoudre", ui_reopen:"Rouvrir",
      toast_bad_duration:"Impossible de lire « {v} ». Utilisez 1.5, 1:30 ou 90m.",
      toast_only_available:" Seulement {left} h disponibles.", toast_no_hours_available:" Aucune heure disponible ce jour-là.",
      toast_bad_clock:"Impossible de lire « {v} ». Utilisez 08:00 ou 8.",
      toast_row_removed:"Ligne supprimée.",
      toast_month_submitted_no_rows:"Ce mois est déjà soumis, aucune ligne supplémentaire ne peut être ajoutée.",
      toast_all_projects_used_month:"Tous les projets disponibles pour cette société ont déjà une ligne ce mois-ci.",
      toast_no_earlier_months:"Pas de mois d'exemple antérieurs.", toast_no_later_months:"Pas de mois d'exemple suivants.",
      toast_sugg_blocked_absence:"{day} a une absence approuvée, la suggestion ne peut pas être appliquée.",
      toast_suggestion_accepted:"Suggestion acceptée le {day}.",
      toast_suggestion_dismissed:"Suggestion rejetée. Le modèle ne sera plus proposé.",
      toast_absence_approved_conflict:"Absence approuvée le {day}. Les {h} h enregistrées ce jour-là sont maintenant en conflit.",
      toast_absence_approved_no_conflict:"Absence approuvée le {day}. Le jour n'est plus disponible pour la saisie.",
      toast_hours_moved:"{h} h déplacées de {from} vers {to}.",
      toast_hours_removed_no_capacity:"{h} h supprimées de {day}, aucun jour n'avait de capacité libre.",
      toast_allowance_removed:"{name} supprimé.",
      toast_week_submitted_no_allow_change:"La semaine est soumise, les indemnités ne peuvent plus être modifiées.",
      toast_week_closed_period:"Cette semaine tombe dans une période clôturée.",
      toast_qty_must_be_positive:"La quantité doit être un nombre supérieur à zéro.",
      toast_allowance_recorded:"{name} enregistré le {day}.",
      toast_bad_number:"Impossible de lire « {v} ».",
      toast_capacity_on_day:"La capacité de {name} est de {cap} h le {day}.",
      toast_select_person_first:"Sélectionnez d'abord au moins une personne.",
      toast_give_duration_or_clock:"Indiquez une durée, ou une heure de début et de fin.",
      toast_pick_a_day:"Choisissez au moins un jour.",
      toast_cells_filled:"{n} cellules remplies pour {people} personnes. Rien n'est encore enregistré, vérifiez d'abord la grille.",
      cells_skipped_field_one:" {n} cellule ignorée, a besoin de l'autre champ pour ce profil.",
      cells_skipped_field_other:" {n} cellules ignorées, ont besoin de l'autre champ pour ce profil.",
      cells_skipped_capacity_one:" {n} cellule ignorée, dépasse la capacité journalière de cette personne.",
      cells_skipped_capacity_other:" {n} cellules ignorées, dépassent la capacité journalière de cette personne.",
      toast_team_entries_partial:"{saved} saisies enregistrées pour {who}. {left} restent à l'écran avec le motif.",
      toast_team_entries_all:"{saved} saisies enregistrées pour {who}, pour leur compte.",
      toast_team_entries_none:"Rien n'a été enregistré. Chaque ligne a un motif à côté.",
      toast_give_qty_positive:"Indiquez une quantité supérieure à zéro.",
      toast_note_required_for:"{note} est obligatoire pour {name}.",
      allow_lines_staged_one:"{n} ligne d'indemnité en attente pour {people} personnes. Rien n'est encore enregistré.",
      allow_lines_staged_other:"{n} lignes d'indemnité en attente pour {people} personnes. Rien n'est encore enregistré.",
      toast_allow_skipped_company:" {n} ignorés, l'indemnité de poste ne s'applique pas à leur société.",
      toast_allow_skipped_project:" {n} ignorés, non alloués à {code}.",
      toast_nothing_staged:"Rien en attente.",
      allow_lines_recorded_one:"{n} ligne d'indemnité enregistrée, pour leur compte.",
      allow_lines_recorded_other:"{n} lignes d'indemnité enregistrées, pour leur compte.",
      toast_nothing_to_save:"Rien à enregistrer.", toast_changes_saved:"Modifications enregistrées.",
      toast_amount_must_be_positive:"Le montant doit être un nombre supérieur à zéro.",
      toast_bonus_reason_required:"La prime a besoin d'un motif. C'est la seule trace de la raison pour laquelle le projet a porté ce coût.",
      toast_none_allocated:"Aucune des personnes sélectionnées n'est allouée à {code}.",
      toast_bonus_recorded:"Prime de {amount} EUR enregistrée pour {names}, approuvée dans le même acte.",
      toast_bonus_none_recorded:"Rien n'a réellement été enregistré.",
      toast_bonus_skipped_ineligible:" {names} ignorés, non alloués à {code}.",
      toast_bonus_skipped_closed:" {names} ignorés, tous les jours de cette semaine tombent dans une période clôturée.",
      toast_week_submitted_no_rows:"Cette semaine est déjà soumise, aucune ligne supplémentaire ne peut être ajoutée.",
      toast_all_projects_used_week:"Tous les projets disponibles pour cette société ont déjà une ligne cette semaine.",
      toast_copy_week_done:"Structure de la semaine précédente copiée, sans les durées. {n} nouvelles lignes.",
      toast_copy_week_none:"Toutes les lignes de la semaine précédente sont déjà présentes.",
      toast_no_earlier_weeks:"Pas de semaines d'exemple antérieures.", toast_no_later_weeks:"Pas de semaines d'exemple suivantes.",
      toast_template_applied:"Modèle d'allocation appliqué aux jours ouvrés.",
      toast_it0001_changed:"L'IT0001 indique désormais {bukrs}. Le ZTIME_COMPANY_CFG le mappe vers {code} : {fields}.",
      toast_week_submitted_locked:"La semaine est soumise, elle ne peut plus être modifiée.",
      toast_day_absence_blocked:"{day} a une absence approuvée, n'accepte pas de nouvelles saisies.",
      toast_day_closed_period:"{day} tombe dans une période clôturée, ne peut pas recevoir de nouvelles heures.",
      toast_hours_recorded:"{h} h enregistrées sur {code}, {day}.",
      toast_entry_added:"Saisie ajoutée.",
      toast_row_exists_week:"{code} a déjà une ligne cette semaine. Supprimez-la ou fusionnez-la d'abord.",
      toast_entry_updated:"Saisie mise à jour.",
      toast_row_exists_month:"{code} a déjà une ligne ce mois-ci. Supprimez-la ou fusionnez-la d'abord.",
      weeks_submitted_approval_one:"{n} semaine soumise pour approbation.",
      weeks_submitted_approval_other:"{n} semaines soumises pour approbation.",
      toast_week_submitted_approval:"Semaine {n} soumise pour approbation.",
      toast_high_conf_applied:"{n} suggestions à forte confiance appliquées. Celles à confiance moyenne et faible restent à revoir.",
      toast_timeline_deleted:"Historique brut supprimé. Les suggestions en attente ont disparu avec lui.",
      toast_timesheets_approved:"{n} relevés approuvés en un seul appel. Les exceptions restent à revoir.",
      toast_voice_error:"Erreur de saisie vocale : {err}",
      toast_staged_entries_cleared:"Saisies en attente effacées. Rien n'avait été enregistré.",
      toast_staged_allow_cleared:"Indemnités en attente effacées. Rien n'avait été enregistré.",
      val_day_exceeds_24h:"Le total pour {day} dépasse 24 heures.",
      val_desc_required:"Chaque saisie a besoin d'une description (au moins 10 caractères) : {code}.",
      val_absence_move_hours:"{day} a une {type} approuvée. Les {h} h enregistrées doivent être déplacées hors de ce jour.",
      val_partial_absence_capacity:"{day} a une absence partielle approuvée. La capacité du jour est de {cap} h et {tot} h sont enregistrées.",
      val_day_capacity:"La capacité de {day} est de {cap} h ; {tot} h sont enregistrées.",
      val_pending_leave_conflict:"{day} a une demande d'absence en attente et des heures enregistrées. Si la demande est approuvée, ces heures seront en conflit.",
      val_day_empty:"{day} est vide.",
      val_week_below_expected:"La semaine a {tot} h enregistrées ; le total attendu avec les absences déduites est de {expect} h.",
      val_closed_period:"{day} tombe dans la période {ym}, clôturée pour {bukrs}. La réouverture est une action RH.",
      val_overlapping_windows:"{day} a des plages horaires qui se chevauchent : {t1} à {t2} et {t3} à {t4}.",
      val_window_needs_both:"{day}, {code} : la plage a besoin d'un début et d'une fin.",
      val_allow_note_needed:"{name} le {day} a besoin de {noteLabel}.",
      val_allow_closed_period:"{name} le {day} tombe dans une période clôturée.",
      val_allow_no_amount:"{name} le {day} n'a pas de montant.",
      val_allow_no_qty:"{name} le {day} n'a pas de quantité.",
      n_suggestions_to_review2_one:"{n} suggestion encore à revoir dans le panneau latéral.",
      n_suggestions_to_review2_other:"{n} suggestions encore à revoir dans le panneau latéral.",
      suggestions_discarded_one:"{n} suggestion écartée car elle tombe sur un jour avec une absence approuvée.",
      suggestions_discarded_other:"{n} suggestions écartées car elles tombent sur des jours avec une absence approuvée.",
      th_project_wbs_activity:"Projet, WBS et activité", row_total_per_day:"Total par jour", btn_remove:"Supprimer",
      tip_approved_partial_absence:"Absence partielle approuvée, capacité de {h} h ce jour-là",
      btn_copy_last_week:"Copier la semaine dernière", btn_add_first_project:"Ajouter le premier projet",
      btn_resume_suggestions:"Reprendre les suggestions", btn_simulate_approval:"Simuler l'approbation",
      tip_bonus_remove_restricted:"La prime est supprimée par le responsable du projet, sur l'écran équipe.",
      text_no_records_to_generate:"Aucune heure ni indemnité cette semaine, donc aucun enregistrement à générer.",
      voice_not_supported:"Saisie vocale non prise en charge dans ce navigateur",
      tip_absence_not_available:"{type} approuvée, jour indisponible pour la saisie",
      text_desc_required:"Description obligatoire", text_no_description:"Aucune description",
      aria_remove_row:"Supprimer la ligne {name}",
      tip_period_closed:"La période {ym} est clôturée pour {bukrs}. La réouverture est une action RH.",
      placeholder_desc_required_once:"Description (obligatoire dès que des heures sont saisies)", placeholder_description_short:"Description",
      text_absence_generic:"absence",
      tip_approved_type:"{type} approuvée", aria_select_name:"Sélectionner {name}",
      hdr_no_warnings_group:"Sans avertissement, approbation groupée possible", hdr_exceptions_group:"Exceptions, révision individuelle nécessaire",
      aria_select_timesheet_for:"Sélectionner le relevé de {name}",
      tip_clock_use_fields:"Z_BSRV enregistre le début et la fin. Utilisez les champs Début/Fin ci-dessus, pour les personnes concernées.",
      tip_closed_period_short:"Période clôturée",
      tip_week_submitted_n:"La semaine {n} a déjà été soumise, elle n'est plus modifiable.", tip_approved_abs:"Absence approuvée : {type}",
      aria_dur_cell:"Durée en heures, {proj}, {day}", aria_desc_cell:"Description, {proj}", aria_team_hours:"Heures de {name}, {day}",
      text_sugs_none_absence:"Rien à proposer. Les suggestions existantes tombaient sur des jours avec une absence approuvée.",
      text_sugs_none_pending:"Aucune suggestion en attente. Bon signe, la semaine est revue.",
      text_bonus_catsamount:"Le montant va dans CATSAMOUNT, champ natif de CATSDB. ANZHL va dans CATS avec la valeur 1.",
      text_bonus_defined_by:"Défini et approuvé par {name}, dans le même acte",
      aria_voice_lang:"Langue de la dictée : {lang}. Cliquez pour choisir : {next}.", voice_lang_PT:"portugais", voice_lang_EN:"anglais", voice_lang_FR:"français",
      aria_start_time_for:"Heure de début, {name}, {day}", aria_end_time_for:"Heure de fin, {name}, {day}",
      sev_error:"ERREUR", sev_warning:"AVERTISSEMENT", sev_info:"INFO",
      text_no_allowances_week:"Aucune indemnité enregistrée cette semaine. Les indemnités journalières, kilométriques et de poste sont enregistrées ici, contre un projet et une date.",
      text_wage_type_label:"rubrique {code}",
      text_recorded_by_behalf:"Enregistré par {name}, pour le compte de l'employé",
      hint_allow_wage_type:"Rubrique {code}, quantité en ANZHL, unité {unit}. Aucune valeur n'est calculée ici, la paie la valorise.",
      text_nothing_staged_yet:"Rien en attente pour l'instant.",
      text_nothing_recorded_behalf_week:"Rien enregistré pour le compte de l'équipe pour l'instant, cette semaine.",
      text_no_bonus_recorded:"Aucune prime enregistrée sur ce projet pour l'instant.",
      label_month_total:"Total du mois", label_week_total:"Total de la semaine",
      n_warnings_no_block_one:"{n} avertissement, ne bloque pas la soumission", n_warnings_no_block_other:"{n} avertissements, ne bloquent pas la soumission",
      label_deviation_justification:"Justification de l'écart par rapport au total attendu",
      placeholder_justification_month:"Une ligne suffit. Reste dans l'historique du mois.",
      text_h_in_project:"{h} h sur projet", chip_warning_lower:"avertissement",
      msg_day_approved_type:"{day} a une {type} approuvée.", msg_day_capacity_simple:"La capacité de {day} est de {cap} h.",
      badge_half_day:"demi-journée",
      text_no_hours_week_yet:"Aucune heure enregistrée cette semaine pour l'instant.", text_no_hours_month_yet:"Aucune heure enregistrée ce mois-ci pour l'instant.",
      text_shortest_path:"Commencez par le chemin le plus court.",
      conf_hi:"confiance élevée", conf_mid:"confiance moyenne", conf_low:"confiance faible",
      tip_save_to_finish:"C'est déjà en vigueur ici ; Save ne fait que le refléter dans la base de données.",
      placeholder_justification_week:"Une ligne suffit. Reste dans l'historique de la semaine.",
      chip_approved:"Approuvée",
      note_pending_leave_conflict:"Demande d'absence en attente chevauche des heures enregistrées", note_two_empty_days:"Deux jours ouvrés vides",
      val_week_label_prefix:"Semaine {n} : {txt}", val_weeks_label_prefix:"Semaines {n} : {txt}",
      link_resolve_move_hours:"résoudre, déplacer les heures", link_go_to_day:"aller au jour",
      btn_shortcuts:"Raccourcis", aria_shortcuts:"Raccourcis clavier",
      btn_settings:"Paramètres", aria_settings:"Paramètres de langue",
      nav_my_timesheet:"Mon relevé", nav_team:"Saisie d'équipe",
      nav_approval:"Approbation (manager)", nav_cats:"Mappage CATS",
      aria_prev_week:"Semaine précédente", aria_next_week:"Semaine suivante",
      state_draft:"Brouillon", state_in_approval:"En approbation, lecture seule",
      btn_quick_add:"Ajout rapide", btn_submit_week:"Soumettre la semaine", btn_save:"Enregistrer",
      kpi_recorded:"Enregistré", kpi_in_project:"Sur projet", kpi_validation:"Validation",
      val_no_errors:"Aucune erreur",
      n_errors_one:"{n} erreur", n_errors_other:"{n} erreurs",
      n_messages_one:"{n} message", n_messages_other:"{n} messages",
      n_weeks_one:"{n} semaine", n_weeks_other:"{n} semaines",
      n_empty_days_one:"{n} jour ouvré vide", n_empty_days_other:"{n} jours ouvrés vides",
      n_allowances_one:"{n} indemnité", n_allowances_other:"{n} indemnités",
      n_records_generated_one:"{n} enregistrement généré", n_records_generated_other:"{n} enregistrements générés",
      n_lines_left_one:"{n} ligne", n_lines_left_other:"{n} lignes",
      err_mass_locked:"Semaine déjà approuvée, la ligne n'a pas été modifiée.", err_mass_not_allocated:"{name} n'est pas affecté à {code}.", err_mass_absence:"{day} a une absence approuvée ({type}).",
      err_mass_closed:"{day} tombe dans une période clôturée.", err_mass_24h:"{day} dépasse 24 heures.", err_mass_capacity:"La capacité de {name} le {day} est de {cap} h.", err_mass_window:"{day} demande un début et une fin pour {name}.",
      n_people_one:"{n} personne", n_people_other:"{n} personnes",
      n_entries_one:"{n} saisie", n_entries_other:"{n} saisies",
      n_suggestions_review_one:"{n} suggestion à revoir", n_suggestions_review_other:"{n} suggestions à revoir",
      btn_submit_month:"Soumettre le mois", btn_month_submitted:"Mois soumis",
      btn_week_submitted:"Semaine soumise", chip_in_approval:"En approbation",
      kextra_absences:"{h} h d'absences déduites", kextra_month_prefix:"{weeks} ce mois-ci",
      n_selected_one:"{n} sélectionné", n_selected_other:"{n} sélectionnés",
      lines_staged_suffix_one:"ligne en attente", lines_staged_suffix_other:"lignes en attente", h_staged_suffix:"h en attente",
      hdr_week_entries:"Saisies de la semaine", aria_view:"Vue", btn_grid:"Grille", btn_calendar:"Calendrier",
      hdr_how_it_works:"Comment ça marche ?",
      how_step1:"Créer ou sélectionner le projet", how_step2:"Saisir les heures",
      how_step3:"Valider", how_step4:"Enregistrer ou soumettre",
      aria_collapse_how:"Réduire Comment ça marche", aria_expand_how:"Développer Comment ça marche",
      legend_over:"Total par jour : au-delà de la capacité", legend_empty:"Jour ouvré vide",
      legend_unavailable:"Indisponible (absence ou jour non ouvré)", legend_submitted:"Semaine déjà soumise",
      btn_add_row:"Ajouter une ligne", btn_copy_week:"Copier la semaine précédente", btn_apply_template:"Appliquer un modèle",
      hint_grid_entry:"Accepte 1.5 · 1:30 · 90m. Entrée descend, Tab avance.",
      hint_calendar:"Cliquez sur un créneau libre pour saisir du temps ce jour-là. Absences et jours fériés non modifiables.",
      hdr_validation_messages:"Messages de validation", hdr_allowances:"Indemnités",
      btn_add_allowance:"Ajouter une indemnité",
      privacy_allowances:"Les indemnités journalières, kilométriques et de poste sont enregistrées contre un projet et une date, en quantité et en unité. Aucune valeur n'est calculée ici. La prime de projet est l'exception : elle porte un montant et seul le responsable du projet l'enregistre.",
      aria_collapse_suggestions:"Réduire les suggestions", aria_expand_suggestions:"Développer les suggestions",
      aria_collapse_allowances:"Réduire les indemnités", aria_expand_allowances:"Développer les indemnités",
      hdr_suggestions:"Suggestions cette semaine", btn_accept_high_confidence:"Accepter celles à forte confiance",
      privacy_suggestions_intro:"Rien n'entre dans le relevé sans confirmation.",
      btn_data_collected:"Ce qui est collecté et où c'est stocké",
      hdr_specmap:"Correspondance entre ce prototype et la spécification",
      text_specmap_intro:"Chaque écran ci-dessous correspond à une section du document de spécification, pour que les échanges avec l'équipe de développement se fassent sur le même vocabulaire.",
      spec_e1:"Grille hebdomadaire avec édition en ligne, totaux par jour et par ligne, copie de semaine",
      spec_e2:"Vue calendrier avec blocs de projet et événements externes à convertir",
      spec_e3:"Ajout rapide en langage naturel avec chips corrigibles",
      spec_e4:"Suggestions avec motif, niveau de confiance et action explicite",
      spec_e5:"Détail de la saisie avec contexte budgétaire et historique",
      spec_e6:"Validation à trois niveaux de gravité et résumé avant soumission",
      spec_e7:"Approbation groupée avec exceptions isolées",
      spec_e10:"Absences issues du Leave Request, blocage de jour et capacité partielle",
      spec_e11:"Assistant conversationnel avec confirmation avant enregistrement",
      spec_e12:"Indemnités contre un projet, une rubrique et une quantité, prime avec un montant",
      spec_e13:"Début et fin selon le profil de saisie, dérivé de l'IT0001",
      spec_e14:"Saisie d'équipe par le chef d'équipe, avec enregistrement partiel et trace pour le compte de",
      aria_expand_already:"Développer déjà enregistré", aria_collapse_already:"Réduire déjà enregistré",
      hdr_already_recorded:"Déjà enregistré cette semaine", hdr_already_allow:"Indemnités enregistrées cette semaine",
      chip_readonly:"Lecture seule",
      hint_already:"Depuis le relevé de chaque personne ou une saisie d'équipe antérieure, plus ce qui est en attente ci-dessous mais pas encore enregistré. Ambré à 8h, rouge au-delà.",
      hint_already_allow:"Indemnités déjà enregistrées pour cette équipe cette semaine, depuis le relevé de chaque personne ou une saisie d'équipe antérieure.",
      tab_hours:"Heures", tab_allowances:"Indemnités", tab_bonus:"Prime",
      hdr_team:"Équipe", hdr_fill_several:"Remplir plusieurs personnes à la fois",
      label_duration:"Durée", label_start_time:"Heure de début", label_end_time:"Heure de fin", label_days:"Jours",
      btn_apply_selected:"Appliquer à la sélection",
      btn_save_staged_entries:"Enregistrer les saisies en attente", btn_clear:"Effacer",
      hint_mass_save:"L'enregistrement est partiel. Les lignes en échec restent à l'écran avec le motif. Durée remplit les personnes sur un profil de durée, Début/Fin remplit les personnes sur Z_BSRV, en un seul clic.",
      hdr_allowances_selected:"Indemnités pour les personnes sélectionnées",
      label_wage_type:"Rubrique", label_quantity:"Quantité", label_note:"Note",
      placeholder_note_required:"Obligatoire pour cette indemnité",
      btn_stage_selected:"Mettre en attente pour la sélection", btn_save_staged_allowances:"Enregistrer les indemnités en attente",
      hint_mass_allow:"Facturé au Projet choisi en haut de l'écran, le même que pour Heures. La prime est enregistrée séparément, dans l'onglet Prime.",
      hdr_project_bonus:"Prime de projet", label_amount_eur:"Montant, EUR", label_reason:"Motif",
      placeholder_bonus_reason:"Week-end de mise en service, clôture de paie",
      btn_record_approve_selected:"Enregistrer et approuver pour la sélection",
      privacy_bonus:"La prime est la seule indemnité que l'employé n'enregistre pas. Le responsable du projet définit le montant et approuve dans le même acte, car c'est le projet qui porte le coût. Le montant vit dans un champ client, la CATSDB étant une structure de quantités.",
      hdr_recorded_on_behalf:"Enregistré pour le compte de",
      privacy_recorded_on_behalf:"Chaque ligne conserve CREATED_BY et ON_BEHALF_OF. Il n'y a pas d'étape d'auto-confirmation : l'employé voit la saisie marquée comme enregistrée par le chef d'équipe, ce qui informe sans bloquer. Côté CATS, l'utilisateur qui soumet reste dans ERNAM.",
      kpi_selected:"Sélectionnés", kpi_staged_not_saved:"En attente, non enregistré", kpi_recorded_on_behalf:"Enregistré pour le compte de",
      label_project:"Projet", label_acting_as:"Agit en tant que",
      chip_up_to_date:"À jour", chip_save_to_finish:"Enregistrer pour terminer", hint_click_save:" Cliquez sur Enregistrer pour terminer.",
      btn_select_no_warnings:"Sélectionner les 4 sans avertissement", chip_project_team:"Équipe du projet", btn_approve_selected:"Approuver la sélection",
      text_approval_sub:"La file d'une autre personne, pas votre propre semaine. Couvre les personnes sur les projets de conseil de Sofia (Banking, Retail, Airports). Rien de ce que vous soumettez dans Mon relevé n'apparaît ici.",
      text_approval_sub_pt02:"La file d'une autre personne, pas votre propre semaine. Couvre les personnes sur les projets facilities de Patrícia (Hospital campus, Airport terminal). Rien de ce que vous soumettez dans Mon relevé n'apparaît ici.",
      kpi_pending_approval:"En attente d'approbation", kpi_hours_submitted:"Heures soumises",
      kpi_with_warnings:"Avec avertissements", kpi_deviation_from_plan:"Écart par rapport au plan",
      hdr_team_allocated:"Équipe allouée à mes projets", chip_integrates:"S'intègre avec My Inbox et SAP Task Center",
      th_employee:"Employé", th_total:"Total", th_deviation:"Écart", th_status:"Statut",
      aria_select_all:"Tout sélectionner",
      hint_bulk_approval:"L'approbation groupée n'est disponible que pour les lignes sans avertissement. Le rejet exige un motif, selon le standard SAP.",
      label_cats_header:"De l'interface vers CATS", chip_annex_a:"Annexe A de la spécification",
      kpi_recording_target:"Cible d'enregistrement", kpi_assistance_layer:"Couche d'assistance",
      kpi_direct_table_write:"Écriture directe en table", val_never:"Jamais", kpi_customer_fields:"Champs client",
      hdr_state_chain:"Chaîne d'états et transfert",
      step_draft:"Brouillon", step_draft_sub:"BTP uniquement",
      step_saved:"Enregistré", step_saved_sub:"CATSDB, en cours",
      step_in_approval:"En approbation", step_in_approval_sub:"libéré, STATUS",
      step_approved:"Approuvé", step_approved_sub:"APNAM, APDAT",
      step_posted:"Comptabilisé", step_posted_sub:"CATA, CAT5, CAT7, CAT9",
      rule_1:"À partir de <strong>En approbation</strong>, modifier n'est plus un simple changement. La correction crée un nouvel enregistrement qui pointe vers l'original via <span class=\"num\">REFCOUNTER</span>, et repasse par l'approbation.",
      rule_2:"Le verrouillage des cellules reflète ce qui a déjà été transféré, pas seulement ce qui a été approuvé. Le transfert s'exécute comme un job, donc l'interface affiche la date du prochain cycle au lieu de prétendre que c'est instantané.",
      hdr_field_mapping:"Mappage champ par champ", chip_cats_or_btp:"CATS, BTP ou champ client",
      th_interface_element:"Élément d'interface", th_sap_concept:"Concept SAP", th_field:"Champ", th_where_lives:"Où il vit",
      hdr_cats_records:"Enregistrements CATS générés à partir de la semaine remplie", aria_format:"Format",
      btn_table:"Tableau", btn_api_payload:"Payload API",
      hint_cats_table:"Généré en direct à partir de la grille de l'écran Mon relevé. LTXA1 est tronqué à 40 caractères, la limite réelle du champ.",
      assistant_fab:"Assistant", assistant_title:"Assistant", chip_joule_pattern:"Modèle Joule",
      btn_close:"Fermer", aria_close_assistant:"Fermer l'assistant",
      placeholder_chat:"2h BNK test de paie hier", btn_send:"Envoyer",
      jfoot_text:"N'enregistre jamais sans confirmation. Les saisies créées ici sont marquées avec l'origine <span class=\"num\">Joule</span> et passent par les mêmes validations.",
      aria_dictate:"Dicter à la voix",
      bot_greeting:"Bonjour {name} ! Je peux saisir des heures, pour vous ou pour l'équipe, vérifier la semaine, gérer les absences, approuver des relevés, ou simplement vous emmener au bon écran. De quoi avez-vous besoin ?",
      bot_greeting_1:"Bonjour ! De quoi avez-vous besoin : saisir des heures, vérifier la semaine, ou autre chose ?",
      bot_greeting_2:"Bonjour. Dites-moi ce qu'il vous faut et je m'en occupe.",
      bot_greeting_3:"Bonjour ! Des heures à saisir, ou quelque chose à vérifier ?",
      chip_done_saved:"Enregistré", chip_done_submitted:"Soumis", chip_done_sent:"Envoyé pour approbation", chip_done_withdrawn:"Retiré", chip_done_approved:"Approuvé", label_week_card:"Semaine", text_schedule_h_day:"horaire de {h} h/jour", fmt_week_range:"semaine {n} ({from} au {to})", fmt_week_range_bare:"{n} ({from} au {to})", tip_windows_overlap:"Deux plages horaires se chevauchent ce jour-là.", chip_confirmed:"confirmé", chip_cancelled:"annulé",
      bot_cancelled_no_save:"Pas de problème, je n'ai rien enregistré.",
      bot_week_summary:"Vous avez {tot} h enregistrées sur {exp} h attendues, absences déjà déduites. ",
      bot_week_errors_block_one:"{n} erreur bloque la soumission.", bot_week_errors_block_other:"{n} erreurs bloquent la soumission.",
      bot_week_no_errors_submit:"Aucune erreur, vous pouvez soumettre.",
      bot_absences_intro:"Voici les absences de cette semaine, issues de la demande de congé. Les jours avec une absence de journée entière approuvée n'acceptent pas de saisie d'heures.",
      bot_help_text:"Voici ce que je peux faire : saisir vos heures (<span class=\"num\">2h BNK payroll testing yesterday</span>), saisir pour quelqu'un de l'équipe (<span class=\"num\">4h for João today</span>), vérifier la semaine ou les absences, copier la semaine précédente, appliquer les suggestions à forte confiance, soumettre la semaine, approuver des relevés, ou aller vers Équipe, Approbation ou Mappage CATS. Écrivez simplement en langage naturel.",
      bot_switched_to:"Passé à {screen}.",
      bot_suggestions_available:"Vous avez {n} suggestions à revoir dans le panneau latéral. Je peux appliquer celles à forte confiance, si vous le souhaitez.",
      bot_no_suggestions:"Aucune suggestion à revoir.",
      bot_no_high_conf:"Je n'ai aucune suggestion à forte confiance en attente.",
      bot_confirm_apply_suggestions:"Confirmez l'application de ces suggestions ?", btn_apply:"Appliquer",
      bot_suggestions_applied:"{n} suggestions appliquées. ",
      bot_copy_week_offer:"Je peux reprendre la structure de la semaine précédente, sans les durées.",
      label_action:"Action", bot_copy_rows_value:"copier les lignes de la semaine précédente",
      label_durations:"Durées", bot_stay_zero_value:"restent à zéro", btn_copy:"Copier",
      bot_copy_week_done:"C'est fait. Les lignes sont créées, les durées restent à remplir.",
      bot_week_already_submitted:"La semaine est déjà soumise et en approbation.",
      bot_cant_submit_week_one:"Je ne peux pas encore soumettre la semaine {num} : {n} erreur l'en empêche.", bot_cant_submit_week_other:"Je ne peux pas encore soumettre la semaine {num} : {n} erreurs l'en empêchent.",
      bot_cant_submit_month_one:"Je ne peux pas encore soumettre le mois de {month} : {n} erreur l'en empêche.", bot_cant_submit_month_other:"Je ne peux pas encore soumettre le mois de {month} : {n} erreurs l'en empêchent.",
      bot_cant_submit_fix:"Corrigez puis redemandez-moi, je le soumettrai aussitôt.",
      bot_month_already_submitted:"Le mois de {month} est déjà soumis et en approbation.",
      bot_confirm_submit_month:"Confirmez-vous la soumission du mois de {month} pour approbation ? Elle couvre toutes les semaines du mois encore ouvertes.",
      bot_month_submitted_msg:"Mois de {month} soumis. Il est maintenant en approbation chez {names}.",
      bot_submit_weekly_only:"Ici la feuille de temps est hebdomadaire, la soumission se fait donc à la semaine.",
      bot_month_summary:"En {month}, vous avez {tot} h enregistrées sur {exp} h attendues, absences déjà déduites. ",
      bot_month_no_errors_submit:"Aucune erreur, vous pouvez soumettre le mois.",
      label_month:"Mois", label_weeks:"Semaines", label_warnings:"Avertissements", fmt_month_year:"{month} {y}",
      bot_confirm_submit_week:"Confirmez la soumission de la semaine {num} ?",
      label_expected:"Attendu", label_status_after_submit:"Statut après soumission",
      bot_week_submitted_msg:"Semaine {num} soumise. Elle est maintenant en approbation chez {names}.",
      bot_week_locked:"La semaine est déjà soumise, je ne peux pas la modifier. Voulez-vous voir autre chose ?",
      bot_day_absence_no_alt:"{day} a une {type} approuvée et aucun autre jour n'a de capacité libre. Je n'ai rien enregistré.",
      bot_day_absence_suggest:"{day} a une {type} approuvée, donc n'accepte pas d'heures. Je suggère {alt}.",
      bot_day_closed:"{day} tombe dans une période clôturée, elle ne peut pas recevoir de nouvelles heures. Je n'ai rien enregistré.",
      bot_day_abs_cap:"{day} a une {type} approuvée.", bot_day_capacity:"La capacité de {day} est de {cap} h.",
      bot_hours_left_suffix:" Seulement {left} h disponibles, je n'ai rien enregistré.",
      bot_no_hours_suffix:" Aucune heure disponible ce jour-là, je n'ai rien enregistré.",
      bot_confirm_entry:"Confirmez cette saisie ?", label_receiver_object:"Objet récepteur",
      bot_receiver_pep:"PEP {code}", bot_receiver_cost_center:"Centre de coûts {code}",
      bot_desc_tbd:"(à compléter)", bot_entry_saved:"{dur} h enregistrées le {day}, {code}. ",
      bot_every_day_blocked:"Chaque jour de cette période a une absence approuvée, tombe dans une période clôturée, ou n'a pas la place pour cette quantité. Je n'ai rien enregistré.",
      bot_skip_absence_closed:"{days} (absence approuvée ou période clôturée)", bot_skip_over_capacity:"{days} (au-delà de la capacité)",
      bot_days_skipped_suffix:" ({parts} ignorés)", label_duration_per_day:"Durée par jour",
      bot_entry_saved_days_one:"{dur} h enregistrées sur {n} jour ({total} h au total), {code}. ",
      bot_entry_saved_days_other:"{dur} h enregistrées sur {n} jours ({total} h au total), {code}. ",
      bot_week_capacity_full:"Tous les jours ouvrés de cette semaine sont déjà à pleine capacité.",
      bot_month_capacity_full:"Tous les jours ouvrés de ce mois sont déjà à pleine capacité.",
      bot_filled_saved_one:"{total} h enregistrées sur {n} jour, {code}. ", bot_filled_saved_other:"{total} h enregistrées sur {n} jours, {code}. ",
      bot_filled_saved_month_one:"{total} h enregistrées sur {n} jour, {code}, ce mois-ci. ",
      bot_filled_saved_month_other:"{total} h enregistrées sur {n} jours, {code}, ce mois-ci. ",
      bot_cant_stage:"Impossible de mettre ça en préparation : {list}.", bot_week_already_approved:"{name} (semaine déjà approuvée)",
      label_people:"Personnes", label_time:"Horaire", label_duration_each:"Durée de chacun", label_skipped:"Ignorés",
      bot_confirm_register_staging:"Enregistrer ceci pour l'équipe, pour le compte de chaque personne ?", btn_register:"Enregistrer",
      bot_staged_saved:"Enregistré pour {names}, {days} de la {week}, {code}, pour le compte de chaque personne. Vous les trouverez dans Saisie d'équipe, onglet Heures, sur cette semaine.",
      bot_staged_nothing:"Rien n'a été réellement enregistré.",
      bot_staged_not_saved_suffix:" {names} n'a/ont pas pu de cette façon (non alloué à {code}, mauvais profil pour ce champ, absence, ou période clôturée), la raison est sur l'écran Équipe.",
      bot_note_required:"{noteLabel} est obligatoire pour {name}. Que doit-elle indiquer ?",
      label_quantity_each:"Quantité de chacun",
      bot_staged_saved_allow:"Enregistré pour {names}, {days} de la {week}, {name}, pour le compte de chaque personne. Vous les trouverez dans Saisie d'équipe, onglet Indemnités, sur cette semaine.",
      bot_staged_not_saved_allow_suffix:" {names} n'a/ont pas pu (non alloué à {code}, mauvaise entreprise pour cette indemnité, ou période clôturée).",
      bot_team_nobody_missing:"Personne dans l'équipe de {code} n'a de jours ouvrés manquants cette semaine.",
      bot_team_already_full:"{names} est/sont déjà à pleine capacité cette semaine, dans l'équipe de {code}.",
      bot_team_person_not_found:"Je n'ai trouvé personne nommé \"{name}\" dans l'équipe de {code}.",
      bot_confirm_fill_team:"Compléter ces jours manquants jusqu'à la capacité de chacun ?",
      btn_fill_and_register:"Compléter et enregistrer",
      bot_team_filled_saved:"Heures manquantes complétées et enregistrées pour {names}, pour le compte de chaque personne, en {week}. Vous les trouverez dans Saisie d'équipe, onglet Heures, sur cette semaine.",
      bot_team_filled_nothing:"Rien n'a été enregistré.",
      bot_team_filled_not_saved_suffix:" {names} n'a/ont pas pu, la raison est sur la grille Équipe.",
      bot_approval_ask_who:"Dites-moi qui approuver, un nom, ou «approuver tout le monde» pour tous les relevés sans exception.",
      bot_approval_nothing:"Rien à approuver ici, soit tout est déjà approuvé, soit ce qui reste a une exception qui nécessite une revue individuelle.",
      bot_confirm_approve_all:"Approuver ces {n} relevés, sans exception ?", btn_approve_all:"Tout approuver",
      bot_approved_all_msg:"{n} relevés approuvés. Les exceptions restent à revoir individuellement.",
      bot_already_approved:"Le relevé de {name} est déjà approuvé.",
      bot_has_exception:"Le relevé de {name} a une exception ({note}) et nécessite une revue individuelle sur l'écran Approbation, celui-là ne peut pas être approuvé en bloc.",
      bot_confirm_approve_one:"Approuver le relevé de {name} ?", label_in_project:"Sur le projet", btn_approve:"Approuver",
      bot_approved_one_msg:"Relevé de {name} approuvé.",
      fmt_week_n:"semaine {n}", bot_gap_row:"{day} : {h} sur {cap} h, il manque {left} h",
      bot_gaps_head_one:"En {period}, il vous reste {n} jour à compléter, {h} h au total. Vous avez {tot} h sur {exp} h :", bot_gaps_head_other:"En {period}, il vous reste {n} jours à compléter, {h} h au total. Vous avez {tot} h sur {exp} h :",
      bot_gaps_none:"Rien ne manque en {period} : {tot} h sur {exp} h enregistrées.",
      bot_recorded_head:"En {period}, vous avez {tot} h enregistrées sur {exp} h attendues :", bot_recorded_none:"Vous n'avez encore aucune heure enregistrée en {period}.",
      chip_fill_missing:"Compléter les heures manquantes", chip_what_missing:"Que me manque-t-il ?",
      bot_claude_unavailable:"Je ne parviens pas à joindre Claude pour l'instant, je ne peux donc pas répondre. Réessayez dans un moment.",
      bot_parse_failed:"Je n'ai pas compris ce qu'il fallait enregistrer. Écrivez la durée et le projet, par exemple <span class=\"num\">2h BNK payroll testing yesterday</span>. Je peux aussi afficher le statut de la semaine ou vos absences.",
      bot_parse_failed_generic:"Je n'ai pas saisi tous les détails de cette saisie. Pouvez-vous l'écrire autrement ?",
      bot_which_project:"Pour quel projet sont ces heures ?",
      bot_team_not_found:"je n'ai pas trouvé \"{name}\" dans l'équipe de {code} ({leader}). S'il/elle est sur un autre projet ou avec un autre responsable, changez d'abord le sélecteur \"Acting as\" ou \"Project\" en haut de l'écran Équipe",
      bot_team_who_unclear:"je n'ai pas compris de qui il s'agit", bot_team_day_unclear:"je n'ai pas compris le jour",
      bot_team_amount_unclear:"je n'ai pas compris {amount}", label_the_hours:"les heures", label_the_quantity:"la quantité",
      bot_also_unrecognized_wage_type:"Je n'ai pas non plus reconnu la rubrique.",
      chip_hours_i_have:"Combien d'heures ai-je ?", chip_my_absences:"Mes absences", chip_bnk_example:"2h BNK test de paie hier",
      chip_submit_week:"Soumettre la semaine", chip_submit_month:"Soumettre le mois", chip_copy_last_week:"Copier la semaine précédente",
      chip_apply_high_conf:"Appliquer celles à forte confiance", chip_help:"Aide",
      dlg_add_allowance_title:"Ajouter une indemnité", chip_wage_type:"Rubrique", label_allowance:"Indemnité", label_day:"Jour",
      btn_cancel:"Annuler", btn_record_allowance:"Enregistrer l'indemnité",
      dlg_quick_add_title:"Ajout rapide", label_write_natural:"Écrivez en langage naturel",
      placeholder_quick_nl:"3h BNK analyse des besoins hier", chip_waiting_text:"en attente de texte",
      chip_duration_to_set:"durée à définir", chip_project_to_choose:"projet à choisir", chip_activity_to_set:"activité à définir", chip_desc_prefix:"description : {txt}",
      text_period_closed_paren:"(période clôturée)", hint_calendar_month:"Vue du mois en lecture seule. Saisissez ou modifiez le temps dans la vue Grille.",
      text_week_already_approved:"semaine déjà approuvée", text_staged_not_saved_short:"en attente, non enregistré", unit_h_per_day:"{h} h/jour", text_n_staged:"{n} en attente",
      text_quick_hint:"Chaque champ résolu peut être corrigé. Si le texte n'est pas reconnu, il va dans la description et rien n'est inventé.",
      btn_save_entry:"Enregistrer la saisie",
      dlg_entry_detail_title:"Détail de la saisie", label_project_wbs:"Projet et WBS",
      label_start:"Début", label_end:"Fin", label_activity_type:"Type d'activité", label_description:"Description",
      placeholder_description:"Obligatoire, au moins 10 caractères. Les 40 premiers vont dans LTXA1",
      placeholder_description_optional:"Obligatoire, au moins 10 caractères. Les 40 premiers vont dans LTXA1",
      label_project_effort:"Effort projet, réel vs. planifié",
      label_origin:"Origine", val_manual:"Manuel", label_created_by:"Créé par", label_last_changed:"Dernière modification",
      btn_back:"Retour", btn_submit:"Soumettre",
      dlg_my_data_title:"Mes données", text_data_intro:"Pour proposer des saisies, l'application n'utilise que des métadonnées, au niveau du projet :",
      row_calendar_events:"Événements du calendrier d'entreprise", row_tickets_handled:"Tickets traités",
      row_repos_activity:"Dépôts avec activité", row_content_emails:"Contenu d'emails, fichiers ou captures d'écran",
      row_raw_timeline:"Rétention de l'historique brut",
      chip_metadata_only:"métadonnées seulement", chip_project_level:"niveau projet", chip_never_collected:"jamais collecté",
      val_14_days:"14 jours", chip_or_until_confirmed:"ou jusqu'à confirmation",
      text_data_footer:"Cet historique n'est visible que par vous. L'organisation ne voit que les saisies que vous soumettez. Base légale et analyse d'impact à valider avec le DPO avant le pilote.",
      btn_delete_timeline:"Supprimer l'historique",
      dlg_shortcuts_title:"Raccourcis clavier",
      row_open_close_assistant:"Aller à l'assistant", row_new_quick_add:"Nouvel ajout rapide",
      row_copy_previous_week:"Copier la semaine précédente", row_prev_next_week:"Semaine précédente et suivante",
      row_confirm_cell:"Valider la cellule et descendre", row_show_list:"Afficher cette liste",
      bot_balance_asof:"Au {date}, votre solde de congés sera de {avail} jours : {total} de droits, {used} pris ou approuvés d'ici là et {req} demandés en attente.",
      bot_movements_intro:"Votre compte de congés {y}, mouvement par mouvement. Disponible maintenant : {avail} jours.",
      bot_request_status:"Demande {id} : {who}{type}, {period}. Statut : {status}.",
      bot_request_not_found:"Je ne trouve pas la demande {id} parmi les vôtres. Voici vos demandes :",
      bot_request_which:"Quelle demande ? Voici les vôtres :",
      bot_approvers_ts_month:"Votre feuille de temps est soumise au mois et approuvée par {names}.",
      bot_approvers_ts_week:"Votre feuille de temps est soumise à la semaine et approuvée par {names}.",
      bot_approvers_leave:"Vos absences vont chez {name}.",
      bot_submit_check_ok_month:"Rien ne bloque le mois de {month} : {total} h sur {exp} h attendues. Une fois soumis, il part chez {names}.",
      bot_submit_check_ok_week:"Rien ne bloque la semaine {num} : {total} h sur {exp} h attendues. Une fois soumise, elle part chez {names}.",
      bot_holidays_next:"Les prochains jours fériés (calendrier de {office}), sans heures attendues et non décomptés des congés :",
      bot_holidays_month:"Jours fériés en {month} (calendrier de {office}), sans heures attendues et non décomptés des congés :",
      bot_holidays_none:"Aucun jour férié en {month} (calendrier de {office}).",
      bot_teamcal_intro:"Qui est absent, {when} :",
      bot_teamcal_none:"Personne de votre calendrier d'équipe n'est absent, {when}.",
      bot_team_balances_only_manager:"Les soldes de l'équipe sont visibles par le responsable ({name}). Je peux vous donner le vôtre.",
      bot_team_balances_intro:"Soldes de congés de votre équipe en {y} :",
      text_team_balance_row:"{name} · {avail} jours disponibles, {req} en attente",
      bot_leave_nothing_to_change:"Vous n'avez aucune demande en attente à modifier. Une demande approuvée s'annule et se redemande.",
      bot_leave_which_change:"Quelle demande voulez-vous modifier ? Seules celles en attente peuvent l'être :",
      bot_leave_cannot_change:"La demande {id} ne peut plus être modifiée ({status}). Seule une demande en attente peut l'être ; une demande approuvée s'annule et se redemande.",
      bot_leave_change_what:"Que faut-il changer dans la demande {id} ? Donnez-moi les nouvelles dates ou le type, ou ouvrez le formulaire.",
      bot_leave_confirm_change:"Voici la demande {id} avec la modification. Elle repart chez {name} pour approbation.",
      bot_leave_changed_msg:"Modifiée. La demande {id} est de nouveau chez {name} pour approbation.",
      bot_leave_onbehalf_only_manager:"Seul le responsable saisit une absence pour quelqu'un d'autre ({name}, pour votre équipe). Je peux demander la vôtre.",
      bot_leave_onbehalf_who:"Pour qui ? Je peux la saisir pour l'un de vos collaborateurs directs : {list}.",
      bot_leave_onbehalf_confirm:"Je saisis cette absence pour {name}, approuvée dès la saisie.",
      bot_leave_onbehalf_done:"Saisie pour {name}, déjà approuvée.",
      bot_allow_bonus_owner:"La prime de projet est saisie par le responsable du projet pour l'équipe, dans Saisie d'équipe, jamais dans votre propre feuille de temps.",
      bot_allow_turno_pt02:"La prime d'équipe n'existe que chez Building Solutions (PT02).",
      bot_allow_country:"Dans quel pays ? L'indemnité à l'étranger en a besoin.",
      bot_allow_which_project:"Pour quel projet est cette {name} ?",
      bot_allow_confirm:"Voici l'indemnité à saisir. Rien n'est enregistré sans votre confirmation.",
      bot_allow_recorded:"Saisi : {name} le {day}, {qty} jours.",
      bot_pending_in_month_one:"{n} demande d'absence à décider en {month} :", bot_pending_in_month_other:"{n} demandes d'absence à décider en {month} :",
      bot_pending_in_month_none:"Rien ne vous attend en {month}.",
      bot_ts_queue_month:"Chez Consulting, chaque feuille de temps est le mois entier de la personne, ici {month}.",
      bot_ts_queue_week:"Chez Building Solutions, chaque feuille de temps est une semaine."
    }
  };
  /* Two languages, kept apart: the screens use the one chosen in Settings
     (state.lang); the assistant answers in the language of each message.
     While a message is handled, REPLY_LANG holds the reply's language, and
     anything redrawn on screen meanwhile goes back to the interface's. */
  var REPLY_LANG = null;
  function curLang(){ return REPLY_LANG || state.lang; }
  function setReplyLang(l){
    REPLY_LANG = l && l !== state.lang ? l : null;
    applyLocaleArrays();
  }
  function inUiLang(fn){
    var saved = REPLY_LANG;
    if(!saved) return fn();
    REPLY_LANG = null; applyLocaleArrays();
    try{ return fn(); } finally{ REPLY_LANG = saved; applyLocaleArrays(); }
  }
  function t(key, vars){
    var d = I18N[curLang()] || I18N.en;
    var s = (Object.prototype.hasOwnProperty.call(d, key) ? d[key] : I18N.en[key]);
    if(s === undefined) return key;
    if(vars) Object.keys(vars).forEach(function(k){ s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }
  /* French pluralises 0 and 1 the same way (singular); English and
     Portuguese only keep the singular at exactly 1. */
  function plural(n, key, extraVars){
    var isOne = curLang() === "fr" ? (n <= 1) : (n === 1);
    var vars = {n: n};
    if(extraVars) Object.keys(extraVars).forEach(function(k){ vars[k] = extraVars[k]; });
    return t(isOne ? key + "_one" : key + "_other", vars);
  }
  var WEEKDAY_ABBR_I18N = {
    en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    pt:["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"],
    fr:["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"]
  };
  var MONTHS_I18N = {
    en:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    pt:["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"],
    fr:["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"]
  };
  /* Full month names for display (the "September 2026" month-view label),
     kept separate from MONTHS_NLP below: that one stays English-only, it
     drives the natural-language regex parser, which doesn't understand
     other languages yet regardless of the UI language selected here. */
  var MONTHS_FULL_I18N = {
    en:["January","February","March","April","May","June","July","August","September","October","November","December"],
    pt:["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],
    fr:["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"]
  };
  function monthFullName(i){ return (MONTHS_FULL_I18N[curLang()] || MONTHS_FULL_I18N.en)[i]; }
  /* Re-points the two lookup arrays at the current language and rebuilds
     the cached weekday+date labels (DAYS) that were computed from the old
     ones - called on load and every time the language changes. */
  function applyLocaleArrays(){
    WEEKDAY_ABBR = WEEKDAY_ABBR_I18N[curLang()] || WEEKDAY_ABBR_I18N.en;
    MONTHS = MONTHS_I18N[curLang()] || MONTHS_I18N.en;
    if(typeof WORKDATES !== "undefined" && WORKDATES.length) DAYS = daysFor(WORKDATES);
  }
  /* Walks every element carrying a data-i18n* attribute and applies the
     current language. Static text (data-i18n) is the vast majority;
     data-i18n-title/placeholder/aria set the matching attribute instead,
     and data-i18n-html allows the handful of strings with inline markup
     (<strong>, <span class="num">) to use innerHTML instead of textContent. */
  function applyDmyPlaceholders(){
    ["lvAsOf","lvStart","lvEnd"].forEach(function(id){ var n = $(id); if(n) n.placeholder = t("placeholder_dmy"); });
    Array.prototype.forEach.call(document.querySelectorAll(".dmypick"), function(b){ b.setAttribute("aria-label", t("aria_pick_date")); b.title = t("aria_pick_date"); });
  }
  function applyI18n(){
    if(typeof applyDmyPlaceholders === "function") setTimeout(applyDmyPlaceholders, 0);
    document.querySelectorAll("[data-i18n]").forEach(function(elm){
      elm.textContent = t(elm.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function(elm){
      elm.innerHTML = t(elm.getAttribute("data-i18n-html"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function(elm){
      elm.title = t(elm.getAttribute("data-i18n-title"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function(elm){
      elm.placeholder = t(elm.getAttribute("data-i18n-placeholder"));
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function(elm){
      elm.setAttribute("aria-label", t(elm.getAttribute("data-i18n-aria")));
    });
    document.querySelectorAll("[data-wd]").forEach(function(elm){
      elm.textContent = WEEKDAY_ABBR[+elm.getAttribute("data-wd")];
    });
    if($("captureTxt")) $("captureTxt").textContent = state.privateMode ? t("capture_off") : t("capture_on");
    if(typeof updateApproverChrome === "function") updateApproverChrome();
    if($("dlgDetail") && $("dlgDetail").open && $("dtProj") && $("dtProj").value !== "") updateDescPlaceholder(+$("dtProj").value);
    if(typeof refreshAssistantForLang === "function") refreshAssistantForLang();
    document.documentElement.lang = state.lang;
  }
  function setLang(lang){
    if(!I18N[lang]) return;
    state.lang = lang;
    try{ localStorage.setItem("vesiLang", lang); }catch(e){}
    voice.lang = lang.toUpperCase();
    syncVoiceLangBtn();
    applyLocaleArrays();
    applyI18n();
    renderContextButton();
    renderSetup();
    render();
    if($("screen-team") && !$("screen-team").hidden) renderTeam();
    if($("screen-aprov") && !$("screen-aprov").hidden) renderApprovals();
    if($("screen-cats") && !$("screen-cats").hidden){ renderCats(); renderMap(); }
  }

  /* Sofia's (PT01, Consulting) and Marco's (PT02, Building Solutions) own
     approval queues - swapped into state.approvals on company switch, the
     same way WEEKS is, so the Approval screen reflects whichever company
     IT0001 currently reads instead of always showing Consulting. */
  /* Consulting approves by month, the period its timesheet shows: each
     line is a person's whole month, with what is missing per week (gap,
     by week of the month) and the hours on the internal project, so the
     totals are worked out from the real working days of that month
     (monthlyApprovals below). Building Solutions approves by week. */
  var APPROVALS_PT01 = [
    {who:"Ana Ferreira", role:"Senior consultant", proj:"BNK-2026", internal:8, gaps:{}, warn:0, sel:false},
    {who:"Bruno Matos", role:"Consultant", proj:"RTL-TT", internal:8, gaps:{4:1.5}, warn:0, sel:false},
    {who:"Carla Nunes", role:"Consultant", proj:"AER-WFM", internal:0, gaps:{}, warn:0, sel:false},
    {who:"Diogo Sousa", role:"Junior consultant", proj:"BNK-2026", internal:12, gaps:{2:3}, warn:0, sel:false},
    {who:"Eva Lopes", role:"Architect", proj:"RTL-TT", internal:0, gaps:{}, warn:1, sel:false, note:"Pending leave request overlaps recorded hours"},
    {who:"Filipe Reis", role:"Consultant", proj:"AER-WFM", internal:6, gaps:{3:16}, warn:1, sel:false, note:"Two empty working days"}
  ];
  var APPROVALS_PT02 = [
    {who:"Nuno Dias", role:"Technician", proj:"HSP-FAC", tot:40, inproj:40, dev:0, warn:0, sel:false, days:[8,8,8,8,8]},
    {who:"Hélder Rocha", role:"Technician", proj:"HSP-FAC", tot:18, inproj:18, dev:-12, warn:0, sel:false, days:[0,0,6,6,6]},
    {who:"Luís Teixeira", role:"Technician", proj:"HSP-FAC", tot:24, inproj:24, dev:-8, warn:0, sel:false, days:[8,8,8,0,0]},
    {who:"Ana Pires", role:"Technician", proj:"AER-FAC", tot:16, inproj:16, dev:-16, warn:0, sel:false, days:[8,8,0,0,0]},
    {who:"Hugo Matos", role:"Technician", proj:"HSP-FAC", tot:24, inproj:24, dev:-8, warn:1, sel:false, note:"Pending leave request overlaps recorded hours", days:[8,0,8,8,0]},
    {who:"Carla Sousa", role:"Senior technician", proj:"AER-FAC", tot:16, inproj:16, dev:-16, warn:1, sel:false, note:"Two empty working days", days:[0,8,8,0,0]}
  ];
  var state = {
    lang: (function(){
      try{
        var saved = localStorage.getItem("vesiLang");
        if(I18N[saved]) return saved;
        var nav = String(navigator.language || "").slice(0, 2).toLowerCase();
        return I18N[nav] ? nav : "en";
      }catch(e){ return "en"; }
    })(),
    submitted: WEEKS[weekIdx].submitted,
    /* True whenever there's an edit (to any week, hours or a status
       change) not yet confirmed with Save: set on every hour-cell edit,
       template/suggestion/quick-add/chat entry, and on Submit itself
       (submitting changes the week's status, which also needs saving).
       Only Save clears it - navigating to a different week doesn't,
       since the pending work isn't tied to whichever week is on screen. */
    needsSave: false,
    privateMode:false,
    rows: WEEKS[weekIdx].rows,
    allow: WEEKS[weekIdx].allow,
    sugs: WEEKS[weekIdx].sugs,
    deviationNote: WEEKS[weekIdx].deviationNote || "",
    leader: "RN",
    staged: {},
    stagedAllow: [],
    massLog: [],
    /* Same idea as needsSave, but for the Team screen's own leader-side
       action, kept separate so one person's pending work never shows as
       "unsaved" on someone else's screen: "Save staged entries"/"Save
       staged allowances" only move data from staged into massLog (the
       "Recorded on behalf" log) - not yet reflected in the database, that
       still needs the header Save. Bonus is excluded on purpose, it's
       recorded and approved in the same click, there's nothing staged. */
    teamNeedsSave: false,
    /* massLog is append-only (see the beforeLog = massLog.length pattern
       already used for the assistant's own flows below), so "everything
       from this index on is still unsaved" is enough to mark exactly
       which recorded-but-not-saved hours entries a cell should highlight,
       even once they're no longer in state.staged - a mass fill that goes
       straight to massLog (the assistant's team fill does, it never
       leaves anything sitting in staged) would otherwise show no marker
       at all once it's recorded. */
    teamSavedThrough: 0,
    /* pure display state, not part of the timesheet data: which mass-entry
       tab is showing, and whether the person has manually opened/closed
       Suggestions this session (null = follow the automatic empty/non-empty
       guess) */
    teamTab: "hours",
    sugManualOpen: null,
    allowManualOpen: null,
    /* which top-level screen is showing right now: "home" (the assistant,
       where the app opens), "semana" (My week), "leave", "team", "aprov"
       or "cats" - lets the assistant tell a personal request from a team
       one when the wording alone is ambiguous */
    screen: "home",
    areaLast: {},
    approvals: APPROVALS_PT01,
    /* whose eyes the app is seen through, chosen in the test setup:
       "employee", "pm" (project manager: team entry and timesheet
       approval) or "manager" (line manager: leave approval) */
    role: "employee",
    /* Approval screen: "pending" shows only what is still to approve */
    apFilter: "pending",
    /* true once the test setup has been confirmed; nothing is greeted before */
    setupDone: false,
    /* decisions on the employee's own requests, waiting to be told to them
       the next time the employee is the one using the app */
    leaveNotices: [],
    /* the last request sent, for the payload shown on the mapping screen */
    lastLeave: null
  };

  var $ = function(id){ return document.getElementById(id); };
  var nextId = 100;

  function fmt(n){ return (Math.round(n*100)/100).toFixed(1); }
  function parseDur(txt){
    if(!txt) return 0;
    var t = String(txt).trim().toLowerCase().replace(",", ".");
    if(!t) return 0;
    var m;
    if((m = t.match(/^(\d{1,2}):(\d{1,2})$/))) return (+m[1]) + (+m[2])/60;
    if((m = t.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?$/))) return (+m[1])/60;
    if((m = t.match(/^(\d+(?:\.\d+)?)\s*h?$/))) return +m[1];
    return NaN;
  }
  function round15(v){ return Math.round(v*4)/4; }

  function rowTotal(r){ return r.h.reduce(function(a,b){ return a+(b||0); },0); }
  function dayTotal(d){ return state.rows.reduce(function(a,r){ return a+(r.h[d]||0); },0); }
  function weekTotal(){ return state.rows.reduce(function(a,r){ return a+rowTotal(r); },0); }
  function projTotal(){
    return state.rows.reduce(function(a,r){ return a + (PROJECTS[r.p].proj ? rowTotal(r) : 0); },0);
  }

  /* ---------- validation ---------- */
  function validate(){
    var out = [];
    for(var d=0; d<7; d++){
      if(dayTotal(d) > 24) out.push({sev:"e", txt:t("val_day_exceeds_24h", {day: DAYS[d]}), day:d});
    }
    state.rows.forEach(function(r){
      if(rowTotal(r) > 0 && r.desc.trim().length < 10){
        out.push({sev:"e", txt:t("val_desc_required", {code: PROJECTS[r.p].code}), row:r.id});
      }
    });
    /* Never past the day's capacity - the person's daily schedule, reduced
       further by an approved absence when there is one. The field-level
       check in durCell keeps this from happening through the UI; this is
       the same rule enforced again for whatever reaches state.rows some
       other way (Quick add, the assistant, a suggestion accepted). */
    for(var a=0; a<5; a++){
      var cap = capacity(a), tot = dayTotal(a);
      if(tot === 0) continue;
      if(cap === 0 && absHours(a) > 0){
        out.push({sev:"e", day:a, conflict:a,
          txt:t("val_absence_move_hours", {day: DAYS[a], type: absTypeLabel(absOn(a,"approved")[0]).toLowerCase(), h: fmt(tot)})});
      } else if(tot > cap){
        out.push({sev:"e", day:a,
          txt: absHours(a) > 0
            ? t("val_partial_absence_capacity", {day: DAYS[a], cap: fmt(cap), tot: fmt(tot)})
            : t("val_day_capacity", {day: DAYS[a], cap: fmt(cap), tot: fmt(tot)})});
      }
    }
    for(var p=0; p<5; p++){
      if(absOn(p,"pending").length && dayTotal(p) > 0){
        out.push({sev:"w", day:p, txt:t("val_pending_leave_conflict", {day: DAYS[p]})});
      }
    }
    for(var i=0; i<5; i++){
      if(capacity(i) > 0 && dayTotal(i) === 0) out.push({sev:"w", txt:t("val_day_empty", {day: DAYS[i]}), day:i});
    }
    var expect = weekCapacity();
    if(weekTotal() > 0 && weekTotal() < expect) out.push({sev:"w", txt:t("val_week_below_expected", {tot: fmt(weekTotal()), expect: fmt(expect)})});
    /* closed periods, monthly and per company */
    for(var c=0; c<7; c++){
      if(dayTotal(c) > 0 && !periodOpen(WORKDATES[c])){
        out.push({sev:"e", day:c, txt:t("val_closed_period", {day: DAYS[c], ym: periodFor(WORKDATES[c]).ym, bukrs: IT0001.bukrs})});
      }
    }
    /* overlapping windows, only in the profile that records start and end */
    if(isClock()){
      for(var o=0; o<7; o++){
        var hits = clockOverlaps(o);
        if(hits.length){
          out.push({sev:"e", day:o, txt:t("val_overlapping_windows", {day: DAYS[o], t1: fmtClock(hits[0][0].b), t2: fmtClock(hits[0][0].e%1440), t3: fmtClock(hits[0][1].b), t4: fmtClock(hits[0][1].e%1440)})});
        }
      }
      state.rows.forEach(function(r){
        for(var i=0; i<7; i++){
          var s = slot(r,i);
          if(s && (s.b === null) !== (s.e === null)){
            out.push({sev:"e", row:r.id, day:i, txt:t("val_window_needs_both", {day: DAYS[i], code: PROJECTS[r.p].code})});
          }
        }
      });
    }
    /* allowances on this employee's own sheet */
    myAllow().forEach(function(a){
      var w = wt(a.code);
      if(!w) return;
      if(w.noteLabel && !String(a.note || "").trim()){
        out.push({sev:"e", allow:a.id, txt:t("val_allow_note_needed", {name: wtName(w), day: DAYS[a.day], noteLabel: w.noteLabel.toLowerCase()})});
      }
      if(!periodOpen(WORKDATES[a.day])){
        out.push({sev:"e", allow:a.id, txt:t("val_allow_closed_period", {name: wtName(w), day: DAYS[a.day]})});
      }
      if(w.amount && !(a.amount > 0)){
        out.push({sev:"e", allow:a.id, txt:t("val_allow_no_amount", {name: wtName(w), day: DAYS[a.day]})});
      }
      if(!w.amount && !(a.qty > 0)){
        out.push({sev:"e", allow:a.id, txt:t("val_allow_no_qty", {name: wtName(w), day: DAYS[a.day]})});
      }
    });
    var pend = visibleSugs().length;
    if(pend > 0 && !state.privateMode) out.push({sev:"i", txt:plural(pend, "n_suggestions_to_review2")});
    return out;
  }
  function errors(){ return validate().filter(function(m){ return m.sev === "e"; }); }

  /* ---------- start and end, profile Z_BSRV ----------
     Stored per row and day as {b, e} in minutes, written to BEGUZ and ENDUZ.
     The duration is always computed and never editable in this profile, and
     the three values are all kept so nothing downstream has to recalculate. */
  function parseClock(txt){
    if(txt === null || txt === undefined) return null;
    var t = String(txt).trim();
    if(!t) return null;
    var m = t.replace(/[.hH]/g, ":").match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if(!m) return NaN;
    var h = +m[1], mi = m[2] === undefined ? 0 : +m[2];
    if(h > 23 || mi > 59) return NaN;
    return h*60 + mi;
  }
  function fmtClock(min){
    if(min === null || min === undefined) return "";
    var h = Math.floor(min/60), m = min%60;
    return (h<10?"0":"") + h + ":" + (m<10?"0":"") + m;
  }
  function slot(r, i){
    if(!r.t) r.t = [null,null,null,null,null,null,null];
    return r.t[i];
  }
  function setSlot(r, i, s){
    if(!r.t) r.t = [null,null,null,null,null,null,null];
    r.t[i] = s;
  }
  function slotHours(s){
    if(!s || s.b === null || s.e === null) return 0;
    var d = s.e - s.b;
    if(d < 0) d = profileFor(WORKDATES[0]).overnight ? d + 1440 : 0;
    /* Every clock window is assumed to carry its own 1h lunch break in the
       middle, worked hours are the span minus that break. */
    d = Math.max(0, d - LUNCH_MIN);
    return round15(d/60);
  }
  /* Recomputes every duration from the time window. Called whenever a window
     changes and once when the profile switches to Z_BSRV. */
  function syncClock(){
    state.rows.forEach(function(r){
      for(var i=0; i<7; i++){
        var s = slot(r,i);
        if(s) r.h[i] = slotHours(s);
      }
    });
  }
  /* Overlapping windows on the same day, only meaningful in Z_BSRV. */
  function clockOverlaps(day){
    var slots = [];
    state.rows.forEach(function(r){
      var s = slot(r,day);
      if(s && s.b !== null && s.e !== null) slots.push({b:s.b, e:s.e < s.b ? s.e + 1440 : s.e, p:r.p});
    });
    slots.sort(function(a,b){ return a.b - b.b; });
    var hits = [];
    for(var i=1; i<slots.length; i++){
      if(slots[i].b < slots[i-1].e) hits.push([slots[i-1], slots[i]]);
    }
    return hits;
  }

  /* The one gate a self-entry cell has to pass to stay editable: the week
     isn't submitted, its period isn't closed, and it isn't a day an approved
     absence already fills (unless it already carries a value, so an old
     entry stays visible and removable even if an absence landed on it
     afterwards). durCell and clockCell each computed this the same way. */
  function cellLocked(day, v){
    return state.submitted || !periodOpen(WORKDATES[day]) || (isBlocked(day) && !v);
  }
  function durCell(r, i, v, pr){
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "cell" + dayExtraClass(i);
    inp.id = "c-"+r.id+"-"+i;
    inp.value = v ? fmt(v) : "";
    inp.inputMode = "decimal";
    inp.setAttribute("aria-label", t("aria_dur_cell", {proj: pr.name, day: DAYS[i]}));
    inp.disabled = cellLocked(i, v);
    decorateCell(inp, i, v);
    inp.addEventListener("change", function(){
      var parsed = parseDur(inp.value);
      if(isNaN(parsed)){ toast(t("toast_bad_duration", {v: inp.value})); inp.value = v ? fmt(v) : ""; return; }
      var newVal = round15(parsed);
      /* Never exceed the day's capacity - the person's daily schedule,
         reduced further by an approved absence when there is one. Block
         it here, at the field, instead of only flagging it once the
         week is validated: the app should never let the limit pass. */
      var otherTotal = dayTotal(i) - (r.h[i] || 0);
      var cap = capacity(i);
      if(otherTotal + newVal > cap){
        var abs = absOn(i, "approved")[0];
        var left = Math.max(0, cap - otherTotal);
        var msg = abs
          ? t("msg_day_approved_type", {day: DAYS[i], type: absTypeLabel(abs).toLowerCase()})
          : t("msg_day_capacity_simple", {day: DAYS[i], cap: fmt(cap)});
        toast(msg + (left > 0 ? t("toast_only_available", {left: fmt(left)}) : t("toast_no_hours_available")));
        inp.value = v ? fmt(v) : "";
        return;
      }
      r.h[i] = newVal;
      state.needsSave = true;
      render();
    });
    inp.addEventListener("keydown", function(ev){
      if(ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey){
        ev.preventDefault(); inp.blur();
        var idx = state.rows.indexOf(r);
        var nxt = state.rows[idx+1];
        setTimeout(function(){
          var t = nxt ? document.getElementById("c-"+nxt.id+"-"+i) : document.getElementById("c-"+r.id+"-"+Math.min(i+1,6));
          if(t) t.focus();
        },0);
      }
    });
    return inp;
  }

  function clockCell(r, i, v, pr){
    var box = el("div","clockcell" + dayExtraClass(i), "");
    var s = slot(r,i);
    var locked = cellLocked(i, v);
    ["b","e"].forEach(function(k){
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "tinp";
      inp.id = "c-"+r.id+"-"+i+(k === "b" ? "" : "-e");
      inp.value = s ? fmtClock(s[k]) : "";
      inp.placeholder = t(k === "b" ? "label_start" : "label_end").toLowerCase();
      inp.inputMode = "numeric";
      inp.disabled = locked;
      inp.setAttribute("aria-label", t(k === "b" ? "aria_start_time_for" : "aria_end_time_for", {name: pr.name, day: DAYS[i]}));
      inp.addEventListener("change", function(){
        var parsed = parseClock(inp.value);
        if(isNaN(parsed)){ toast(t("toast_bad_clock", {v: inp.value})); render(); return; }
        var cur = slot(r,i) || {b:null, e:null};
        var prev = cur[k];
        cur[k] = parsed;
        var newVal = (cur.b === null && cur.e === null) ? 0 : slotHours(cur);
        /* Same hard rule as durCell: never let a day go over capacity, not
           even with a warning - refuse it here instead, before the window
           is ever stored. */
        var otherTotal = dayTotal(i) - (r.h[i] || 0);
        var cap = capacity(i);
        if(otherTotal + newVal > cap){
          var abs = absOn(i, "approved")[0];
          var left = Math.max(0, cap - otherTotal);
          var msg = abs
            ? t("msg_day_approved_type", {day: DAYS[i], type: absTypeLabel(abs).toLowerCase()})
            : t("msg_day_capacity_simple", {day: DAYS[i], cap: fmt(cap)});
          toast(msg + (left > 0 ? t("toast_only_available", {left: fmt(left)}) : t("toast_no_hours_available")));
          cur[k] = prev;
          render();
          return;
        }
        if(cur.b === null && cur.e === null) setSlot(r,i,null); else setSlot(r,i,cur);
        syncClock();
        state.needsSave = true;
        render();
      });
      box.appendChild(inp);
    });
    var d = el("div","cdur", v ? fmt(v) + " h" : "–");
    if(s && s.b !== null && s.e !== null && s.e < s.b) d.textContent = fmt(v) + " h +1";
    box.appendChild(d);
    decorateCell(box, i, v);
    return box;
  }

  function decorateCell(node, i, v){
    if(!periodOpen(WORKDATES[i])){
      node.classList.add("closed");
      node.title = t("tip_period_closed", {ym: periodFor(WORKDATES[i]).ym, bukrs: IT0001.bukrs});
    } else if(isBlocked(i)){
      node.classList.add("abs");
      node.title = t("tip_absence_not_available", {type: absTypeLabel(absOn(i,"approved")[0]).toLowerCase()});
    } else if(absHours(i) > 0){
      node.title = t("tip_approved_partial_absence", {h: fmt(capacity(i))});
    }
  }

  /* ---------- render: grid ---------- */
  function renderGrid(){
    var g = $("tsgrid");
    g.innerHTML = "";
    g.className = "tsgrid" + (isClock() ? " clock" : "");

    var head = document.createElement("div");
    head.className = "row head";
    head.appendChild(el("div","",t("th_project_wbs_activity")));
    DAYS.forEach(function(d,i){
      var c = el("div", dayExtraClass(i).trim(), "");
      appendDayLabel(c, i);
      var ap = absOn(i,"approved")[0], pe = absOn(i,"pending")[0];
      if(ap) c.appendChild(dayAbsBadge(ap, capacity(i) === 0 ? absTypeLabel(ap) : t("badge_half_day"), capacity(i) === 0 ? " full" : ""));
      else if(pe) c.appendChild(dayAbsBadge(pe, t("text_pending_short"), " pend"));
      head.appendChild(c);
    });
    head.appendChild(el("div","",t("th_total")));
    head.appendChild(el("div","",""));
    g.appendChild(head);

    if(state.rows.length === 0){
      var e = document.createElement("div");
      e.className = "empty";
      e.innerHTML = '<p><strong>'+t("text_no_hours_week_yet")+'</strong> '+t("text_shortest_path")+'</p>';
      var acts = el("div","acts","");
      acts.appendChild(btn(t("btn_copy_last_week"),"btn primary", copyWeek));
      acts.appendChild(btn(plural(state.sugs.length, "n_suggestions_review"),"btn", function(){ $("sugPanel").scrollIntoView({block:"center"}); }));
      acts.appendChild(btn(t("btn_add_first_project"),"btn", addRow));
      e.appendChild(acts);
      g.appendChild(e);
    }

    state.rows.forEach(function(r){
      var pr = PROJECTS[r.p];
      var row = document.createElement("div");
      row.className = "row" + (state.submitted ? " locked" : "");

      var meta = el("div","rowmeta","");
      var p = el("div","p","");
      p.appendChild(el("span","", pr.name));
      var c = document.createElement("code"); c.textContent = pr.wbs || pr.sap.rkostl; p.appendChild(c);
      p.appendChild(el("span","bill" + (pr.proj?"":" no"), pr.proj ? "PEP" : "INTERNAL"));
      meta.appendChild(p);
      var needDesc = rowTotal(r) > 0 && r.desc.trim().length < 10;
      var s = el("div","s", (r.desc || (needDesc ? t("text_desc_required") : t("text_no_description"))) + " · " + pr.act);
      if(needDesc) s.style.color = "var(--crit)";
      meta.appendChild(s);
      meta.style.cursor = "pointer";
      meta.onclick = function(){ openDetail(r); };
      row.appendChild(meta);

      r.h.forEach(function(v,i){
        row.appendChild(isClock() ? clockCell(r,i,v,pr) : durCell(r,i,v,pr));
      });

      row.appendChild(el("div","rowtot", rowTotal(r) ? fmt(rowTotal(r)) : "–"));
      var act = el("div","rowact","");
      var rm = btn("×","", function(){
        state.rows = state.rows.filter(function(x){ return x.id !== r.id; });
        render(); toast(t("toast_row_removed"), t("ui_undo"), function(){ state.rows.push(r); render(); });
      });
      rm.setAttribute("aria-label",t("aria_remove_row", {name: pr.name}));
      rm.disabled = state.submitted;
      act.appendChild(rm);
      row.appendChild(act);
      g.appendChild(row);
    });

    if(state.rows.length){
      var tr = document.createElement("div");
      tr.className = "row totals";
      tr.appendChild(el("div","rowmeta",t("row_total_per_day")));
      for(var d=0; d<7; d++){
        var v = dayTotal(d), cap = capacity(d);
        var cls = "t";
        /* two windows on top of each other are a collision, shown like
           a day over its capacity */
        var clash = isClock() && clockOverlaps(d).length > 0;
        if(v > 24 || (d < 5 && v > cap) || clash) cls += " over";
        else if(v === 0 && d < 5 && cap > 0) cls += " zero";
        else if(d < 5 && cap === 0) cls += " off";
        cls += dayExtraClass(d);
        var tcell = el("div", cls, d < 5 && cap === 0 && !v ? "–" : (v ? fmt(v) : "0.0"));
        if(clash) tcell.title = t("tip_windows_overlap");
        tr.appendChild(tcell);
      }
      tr.appendChild(el("div","t", fmt(weekTotal())));
      tr.appendChild(el("div","",""));
      g.appendChild(tr);
    }
  }

  /* ---------- render: monthly grid, consulting only ----------
     One row per project for the whole month; hours still live on the
     underlying week's own row (created lazily on first edit in a week
     that doesn't have one yet), read/written through the week-scoped
     helpers above so a cell always uses its own week's capacity and
     absences, never whichever week the rest of the app is pointed at. */
  function monthDayLabel(week, i){ return WEEKDAY_ABBR[i] + " " + (+datesFor(week.start)[i].slice(6,8)); }
  function dayAbsBadgeOf(week, a, label, extraClass){
    var b = el("button","dayabs" + extraClass, label);
    b.type = "button";
    b.setAttribute("aria-label", absTypeLabel(a) + ", " + monthDayLabel(week, a.day) + ", " + absStatusLabel(a.status).toLowerCase());
    b.onmouseenter = function(){ withWeek(week, function(){ showAbsTip(a, b); }); };
    b.onmouseleave = hideAbsTip;
    b.onfocus = function(){ withWeek(week, function(){ showAbsTip(a, b); }); };
    b.onblur = hideAbsTip;
    return b;
  }
  function monthDecorateCell(node, week, i){
    var dates = datesFor(week.start);
    var extra = monthDayExtraClass(i, dates[i]).trim();
    if(extra) node.classList.add.apply(node.classList, extra.split(" "));
    if(week.submitted){
      node.classList.add("submitted");
      node.title = t("tip_week_submitted_n", {n: isoWeekOf(week.start)});
    } else if(!periodOpen(dates[i])){
      node.classList.add("closed");
      node.title = t("tip_period_closed", {ym: periodFor(dates[i]).ym, bukrs: IT0001.bukrs});
    } else if(isBlockedOf(week, i)){
      node.classList.add("abs");
      var ap = week.absences.filter(function(a){ return a.day === i && a.status === "approved"; })[0];
      node.title = t("tip_absence_not_available", {type: ap ? absTypeLabel(ap).toLowerCase() : t("text_absence_generic")});
    } else if(absHoursOf(week, i) > 0){
      node.title = t("tip_approved_partial_absence", {h: fmt(capacityOf(week,i))});
    }
  }
  function monthDurCell(monthRow, week, i, pr){
    var existing = monthRowIn(week, monthRow.p);
    var v = existing ? (existing.h[i] || 0) : 0;
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "cell";
    inp.value = v ? fmt(v) : "";
    inp.inputMode = "decimal";
    inp.setAttribute("aria-label", t("aria_dur_cell", {proj: pr.name, day: monthDayLabel(week,i)}));
    inp.disabled = cellLockedOf(week, i, v);
    monthDecorateCell(inp, week, i);
    inp.addEventListener("change", function(){
      var parsed = parseDur(inp.value);
      if(isNaN(parsed)){ toast(t("toast_bad_duration", {v: inp.value})); inp.value = v ? fmt(v) : ""; return; }
      var newVal = round15(parsed);
      var row0 = monthRowIn(week, monthRow.p);
      var otherTotal = dayTotalOf(week, i) - (row0 ? (row0.h[i]||0) : 0);
      var cap = capacityOf(week, i);
      if(otherTotal + newVal > cap){
        var abs = week.absences.filter(function(a){ return a.day === i && a.status === "approved"; })[0];
        var left = Math.max(0, cap - otherTotal);
        var dayLabel = monthDayLabel(week, i);
        var msg = abs ? t("msg_day_approved_type", {day: dayLabel, type: absTypeLabel(abs).toLowerCase()}) : t("msg_day_capacity_simple", {day: dayLabel, cap: fmt(cap)});
        toast(msg + (left > 0 ? t("toast_only_available", {left: fmt(left)}) : t("toast_no_hours_available")));
        inp.value = v ? fmt(v) : "";
        return;
      }
      var row = monthRowIn(week, monthRow.p);
      if(!row){
        row = {id:nextId++, p:monthRow.p, desc:monthRow.desc || "", h:[0,0,0,0,0,0,0], origin:"Manual"};
        week.rows.push(row);
      }
      row.h[i] = newVal;
      state.needsSave = true;
      render();
    });
    return inp;
  }
  function renderMonthGrid(){
    var g = $("tsgrid");
    g.innerHTML = "";
    g.className = "tsgrid month";
    var dates = activeMonthDates();
    var weeks = touchedWeeksFor(dates);
    var dayCols = dates.length;
    var gridCols = "minmax(230px,1fr) repeat(" + dayCols + ",50px) 70px 34px";
    g.style.minWidth = (230 + dayCols*50 + 70 + 34) + "px";

    var head = document.createElement("div");
    head.className = "row head";
    head.style.gridTemplateColumns = gridCols;
    head.appendChild(el("div","",t("th_project_wbs_activity")));
    dates.forEach(function(dateISO){
      var wd = weekDayFor(dateISO);
      var c = el("div", monthDayExtraClass(wd.day, dateISO).trim(), "");
      c.appendChild(el("span","dname", WEEKDAY_ABBR[wd.day]));
      c.appendChild(el("span","dnum", "" + (+dateISO.slice(6,8))));
      var ap = wd.week.absences.filter(function(a){ return a.day===wd.day && a.status==="approved"; })[0];
      var pe = wd.week.absences.filter(function(a){ return a.day===wd.day && a.status==="pending"; })[0];
      if(ap) c.appendChild(dayAbsBadgeOf(wd.week, ap, capacityOf(wd.week,wd.day)===0 ? absTypeLabel(ap) : t("badge_half_day"), capacityOf(wd.week,wd.day)===0 ? " full" : ""));
      else if(pe) c.appendChild(dayAbsBadgeOf(wd.week, pe, t("text_pending_short"), " pend"));
      head.appendChild(c);
    });
    head.appendChild(el("div","",t("th_total")));
    head.appendChild(el("div","",""));
    g.appendChild(head);

    /* the week-divider row groups consecutive dates that belong to the
       same underlying week - not fixed at 5 or 7 wide, since a boundary
       week only contributes however many of its days fall in this month */
    var sub = document.createElement("div");
    sub.className = "row monthsub";
    sub.style.gridTemplateColumns = gridCols;
    sub.appendChild(el("div","",""));
    var di = 0;
    while(di < dates.length){
      var w0 = weekDayFor(dates[di]).week;
      var span = 0;
      while(di+span < dates.length && weekDayFor(dates[di+span]).week === w0) span++;
      var label = el("div","monthweeklabel",t("label_week_short", {n: isoWeekOf(w0.start)}));
      label.style.gridColumn = "span " + span;
      sub.appendChild(label);
      di += span;
    }
    sub.appendChild(el("div","",""));
    sub.appendChild(el("div","",""));
    g.appendChild(sub);

    var monthRows = monthProjectRows(weeks);
    var allSubmitted = weeks.every(function(w){ return w.submitted; });

    if(monthRows.length === 0){
      var e = document.createElement("div");
      e.className = "empty";
      e.innerHTML = '<p><strong>'+t("text_no_hours_month_yet")+'</strong> '+t("text_shortest_path")+'</p>';
      var acts = el("div","acts","");
      acts.appendChild(btn(t("btn_add_first_project"),"btn", addMonthRow));
      e.appendChild(acts);
      g.appendChild(e);
    }

    monthRows.forEach(function(monthRow){
      var pr = PROJECTS[monthRow.p];
      var row = document.createElement("div");
      row.className = "row" + (allSubmitted ? " locked" : "");
      row.style.gridTemplateColumns = gridCols;

      var meta = el("div","rowmeta","");
      var p = el("div","p","");
      p.appendChild(el("span","", pr.name));
      var c = document.createElement("code"); c.textContent = pr.wbs || pr.sap.rkostl; p.appendChild(c);
      p.appendChild(el("span","bill" + (pr.proj?"":" no"), pr.proj ? "PEP" : "INTERNAL"));
      /* Scoped to the project name/PEP area, not the whole rowmeta - the
         description right below is its own editable input, and treating
         a click there as "open the project picker" would just get in the
         way of typing. This is also the only way to change a month row's
         project at all: it was never wired up here, unlike the weekly
         grid's own click-to-open-detail. */
      p.style.cursor = "pointer";
      p.onclick = function(){ openMonthDetail(monthRow, weeks); };
      meta.appendChild(p);
      var descInp = document.createElement("input");
      descInp.type = "text";
      descInp.className = "monthdesc";
      descInp.placeholder = t("placeholder_desc_required_once");
      descInp.value = monthRow.desc || "";
      descInp.disabled = allSubmitted;
      descInp.setAttribute("aria-label", t("aria_desc_cell", {proj: pr.name}));
      descInp.addEventListener("change", function(){
        var val = descInp.value;
        weeks.forEach(function(w){ var r = monthRowIn(w, monthRow.p); if(r) r.desc = val; });
        render();
      });
      meta.appendChild(descInp);
      row.appendChild(meta);

      var rowTot = 0;
      dates.forEach(function(dateISO){
        var wd = weekDayFor(dateISO);
        var existing = monthRowIn(wd.week, monthRow.p);
        rowTot += existing ? (existing.h[wd.day]||0) : 0;
        row.appendChild(monthDurCell(monthRow, wd.week, wd.day, pr));
      });

      row.appendChild(el("div","rowtot", rowTot ? fmt(rowTot) : "–"));
      var act = el("div","rowact","");
      var rm = btn("×","", function(){
        var removed = [];
        weeks.forEach(function(w){
          var r = monthRowIn(w, monthRow.p);
          if(r){ w.rows = w.rows.filter(function(x){ return x.id !== r.id; }); removed.push({week:w, row:r}); }
          /* the week on show keeps its rows in state.rows too, which a
             change of month writes back over w.rows */
          if(w === WEEKS[weekIdx]) state.rows = w.rows;
        });
        render();
        toast(t("toast_row_removed"), t("ui_undo"), function(){
          removed.forEach(function(item){ item.week.rows.push(item.row); });
          render();
        });
      });
      rm.setAttribute("aria-label",t("aria_remove_row", {name: pr.name}));
      rm.disabled = allSubmitted;
      act.appendChild(rm);
      row.appendChild(act);
      g.appendChild(row);
    });

    if(monthRows.length){
      var tr = document.createElement("div");
      tr.className = "row totals";
      tr.style.gridTemplateColumns = gridCols;
      tr.appendChild(el("div","rowmeta",t("row_total_per_day")));
      dates.forEach(function(dateISO){
        var wd = weekDayFor(dateISO);
        var v = dayTotalOf(wd.week, wd.day), cap = capacityOf(wd.week, wd.day);
        var cls = "t";
        if(v > 24 || v > cap) cls += " over";
        else if(v === 0 && cap > 0) cls += " zero";
        else if(cap === 0) cls += " off";
        cls += monthDayExtraClass(wd.day, dateISO);
        tr.appendChild(el("div", cls, cap === 0 && !v ? "–" : (v ? fmt(v) : "0.0")));
      });
      tr.appendChild(el("div","t", fmt(monthTotalHours(dates))));
      tr.appendChild(el("div","",""));
      g.appendChild(tr);
    }
  }
  function addMonthRow(){
    var weeks = activeMonthWeeks();
    if(weeks.every(function(w){ return w.submitted; })){
      toast(t("toast_month_submitted_no_rows"));
      return;
    }
    var used = {};
    weeks.forEach(function(w){ w.rows.forEach(function(r){ used[r.p] = true; }); });
    /* Only a project this company actually does (its own, or a shared one
       with no bukrs) is eligible - otherwise, once every PT01 project is
       already on the month, this fell through to the first PT02-only one
       (Hospital campus) on a Consulting person's own timesheet. The person
       then picks which of the remaining ones in the dialog - see
       openNewMonthRowDetail. */
    var eligible = [];
    for(var i=0; i<PROJECTS.length; i++){
      if(!used[i] && (PROJECTS[i].bukrs === IT0001.bukrs || PROJECTS[i].bukrs === null)) eligible.push(i);
    }
    if(!eligible.length){
      toast(t("toast_all_projects_used_month"));
      return;
    }
    var target = weeks.filter(function(w){ return !w.submitted; })[0] || weeks[0];
    openNewMonthRowDetail(eligible, target, weeks);
  }
  function monthList(){
    var seen = {}, out = [];
    weeksOfCompany("PT01").forEach(function(w){ var k = monthKeyOf(w); if(!seen[k]){ seen[k] = 1; out.push(k); } });
    return out;
  }
  function changeMonth(delta){
    var months = monthList();
    var mi = months.indexOf(monthKeyOf(WEEKS[weekIdx]));
    var nextMi = mi + delta;
    if(nextMi < 0 || nextMi >= months.length){
      toast(delta < 0 ? t("toast_no_earlier_months") : t("toast_no_later_months"));
      return;
    }
    var target = WEEKS.filter(function(w){ return monthKeyOf(w) === months[nextMi]; })[0];
    saveCurrentWeek();
    loadWeek(WEEKS.indexOf(target));
    render();
  }
  /* Only Copy previous week and Apply template are hidden for consulting's
     monthly view - "previous week" and a per-week template don't carry a
     clear meaning once the whole month is already on screen. Calendar,
     Quick add, Suggestions and Allowances stay available and keep working
     exactly as before, against the one week the app is currently pointed
     at (WEEKS[weekIdx]) - the same week the month grid highlights first. */
  function applyMonthlyUI(){
    var monthly = isMonthly();
    if($("copyWeek")) $("copyWeek").hidden = monthly;
    if($("tplBtn")) $("tplBtn").hidden = monthly;
    /* The Calendar view's own hint only holds true week by week - the
       monthly Calendar is read-only, so telling the user they can click
       an empty slot there would be wrong. */
    var calHint = $("calHint");
    if(calHint){
      calHint.title = t(monthly ? "hint_calendar_month" : "hint_calendar");
    }
  }

  /* ---------- render: calendar ---------- */
  /* Read-only overview, for consulting's monthly view: every week's day
     laid out side by side on the same hour axis. Editing still happens on
     the Grid - the blocks here aren't clickable and there's no "+ log
     time", both of which would otherwise need to know which week a click
     landed in, the same problem the Grid's own month cells solve with the
     *Of() helpers; not worth it for a read-only summary. */
  function renderCalMonth(){
    var cal = $("cal");
    cal.innerHTML = "";
    var dates = activeMonthDates();
    cal.className = "cal month";
    cal.style.gridTemplateColumns = "52px repeat(" + dates.length + ",minmax(90px,1fr))";
    cal.style.minWidth = (52 + dates.length*90) + "px";

    cal.appendChild(el("div","ch","Time"));
    dates.forEach(function(dateISO){
      var wd = weekDayFor(dateISO);
      cal.appendChild(el("div","ch", monthDayLabel(wd.week, wd.day)));
    });

    var hours = el("div","hours","");
    for(var h=9; h<19; h++){ hours.appendChild(el("span","", h+":00")); }
    cal.appendChild(hours);

    dates.forEach(function(dateISO){
      var wd = weekDayFor(dateISO), w = wd.week, d = wd.day;
      var col = el("div","col","");
      w.absences.filter(function(a){ return a.day === d; }).forEach(function(a){
        var ab = el("div","blk abs" + (a.status === "pending" ? " pend" : ""), "");
        ab.style.minHeight = Math.max(30, a.hours*26) + "px";
        ab.appendChild(el("b","", fmt(a.hours)+" h"));
        ab.appendChild(document.createTextNode(absTypeLabel(a) + " · " + absStatusLabel(a.status)));
        ab.title = a.src + ", " + absTypeLabel(a);
        col.appendChild(ab);
      });
      var any = false;
      w.rows.forEach(function(r){
        var v = r.h[d];
        if(!v) return;
        any = true;
        var pr = PROJECTS[r.p];
        var b = el("div","blk" + (pr.proj ? "" : " nb"), "");
        b.style.minHeight = Math.max(30, v*26) + "px";
        var s = slot(r,d);
        b.appendChild(el("b","", (isClock() && s && s.b!==null && s.e!==null) ? (fmtClock(s.b)+"–"+fmtClock(s.e%1440)) : fmt(v)+" h"));
        b.appendChild(document.createTextNode(pr.code + " · " + (r.desc || pr.act)));
        col.appendChild(b);
      });
      if(isBlockedOf(w,d) && !any){
        col.appendChild(el("div","calfree off","day not available"));
      }
      cal.appendChild(col);
    });
  }
  function renderCal(){
    if(isMonthly()) return renderCalMonth();
    var cal = $("cal");
    cal.innerHTML = "";
    cal.className = "cal";
    cal.style.gridTemplateColumns = "";
    cal.style.minWidth = "";
    cal.appendChild(el("div","ch","Time"));
    for(var i=0; i<7; i++) cal.appendChild(el("div","ch", DAYS[i]));

    var hours = el("div","hours","");
    for(var h=9; h<19; h++){ hours.appendChild(el("span","", h+":00")); }
    cal.appendChild(hours);

    for(var d=0; d<7; d++){
      var col = el("div","col","");
      absOn(d).forEach(function(a){
        var ab = el("div","blk abs" + (a.status === "pending" ? " pend" : ""), "");
        ab.style.minHeight = Math.max(30, a.hours*26) + "px";
        ab.appendChild(el("b","", fmt(a.hours)+" h"));
        ab.appendChild(document.createTextNode(absTypeLabel(a) + " · " + absStatusLabel(a.status)));
        ab.title = a.src + ", " + absTypeLabel(a);
        col.appendChild(ab);
      });
      /* r.desc is free text the person types in Quick Add or the detail
         dialog: built with textContent/createTextNode, never innerHTML, so
         something like "<img onerror=...>" in a description shows up as
         literal text instead of running. */
      state.rows.forEach(function(r){
        var v = r.h[d];
        if(!v) return;
        var pr = PROJECTS[r.p];
        var b = document.createElement("button");
        b.className = "blk" + (pr.proj ? "" : " nb");
        b.style.minHeight = Math.max(30, v*26) + "px";
        var s = slot(r,d);
        b.appendChild(el("b","", (isClock() && s && s.b!==null && s.e!==null) ? (fmtClock(s.b)+"–"+fmtClock(s.e%1440)) : fmt(v)+" h"));
        b.appendChild(document.createTextNode(pr.code + " · " + (r.desc || pr.act)));
        b.onclick = (function(day){ return function(){ openDetail(r, day); }; })(d);
        col.appendChild(b);
      });
      if(!isBlocked(d)){
        var free = document.createElement("button");
        free.className = "calfree";
        free.textContent = "+ log time";
        free.onclick = (function(day){ return function(){ openQuick("", day); }; })(d);
        col.appendChild(free);
      } else {
        col.appendChild(el("div","calfree off","day not available"));
      }
      cal.appendChild(col);
    }
  }

  /* ---------- render: suggestions ---------- */
  function confLabel(level){ return t("conf_" + level); }
  function visibleSugs(){
    return state.sugs.filter(function(s){ return !isBlocked(s.day); });
  }
  function renderSugs(){
    var box = $("sugs");
    box.innerHTML = "";
    var vis = visibleSugs();
    var hidden = state.sugs.length - vis.length;
    $("acceptHi").disabled = state.privateMode || !vis.some(function(s){ return s.conf === "hi"; });

    /* Collapsed when there's nothing to review, open when there is —
       unless the person has already toggled it themselves this session,
       which always wins over the automatic guess. */
    var autoOpen = !state.privateMode && vis.length > 0;
    setPanelOpen("sugPanel", "sugTog", state.sugManualOpen === null ? autoOpen : state.sugManualOpen);

    if(state.privateMode){
      var p = el("div","paused","");
      p.innerHTML = "<strong>Private mode on.</strong><span>Signal capture is paused. Nothing is collected while this mode is on.</span>";
      p.appendChild(btn(t("btn_resume_suggestions"),"btn", togglePrivate));
      box.appendChild(p);
      return;
    }
    if(vis.length === 0){
      box.appendChild(el("div","paused", t(hidden ? "text_sugs_none_absence" : "text_sugs_none_pending")));
      return;
    }
    if(hidden){
      box.appendChild(el("div","msg i", plural(hidden, "suggestions_discarded")));
    }
    vis.forEach(function(s){
      var pr = PROJECTS[s.p];
      var card = el("div","sug "+s.conf,"");
      var h = el("div","h","");
      var b = document.createElement("b"); b.textContent = fmt(s.hours)+" h"; h.appendChild(b);
      h.appendChild(el("span","", DAYS[s.day]));
      card.appendChild(h);
      card.appendChild(el("div","", pr.name));
      card.appendChild(el("div","why", s.why));
      card.appendChild(el("div","conf", confLabel(s.conf)));
      var acts = el("div","acts","");
      var accBtn = btn(t("btn_accept"),"btn sm primary", function(){ acceptSug(s); });
      if(sugRoom(s) <= 0){ accBtn.disabled = true; accBtn.title = t("toast_sugg_day_full", {day: DAYS[s.day]}); card.appendChild(el("div","why", t("text_sug_day_full"))); }
      else if(sugRoom(s) < s.hours) card.appendChild(el("div","why", t("text_sug_room", {h: fmt(sugRoom(s))})));
      acts.appendChild(accBtn);
      acts.appendChild(btn(t("btn_edit"),"btn sm", function(){ openQuick(fmt(s.hours)+"h "+pr.code+" "+(s.desc||""), s.day); }));
      acts.appendChild(btn(t("btn_dismiss"),"btn sm ghost", function(){ dropSug(s, true); }));
      card.appendChild(acts);
      box.appendChild(card);
    });
  }
  /* A suggestion goes in only as far as the day has room: never past the
     day's capacity (the daily schedule less any approved absence), the
     same hard rule as typing in the grid. Returns the hours added: all of
     them, fewer (trimmed to what was left), or none (the day was full).
     quiet leaves the toast to a caller applying several at once. */
  function sugRoom(s){ return Math.max(0, round15(capacity(s.day) - dayTotal(s.day))); }
  function acceptSug(s, quiet){
    if(isBlocked(s.day)){ if(!quiet) toast(t("toast_sugg_blocked_absence", {day: DAYS[s.day]})); return 0; }
    var room = sugRoom(s);
    if(room <= 0){ if(!quiet) toast(t("toast_sugg_day_full", {day: DAYS[s.day]})); return 0; }
    var add = Math.min(s.hours, room);
    var row = state.rows.filter(function(r){ return r.p === s.p; })[0];
    if(!row){ row = {id:nextId++, p:s.p, desc:s.desc || "", h:[0,0,0,0,0,0,0], origin:"Suggested"}; state.rows.push(row); }
    if(!row.desc) row.desc = s.desc || "";
    row.h[s.day] = round15((row.h[s.day] || 0) + add);
    state.needsSave = true;
    dropSug(s, false);
    if(!quiet) toast(add < s.hours ? t("toast_sugg_trimmed", {day: DAYS[s.day], h: fmt(add)}) : t("toast_suggestion_accepted", {day: DAYS[s.day]}));
    return add;
  }
  /* several at once, in order, each against what's left after the others */
  function acceptSugs(list){
    var res = {applied:0, trimmed:0, skipped:0};
    list.forEach(function(s){
      var add = acceptSug(s, true);
      if(!add) res.skipped++;
      else { res.applied++; if(add < s.hours) res.trimmed++; }
    });
    return res;
  }
  function sugsSummary(res){
    var txt = res.applied ? t("text_sugs_applied", {n: res.applied}) : t("text_sugs_none");
    if(res.trimmed) txt += " " + t("text_sugs_trimmed", {n: res.trimmed});
    if(res.skipped) txt += " " + t("text_sugs_skipped", {n: res.skipped});
    return txt;
  }
  function dropSug(s, notify){
    /* in place, like the allowances: the month view reads the week's own list */
    var ix = state.sugs.indexOf(s);
    if(ix !== -1) state.sugs.splice(ix, 1);
    render();
    if(notify) toast(t("toast_suggestion_dismissed"), t("ui_undo"), function(){ state.sugs.push(s); render(); });
  }

  /* ---------- render: messages, KPIs ---------- */
  /* Month messages keep the "resolve, move the hours" action (a pure data
     fix, replayed through withWeek against the message's own week, so it
     never touches the wrong week's rows) but skip "go to day": the month
     grid shows project rows, not a per-day cell per row the way the
     weekly grid does, so there's no single cell to focus. Each line
     names its week either way. */
  function renderMsgsMonth(){
    var dates = activeMonthDates();
    var weeks = touchedWeeksFor(dates);
    var list = [];
    weeks.forEach(function(w){
      withWeek(w, function(){
        validate().forEach(function(m){
          if(typeof m.day === "number" && dates.indexOf(datesFor(w.start)[m.day]) === -1) return;
          list.push({sev:m.sev, txt:t("val_week_label_prefix", {n: isoWeekOf(w.start), txt: m.txt}), conflict:m.conflict, week:w, submitted:w.submitted});
        });
      });
    });
    var box = $("msgs");
    box.innerHTML = "";
    $("msgPanel").hidden = list.length === 0;
    $("msgCount").textContent = plural(list.length, "n_messages");
    var names = {e:t("sev_error"), w:t("sev_warning"), i:t("sev_info")};
    list.forEach(function(m){
      var row = el("div","msg "+m.sev,"");
      row.appendChild(el("span","ic", names[m.sev]));
      row.appendChild(el("span","", m.txt));
      if(typeof m.conflict === "number" && !m.submitted){
        var fix = btn(t("link_resolve_move_hours"),"", (function(week, day){
          return function(){ withWeek(week, function(){ resolveConflict(day); }); render(); };
        })(m.week, m.conflict));
        fix.style.marginLeft = "auto";
        row.appendChild(fix);
      }
      box.appendChild(row);
    });
  }
  function renderMsgs(){
    if(isMonthly()) return renderMsgsMonth();
    var list = validate();
    var box = $("msgs");
    box.innerHTML = "";
    $("msgPanel").hidden = list.length === 0;
    $("msgCount").textContent = plural(list.length, "n_messages");
    var names = {e:t("sev_error"), w:t("sev_warning"), i:t("sev_info")};
    list.forEach(function(m){
      var row = el("div","msg "+m.sev,"");
      row.appendChild(el("span","ic", names[m.sev]));
      var msgSpan = el("span","", m.txt);
      row.appendChild(msgSpan);
      if(typeof m.conflict === "number" && !state.submitted){
        var fix = btn(t("link_resolve_move_hours"),"", (function(day){ return function(){ resolveConflict(day); }; })(m.conflict));
        fix.style.marginLeft = "auto";
        row.appendChild(fix);
      } else if(typeof m.day === "number" && !state.submitted){
        var go = btn(t("link_go_to_day"),"", function(){
          var r0 = state.rows[0];
          if(r0){ var c = document.getElementById("c-"+r0.id+"-"+m.day); if(c) c.focus(); }
        });
        go.style.marginLeft = "auto";
        row.appendChild(go);
      }
      box.appendChild(row);
    });
    return list.filter(function(m){ return m.sev === "e"; }).length;
  }
  function renderKpisMonth(){
    var dates = activeMonthDates();
    var weeks = touchedWeeksFor(dates);
    var ym = monthKeyOf(WEEKS[weekIdx]);
    var y = ym.slice(0,4), mIdx = +ym.slice(4,6) - 1;
    /* A clean month selector, not a week one - the week numbers already
       label their own columns in the grid below, repeating them here read
       as if this picked a week, not a month. */
    var monthName = monthFullName(mIdx);
    var label = monthName + " " + y;
    $("weekLabel").textContent = label;
    var months = monthList();
    var mi = months.indexOf(ym);
    $("prevW").disabled = mi <= 0;
    $("nextW").disabled = mi >= months.length - 1;
    /* Team keeps its own week-by-week navigator even when My week steps by
       month for consulting - a leader stepping through the team's log
       still needs single weeks, so this mirrors the *week*, not the month. */
    if($("weekLabel2")) $("weekLabel2").textContent = weekLabelFor(WORKDATES, WEEKS[weekIdx].num);
    var teamRange = teamWeekRange();
    if($("prevW2")) $("prevW2").disabled = weekIdx <= teamRange.lo;
    if($("nextW2")) $("nextW2").disabled = weekIdx >= teamRange.hi;

    var tot = monthTotalHours(dates), expect = monthCapacityTotal(dates);
    var proj = dates.reduce(function(a,d){
      var wd = weekDayFor(d);
      return a + (wd ? wd.week.rows.reduce(function(x,r){ return x + (PROJECTS[r.p].proj ? (r.h[wd.day]||0) : 0); }, 0) : 0);
    }, 0);
    $("kTot").innerHTML = fmt(tot) + "<small> / " + fmt(expect) + " h</small>";
    var pct = expect ? Math.min(100, tot/expect*100) : 0;
    var bar = $("kBar");
    bar.style.width = pct + "%";
    bar.className = tot >= expect ? "ok" : (pct < 80 ? "low" : "");
    $("kProj").innerHTML = fmt(proj) + "<small> h</small>";
    $("kProjBar").style.width = (tot ? proj/tot*100 : 0) + "%";

    var absW = 0, zeros = 0;
    dates.forEach(function(d){
      var wd = weekDayFor(d);
      if(!wd || wd.day > 4) return;
      absW += absHoursOf(wd.week, wd.day);
      if(capacityOf(wd.week, wd.day) > 0 && dayTotalOf(wd.week, wd.day) === 0) zeros++;
    });
    if($("kExtra")) $("kExtra").textContent = t("kextra_month_prefix", {weeks: plural(weeks.length, "n_weeks")}) + " · "
      + t("kextra_absences", {h: fmt(absW)}) + " · " + plural(zeros, "n_empty_days");

    var errs = monthErrors(dates).length;
    $("kVal").textContent = errs ? plural(errs, "n_errors") : t("val_no_errors");
    $("kVal").style.color = errs ? "var(--crit)" : "var(--good)";
    var allSubmitted = weeks.every(function(w){ return w.submitted; });
    $("submitBtn").disabled = allSubmitted || errs > 0 || tot === 0;
    $("submitBtn").textContent = allSubmitted ? t("btn_month_submitted") : t("btn_submit_month");
    /* Always visible on My Timesheet, not just while there's something
       unsaved - the person can reach for it any time as reassurance,
       not only when the app is telling them they have to. */
    if($("saveBtn")) $("saveBtn").hidden = false;
    var chip = $("stateChip");
    chip.textContent = state.needsSave ? t("chip_save_to_finish") : (allSubmitted ? t("chip_in_approval") : t("state_draft"));
    chip.className = state.needsSave ? "chip amber" : (allSubmitted ? "chip blue" : "chip grey");
    chip.title = state.needsSave ? t("tip_save_to_finish") : "";
    var sc = $("sugChip"), nv = visibleSugs().length;
    sc.hidden = state.privateMode || nv === 0;
    sc.textContent = plural(nv, "n_suggestions_review");
    var pf = profileFor(WORKDATES[0]);
    var pc = $("profChip");
    if(pc){
      pc.textContent = pf.code;
      pc.title = companyName(IT0001.bukrs) + " · " + pf.fields;
      pc.className = pf.clock ? "chip blue" : "chip grey";
    }
    var co = $("coSel");
    if(co && co.value !== IT0001.bukrs) co.value = IT0001.bukrs;
  }
  function renderKpis(errCount){
    if(isMonthly()) return renderKpisMonth();
    $("weekLabel").textContent = weekLabelFor(WORKDATES, WEEKS[weekIdx].num);
    $("prevW").disabled = weekIdx === 0;
    $("nextW").disabled = weekIdx === WEEKS.length - 1;
    /* the team screen has its own week navigator, kept in sync with this one */
    if($("weekLabel2")) $("weekLabel2").textContent = weekLabelFor(WORKDATES, WEEKS[weekIdx].num);
    var teamRange = teamWeekRange();
    if($("prevW2")) $("prevW2").disabled = weekIdx <= teamRange.lo;
    if($("nextW2")) $("nextW2").disabled = weekIdx >= teamRange.hi;
    var tot = weekTotal(), proj = projTotal(), expect = weekCapacity();
    $("kTot").innerHTML = fmt(tot) + "<small> / " + fmt(expect) + " h</small>";
    var pct = expect ? Math.min(100, tot/expect*100) : 0;
    var bar = $("kBar");
    bar.style.width = pct + "%";
    bar.className = tot >= expect ? "ok" : (pct < 80 ? "low" : "");
    var absW = 0;
    for(var a=0; a<5; a++) absW += absHours(a);
    $("kProj").innerHTML = fmt(proj) + "<small> h</small>";
    $("kProjBar").style.width = (tot ? proj/tot*100 : 0) + "%";
    var zeros = 0;
    for(var i=0; i<5; i++) if(capacity(i) > 0 && dayTotal(i) === 0) zeros++;
    if($("kExtra")) $("kExtra").textContent = t("kextra_absences", {h: fmt(absW)}) + " · " + plural(zeros, "n_empty_days");
    var errs = errCount;
    $("kVal").textContent = errs ? plural(errs, "n_errors") : t("val_no_errors");
    $("kVal").style.color = errs ? "var(--crit)" : "var(--good)";
    $("submitBtn").disabled = state.submitted || errs > 0 || tot === 0;
    $("submitBtn").textContent = state.submitted ? t("btn_week_submitted") : t("btn_submit_week");
    /* Always visible on My Timesheet, not just while there's something
       unsaved - see renderKpisMonth. */
    if($("saveBtn")) $("saveBtn").hidden = false;
    var chip = $("stateChip");
    chip.textContent = state.needsSave ? t("chip_save_to_finish") : (state.submitted ? t("chip_in_approval") : t("state_draft"));
    chip.className = state.needsSave ? "chip amber" : (state.submitted ? "chip blue" : "chip grey");
    chip.title = state.needsSave ? t("tip_save_to_finish") : "";
    var sc = $("sugChip"), nv = visibleSugs().length;
    sc.hidden = state.privateMode || nv === 0;
    sc.textContent = plural(nv, "n_suggestions_review");
    var pf = profileFor(WORKDATES[0]);
    var pc = $("profChip");
    if(pc){
      pc.textContent = pf.code;
      pc.title = companyName(IT0001.bukrs) + " · " + pf.fields;
      pc.className = pf.clock ? "chip blue" : "chip grey";
    }
    var co = $("coSel");
    if(co && co.value !== IT0001.bukrs) co.value = IT0001.bukrs;
  }

  function render(){ return inUiLang(renderNow); }
  function renderNow(){
    applyMonthlyUI();
    if(isMonthly()){ renderMonthGrid(); } else { renderGrid(); }
    renderCal(); renderSugs(); renderAllow();
    /* renderMsgs already runs validate() to build the message panel;
       renderKpis only needs the error count from that same pass, so it's
       passed through instead of validate() running a second time. Monthly
       ignores it and computes its own (see renderKpisMonth): a submitted
       week's errors still show in the month's message list but must not
       count against whether the month can be submitted, so that count
       can't be reused here. */
    var errCount = renderMsgs(); renderKpis(errCount); renderApprovals(); renderTeam(); renderCats();
    renderHome(); renderLeave(); renderLeaveApprovals(); renderTeamCalendar(); renderLeaveMap(); renderNavBadges();
  }

  /* ---------- absences: a badge on the grid's day header, detail on hover ----------
     Used to be a permanent side panel listing every absence, open or not.
     The grid already marks which days are affected; hovering (or focusing,
     for keyboard use) the badge is enough to see the full card, including
     the pending ones' approval action, without reserving screen space for
     it when nobody's looking. */
  var absTipTimer = null;
  function dayAbsBadge(a, label, extraClass){
    var b = el("button","dayabs" + extraClass, label);
    b.type = "button";
    b.setAttribute("aria-label", absTypeLabel(a) + ", " + DAYS[a.day] + ", " + absStatusLabel(a.status).toLowerCase());
    b.onmouseenter = function(){ showAbsTip(a, b); };
    b.onmouseleave = hideAbsTip;
    b.onfocus = function(){ showAbsTip(a, b); };
    b.onblur = hideAbsTip;
    return b;
  }
  function showAbsTip(a, anchorEl){
    clearTimeout(absTipTimer);
    var tip = $("absTip");
    if(!tip) return;
    tip.innerHTML = "";
    var c = el("div","abscard" + (a.status === "pending" ? " pend" : ""), "");
    var h = el("div","h","");
    h.appendChild(el("b","", absTypeLabel(a)));
    h.appendChild(el("span","chip " + (a.status === "approved" ? "grey" : "amber"), absStatusLabel(a.status)));
    c.appendChild(h);
    c.appendChild(el("div","why", DAYS[a.day] + " · " + fmt(a.hours) + " h"));
    c.appendChild(el("div","why", a.src + " · Leave Request"));
    if(a.status === "pending"){
      var acts = el("div","acts","");
      var lr = a.req ? leaveById(a.req) : null;
      acts.appendChild(btn(t("btn_simulate_approval"),"btn sm", function(){
        hideAbsTipNow();
        /* the same decision the manager takes in the Leave Request, so the
           request, the inbox and the timesheet stay in step */
        if(lr && lr.StatusID === "SENT") decideLeave(lr, true, ""); else approveAbsence(a);
      }));
      c.appendChild(acts);
    }
    tip.appendChild(c);
    tip.hidden = false;
    var r = anchorEl.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + "px";
    tip.style.top = (r.bottom + 6) + "px";
    tip.onmouseenter = function(){ clearTimeout(absTipTimer); };
    tip.onmouseleave = hideAbsTip;
  }
  function hideAbsTip(){ absTipTimer = setTimeout(hideAbsTipNow, 150); }
  function hideAbsTipNow(){ clearTimeout(absTipTimer); var t = $("absTip"); if(t) t.hidden = true; }
  function approveAbsence(a){
    a.status = "approved";
    var moved = dayTotal(a.day);
    render();
    if(moved > 0) toast(t("toast_absence_approved_conflict", {day: DAYS[a.day], h: fmt(moved)}), t("ui_resolve"), function(){ resolveConflict(a.day); });
    else toast(t("toast_absence_approved_no_conflict", {day: DAYS[a.day]}));
  }
  function resolveConflict(day){
    var target = -1;
    for(var i=0; i<5; i++){ if(capacity(i) - dayTotal(i) > 0){ target = i; break; } }
    var moved = 0;
    state.rows.forEach(function(r){
      if(!r.h[day]) return;
      moved += r.h[day];
      if(target > -1) r.h[target] += r.h[day];
      r.h[day] = 0;
    });
    render();
    toast(target > -1
      ? t("toast_hours_moved", {h: fmt(moved), from: DAYS[day], to: DAYS[target]})
      : t("toast_hours_removed_no_capacity", {h: fmt(moved), day: DAYS[day]}));
  }

  /* ---------- allowances, wage types against a project ----------
     Quantity and unit, never a value, except the bonus, which the project
     owner creates with an amount. An allowance can exist on a day with no
     hours, so nothing here depends on the grid. */
  var alEdit = null;
  function myAllow(){
    return state.allow.filter(function(a){ return (a.onBehalf || IT0001.pernr) === IT0001.pernr; });
  }
  function allowLabel(a){
    var w = wt(a.code);
    return w.amount ? fmt(a.amount) + " EUR" : fmt(a.qty) + " " + w.unit;
  }
  function renderAllow(){
    var box = $("allowList");
    if(!box) return;
    box.innerHTML = "";
    var mine = myAllow();
    $("allowCount").textContent = plural(mine.length, "n_allowances");
    /* Collapsed when there's nothing recorded, open when there is - unless
       the person has already toggled it themselves this session, which
       always wins over the automatic guess (see renderSugs). */
    setPanelOpen("allowPanel", "allowTog", state.allowManualOpen === null ? mine.length > 0 : state.allowManualOpen);
    if(!mine.length){
      box.appendChild(el("div","paused",t("text_no_allowances_week")));
      return;
    }
    mine.slice().sort(function(x,y){ return x.day - y.day; }).forEach(function(a){
      var w = wt(a.code);
      var c = el("div","abscard" + (w.amount ? " bonus" : ""), "");
      var h = el("div","h","");
      h.appendChild(el("b","", wtName(w)));
      h.appendChild(el("span","chip " + (w.amount ? "green" : "grey"), allowLabel(a)));
      c.appendChild(h);
      c.appendChild(el("div","why", DAYS[a.day] + " · " + PROJECTS[a.p].code + " · " + t("text_wage_type_label", {code: w.lgart})));
      if(a.note) c.appendChild(el("div","why", a.note));
      if(a.by !== a.onBehalf) c.appendChild(el("div","why", t("text_recorded_by_behalf", {name: a.byName})));
      if(w.amount) c.appendChild(el("div","why", t("text_bonus_catsamount")));
      var acts = el("div","acts","");
      var rm = btn(t("btn_remove"),"btn sm", function(){
        if(!allowEditable(a)) return;
        /* in place: the week object holds this same list, and the month
           view validates each week from it */
        var ix = state.allow.indexOf(a);
        if(ix !== -1) state.allow.splice(ix, 1);
        render(); toast(t("toast_allowance_removed", {name: wtName(w)}), t("ui_undo"), function(){ state.allow.push(a); render(); });
      });
      rm.disabled = !allowEditable(a);
      if(w.amount) rm.title = t("tip_bonus_remove_restricted");
      acts.appendChild(rm);
      c.appendChild(acts);
      box.appendChild(c);
    });
  }
  function allowEditable(a){
    var w = wt(a.code);
    if(state.submitted) return false;
    if(!periodOpen(WORKDATES[a.day])) return false;
    return !w.amount;
  }
  function openAllow(){
    if(state.submitted){ toast(t("toast_week_submitted_no_allow_change")); return; }
    if(weekPeriodClosed()){ toast(t("toast_week_closed_period")); return; }
    alEdit = {id:"al"+(nextId++), day:0, p:state.rows.length ? state.rows[0].p : 0, code:wtFor()[0].code, qty:1, amount:0, note:"", by:IT0001.pernr, onBehalf:IT0001.pernr};
    var sel = $("alCode");
    sel.innerHTML = "";
    wtFor().filter(function(w){ return w.selfEntry; }).forEach(function(w){
      var o = document.createElement("option");
      o.value = w.code; o.textContent = wtName(w) + " (" + w.lgart + ")";
      sel.appendChild(o);
    });
    alEdit.code = sel.value;
    var pj = $("alProj");
    pj.innerHTML = "";
    var mine = profileProjects();
    PROJECTS.forEach(function(p,i){
      if(mine.length && mine.indexOf(i) === -1) return;
      var o = document.createElement("option");
      o.value = String(i); o.textContent = p.code + " · " + p.name;
      pj.appendChild(o);
    });
    if(mine.length && mine.indexOf(alEdit.p) === -1) alEdit.p = mine[0];
    pj.value = String(alEdit.p);
    $("alFrom").value = ""; $("alTo").value = ""; $("alRound").checked = false;
    $("alPlaces").innerHTML = "";
    PLACES.forEach(function(pl){ var o = document.createElement("option"); o.value = placeLabel(pl); $("alPlaces").appendChild(o); });
    var dy = $("alDay");
    dy.innerHTML = "";
    DAYS.forEach(function(d,i){
      var o = document.createElement("option");
      o.value = String(i); o.textContent = d + (periodOpen(WORKDATES[i]) ? "" : " " + t("text_period_closed_paren"));
      o.disabled = !periodOpen(WORKDATES[i]);
      dy.appendChild(o);
    });
    dy.value = "0";
    syncAllowForm();
    $("dlgAllow").showModal();
  }
  function syncAllowForm(){
    var w = wt($("alCode").value);
    $("alQty").value = "1";
    $("alUnit").textContent = w.unit;
    $("alNoteWrap").hidden = !w.noteLabel;
    $("alNoteLbl").textContent = w.noteLabel || t("label_note");
    $("alProjWrap").hidden = !w.needProj;
    $("alHint").textContent = t("hint_allow_wage_type", {code: w.lgart, unit: w.unit});
    if(w.code === "KMS" && !$("alFrom").value){ var o = officePlace(); $("alFrom").value = placeLabel(o); }
    syncAllowRoute();
  }
  function saveAllow(){
    var w = wt($("alCode").value);
    var qty = parseDur($("alQty").value);
    if(isNaN(qty) || qty <= 0){ toast(t("toast_qty_must_be_positive")); return false; }
    if(w.code === "KMS"){
      if(!$("alFrom").value.trim() || !$("alTo").value.trim()){ toast(t("toast_km_route_needed")); return false; }
      $("alNote").value = $("alFrom").value.trim() + " → " + $("alTo").value.trim() + ($("alRound").checked ? " (" + t("km_round_trip") + ")" : "");
    }
    state.allow.push({
      id: alEdit.id,
      day: +$("alDay").value,
      p: w.needProj ? +$("alProj").value : 3,
      code: w.code,
      qty: qty,
      amount: 0,
      note: $("alNote").value.trim(),
      by: IT0001.pernr,
      onBehalf: IT0001.pernr,
      byName: "self"
    });
    render();
    toast(t("toast_allowance_recorded", {name: wtName(w), day: DAYS[+$("alDay").value]}));
    return true;
  }

  /* ---------- CATS mapping screen ---------- */
  var MAP = [
    ["Employee recording the time","Personnel number","PERNR","cats",""],
    ["Day column in the grid","Work date","WORKDATE","cats","One entry per day, never aggregated to the week"],
    ["Cell value","Recorded hours","CATSHOURS","cats","Unit in UNIT, usually H"],
    ["Start and end, profile Z_BSRV","Time window","BEGUZ, ENDUZ","cats","Standard CATSDB fields, shown or hidden by the data entry profile, never by the application"],
    ["Company of the employee","Organizational assignment","IT0001, field BUKRS","cats","Decides the data entry profile through ZTIME_COMPANY_CFG, read at the date of the entry"],
    ["Data entry profile in force","CATS profile","customizing, Z_CONS or Z_BSRV","cats","Z_CONS records duration only, Z_BSRV records start and end with the duration computed"],
    ["Allowance recorded against a project","Wage type","LGART","cats","Has to exist in T512Z and be authorised in the profile"],
    ["Own-car kilometres, origin and destination","Quantity and short text","ANZHL, LTXA1","cats","Wage type 1300. The distance between the two places comes from a routing service and is shown for confirmation before it's recorded; the mockup uses a table of road distances and, for other pairs, an estimate from the map. The route goes to LTXA1"],
    ["Allowance quantity","Number, with unit","ANZHL, ZEINH","cats","Days, kilometres. The bonus goes in with ANZHL 1"],
    ["Bonus amount","Amount","CATSAMOUNT","cats","Native CATSDB field, CURR 13.2. Confirm with the client whether the standard CAT6 transfer maps it to IT2010 BETRG, or whether that needs configuring"],
    ["Transfer to payroll","Standard transfer","CAT6 to IT2010","cats","No bespoke interface. CAT5 and CAT7 cover PS and CO"],
    ["Recorded on behalf of someone","No equivalent","ON_BEHALF_OF","btp","Team entry. The submitting user still lands in ERNAM, by standard behaviour"],
    ["Period open or closed","No equivalent","ZTIME_PERIOD_CTRL","btp","Monthly, per company. Reopening is an HR action and is recorded"],
    ["Project and WBS of the row","Receiver WBS element","RPROJ","cats","Field with conversion, the interface shows the external mask"],
    ["Order, when the receiver is an order","Receiver order","RAUFNR","cats","Maintenance, CAPEX or internal orders"],
    ["Network and operation","Network and operation","RNPLNR, RAUFPL, RAPLZL","cats","Only with network planning"],
    ["Activity type","CO activity type","LSTAR","cats","The valuation key"],
    ["Employee's cost center","Sender cost center","SKOSTL","cats","From master data, never manual"],
    ["Receiver cost center","Receiver cost center","RKOSTL","cats","Internal entries without a project"],
    ["Entry description","Short text","LTXA1","cats","40 characters. The interface accepts 300 and truncates"],
    ["Absences in the calendar and the grid","Absence or attendance type","AWART","cats","Read from the Leave Request, read-only. The record stays in Time Management"],
    ["Day blocking from an absence","Employee's daily capacity","work schedule and infotype 2001","cats","An approved full day closes the day, a half day reduces capacity"],
    ["Pending leave request","Request in approval","Leave Request workflow","cats","Doesn't block, raises a warning. If approved, that day's hours conflict"],
    ["Entries created by the assistant","No equivalent","ZZORIGIN with value Joule","btp","Same validations as manual entries, flagged for audit"],
    ["Week status","Processing status","STATUS","cats","Confirm the domain values with the client"],
    ["Approver and date","Approval","APNAM, APDAT","cats","Filled by the process, never by the interface"],
    ["Correction after submission","Reference to the changed record","REFCOUNTER","cats","The change creates a new record, history stays"],
    ["Entry origin","No equivalent","ZZORIGIN","btp","Manual, suggested, copied, on behalf of. Used for telemetry"],
    ["Suggestion confidence level","No equivalent","none","btp","Never leaves the experience layer"],
    ["Signal timeline","No equivalent","none","btp","14-day retention, personal data"],
    ["Favorites and copy week","CATS worklist","worklist tables","cats","Prefer the standard worklist over a parallel list"],
    ["Deviation justification","No equivalent","none","btp","Stays in the history, visible to the approver"]
  ];
  var WHERE = {cats:["CATS","cats"], btp:["BTP","btp"], ci:["CI_CATSDB","ci"]};

  function renderMap(){
    var b = $("mapBody");
    if(!b || b.childElementCount) return;
    MAP.forEach(function(m){
      var tr = document.createElement("tr");
      tr.appendChild(td2(m[0]));
      var c2 = document.createElement("td");
      c2.innerHTML = m[1] + (m[4] ? "<div class='sub' style='color:var(--ink-3); font-size:var(--fs-sm)'>"+m[4]+"</div>" : "");
      tr.appendChild(c2);
      var c3 = document.createElement("td");
      c3.className = "f" + (m[2] === "none" ? " none" : "");
      c3.textContent = m[2];
      tr.appendChild(c3);
      var c4 = document.createElement("td");
      c4.innerHTML = "<span class='tag "+WHERE[m[3]][1]+"'>"+WHERE[m[3]][0]+"</span>";
      tr.appendChild(c4);
      b.appendChild(tr);
    });
  }

  function catsRecords(){
    var recs = [];
    var status = state.submitted ? "20" : "10";
    var clock = isClock();
    state.rows.forEach(function(r){
      var pr = PROJECTS[r.p];
      r.h.forEach(function(v,i){
        if(!v) return;
        var s = clock ? slot(r,i) : null;
        recs.push({
          PERNR: PERNR,
          WORKDATE: WORKDATES[i],
          CATSHOURS: fmt(v),
          UNIT: "H",
          BEGUZ: s && s.b !== null ? fmtClock(s.b) : "",
          ENDUZ: s && s.e !== null ? fmtClock(s.e) : "",
          LGART: "",
          ANZHL: "",
          CATSAMOUNT: "",
          LSTAR: pr.sap.lstar,
          RPROJ: pr.sap.rproj || "",
          SKOSTL: pr.sap.skostl,
          RKOSTL: pr.sap.rkostl || "",
          LTXA1: (r.desc || pr.act).slice(0,40),
          STATUS: status
        });
      });
    });
    /* Allowances are CATS records too, with a wage type instead of hours. */
    state.allow.forEach(function(a){
      var w = wt(a.code), pr = PROJECTS[a.p];
      recs.push({
        PERNR: a.onBehalf || PERNR,
        WORKDATE: WORKDATES[a.day],
        CATSHOURS: "",
        UNIT: w.amount ? "" : w.unit.toUpperCase().slice(0,3),
        BEGUZ: "",
        ENDUZ: "",
        LGART: w.lgart,
        ANZHL: w.amount ? "1.0" : fmt(a.qty),
        CATSAMOUNT: w.amount ? fmt(a.amount) : "",
        LSTAR: pr.sap.lstar,
        RPROJ: pr.sap.rproj || "",
        SKOSTL: pr.sap.skostl,
        RKOSTL: pr.sap.rkostl || "",
        LTXA1: (a.note || w.name).slice(0,40),
        STATUS: status
      });
    });
    return recs;
  }

  function renderCats(){
    renderMap();
    var body = $("catsBody");
    if(!body) return;
    var recs = catsRecords();
    body.innerHTML = "";
    recs.forEach(function(rec){
      var tr = document.createElement("tr");
      ["PERNR","WORKDATE","CATSHOURS","BEGUZ","ENDUZ","LGART","ANZHL","CATSAMOUNT","LSTAR","RPROJ","LTXA1","STATUS"].forEach(function(k){
        var td = td2(rec[k] || "–");
        if(k !== "LTXA1") td.className = "f";
        if(k === "LGART" && rec[k]) td.className = "f wt";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if(!recs.length){
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 12; td.style.color = "var(--ink-3)";
      td.textContent = t("text_no_records_to_generate");
      tr.appendChild(td); body.appendChild(tr);
    }
    $("catsCount").textContent = plural(recs.length, "n_records_generated");
    $("catsPayload").textContent =
      "// Integration with CATS is BAPI only: BAPI_CATIMESHEETMGR_INSERT / _CHANGE / _DELETE,\n" +
      "// with BAPI_TRANSACTION_COMMIT. No OData service, no WorkforceTimesheetService,\n" +
      "// whether the target is cloud or on-premise\n\n" +
      JSON.stringify({
        requestId: "ts-" + WORKDATES[3].slice(0,4) + "-W" + isoWeekOf(WEEKS[weekIdx].start) + "-" + PERNR,
        bukrs: IT0001.bukrs,
        profile: profileFor(WORKDATES[0]).code,
        period: {ym: periodFor(WORKDATES[0]).ym, open: periodOpen(WORKDATES[0])},
        release: state.submitted,
        deviationJustification: state.deviationNote || null,
        records: recs,
        note: "CATSAMOUNT is a native CATSDB field (CURR 13,2), used above for the bonus. Confirm with the client whether the standard CAT6 transfer already maps it to IT2010 BETRG, or whether that mapping needs configuring, and which field carries the currency key alongside it",
        btpOnly: {
          comment: "stays in the experience layer, never enters CATSDB",
          onBehalfOf: massLogThisWeek().slice(-8).map(function(e){
            return {pernr: e.pernr, workdate: e.date, createdBy: e.createdBy, onBehalfOf: e.onBehalf};
          }),
          origins: state.rows.filter(function(r){ return rowTotal(r) > 0; }).map(function(r){
            return {rproj: PROJECTS[r.p].sap.rproj || PROJECTS[r.p].sap.rkostl, origin: r.origin};
          }),
          absenceCapacity: (function(){
            var o = {};
            for(var i=0; i<5; i++) o[WORKDATES[i]] = fmt(capacity(i)) + " h";
            return o;
          })()
        }
      }, null, 2);
  }


  /* ---------- team screen, mass entry ----------
     The leader fills a grid of people by days, reviews it, and saves. The save
     is partial on purpose: rows that fail validation stay on screen with their
     reason, the rest are written. Cancelling ten rows because of one approved
     absence is the fastest way to make people stop using this screen. */
  function stagedOf(pernr){
    if(!state.staged[pernr]) state.staged[pernr] = {sel:false, h:[0,0,0,0,0,0,0], t:[null,null,null,null,null,null,null], err:""};
    if(!state.staged[pernr].t) state.staged[pernr].t = [null,null,null,null,null,null,null];
    return state.staged[pernr];
  }
  function memberBlocked(m, day){ return isSelfMember(m) ? isBlocked(day) : (!!m.abs[day] || !!holidayOn(WORKDATES[day], m.bukrs)); }
  /* The absence that closes a member's day, as a label: from the sample
     roster for the team, from their own sheet for the manager under test. */
  function memberAbsLabel(m, day){
    var hol = holidayOn(WORKDATES[day], m.bukrs);
    if(hol && !m.abs[day]) return holidayName(hol);
    if(isSelfMember(m)){ var a = absOn(day, "approved")[0]; return a ? absTypeLabel(a) : t("text_absence_generic"); }
    return m.abs[day] || "";
  }
  /* The project manager under test, as a member of their own team. */
  function isSelfMember(m){ return state.role === "pm" && !!m.leaderOf && m.leaderOf === state.leader; }
  /* What the project manager records for themselves in mass entry is their
     own time: it goes into their own sheet too, on the project's row (a
     new row when the project has none yet, or, for start and end profiles,
     when that day already holds a window on that row). */
  function addToOwnSheet(pIdx, day, hours, slotT){
    var row = state.rows.filter(function(r){ return r.p === pIdx && !(slotT && r.t && r.t[day]); })[0];
    if(!row){
      /* a second line on the same project carries the first one's description */
      var same = state.rows.filter(function(r){ return r.p === pIdx && r.desc; })[0];
      row = {id:nextId++, p:pIdx, desc: same ? same.desc : "", h:[0,0,0,0,0,0,0], origin:"Team entry"};
      state.rows.push(row);
    }
    row.h[day] = round15((row.h[day] || 0) + hours);
    if(slotT && slotT.b !== null && slotT.e !== null) setSlot(row, day, {b: slotT.b, e: slotT.e});
    state.needsSave = true;
  }
  /* Most of the roster is a standard 8h/day schedule; a few named people
     carry their own reduced dailyHours (see TEAM above), the same idea as
     My week's own daily cap, just per person instead of a single value. */
  /* where a person's working day currently ends, in minutes: the last
     window on their own sheet for the project manager under test, and for
     anyone else the day's recorded hours counted from 09:00, lunch included */
  function dayEndMin(m, day){
    var start = parseClock("09:00");
    if(isSelfMember(m)){
      var end = start;
      state.rows.forEach(function(r){ var w = r.t && r.t[day]; if(w && w.e !== null && w.e > end) end = w.e; });
      return end;
    }
    var h = (alreadyHoursFor(m, WEEKS[weekIdx].num) || [])[day] || 0;
    return h ? start + h*60 + LUNCH_MIN : start;
  }
  function teamDailyCap(m){ return m.dailyHours || DAYCAP; }
  function massProject(){ return +($("mProj") ? $("mProj").value : 0); }

  /* ---------- already recorded, read-only ----------
     A second grid, next to the editable one: what each person already has
     this week, so the leader can see day load before staging more, rather
     than piecing it together from the log on the right. Combines the sample
     "already" hours with whatever is staged but not yet saved, so it updates
     live as the leader fills the grid below. */
  function renderAlreadyGrid(members){
    var wrap = $("alreadyGrid");
    if(!wrap) return;
    wrap.innerHTML = "";
    wrap.className = "tsgrid team readonly";

    var head = document.createElement("div");
    head.className = "row head";
    head.appendChild(el("div","",t("th_employee")));
    DAYS.forEach(function(d,i){ var c = el("div", dayExtraClass(i).trim(), ""); appendDayLabel(c, i); head.appendChild(c); });
    head.appendChild(el("div","",t("th_total")));
    head.appendChild(el("div","",""));
    wrap.appendChild(head);

    members.forEach(function(m){
      var st = stagedOf(m.pernr);
      var already = alreadyHoursFor(m, WEEKS[weekIdx].num);
      /* Recorded on this person's behalf since the last header Save (see
         teamSavedThrough) - a mass fill that goes straight to massLog,
         like the assistant's team fill, never sits in state.staged, so
         that alone would miss it entirely. */
      var pendingHours = {};
      state.massLog.slice(state.teamSavedThrough).forEach(function(e){
        if(e.kind !== "hours" || e.pernr !== m.pernr) return;
        var idx = WORKDATES.indexOf(e.date);
        if(idx !== -1) pendingHours[idx] = (pendingHours[idx] || 0) + e.hours;
      });
      var row = document.createElement("div");
      row.className = "row";
      row.appendChild(el("div","rowmeta", m.name));
      var rowTotal = 0;
      already.forEach(function(v,i){
        var total = v + (st.h[i] || 0);
        rowTotal += total;
        var cls = "already-cell" + dayExtraClass(i);
        if(total > 8) cls += " over";
        else if(total >= 8) cls += " full";
        if(memberBlocked(m,i)) cls += " abs";
        /* A visible marker, not just the tooltip below - so "what did the
           assistant/mass entry just add here" doesn't require hovering
           every cell one by one. Either still staged, or recorded but
           not yet through the header Save. */
        var stagedNow = st.h[i] || 0;
        var pendingNow = pendingHours[i] || 0;
        if(stagedNow || pendingNow) cls += " staged";
        var cell = el("div", cls, total ? fmt(total) : "–");
        if(memberBlocked(m,i)) cell.title = t("tip_approved_type", {type: memberAbsLabel(m, i).toLowerCase()});
        else if(stagedNow && pendingNow) cell.title = fmt(v - pendingNow) + " h already · " + fmt(pendingNow) + " h recorded, " + fmt(stagedNow) + " h staged - Save to finish";
        else if(pendingNow) cell.title = fmt(v - pendingNow) + " h already · " + fmt(pendingNow) + " h recorded, not yet saved";
        else if(stagedNow) cell.title = fmt(v) + " h already · " + fmt(stagedNow) + " h staged now";
        row.appendChild(cell);
      });
      row.appendChild(el("div","rowtot", rowTotal ? fmt(rowTotal) : "–"));
      row.appendChild(el("div","",""));
      wrap.appendChild(row);
    });
  }

  /* One or more allowance lines for a single person/day cell, collapsed to
     what fits a grid cell (total quantity, or a count when the lines don't
     share a unit) with the full breakdown left for the title tooltip. Used
     both for what's staged and for what's already saved, so the two grids
     read the same way. */
  function fmtAllowCell(lines){
    if(!lines.length) return {text:"–", title:""};
    var qty = lines.reduce(function(a,l){ return a + l.qty; }, 0);
    var text = fmt(qty) + " " + (lines.length === 1 ? wt(lines[0].code).unit : "×" + lines.length);
    var title = lines.map(function(l){
      return wt(l.code).name + ": " + fmt(l.qty) + " " + wt(l.code).unit + " · " + PROJECTS[l.p].code + (l.note ? " (" + l.note + ")" : "");
    }).join(", ");
    return {text:text, title:title};
  }

  /* Same layout as renderAlreadyGrid (hours), so the leader reads both the
     same way: a day-by-day grid instead of a flat card list. A cell can
     still hide detail when a person has more than one wage type the same
     day, that's what the tooltip is for. */
  function renderAlreadyAllowGrid(members){
    var wrap = $("alreadyAllowGrid");
    if(!wrap) return;
    wrap.innerHTML = "";
    wrap.className = "tsgrid team readonly";

    var head = document.createElement("div");
    head.className = "row head";
    head.appendChild(el("div","",t("th_employee")));
    DAYS.forEach(function(d,i){ var c = el("div", dayExtraClass(i).trim(), ""); appendDayLabel(c, i); head.appendChild(c); });
    head.appendChild(el("div","",t("th_total")));
    head.appendChild(el("div","",""));
    wrap.appendChild(head);

    members.forEach(function(m){
      var entries = state.massLog.filter(function(e){
        return e.kind === "allowance" && e.pernr === m.pernr && WORKDATES.indexOf(e.date) !== -1;
      });
      var row = document.createElement("div");
      row.className = "row";
      row.appendChild(el("div","rowmeta", m.name));
      var units = {};
      DAYS.forEach(function(d,i){
        var lines = entries.filter(function(e){ return e.day === i; });
        var info = fmtAllowCell(lines);
        var cls = "already-cell" + dayExtraClass(i) + (memberBlocked(m,i) ? " abs" : "");
        var cell = el("div", cls, info.text);
        if(memberBlocked(m,i)) cell.title = t("tip_approved_type", {type: memberAbsLabel(m, i).toLowerCase()});
        else if(lines.length) cell.title = info.title;
        if(lines.length){
          lines.forEach(function(l){ units[wt(l.code).unit] = (units[wt(l.code).unit]||0) + l.qty; });
        }
        row.appendChild(cell);
      });
      var unitKeys = Object.keys(units);
      var totTxt = unitKeys.length === 0 ? "–" : (unitKeys.length === 1 ? fmt(units[unitKeys[0]]) + " " + unitKeys[0] : entries.length + " lines");
      row.appendChild(el("div","rowtot", totTxt));
      row.appendChild(el("div","",""));
      wrap.appendChild(row);
    });
  }

  function renderTeam(){
    var wrap = $("teamGrid");
    if(!wrap) return;

    /* project options, limited to the leader's scope. This has to run
       before teamOf(), which reads #mProj's current value to decide who's
       even on the roster now. */
    var pj = $("mProj");
    if(pj && !pj.dataset.for || (pj && pj.dataset.for !== state.leader)){
      var keep = pj.value;
      pj.innerHTML = "";
      projectsOf(state.leader).forEach(function(i){
        var o = document.createElement("option");
        o.value = String(i); o.textContent = PROJECTS[i].code + " · " + PROJECTS[i].name;
        pj.appendChild(o);
      });
      pj.dataset.for = state.leader;
      if(keep && pj.querySelector('option[value="'+keep+'"]')) pj.value = keep;
    }

    var members = teamOf(state.leader);

    $("teamCount").textContent = plural(members.length, "n_people");
    var teamChip = $("teamStateChip");
    if(teamChip){
      teamChip.textContent = state.teamNeedsSave ? t("chip_save_to_finish") : t("chip_up_to_date");
      teamChip.className = state.teamNeedsSave ? "chip amber" : "chip grey";
    }

    renderAlreadyGrid(members);
    renderAlreadyAllowGrid(members);

    wrap.innerHTML = "";
    var anyClock = members.some(function(m){ return profileFor(WORKDATES[0], m.bukrs).clock; });
    var anyDur = members.some(function(m){ return !profileFor(WORKDATES[0], m.bukrs).clock; });
    wrap.className = "tsgrid team" + (anyClock ? " clock" : "");
    /* Only show the fields this team can actually use: an all-Z_CONS team has
       nothing to do with Start/End, an all-Z_BSRV team has nothing to do with
       Duration. Both stayed visible regardless before, which read as broken
       when neither field did anything for the team on screen. */
    if($("mDurWrap")) $("mDurWrap").hidden = !anyDur;
    if($("mBegWrap")) $("mBegWrap").hidden = !anyClock;
    if($("mEndWrap")) $("mEndWrap").hidden = !anyClock;

    var head = document.createElement("div");
    head.className = "row head";
    head.appendChild(el("div","",t("th_employee")));
    DAYS.forEach(function(d,i){ var c = el("div", dayExtraClass(i).trim(), ""); appendDayLabel(c, i); head.appendChild(c); });
    head.appendChild(el("div","",t("th_total")));
    head.appendChild(el("div","",""));
    wrap.appendChild(head);

    members.forEach(function(m){
      var st = stagedOf(m.pernr);
      var row = document.createElement("div");
      row.className = "row" + (m.locked ? " locked" : "");

      var meta = el("div","rowmeta","");
      var p = el("div","p","");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = st.sel;
      cb.disabled = m.locked;
      cb.setAttribute("aria-label",t("aria_select_name", {name: m.name}));
      cb.onchange = function(){ st.sel = cb.checked; renderTeam(); };
      p.appendChild(cb);
      p.appendChild(el("span","", m.name));
      var code = document.createElement("code"); code.textContent = m.pernr; p.appendChild(code);
      meta.appendChild(p);
      /* teamOf() only lists people allocated to the project selected above,
         so everyone in this loop already qualifies - no need to spell out
         which project(s), the roster itself is the answer. */
      var sub = m.role + (isSelfMember(m) ? " · " + t("label_you") : "") + " · " + m.bukrs + " · " + profileFor(WORKDATES[0], m.bukrs).code;
      if(m.dailyHours) sub += " · " + t("unit_h_per_day", {h: fmt(m.dailyHours)});
      var absDays = isSelfMember(m)
        ? [0,1,2,3,4].filter(function(d){ return memberBlocked(m, d); })
        : Object.keys(m.abs).map(Number).sort(function(a,b){ return a-b; });
      if(absDays.length){
        sub += " · " + absDays.map(function(d){ return DAYS[d] + " " + memberAbsLabel(m, d).toLowerCase(); }).join(", ");
      }
      if(m.locked) sub += " · " + t("text_week_already_approved");
      var s = el("div","s", sub);
      if(m.locked) s.style.color = "var(--warn)";
      meta.appendChild(s);
      row.appendChild(meta);

      st.h.forEach(function(v,i){
        if(state.teamTab === "allow"){
          /* The grid is shared across tabs so selection stays put, but on
             Allowances it has nothing to do with hours: show what's staged
             (not yet saved) for this person and day instead, so the leader
             sees it land here, not only in the list below. */
          var lines = state.stagedAllow.filter(function(a){ return a.pernr === m.pernr && a.day === i; });
          var info = fmtAllowCell(lines);
          var cell = el("div","allowcell" + dayExtraClass(i), info.text);
          if(lines.length){
            cell.title = info.title + " · " + t("text_staged_not_saved_short");
            cell.classList.add("pending");
          }
          row.appendChild(cell);
          return;
        }
        var clock = profileFor(WORKDATES[i], m.bukrs).clock;
        if(clock){
          /* Z_BSRV is filled from the Start/End fields above, not per cell. An
             unstaged cell is just empty, not a form field waiting for input:
             the only place to fill it is Apply to selected. Once staged, the
             leader sees exactly what was recorded, project included, without
             waiting for the save log. */
          var slotT = st.t[i];
          if(!slotT){
            var ph = el("div","cell computed" + dayExtraClass(i), "–");
            ph.title = t("tip_clock_use_fields");
            if(memberBlocked(m,i)){ ph.classList.add("abs"); ph.title = t("tip_approved_type", {type: memberAbsLabel(m, i).toLowerCase()}); }
            if(!periodOpen(WORKDATES[i], m.bukrs)){ ph.classList.add("closed"); ph.title = t("tip_closed_period_short"); }
            row.appendChild(ph);
            return;
          }
          var box = el("div","clockcell" + dayExtraClass(i), "");
          ["b","e"].forEach(function(k){
            var tinp = document.createElement("input");
            tinp.type = "text";
            tinp.className = "tinp";
            tinp.value = fmtClock(slotT[k]);
            tinp.disabled = true;
            tinp.setAttribute("aria-label", t(k === "b" ? "aria_start_time_for" : "aria_end_time_for", {name: m.name, day: DAYS[i]}));
            box.appendChild(tinp);
          });
          box.appendChild(el("div","cdur", v ? fmt(v) + " h" : "–"));
          box.title = PROJECTS[massProject()].code + " · " + fmtClock(slotT.b) + "–" + fmtClock(slotT.e);
          if(memberBlocked(m,i)){ box.classList.add("abs"); box.title = t("tip_approved_type", {type: memberAbsLabel(m, i).toLowerCase()}); }
          if(!periodOpen(WORKDATES[i], m.bukrs)){ box.classList.add("closed"); box.title = t("tip_closed_period_short"); }
          row.appendChild(box);
          return;
        }
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "cell" + dayExtraClass(i);
        inp.value = v ? fmt(v) : "";
        inp.inputMode = "decimal";
        inp.disabled = m.locked || memberBlocked(m,i) || !periodOpen(WORKDATES[i], m.bukrs);
        inp.title = v ? (PROJECTS[massProject()].code + " · " + fmt(v) + " h") : "";
        inp.setAttribute("aria-label", t("aria_team_hours", {name: m.name, day: DAYS[i]}));
        if(memberBlocked(m,i)){ inp.classList.add("abs"); inp.title = t("tip_approved_abs", {type: memberAbsLabel(m, i).toLowerCase()}); }
        if(!periodOpen(WORKDATES[i], m.bukrs)){ inp.classList.add("closed"); inp.title = t("tip_closed_period_short"); }
        inp.addEventListener("change", function(){
          var parsed = parseDur(inp.value);
          if(isNaN(parsed)){ toast(t("toast_bad_number", {v: inp.value})); renderTeam(); return; }
          var newVal = round15(parsed);
          /* Same rule as My week: never let a day go over the person's own
             daily capacity, counting what they already have recorded that
             day (alreadyHoursFor), not just what's being staged here. */
          var already = alreadyHoursFor(m, WEEKS[weekIdx].num)[i];
          var cap = teamDailyCap(m);
          if(already + newVal > cap){
            var left = Math.max(0, cap - already);
            toast(t("toast_capacity_on_day", {name: m.name, cap: fmt(cap), day: DAYS[i]}) + (left > 0 ? t("toast_only_available", {left: fmt(left)}) : t("toast_no_hours_available")));
            renderTeam();
            return;
          }
          st.h[i] = newVal;
          st.t[i] = null;
          renderTeam();
        });
        row.appendChild(inp);
      });

      if(state.teamTab === "allow"){
        var mLines = state.stagedAllow.filter(function(a){ return a.pernr === m.pernr; });
        var totTxt = "–";
        if(mLines.length){
          var units = {};
          mLines.forEach(function(l){ var u = wt(l.code).unit; units[u] = (units[u]||0) + l.qty; });
          var unitKeys = Object.keys(units);
          totTxt = unitKeys.length === 1 ? fmt(units[unitKeys[0]]) + " " + unitKeys[0] : t("text_n_staged", {n: mLines.length});
        }
        row.appendChild(el("div","rowtot", totTxt));
      } else {
        var tot = st.h.reduce(function(a,b){ return a+(b||0); },0);
        row.appendChild(el("div","rowtot", tot ? fmt(tot) : "–"));
      }
      var act = el("div","rowact","");
      if(st.err){
        var flag = el("span","errdot","!");
        flag.title = st.err;
        act.appendChild(flag);
      }
      row.appendChild(act);
      wrap.appendChild(row);
    });

    var sel = members.filter(function(m){ return stagedOf(m.pernr).sel; }).length;
    var staged = members.reduce(function(a,m){ return a + stagedOf(m.pernr).h.reduce(function(x,y){ return x+(y||0); },0); },0);
    $("mSel").textContent = plural(sel, "n_selected");
    if(state.teamTab === "allow"){
      var n = state.stagedAllow.length;
      $("mStaged").innerHTML = n + "<small> " + plural(n, "lines_staged_suffix") + "</small>";
    } else {
      $("mStaged").innerHTML = fmt(staged) + "<small> " + t("h_staged_suffix") + "</small>";
    }
    $("mSave").disabled = staged === 0;

    renderMassLog();
    renderBonusPanel();
    renderMassAllowList();
    setTeamTab(state.teamTab);
  }

  /* Fills duration for people on a duration profile, and start/end for people
     on Z_BSRV, in the same click. A mixed selection (Carlos Pinto's team has
     both) uses whichever field applies to each person; a cell whose profile
     needs the field left blank is skipped, not guessed. */
  function applyMass(){
    var members = teamOf(state.leader).filter(function(m){ return stagedOf(m.pernr).sel && !m.locked; });
    if(!members.length){ toast(t("toast_select_person_first")); return; }
    var dur = parseDur($("mDur").value);
    var hasDur = !isNaN(dur) && dur > 0;
    var bTxt = $("mBeg") ? $("mBeg").value : "", eTxt = $("mEnd") ? $("mEnd").value : "";
    var b = parseClock(bTxt), e = parseClock(eTxt);
    var hasClock = bTxt.trim() !== "" && eTxt.trim() !== "" && !isNaN(b) && !isNaN(e);
    if(!hasDur && !hasClock){ toast(t("toast_give_duration_or_clock")); return; }
    var days = [];
    Array.prototype.forEach.call(document.querySelectorAll(".mHoursDays input:checked"), function(c){ days.push(+c.value); });
    if(!days.length){ toast(t("toast_pick_a_day")); return; }
    var touched = 0, skipped = 0, capped = 0;
    members.forEach(function(m){
      var st = stagedOf(m.pernr);
      var already = alreadyHoursFor(m, WEEKS[weekIdx].num);
      var cap = teamDailyCap(m);
      days.forEach(function(d){
        if(memberBlocked(m,d) || !periodOpen(WORKDATES[d], m.bukrs)) return;
        var clock = profileFor(WORKDATES[d], m.bukrs).clock;
        var val;
        if(clock){
          if(!hasClock){ skipped++; return; }
          val = slotHours({b:b, e:e});
        } else {
          if(!hasDur){ skipped++; return; }
          val = round15(dur);
        }
        /* Same daily cap as a single manual cell (durCell, the Team hours
           input above): bulk-filling never gets to skip the check just
           because it touches many people at once. */
        if(already[d] + val > cap){ capped++; return; }
        if(clock){ st.t[d] = {b:b, e:e}; st.h[d] = val; }
        else { st.t[d] = null; st.h[d] = val; }
        touched++;
      });
    });
    renderTeam();
    var msg = t("toast_cells_filled", {n: touched, people: members.length});
    if(skipped) msg += plural(skipped, "cells_skipped_field");
    if(capped) msg += plural(capped, "cells_skipped_capacity");
    toast(msg);
  }

  function clearMass(){
    Object.keys(state.staged).forEach(function(k){ state.staged[k] = {sel:false, h:[0,0,0,0,0,0,0], t:[null,null,null,null,null,null,null], err:""}; });
    state.stagedAllow = [];
    renderTeam();
  }

  /* Partial save. Every row is validated on its own and the ones that pass are
     written, with CREATED_BY as the leader and ON_BEHALF_OF as the employee. */
  /* onlyPernrs, when given, restricts the commit to those people, leaving
     anyone else's staged-but-unsaved hours exactly as they were: without
     it, this saves every nonzero staged line for the whole team, which is
     what "Save staged entries" on screen means (several people can be
     staged in separate batches before one Save). The chat assistant passes
     it, scoped to whoever its own confirmation card named, so a person's
     unrelated staged hours from an earlier, still-unconfirmed manual batch
     never get swept into a save the person never saw or confirmed. */
  function saveMass(onlyPernrs, silent){
    var ownSheetChanged = false;
    var leader = leaderById(state.leader);
    var members = teamOf(state.leader);
    if(onlyPernrs) members = members.filter(function(m){ return onlyPernrs.indexOf(m.pernr) !== -1; });
    var saved = 0, kept = 0, savedPeople = 0;
    var pIdx = massProject();
    members.forEach(function(m){
      var st = stagedOf(m.pernr);
      var total = st.h.reduce(function(a,b){ return a+(b||0); },0);
      if(total === 0){ st.err = ""; return; }
      var err = "";
      if(m.locked) err = t("err_mass_locked");
      else if(!isEligibleForProject(m, pIdx)) err = t("err_mass_not_allocated", {name: m.name.split(" ")[0], code: PROJECTS[pIdx].code});
      else {
        var already = alreadyHoursFor(m, WEEKS[weekIdx].num);
        var cap = teamDailyCap(m);
        for(var d=0; d<7; d++){
          if(!st.h[d]) continue;
          if(memberBlocked(m,d)){ err = t("err_mass_absence", {day: DAYS[d], type: memberAbsLabel(m, d).toLowerCase()}); break; }
          if(!periodOpen(WORKDATES[d], m.bukrs)){ err = t("err_mass_closed", {day: DAYS[d]}); break; }
          if(st.h[d] > 24){ err = t("err_mass_24h", {day: DAYS[d]}); break; }
          /* The authoritative capacity gate: every path that stages hours
             (a manual cell, Apply to selected, or the chat assistant) ends
             up here before anything is actually saved, so this is the one
             place that has to catch all of them, not just the UI paths
             that already guard themselves on the way in. */
          if(already[d] + st.h[d] > cap){
            err = t("err_mass_capacity", {day: DAYS[d], cap: fmt(cap), name: m.name.split(" ")[0]}); break;
          }
          if(profileFor(WORKDATES[d], m.bukrs).clock && (!st.t[d] || st.t[d].b === null || st.t[d].e === null)){
            err = t("err_mass_window", {day: DAYS[d], name: m.name.split(" ")[0]}); break;
          }
        }
      }
      if(err){ st.err = err; kept++; return; }
      st.err = "";
      for(var i=0; i<7; i++){
        if(!st.h[i]) continue;
        state.massLog.push({
          kind: "hours",
          pernr: m.pernr, name: m.name, date: WORKDATES[i], day: i, hours: st.h[i],
          p: pIdx, createdBy: leader.name, onBehalf: m.pernr,
          profile: profileFor(WORKDATES[i], m.bukrs).code,
          beg: st.t[i] ? st.t[i].b : null, end: st.t[i] ? st.t[i].e : null
        });
        if(isSelfMember(m)){ addToOwnSheet(pIdx, i, st.h[i], st.t[i]); ownSheetChanged = true; }
        saved++;
      }
      savedPeople++;
      state.staged[m.pernr] = {sel:false, h:[0,0,0,0,0,0,0], t:[null,null,null,null,null,null,null], err:""};
    });
    /* Recorded on behalf, but not yet persisted - same distinction as
       Submit vs Save on My Timesheet. The header Save button is what
       actually reflects this in the database. */
    if(saved) state.teamNeedsSave = true;
    if(ownSheetChanged) render(); else renderTeam();
    if(silent) return saved;
    var who = plural(savedPeople, "n_people");
    var left = plural(kept, "n_lines_left");
    if(saved && kept) toast(t("toast_team_entries_partial", {saved: saved, who: who, left: left}) + saveHint());
    else if(saved) toast(t("toast_team_entries_all", {saved: saved, who: who}) + saveHint());
    else toast(t("toast_team_entries_none"));
    return saved;
  }

  /* ---------- allowances, mass entry ----------
     Same partial, staged-then-saved pattern as hours, but the line items are
     flat (an allowance is one occurrence, not a per-day grid cell), so
     they're staged in a list instead of a second grid. The bonus wage type
     never appears here, it stays the project owner's separate panel. */
  function massWageTypes(){
    /* the team can mix companies (Carlos Pinto has PT01 and PT02 people), so
       the shift allowance is offered if anyone on the team could use it, not
       just whoever happens to be first in the list */
    var anyShiftCompany = teamOf(state.leader).some(function(m){ return m.bukrs === "PT02"; });
    return WAGETYPES.filter(function(w){ return w.selfEntry && (w.code !== "TURNO" || anyShiftCompany); });
  }
  function syncMassAllowForm(){
    var sel = $("mAllowCode");
    if(!sel) return;
    var w = wt(sel.value);
    if(!w) return;
    $("mAllowUnit").textContent = w.unit;
    $("mAllowNoteWrap").hidden = !w.noteLabel;
    $("mAllowNoteLbl").textContent = w.noteLabel || t("label_note");
  }
  function applyMassAllow(){
    var members = teamOf(state.leader).filter(function(m){ return stagedOf(m.pernr).sel && !m.locked; });
    if(!members.length){ toast(t("toast_select_person_first")); return; }
    var w = wt($("mAllowCode").value);
    var qty = parseDur($("mAllowQty").value);
    if(isNaN(qty) || qty <= 0){ toast(t("toast_give_qty_positive")); return; }
    var note = $("mAllowNote").value.trim();
    if(w.noteLabel && !note){ toast(t("toast_note_required_for", {note: w.noteLabel, name: wtName(w)})); return; }
    var days = [];
    Array.prototype.forEach.call(document.querySelectorAll(".mAllowDays input:checked"), function(c){ days.push(+c.value); });
    if(!days.length){ toast(t("toast_pick_a_day")); return; }
    var pIdx = w.needProj ? massProject() : 3;
    var added = 0, skippedCompany = 0, skippedProject = 0;
    members.forEach(function(m){
      if(w.code === "TURNO" && m.bukrs !== "PT02"){ skippedCompany++; return; }
      /* A leader who owns more than one project can have a team member
         selected who isn't actually allocated to the project currently
         picked (they're on the team through the leader's other project):
         skip them here too, same as Hours already does at save time. */
      if(w.needProj && !isEligibleForProject(m, pIdx)){ skippedProject++; return; }
      days.forEach(function(d){
        if(!periodOpen(WORKDATES[d], m.bukrs)) return;
        state.stagedAllow.push({pernr:m.pernr, name:m.name, code:w.code, day:d, p:pIdx, qty:round15(qty), note:note});
        added++;
      });
    });
    renderTeam();
    var msg = plural(added, "allow_lines_staged", {people: members.length});
    if(skippedCompany) msg += t("toast_allow_skipped_company", {n: skippedCompany});
    if(skippedProject) msg += t("toast_allow_skipped_project", {n: skippedProject, code: PROJECTS[pIdx].code});
    toast(msg);
  }
  function clearMassAllow(){
    state.stagedAllow = [];
    renderTeam();
  }
  /* Same onlyPernrs scoping as saveMass(): without it, every staged
     allowance line is committed and cleared, which is what "Save staged
     allowances" on screen means. The chat assistant passes it, scoped to
     its own confirmation card, so someone else's still-unconfirmed staged
     lines are left in place instead of being saved (or wiped) alongside it. */
  function saveMassAllow(onlyPernrs, silent){
    var lines = onlyPernrs
      ? state.stagedAllow.filter(function(a){ return onlyPernrs.indexOf(a.pernr) !== -1; })
      : state.stagedAllow;
    if(!lines.length){ if(!silent) toast(t("toast_nothing_staged")); return 0; }
    var leader = leaderById(state.leader);
    lines.forEach(function(a){
      state.massLog.push({
        kind: "allowance",
        pernr: a.pernr, name: a.name, date: WORKDATES[a.day], day: a.day,
        code: a.code, qty: a.qty, note: a.note, p: a.p,
        createdBy: leader.name, onBehalf: a.pernr
      });
    });
    var n = lines.length;
    state.stagedAllow = onlyPernrs
      ? state.stagedAllow.filter(function(a){ return onlyPernrs.indexOf(a.pernr) === -1; })
      : [];
    state.teamNeedsSave = true;
    renderTeam();
    if(!silent) toast(plural(n, "allow_lines_recorded") + saveHint());
    return n;
  }
  /* The header's single Save button: records whatever is still staged
     (silently, same rules and same partial-save behaviour as the Hours/
     Allowances tabs' own buttons) and then, in the same click, clears
     teamNeedsSave - the step that actually reflects everything already
     recorded on behalf of the team in the database. One safe click that
     always finishes the job, whichever tab it was staged from. */
  /* What the assistant records is saved as it is confirmed: it isn't on
     the screen being edited, so there is no Save button to press after it.
     Changes typed on the screens keep their own Save. */
  /* the week a team entry goes to: the one the Team screen is on */
  function teamWeekLabel(bare){
    var w = WEEKS[weekIdx], ds = datesFor(w.start);
    return t(bare ? "fmt_week_range_bare" : "fmt_week_range", {n: isoWeekOf(w.start), from: isoToDmy(ds[0]).slice(0,5), to: isoToDmy(ds[4]).slice(0,5)});
  }
  function saveHint(){ return chat.committing ? "" : t("hint_click_save"); }
  function commitAssistantChanges(){
    if(state.needsSave) state.needsSave = false;
    if(state.teamNeedsSave){ state.teamNeedsSave = false; state.teamSavedThrough = state.massLog.length; }
    render();
    if($("screen-team") && !$("screen-team").hidden) renderTeam();
  }
  function saveTeamAll(){
    var hoursSaved = saveMass(null, true);
    var allowSaved = saveMassAllow(null, true);
    if(!hoursSaved && !allowSaved && !state.teamNeedsSave){
      toast(t("toast_nothing_to_save"));
      return;
    }
    state.teamNeedsSave = false;
    state.teamSavedThrough = state.massLog.length;
    renderTeam();
    toast(t("toast_changes_saved"));
  }
  function renderMassAllowList(){
    var box = $("mAllowList");
    if(!box) return;
    /* wage type options, limited to what this leader's team can record */
    var sel = $("mAllowCode");
    if(sel && sel.dataset.for !== state.leader){
      var keep = sel.value;
      sel.innerHTML = "";
      massWageTypes().forEach(function(w){
        var o = document.createElement("option");
        o.value = w.code; o.textContent = wtName(w) + " (" + w.lgart + ")";
        sel.appendChild(o);
      });
      sel.dataset.for = state.leader;
      if(keep && sel.querySelector('option[value="'+keep+'"]')) sel.value = keep;
      syncMassAllowForm();
    }
    $("mAllowStagedCount").textContent = state.stagedAllow.length + (state.stagedAllow.length === 1 ? " staged" : " staged");
    if($("mAllowProj")){
      $("mAllowProj").textContent = PROJECTS[massProject()].code + " · " + PROJECTS[massProject()].name;
    }
    $("mAllowSave").disabled = state.stagedAllow.length === 0;
    box.innerHTML = "";
    if(!state.stagedAllow.length){
      box.appendChild(el("div","paused",t("text_nothing_staged_yet")));
      return;
    }
    state.stagedAllow.forEach(function(a){
      var w = wt(a.code);
      var c = el("div","abscard","");
      var h = el("div","h","");
      h.appendChild(el("b","", a.name));
      h.appendChild(el("span","chip grey", fmt(a.qty) + " " + w.unit));
      c.appendChild(h);
      c.appendChild(el("div","why", DAYS[a.day] + " · " + PROJECTS[a.p].code + " · " + t("text_wage_type_label", {code: w.lgart})));
      if(a.note) c.appendChild(el("div","why", a.note));
      box.appendChild(c);
    });
  }

  /* state.massLog holds every mass entry ever recorded, across every week,
     not just this one - it's the CATS payload's audit trail too. Without
     this filter, switching weeks left last week's entries on screen, and
     DAYS[e.day] read them against the WRONG week's calendar, so "Tue 15"
     silently relabelled itself "Tue 22" the moment the visible week
     changed, still pointing at the same stored day-of-week offset. */
  function massLogThisWeek(){
    return state.massLog.filter(function(e){ return WORKDATES.indexOf(e.date) !== -1; });
  }
  function renderMassLog(){
    var box = $("massLog");
    if(!box) return;
    box.innerHTML = "";
    var weekLog = massLogThisWeek();
    $("massLogCount").textContent = plural(weekLog.length, "n_entries");
    if(!weekLog.length){
      box.appendChild(el("div","paused",t("text_nothing_recorded_behalf_week")));
      return;
    }
    weekLog.slice(-12).reverse().forEach(function(e){
      var c = el("div","abscard","");
      var h = el("div","h","");
      h.appendChild(el("b","", e.name));
      if(e.kind === "bonus"){
        h.appendChild(el("span","chip green", fmt(e.amount) + " EUR"));
        c.appendChild(h);
        c.appendChild(el("div","why", DAYS[e.day] + " · " + PROJECTS[e.p].code + " · " + wt(e.code).name));
        c.appendChild(el("div","why", e.note));
      } else if(e.kind === "allowance"){
        var w = wt(e.code);
        h.appendChild(el("span","chip grey", fmt(e.qty) + " " + w.unit));
        c.appendChild(h);
        c.appendChild(el("div","why", DAYS[e.day] + " · " + PROJECTS[e.p].code + " · " + wtName(w)));
      } else {
        h.appendChild(el("span","chip grey", fmt(e.hours) + " h"));
        c.appendChild(h);
        var line = DAYS[e.day] + " · " + PROJECTS[e.p].code + " · " + e.profile;
        if(e.beg !== null && e.beg !== undefined) line += " · " + fmtClock(e.beg) + "–" + fmtClock(e.end);
        c.appendChild(el("div","why", line));
      }
      c.appendChild(el("div","why", "CREATED_BY " + e.createdBy + " · ON_BEHALF_OF " + e.onBehalf));
      box.appendChild(c);
    });
  }

  /* ---------- bonus, created by the project owner ----------
     The only allowance carrying an amount and the only one the employee does
     not record. Defining the value and approving are the same act, by the same
     person, so there is no separate approval step. Every leader in Team entry
     is a project owner (scope is by project, never by line hierarchy), so the
     panel is always available here. */
  function renderBonusPanel(){
    var panel = $("bonusPanel");
    if(!panel) return;
    var leader = leaderById(state.leader);
    /* visibility is owned by setTeamTab() now, one of the three mass-entry
       tabs, not this function — every leader is a project owner so the
       tab itself is always enabled, just not always the active one.
       Who it's for comes from the Team grid's own checkboxes, same as
       Hours and Allowances, instead of a second, separate picker here. */
    $("bProj").textContent = PROJECTS[massProject()].code + " · " + PROJECTS[massProject()].name;
    var box = $("bonusList");
    box.innerHTML = "";
    var mine = state.allow.filter(function(a){ return wt(a.code).amount; });
    if(!mine.length){ box.appendChild(el("div","paused",t("text_no_bonus_recorded"))); return; }
    mine.forEach(function(a){
      var c = el("div","abscard bonus","");
      var h = el("div","h","");
      h.appendChild(el("b","", a.forName || t("th_employee")));
      h.appendChild(el("span","chip green", fmt(a.amount) + " EUR"));
      c.appendChild(h);
      c.appendChild(el("div","why", DAYS[a.day] + " · " + PROJECTS[a.p].code + " · " + t("text_wage_type_label", {code: wt(a.code).lgart})));
      c.appendChild(el("div","why", a.note));
      c.appendChild(el("div","why", t("text_bonus_defined_by", {name: a.byName})));
      box.appendChild(c);
    });
  }
  function saveBonus(){
    var leader = leaderById(state.leader);
    var pIdx = massProject();
    var members = teamOf(state.leader).filter(function(m){ return stagedOf(m.pernr).sel && !m.locked; });
    if(!members.length){ toast(t("toast_select_person_first")); return; }
    var amount = parseDur($("bAmount").value);
    var note = $("bNote").value.trim();
    if(isNaN(amount) || amount <= 0){ toast(t("toast_amount_must_be_positive")); return; }
    if(!note){ toast(t("toast_bonus_reason_required")); return; }
    /* A leader who owns more than one project can have someone selected who
       isn't actually allocated to the project picked above (they're on the
       team through the leader's other project): skip them, same partial-save
       pattern as Hours and Allowances, rather than billing the wrong project. */
    var eligible = members.filter(function(m){ return isEligibleForProject(m, pIdx); });
    var ineligible = members.filter(function(m){ return !isEligibleForProject(m, pIdx); });
    if(!eligible.length){ toast(t("toast_none_allocated", {code: PROJECTS[pIdx].code})); return; }
    var recorded = [], noOpenDay = [];
    eligible.forEach(function(who){
      var day = -1;
      for(var i=4; i>=0; i--){ if(periodOpen(WORKDATES[i], who.bukrs)){ day = i; break; } }
      /* Every weekday closed is the same "nothing open to bill to" case
         Hours and Allowances already skip with a reason, not a silent
         write to whatever day the loop happened to start from. */
      if(day === -1){ noOpenDay.push(who); return; }
      state.allow.push({
        id:"al"+(nextId++), day:day, p:pIdx, code:"BONUS", qty:1, amount:amount,
        note:note, by:leader.id, onBehalf:who.pernr, byName:leader.name, forName:who.name
      });
      state.massLog.push({
        kind:"bonus", pernr:who.pernr, name:who.name, date:WORKDATES[day], day:day,
        code:"BONUS", amount:amount, note:note, p:pIdx,
        createdBy:leader.name, onBehalf:who.pernr
      });
      recorded.push(who);
    });
    $("bAmount").value = ""; $("bNote").value = "";
    render();
    var msg = recorded.length
      ? t("toast_bonus_recorded", {amount: fmt(amount), names: recorded.map(function(m){ return m.name; }).join(", ")})
      : t("toast_bonus_none_recorded");
    if(ineligible.length) msg += t("toast_bonus_skipped_ineligible", {names: ineligible.map(function(m){ return m.name.split(" ")[0]; }).join(", "), code: PROJECTS[pIdx].code});
    if(noOpenDay.length) msg += t("toast_bonus_skipped_closed", {names: noOpenDay.map(function(m){ return m.name.split(" ")[0]; }).join(", ")});
    toast(msg);
  }

  /* ---------- actions ---------- */
  function addRow(){
    if(isMonthly()) return addMonthRow();
    if(state.submitted){
      toast(t("toast_week_submitted_no_rows"));
      return;
    }
    var used = state.rows.map(function(r){ return r.p; });
    /* Same eligibility rule as addMonthRow: only a project this company
       actually does (its own, or a shared one with no bukrs), and not
       already on a row this week. The person then picks which one of
       those in the dialog - see openNewRowDetail. */
    var eligible = [];
    for(var i=0; i<PROJECTS.length; i++){
      if(used.indexOf(i) === -1 && (PROJECTS[i].bukrs === IT0001.bukrs || PROJECTS[i].bukrs === null)) eligible.push(i);
    }
    if(!eligible.length){
      toast(t("toast_all_projects_used_week"));
      return;
    }
    openNewRowDetail(eligible);
  }
  function copyWeek(){
    if(state.submitted) return;
    var prev = WEEKS[weekIdx-1];
    var base = prev
      ? prev.rows.map(function(r){ return {p:r.p, desc:r.desc}; })
      : [
          {p:0, desc:"Requirements workshop, payroll"},
          {p:1, desc:"Time recording solution design"},
          {p:2, desc:"Rollout follow-up"},
          {p:3, desc:"Pre-sales and internal training"}
        ];
    var added = 0;
    base.forEach(function(b){
      if(state.rows.some(function(r){ return r.p === b.p; })) return;
      state.rows.push({id:nextId++, p:b.p, desc:b.desc, h:[0,0,0,0,0,0,0], origin:"Copied"});
      added++;
    });
    render();
    var first = state.rows[0];
    if(first){ var c = document.getElementById("c-"+first.id+"-0"); if(c) c.focus(); }
    toast(added ? t("toast_copy_week_done", {n: added}) : t("toast_copy_week_none"));
  }

  /* ---------- week navigation ---------- */
  function saveCurrentWeek(){
    var w = WEEKS[weekIdx];
    w.rows = state.rows;
    w.allow = state.allow;
    w.sugs = state.sugs;
    w.submitted = state.submitted;
    w.absences = ABSENCES;
  }
  function loadWeek(idx){
    weekIdx = idx;
    var w = WEEKS[weekIdx];
    WORKDATES = datesFor(w.start);
    DAYS = daysFor(WORKDATES);
    ABSENCES = w.absences;
    state.rows = w.rows;
    state.allow = w.allow || (w.allow = []);
    state.sugs = w.sugs;
    state.submitted = w.submitted;
    state.deviationNote = w.deviationNote || "";
  }
  /* My week's own arrows step by month for consulting (changeWeek below);
     the Team screen's arrows (prevW2/nextW2) call this directly instead,
     because a leader stepping through the team's log week by week isn't
     the same navigation as the monthly My week view, even though both
     screens read the same underlying "current week". */
  function changeWeekByOne(delta){
    var range = teamWeekRange();
    var next = weekIdx + delta;
    if(next < range.lo || next > range.hi){
      toast(delta < 0 ? t("toast_no_earlier_weeks") : t("toast_no_later_weeks"));
      return;
    }
    saveCurrentWeek();
    loadWeek(next);
    render();
  }
  /* Team's week-by-week navigator stays around today, six weeks back and
     four ahead, however far My week's month pager or a leave request
     reaches. */
  function teamWeekRange(){
    var cur = todayWeekIndex();
    return { lo: Math.max(0, cur - 6), hi: Math.min(WEEKS.length - 1, cur + 4) };
  }
  function changeWeek(delta){
    if(isMonthly()) return changeMonth(delta);
    return changeWeekByOne(delta);
  }
  function applyTemplate(){
    if(state.submitted) return;
    state.rows.forEach(function(r){
      for(var i=0; i<5; i++){ if(!r.h[i]) r.h[i] = PROJECTS[r.p].proj ? 1.5 : 0.5; }
    });
    state.needsSave = true;
    render();
    toast(t("toast_template_applied"), t("ui_undo"), function(){ location.reload(); });
  }
  /* ---------- company switch, demo of the IT0001 derivation ----------
     Changing the company is the same as opening the sheet as someone assigned
     to the other one. Nothing else decides the layout. */
  function seedClock(){
    seedClockRows(state.rows);
  }
  /* Shared by seedClock (the currently loaded week) and the PT02 sample
     data itself (every week, at definition time, see below): lays out
     start/end times sequentially from 8:00, for whichever rows have an
     hour value but no slot yet. Each row's own span bakes in the 1h lunch
     break slotHours() now always subtracts, so reading it back gives the
     same r.h[d] it started from. */
  function seedClockRows(rows){
    for(var d=0; d<7; d++){
      var cursor = 9*60;
      rows.forEach(function(r){
        if(!r.h[d] || slot(r,d)) return;
        var span = Math.round(r.h[d]*60) + LUNCH_MIN;
        setSlot(r, d, {b:cursor, e:cursor + span});
        cursor += span;
      });
    }
  }
  /* Approver identity and the sentence explaining whose queue this is -
     both depend on company (a different approver per company, like the
     approvals list itself) and on language, so this runs from both
     switchCompany and applyI18n rather than being a one-shot data-i18n. */
  function updateApproverChrome(){
    /* Timesheets are approved by project ownership: the project manager
       being tested sees the people on the projects they own, never their
       own sheet. */
    if(state.role === "pm"){
      var l = leaderById(state.leader);
      if($("apActingAs")) $("apActingAs").textContent = l.name + " · " + t("profile_pm") + ", " + pmProjectsLabel();
      if($("apSubText")) $("apSubText").textContent = t("text_approval_sub_pm", {projects: pmProjectsLabel()}) + " " + t(isMonthly() ? "text_approval_monthly" : "text_approval_weekly");
      return;
    }
    if($("apActingAs")) $("apActingAs").textContent = IT0001.bukrs === "PT02" ? "Patrícia Gomes · Operations Manager, Building Solutions" : "Sofia Almeida · Delivery Manager, Consulting";
    if($("apSubText")) $("apSubText").textContent = t(IT0001.bukrs === "PT02" ? "text_approval_sub_pt02" : "text_approval_sub");
  }
  /* The month a Consulting approver is closing: the current one from its
     last working week on (the month's timesheets come in at its end), the
     one before until then. */
  function approvalMonth(){
    var today = todayISO(), y = +today.slice(0,4), m = +today.slice(4,6);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if(+today.slice(6,8) <= last - 7){ m -= 1; if(!m){ m = 12; y -= 1; } }
    return "" + y + (m < 10 ? "0" : "") + m;
  }
  /* the weeks of a month with their working days (weekends and the
     company's holidays out), at the daily capacity each */
  function monthWeeksOf(ym, bukrs){
    var weeks = [], byNum = {};
    monthDatesFor(ym).forEach(function(d){
      if(weekdayOf(d) > 4 || holidayOn(d, bukrs)) return;
      var n = isoWeekOf(d);
      if(!byNum[n]){ byNum[n] = {n:n, from:d, to:d, exp:0}; weeks.push(byNum[n]); }
      byNum[n].to = d;
      byNum[n].exp += dailyCapFor();
    });
    return weeks;
  }
  function monthlyApprovals(list){
    var ym = approvalMonth();
    if(list._ym === ym) return list;
    list._ym = ym;
    var weeks = monthWeeksOf(ym, "PT01");
    list.forEach(function(a){
      a.weeks = weeks.map(function(w, i){ return {n:w.n, from:w.from, to:w.to, exp:w.exp, h:Math.max(0, w.exp - ((a.gaps || {})[i] || 0))}; });
      a.tot = a.weeks.reduce(function(x, w){ return x + w.h; }, 0);
      a.dev = a.tot - weeks.reduce(function(x, w){ return x + w.exp; }, 0);
      a.inproj = a.tot - (a.internal || 0);
    });
    return list;
  }
  function tsQueue(){
    if(state.approvals === APPROVALS_PT01) monthlyApprovals(APPROVALS_PT01);
    if(state.role !== "pm") return state.approvals;
    var l = leaderById(state.leader);
    var codes = l.projs.map(function(i){ return PROJECTS[i].code; });
    return state.approvals.filter(function(a){ return codes.indexOf(a.proj) !== -1 && a.who !== l.name; });
  }
  /* The projects the person under test actually works with: for the
     employee, the company's own plus the shared internal one (the same
     rule as the project pickers); for the project manager, the projects
     they own; the line manager books no time. The assistant is told
     exactly this list, so its answers match what the screen offers. */
  function profileProjects(){
    if(state.role === "pm") return leaderById(state.leader).projs.slice();
    if(state.role === "manager") return MANAGER_PROJECTS[IT0001.bukrs].slice();
    var out = [];
    PROJECTS.forEach(function(p, i){ if(p.bukrs === IT0001.bukrs || p.bukrs === null) out.push(i); });
    return out;
  }
  function pmProjectsLabel(){
    return leaderById(state.leader).projs.map(function(i){ return PROJECTS[i].code; }).join(", ");
  }
  function switchCompany(bukrs, quiet){
    if(bukrs === IT0001.bukrs) return;
    saveCurrentWeek();
    var curNum = WEEKS[weekIdx].num;
    IT0001.bukrs = bukrs;
    WEEKS = weeksOfCompany(bukrs);
    state.approvals = bukrs === "PT02" ? APPROVALS_PT02 : APPROVALS_PT01;
    updateApproverChrome();
    /* WEEKS_PT01 and WEEKS_PT02 no longer line up index for index - PT01
       alone has weeks either side for the monthly view - so land on the
       same week NUMBER in the new array, not the same array position;
       falling back to today's week if this company doesn't have that
       number at all. */
    var match = WEEKS.filter(function(w){ return w.num === curNum; })[0];
    loadWeek(match ? WEEKS.indexOf(match) : todayWeekIndex());
    if(isClock()) seedClock();
    renderLeaderOptions();
    renderContextButton();
    clearMass();
    render();
    if(quiet) return;
    var pf = profileFor(WORKDATES[0]);
    toast(t("toast_it0001_changed", {bukrs: bukrs, code: pf.code, fields: pf.fields.toLowerCase()}));
  }

  function togglePrivate(){
    state.privateMode = !state.privateMode;
    var cap = $("capture");
    cap.classList.toggle("off", state.privateMode);
    $("captureTxt").textContent = state.privateMode ? t("capture_off") : t("capture_on");
    render();
  }

  /* ---------- quick add ---------- */
  var nlParsed = null;
  function openQuick(prefill, day){
    var dlg = $("dlgQuick");
    $("nlq").value = prefill || "";
    if(typeof day === "number") $("nlq").dataset.day = day; else delete $("nlq").dataset.day;
    parseNL();
    dlg.showModal();
    setTimeout(function(){ $("nlq").focus(); },30);
  }
  function parseNL(){
    var txt = $("nlq").value;
    var box = $("nlChips");
    box.innerHTML = "";
    if(!txt.trim()){
      box.appendChild(chip(t("chip_waiting_text"),""));
      nlParsed = null;
      $("nlSave").disabled = true;
      return;
    }
    var rest = txt;
    var dur = NaN, m;
    if((m = rest.match(/(\d+(?:[.,]\d+)?)\s*h/i))){ dur = parseDur(m[1]); rest = rest.replace(m[0]," "); }
    else if((m = rest.match(/(\d{1,2}):(\d{2})/))){ dur = parseDur(m[0]); rest = rest.replace(m[0]," "); }
    else if((m = rest.match(/(\d+)\s*m(?:in)?\b/i))){ dur = parseDur(m[1]+"m"); rest = rest.replace(m[0]," "); }
    else if((m = rest.match(/(^|\s)(\d+(?:[.,]\d+)?)(\s|$)/))){ dur = parseDur(m[2]); rest = rest.replace(m[0]," "); }

    var day = $("nlq").dataset.day ? +$("nlq").dataset.day : 0;
    var dayLabel = null;
    var dmq = matchDayMention(" " + rest + " ");
    if(dmq && dmq.day !== -1){ day = dmq.day; dayLabel = DAYS[day]; rest = rest.replace(dmq.match, " "); }
    if(!dayLabel) dayLabel = DAYS[day];

    /* the same rule as the assistant: only the person's own projects */
    var pIdx = -1, notMine = "";
    var pmq = matchProject(" " + rest + " ");
    if(pmq){ rest = rest.replace(pmq.match, " "); if(pmq.notAllowed) notMine = PROJECTS[pmq.p].code; else pIdx = pmq.p; }
    var desc = rest.replace(/\s+/g," ").trim();

    box.appendChild(chipBtn(isNaN(dur) || !dur ? t("chip_duration_to_set") : fmt(dur)+" h", isNaN(dur) || !dur ? "warnc" : "okc", function(){
      /* Edited in the text itself: a window.prompt() is refused inside the
         claude.ai viewer, and the sentence is already the editable form. */
      var q = $("nlq");
      q.focus();
      q.select();
    }));
    box.appendChild(chipBtn(dayLabel, "okc", function(){
      $("nlq").value = nlText(dur, (day + 1) % 7, pIdx, desc);
      parseNL();
    }));
    box.appendChild(chipSelect(
      pIdx === -1 ? "" : String(pIdx),
      profileProjects().map(function(i){ return {value:String(i), label:PROJECTS[i].code + " · " + PROJECTS[i].name}; }),
      pIdx === -1 ? "warnc" : "okc",
      function(v){
        if(v === "") return;
        $("nlq").value = nlText(dur, day, +v, desc);
        parseNL();
      },
      t("chip_project_to_choose")
    ));
    if(notMine) box.appendChild(chip(t("chip_not_your_project", {code: notMine}), "warnc"));
    box.appendChild(chip(pIdx === -1 ? t("chip_activity_to_set") : PROJECTS[pIdx].act, pIdx === -1 ? "" : "okc"));
    if(pIdx !== -1) box.appendChild(chip(PROJECTS[pIdx].sap.rproj ? "PEP "+PROJECTS[pIdx].sap.rproj : t("bot_receiver_cost_center", {code: PROJECTS[pIdx].sap.rkostl}), "okc"));
    if(desc) box.appendChild(chip(t("chip_desc_prefix", {txt: desc.slice(0,42)}), "okc"));

    var rowDesc = pIdx === -1 ? "" : ((state.rows.filter(function(r){ return r.p === pIdx; })[0] || {}).desc || "");
    var descOk = desc.length >= 10 || String(rowDesc).trim().length >= 10;
    if(pIdx !== -1 && !descOk) box.appendChild(chip(t("hint_desc_min"), "warnc"));
    var ok = !isNaN(dur) && dur > 0 && pIdx !== -1 && descOk;
    nlParsed = ok ? {dur:round15(dur), day:day, p:pIdx, desc:desc} : null;
    $("nlSave").disabled = !ok;
  }
  /* Returns whether the entry was actually saved: the dialog is a native
     <form method="dialog">, which closes itself on any button click
     regardless of what the handler does, so the onclick wrapper below needs
     this to know when to preventDefault() and keep it open instead, rather
     than closing over a rejected save as if it had gone through. */
  function saveNL(){
    if(!nlParsed) return false;
    if(state.submitted){ toast(t("toast_week_submitted_locked")); return false; }
    if(isBlocked(nlParsed.day)){ toast(t("toast_day_absence_blocked", {day: DAYS[nlParsed.day]})); return false; }
    if(!periodOpen(WORKDATES[nlParsed.day])){ toast(t("toast_day_closed_period", {day: DAYS[nlParsed.day]})); return false; }
    /* the same daily limit as a grid cell (durCell): refused here, with
       the dialog left open, rather than flagged after it's saved */
    var cap = capacity(nlParsed.day), left = Math.max(0, cap - dayTotal(nlParsed.day));
    if(nlParsed.dur > left){
      var ap = absOn(nlParsed.day, "approved")[0];
      toast((ap ? t("msg_day_approved_type", {day: DAYS[nlParsed.day], type: absTypeLabel(ap).toLowerCase()}) : t("msg_day_capacity_simple", {day: DAYS[nlParsed.day], cap: fmt(cap)}))
        + (left > 0 ? t("toast_only_available", {left: fmt(left)}) : t("toast_no_hours_available")));
      return false;
    }
    var row = state.rows.filter(function(r){ return r.p === nlParsed.p; })[0];
    if(!row){ row = {id:nextId++, p:nlParsed.p, desc:nlParsed.desc, h:[0,0,0,0,0,0,0], origin:"Manual"}; state.rows.push(row); }
    if(nlParsed.desc) row.desc = nlParsed.desc;
    row.h[nlParsed.day] += nlParsed.dur;
    state.needsSave = true;
    render();
    toast(t("toast_hours_recorded", {h: fmt(nlParsed.dur), code: PROJECTS[nlParsed.p].code, day: DAYS[nlParsed.day]}));
    return true;
  }

  /* ---------- detail ---------- */
  var dtRow = null;
  /* Set instead of dtRow when the detail dialog is opened from the month
     grid: {monthRow, weeks}. A month row isn't one row object, it's one
     per week that happens to have hours against that project (see
     monthProjectRows/monthRowIn), so changing its project or description
     has to reach every one of them, not just whichever week is loaded. */
  var dtMonthCtx = null;
  /* Set instead of dtRow/dtMonthCtx when the detail dialog is opened from
     "Add row" to let the person pick which still-unused project the new
     row is for, rather than the app silently picking one: {eligible} for
     the week grid, {eligible, target, weeks, monthly:true} for the month
     grid (target is the week the new row is pushed into). */
  var dtNewRow = null;
  /* Fills the detail dialog's project <select> with one <option> per index
     in indices, "CODE · Name" - the name, not the WBS, since a non-project
     activity like AXI-INT has no WBS to show and the code alone isn't
     enough to tell apart two similarly-named projects while the list is
     still open (the WBS itself is still visible once something is picked,
     on the row above it, and in the dialog's own title). openDetail/
     openMonthDetail (every project) and openNewRowDetail/openNewMonthRowDetail
     (only the eligible ones) each built this same option list themselves. */
  /* Every line needs a description (val_desc_required), internal
     activities like AXI-INT included. Re-run on every project change and,
     since the dialog can stay open across a language switch, from
     applyI18n too. */
  function updateDescPlaceholder(pIdx){
    var desc = $("dtDesc");
    if(desc) desc.placeholder = t("placeholder_description");
  }
  function fillProjectOptions(pj, indices){
    pj.innerHTML = "";
    indices.forEach(function(i){
      var p = PROJECTS[i];
      var o = document.createElement("option");
      o.value = String(i); o.textContent = p.code + " · " + p.name;
      pj.appendChild(o);
    });
  }
  /* day is which calendar column was clicked, only meaningful for Z_BSRV
     (Building Solutions): that profile records start and end per day, not
     one duration for the week, so a day-specific click there needs to
     show that day's actual window, not the row's total. */
  function openDetail(r, day){
    dtRow = r;
    dtMonthCtx = null;
    dtNewRow = null;
    var pr = PROJECTS[r.p];
    $("dtTitle").textContent = pr.name;
    var pj = $("dtProj");
    fillProjectOptions(pj, PROJECTS.map(function(p,i){ return i; }));
    pj.value = String(r.p);
    pj.disabled = state.submitted;
    /* Activity type isn't its own choice here, it comes from whichever
       project is picked (each project has exactly one, in SAP terms its
       LSTAR), so it follows the project select instead of being a second,
       independent field that could disagree with it. */
    pj.onchange = function(){ $("dtAct").value = PROJECTS[+pj.value].act; setDetailBudgetAndAudit(+pj.value, ["row", r.id]); updateDescPlaceholder(+pj.value); };
    $("dtDur").value = fmt(rowTotal(r));
    $("dtDesc").value = r.desc;
    $("dtAct").value = pr.act;
    $("dtOrigin").textContent = originLabel(r.origin);
    setDetailBudgetAndAudit(r.p, ["row", r.id]);
    updateDescPlaceholder(r.p);
    var showClock = isClock() && typeof day === "number";
    $("dtStartField").hidden = !showClock;
    $("dtEndField").hidden = !showClock;
    if(showClock){
      var s = slot(r, day);
      $("dtStart").value = s && s.b !== null ? fmtClock(s.b) : "–";
      $("dtEnd").value = s && s.e !== null ? fmtClock(s.e % 1440) : "–";
    }
    var st = $("dtState");
    st.textContent = state.submitted ? t("state_in_approval") : t("state_draft");
    st.className = state.submitted ? "chip blue" : "chip grey";
    $("dtDesc").readOnly = state.submitted;
    $("dtDur").readOnly = true;
    $("dtSave").disabled = state.submitted;
    $("dlgDetail").showModal();
  }
  /* Same dialog, opened from a month-grid row instead: monthRow is the
     {p, desc} placeholder monthProjectRows() hands out, weeks is every
     week the visible month touches. There's no single row to point at
     (see dtMonthCtx above), so this reads the total and description live
     across whichever of those weeks actually has a row for the project. */
  function openMonthDetail(monthRow, weeks){
    dtRow = null;
    dtMonthCtx = {monthRow: monthRow, weeks: weeks};
    dtNewRow = null;
    var pr = PROJECTS[monthRow.p];
    var allSubmitted = weeks.every(function(w){ return w.submitted; });
    $("dtTitle").textContent = pr.name;
    var pj = $("dtProj");
    fillProjectOptions(pj, PROJECTS.map(function(p,i){ return i; }));
    pj.value = String(monthRow.p);
    pj.disabled = allSubmitted;
    pj.onchange = function(){ $("dtAct").value = PROJECTS[+pj.value].act; setDetailBudgetAndAudit(+pj.value, ["month", monthRow.p, weeks[0] ? weeks[0].num : 0]); updateDescPlaceholder(+pj.value); };
    updateDescPlaceholder(monthRow.p);
    var total = weeks.reduce(function(a,w){
      var r = monthRowIn(w, monthRow.p);
      return a + (r ? rowTotal(r) : 0);
    }, 0);
    $("dtDur").value = fmt(total);
    $("dtDesc").value = monthRow.desc || "";
    $("dtAct").value = pr.act;
    $("dtOrigin").textContent = t("val_manual");
    setDetailBudgetAndAudit(monthRow.p, ["month", monthRow.p, weeks[0] ? weeks[0].num : 0]);
    $("dtStartField").hidden = true;
    $("dtEndField").hidden = true;
    var st = $("dtState");
    st.textContent = allSubmitted ? t("state_in_approval") : t("state_draft");
    st.className = allSubmitted ? "chip blue" : "chip grey";
    $("dtDesc").readOnly = allSubmitted;
    $("dtDur").readOnly = true;
    $("dtSave").disabled = allSubmitted;
    $("dlgDetail").showModal();
  }
  /* Same dialog again, this time with no row behind it yet: opened from
     "Add row" so the person picks the project themselves instead of the
     app auto-assigning the first still-unused one. pj only lists eligible
     (not yet used this week/month, and belonging to this company or
     shared) projects, so there's nothing here saveDetail's clash-check
     would ever need to reject. */
  function openNewRowDetail(eligible){
    dtRow = null;
    dtMonthCtx = null;
    dtNewRow = {eligible: eligible};
    $("dtTitle").textContent = t("dlg_new_entry_title");
    var pj = $("dtProj");
    fillProjectOptions(pj, eligible);
    pj.value = String(eligible[0]);
    pj.disabled = false;
    pj.onchange = function(){ $("dtAct").value = PROJECTS[+pj.value].act; setDetailBudgetAndAudit(+pj.value, ["newrow", +pj.value]); updateDescPlaceholder(+pj.value); };
    $("dtDur").value = fmt(0);
    $("dtDesc").value = "";
    $("dtAct").value = PROJECTS[eligible[0]].act;
    $("dtOrigin").textContent = t("val_manual");
    setDetailBudgetAndAudit(eligible[0], ["newrow", eligible[0]]);
    updateDescPlaceholder(eligible[0]);
    $("dtStartField").hidden = true;
    $("dtEndField").hidden = true;
    var st = $("dtState");
    st.textContent = t("state_draft");
    st.className = "chip grey";
    $("dtDesc").readOnly = false;
    $("dtDur").readOnly = true;
    $("dtSave").disabled = false;
    $("dlgDetail").showModal();
  }
  function openNewMonthRowDetail(eligible, target, weeks){
    dtRow = null;
    dtMonthCtx = null;
    dtNewRow = {eligible: eligible, target: target, weeks: weeks, monthly: true};
    $("dtTitle").textContent = t("dlg_new_entry_title");
    var pj = $("dtProj");
    fillProjectOptions(pj, eligible);
    pj.value = String(eligible[0]);
    pj.disabled = false;
    pj.onchange = function(){ $("dtAct").value = PROJECTS[+pj.value].act; setDetailBudgetAndAudit(+pj.value, ["newmonthrow", +pj.value, weeks[0] ? weeks[0].num : 0]); updateDescPlaceholder(+pj.value); };
    $("dtDur").value = fmt(0);
    $("dtDesc").value = "";
    $("dtAct").value = PROJECTS[eligible[0]].act;
    $("dtOrigin").textContent = t("val_manual");
    setDetailBudgetAndAudit(eligible[0], ["newmonthrow", eligible[0], weeks[0] ? weeks[0].num : 0]);
    updateDescPlaceholder(eligible[0]);
    $("dtStartField").hidden = true;
    $("dtEndField").hidden = true;
    var st = $("dtState");
    st.textContent = t("state_draft");
    st.className = "chip grey";
    $("dtDesc").readOnly = false;
    $("dtDur").readOnly = true;
    $("dtSave").disabled = false;
    $("dlgDetail").showModal();
  }
  function saveNewRow(){
    var ctx = dtNewRow;
    if(!ctx) return;
    var p = +$("dtProj").value;
    var row = {id:nextId++, p:p, desc:$("dtDesc").value, h:[0,0,0,0,0,0,0], origin:"Manual"};
    if(ctx.monthly) ctx.target.rows.push(row);
    else state.rows.push(row);
    state.needsSave = true;
    dtNewRow = null;
    render();
    toast(t("toast_entry_added"));
    $("dlgDetail").close();
    if(ctx.monthly){
      var descs = document.querySelectorAll(".monthdesc");
      var last = descs[descs.length-1];
      if(last) last.focus();
    } else {
      var c = document.getElementById("c-"+row.id+"-0");
      if(c) c.focus();
    }
  }
  function saveDetail(){
    if(dtNewRow) return saveNewRow();
    if(dtMonthCtx) return saveMonthDetail();
    if(!dtRow) return;
    var pj = $("dtProj");
    if(pj && !pj.disabled){
      var newP = +pj.value;
      if(newP !== dtRow.p){
        /* Every other path that touches state.rows (addRow, Quick Add,
           the chat) keeps at most one row per project, finding-or-creating
           rather than ever duplicating one. Re-pointing this row at a
           project that already has its own row would break that, and
           silently merging the two could surprise someone who didn't ask
           for their hours combined - so this asks them to resolve it on
           the grid first instead. */
        var clash = state.rows.some(function(r){ return r !== dtRow && r.p === newP; });
        if(clash){
          toast(t("toast_row_exists_week", {code: PROJECTS[newP].code}));
          return;
        }
        dtRow.p = newP;
      }
    }
    dtRow.desc = $("dtDesc").value;
    state.needsSave = true;
    render();
    toast(t("toast_entry_updated"));
    $("dlgDetail").close();
  }
  /* Same clash rule as saveDetail, checked across every week the month
     row touches: re-pointing it at a project that already has its own
     row in ANY of those weeks would collide with monthRowIn() there. */
  function saveMonthDetail(){
    var ctx = dtMonthCtx;
    if(!ctx) return;
    var rows = ctx.weeks.map(function(w){ return monthRowIn(w, ctx.monthRow.p); }).filter(function(r){ return r; });
    var pj = $("dtProj");
    if(pj && !pj.disabled){
      var newP = +pj.value;
      if(newP !== ctx.monthRow.p){
        var clash = ctx.weeks.some(function(w){ return w.rows.some(function(r){ return r.p === newP; }); });
        if(clash){
          toast(t("toast_row_exists_month", {code: PROJECTS[newP].code}));
          return;
        }
        rows.forEach(function(r){ r.p = newP; });
      }
    }
    var newDesc = $("dtDesc").value;
    rows.forEach(function(r){ r.desc = newDesc; });
    state.needsSave = true;
    render();
    toast(t("toast_entry_updated"));
    $("dlgDetail").close();
  }

  /* ---------- submit ---------- */
  function openSubmitMonth(){
    var dates = activeMonthDates();
    var weeks = touchedWeeksFor(dates);
    var first = weeks[0];
    var ym = monthKeyOf(WEEKS[weekIdx]);
    var y = ym.slice(0,4), mIdx = +ym.slice(4,6) - 1;
    var monthName = monthFullName(mIdx);
    $("subTitle").textContent = t("dlg_submit_month_title", {month: monthName, y: y});
    /* only the days of this month, so the lines add up to the month total
       even when a week at either end runs into the next or previous month */
    var byP = {}, monthProj = 0;
    dates.forEach(function(d){
      var wd = weekDayFor(d);
      if(!wd) return;
      wd.week.rows.forEach(function(r){
        var h = r.h[wd.day] || 0;
        if(!h) return;
        var k = PROJECTS[r.p].code;
        if(!byP[k]) byP[k] = {name:PROJECTS[r.p].name, t:0, b:PROJECTS[r.p].proj, wbs:PROJECTS[r.p].sap.rproj || PROJECTS[r.p].sap.rkostl};
        byP[k].t += h;
        if(PROJECTS[r.p].proj) monthProj += h;
      });
    });
    var body = $("subBody");
    body.innerHTML = "";
    var sum = el("div","sum","");
    Object.keys(byP).forEach(function(k){
      var o = byP[k];
      var r = el("div","r","");
      r.appendChild(el("span","", o.name));
      r.appendChild(el("span","chip "+(o.b?"blue":"grey"), o.wbs));
      r.appendChild(el("span","n", fmt(o.t)+" h"));
      sum.appendChild(r);
    });
    var tr = el("div","r t","");
    tr.appendChild(el("span","",t("label_month_total")));
    tr.appendChild(el("span","", t("text_h_in_project", {h: fmt(monthProj)})));
    tr.appendChild(el("span","n", fmt(monthTotalHours(dates))+" h"));
    sum.appendChild(tr);
    body.appendChild(sum);
    var apm = submitApproverLine(weeks.reduce(function(a, w){ return a.concat(w.rows); }, []));
    if(apm) body.appendChild(apm);

    var warns = [];
    weeks.forEach(function(w){
      withWeek(w, function(){ validate().filter(function(m){ return m.sev === "w"; }).forEach(function(m){ warns.push({week:w, txt:m.txt}); }); });
    });
    if(warns.length){
      var wDiv = el("div","","");
      wDiv.innerHTML = "<div class='field'><label>"+plural(warns.length, "n_warnings_no_block")+"</label></div>";
      var ul = el("div","sum","");
      warns.forEach(function(m){
        var r = el("div","r","");
        r.appendChild(el("span","", t("val_week_label_prefix", {n: isoWeekOf(m.week.start), txt: m.txt})));
        r.appendChild(el("span","chip amber",t("chip_warning_lower")));
        r.appendChild(el("span","",""));
        ul.appendChild(r);
      });
      wDiv.appendChild(ul);
      body.appendChild(wDiv);
      var f = el("div","field","");
      f.innerHTML = "<label for='subWhy'>"+t("label_deviation_justification")+"</label><textarea id='subWhy' placeholder=\""+t("placeholder_justification_month")+"\"></textarea>";
      body.appendChild(f);
      $("subWhy").value = first.deviationNote || "";
    }
    $("dlgSubmit").showModal();
  }
  /* Submitting is the save: the hours go to approval as they are, there
     is no second step after it. In Consulting the whole month goes at
     once, every week of it still open; a week already submitted stays as
     it was, and Reopen gives back only the weeks this submission took. */
  function openMonthWeeks(){
    return activeMonthWeeks().filter(function(w){ return !w.submitted && !(w === WEEKS[weekIdx] && state.submitted); });
  }
  function submitMonthNow(note){
    var weeks = openMonthWeeks();
    weeks.forEach(function(w){ w.deviationNote = note; w.submitted = true; });
    state.submitted = true;
    state.needsSave = false;
    state.deviationNote = note;
    render();
    toast(plural(weeks.length, "weeks_submitted_approval"), t("ui_reopen"), function(){
      weeks.forEach(function(w){ w.submitted = false; });
      state.submitted = !!WEEKS[weekIdx].submitted;
      render();
    });
  }
  function doSubmitMonth(){
    var why = $("subWhy");
    $("dlgSubmit").close();
    submitMonthNow(why ? why.value.trim() : "");
  }
  /* Who approves the hours: the owner of each project, as for everyone;
     a project manager's hours on their own project, and all of the line
     manager's, go one level up instead. */
  function timesheetApprovers(projIdxs){
    var me = selfId(), names = [];
    projIdxs.forEach(function(p){
      var name;
      if(state.role === "manager") name = approverFor(me).name;
      else {
        var owner = LEADERS.filter(function(l){ return l.bukrs === IT0001.bukrs && l.projs.indexOf(p) !== -1; })[0];
        var ownerM = owner && TEAM.filter(function(m){ return m.leaderOf === owner.id; })[0];
        name = !owner || (ownerM && ownerM.pernr === me) ? approverFor(me).name : owner.name;
      }
      if(names.indexOf(name) === -1) names.push(name);
    });
    return names;
  }
  function rowsProjects(rowsList){
    var ps = [];
    rowsList.forEach(function(r){ if(r.h.some(function(v){ return v > 0; }) && ps.indexOf(r.p) === -1) ps.push(r.p); });
    return ps;
  }
  function submitApproverLine(rowsList){
    var names = timesheetApprovers(rowsProjects(rowsList));
    return names.length ? el("p","sub", t("text_submit_approvers", {names: names.join(", ")})) : null;
  }
  function openSubmit(){
    if(isMonthly()) return openSubmitMonth();
    $("subTitle").textContent = t("dlg_submit_week_title", {n: isoWeekOf(WEEKS[weekIdx].start)});
    var byP = {};
    state.rows.forEach(function(r){
      var t = rowTotal(r);
      if(!t) return;
      var k = PROJECTS[r.p].code;
      if(!byP[k]) byP[k] = {name:PROJECTS[r.p].name, t:0, b:PROJECTS[r.p].proj, wbs:PROJECTS[r.p].sap.rproj || PROJECTS[r.p].sap.rkostl};
      byP[k].t += t;
    });
    var body = $("subBody");
    body.innerHTML = "";
    var sum = el("div","sum","");
    Object.keys(byP).forEach(function(k){
      var o = byP[k];
      var r = el("div","r","");
      r.appendChild(el("span","", o.name));
      r.appendChild(el("span","chip "+(o.b?"blue":"grey"), o.wbs));
      r.appendChild(el("span","n", fmt(o.t)+" h"));
      sum.appendChild(r);
    });
    var tr = el("div","r t","");
    tr.appendChild(el("span","",t("label_week_total")));
    tr.appendChild(el("span","", t("text_h_in_project", {h: fmt(projTotal())})));
    tr.appendChild(el("span","n", fmt(weekTotal())+" h"));
    sum.appendChild(tr);
    body.appendChild(sum);
    var apw = submitApproverLine(state.rows);
    if(apw) body.appendChild(apw);

    var warns = validate().filter(function(m){ return m.sev === "w"; });
    if(warns.length){
      var w = el("div","","");
      w.innerHTML = "<div class='field'><label>"+plural(warns.length, "n_warnings_no_block")+"</label></div>";
      var ul = el("div","sum","");
      warns.forEach(function(m){
        var r = el("div","r","");
        r.appendChild(el("span","", m.txt));
        r.appendChild(el("span","chip amber",t("chip_warning_lower")));
        r.appendChild(el("span","",""));
        ul.appendChild(r);
      });
      w.appendChild(ul);
      body.appendChild(w);
      var f = el("div","field","");
      f.innerHTML = "<label for='subWhy'>"+t("label_deviation_justification")+"</label><textarea id='subWhy' placeholder=\""+t("placeholder_justification_week")+"\"></textarea>";
      body.appendChild(f);
      $("subWhy").value = state.deviationNote || "";
    }
    $("dlgSubmit").showModal();
  }
  function submitWeekNow(note){
    state.deviationNote = note;
    WEEKS[weekIdx].deviationNote = note;
    state.submitted = true;
    state.needsSave = false;
    render();
    toast(t("toast_week_submitted_approval", {n: isoWeekOf(WEEKS[weekIdx].start)}), t("ui_reopen"), function(){ state.submitted = false; render(); });
  }
  function doSubmit(){
    if(isMonthly()) return doSubmitMonth();
    var why = $("subWhy");
    $("dlgSubmit").close();
    submitWeekNow(why ? why.value.trim() : "");
  }

  /* ---------- approvals ---------- */
  function renderApprovals(){
    var body = $("apBody");
    if(!body) return;
    body.innerHTML = "";
    var clean = tsQueue().filter(function(a){ return !a.warn; });
    var flagged = tsQueue().filter(function(a){ return a.warn; });
    var apHours = $("apHours");
    if(apHours) apHours.innerHTML = fmt(tsQueue().reduce(function(a,x){ return a+x.tot; }, 0)) + "<small> h</small>";
    var apDev = $("apDev");
    if(apDev){
      var dev = tsQueue().reduce(function(a,x){ return a+x.dev; }, 0);
      apDev.innerHTML = (dev>0?"+":"") + fmt(dev) + "<small> h</small>";
    }

    /* Approved rows leave the list by default: the queue shows what is
       still to approve, and "All" brings the approved ones back, read only. */
    var showAll = state.apFilter === "all";
    var visible = function(a){ return showAll || !a.approved; };
    Array.prototype.forEach.call(document.querySelectorAll("#apFilter button"), function(b){
      b.setAttribute("aria-pressed", (b.dataset.f === "all") === showAll ? "true" : "false");
    });
    function group(title, list, cls){
      list = list.filter(visible);
      if(!list.length) return;
      var gh = document.createElement("tr");
      gh.className = "grouphead";
      var td = document.createElement("td");
      td.colSpan = 7; td.textContent = title;
      gh.appendChild(td); body.appendChild(gh);
      list.forEach(function(a){
        var tr = document.createElement("tr");
        var c1 = document.createElement("td");
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!a.sel && !a.approved; cb.disabled = !!a.warn || !!a.approved;
        cb.setAttribute("aria-label",t("aria_select_timesheet_for", {name: a.who}));
        cb.onchange = function(){ a.sel = cb.checked; renderApprovals(); };
        c1.appendChild(cb); tr.appendChild(c1);
        var c2 = document.createElement("td");
        var whoBtn = document.createElement("button");
        whoBtn.type = "button";
        whoBtn.className = "apwho";
        whoBtn.setAttribute("aria-expanded", a.expanded ? "true" : "false");
        whoBtn.innerHTML = "<span class='apchev'>"+(a.expanded ? "▾" : "▸")+"</span><span><div class='who'>"+a.who+"</div><div class='sub'>"+a.role+"</div></span>";
        whoBtn.onclick = function(){ a.expanded = !a.expanded; renderApprovals(); };
        c2.appendChild(whoBtn);
        tr.appendChild(c2);
        tr.appendChild(td2(a.proj, "num"));
        tr.appendChild(td2(fmt(a.tot)+" h","n"));
        tr.appendChild(td2(fmt(a.inproj)+" h","n"));
        tr.appendChild(td2((a.dev>0?"+":"")+fmt(a.dev)+" h","n"));
        var c7 = document.createElement("td");
        c7.innerHTML = a.warn
          ? "<span class='chip amber'>"+approvalNoteLabel(a.note)+"</span>"
          : (a.approved ? "<span class='chip green'>"+t("chip_approved")+"</span>" : "<span class='chip blue'>"+t("chip_in_approval")+"</span>");
        tr.appendChild(c7);
        body.appendChild(tr);
        if(a.expanded){
          var dtr = document.createElement("tr");
          dtr.className = "apdetail";
          var dtd = document.createElement("td");
          dtd.colSpan = 7;
          var wrap = document.createElement("div");
          wrap.className = "apdays";
          if(a.weeks) a.weeks.forEach(function(w){
            var d = document.createElement("span");
            d.className = "apday" + (w.h < w.exp ? " empty" : "");
            d.textContent = t("ap_week_chip", {n: w.n, from: w.from.slice(6,8) + "/" + w.from.slice(4,6), to: w.to.slice(6,8) + "/" + w.to.slice(4,6), h: fmt(w.h), exp: fmt(w.exp)});
            wrap.appendChild(d);
          });
          else (a.days || []).forEach(function(h, i){
            var d = document.createElement("span");
            d.className = "apday" + (h ? "" : " empty");
            d.textContent = WEEKDAY_ABBR[i] + " " + (h ? fmt(h)+"h" : "–");
            wrap.appendChild(d);
          });
          dtd.appendChild(wrap);
          dtr.appendChild(dtd);
          body.appendChild(dtr);
        }
      });
    }
    group(t("hdr_no_warnings_group"), clean);
    group(t("hdr_exceptions_group"), flagged);
    if(!body.children.length){
      var er = document.createElement("tr");
      var et = td2(t("text_ap_none_pending"), "sub");
      et.colSpan = 7;
      er.appendChild(et);
      body.appendChild(er);
    }
    var cleanLeft = clean.filter(function(a){ return !a.approved; }).length;
    $("apSelClean").textContent = plural(cleanLeft, "btn_select_clean");
    $("apSelClean").disabled = cleanLeft === 0;
    $("apAll").disabled = cleanLeft === 0;
    if(!cleanLeft) $("apAll").checked = false;

    if($("apWeekLabel")){
      var aym = approvalMonth();
      $("apWeekLabel").textContent = IT0001.bukrs === "PT01"
        ? t("label_approval_month", {month: monthFullName(+aym.slice(4,6) - 1) + " " + aym.slice(0,4)})
        : t("label_approval_week", {n: isoWeekOf(isoAdd(mondayOf(todayISO()), -7))});
    }
    var sel = tsQueue().filter(function(a){ return a.sel && !a.approved; }).length;
    $("apSel").textContent = plural(sel, "n_selected");
    $("apApprove").disabled = sel === 0;
    var pend = tsQueue().filter(function(a){ return !a.approved; }).length;
    $("apPend").textContent = pend;
    $("apWarn").textContent = flagged.filter(function(a){ return !a.approved; }).length;
    /* the tab counts read the same queue: an approval updates them at once */
    renderNavBadges();
  }
  function td2(txt, cls){ var td = document.createElement("td"); td.className = cls || ""; td.textContent = txt; return td; }

  /* ---------- helpers ---------- */
  function el(tag, cls, txt){ var n = document.createElement(tag); if(cls) n.className = cls; if(txt) n.textContent = txt; return n; }
  function btn(txt, cls, fn){ var b = document.createElement("button"); b.className = cls || "btn"; b.textContent = txt; if(fn) b.onclick = fn; return b; }
  function chip(txt, cls){ var s = document.createElement("span"); s.className = "pchip " + (cls||""); s.textContent = txt; return s; }
  function chipBtn(txt, cls, fn){ var b = document.createElement("button"); b.type = "button"; b.className = "pchip clickable " + (cls||""); b.textContent = txt; b.onclick = fn; return b; }
  /* A picklist styled as a chip, for the one place (Quick Add) that used to
     ask for a project code via window.prompt(): free text, no list of what's
     valid, easy to typo. options is [{value, label}]; placeholder, when
     given, is an extra unselectable first option for "nothing chosen yet". */
  function chipSelect(value, options, cls, fn, placeholder){
    var s = document.createElement("select");
    s.className = "pchip clickable " + (cls||"");
    if(placeholder){
      var ph = document.createElement("option");
      ph.value = ""; ph.textContent = placeholder; ph.disabled = true;
      if(value === "") ph.selected = true;
      s.appendChild(ph);
    }
    options.forEach(function(o){
      var opt = document.createElement("option");
      opt.value = o.value; opt.textContent = o.label;
      if(o.value === value) opt.selected = true;
      s.appendChild(opt);
    });
    s.onchange = function(){ fn(s.value); };
    return s;
  }
  function dayWordFor(day){ var names = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]; return names[day] !== undefined ? names[day] : names[2]; }
  function nlText(dur, day, pIdx, desc){
    var parts = [];
    if(!isNaN(dur) && dur > 0) parts.push(fmt(dur)+"h");
    parts.push(dayWordFor(day));
    if(pIdx !== -1) parts.push(PROJECTS[pIdx].code.split("-")[0]);
    if(desc) parts.push(desc);
    return parts.join(" ");
  }
  function toast(txt, actionLabel, fn){
    var box = $("toasts");
    var t = el("div","toast","");
    t.appendChild(el("span","", txt));
    if(actionLabel){ t.appendChild(btn(actionLabel,"", function(){ fn(); box.removeChild(t); })); }
    box.appendChild(t);
    setTimeout(function(){ if(t.parentNode) box.removeChild(t); }, 8000);
  }
  /* A number changing inside an existing cell (an assistant entry merges
     into whatever that project/day already had) is easy to miss, there's
     no new row to draw the eye. Scrolls to the exact cell that changed and
     flashes it, so "did that actually save?" has an obvious answer. */
  function flashCell(rowId, day){
    var cell = document.getElementById("c-"+rowId+"-"+day);
    if(!cell) return;
    cell.scrollIntoView({block:"center", behavior:"smooth"});
    cell.classList.remove("just-saved");
    void cell.offsetWidth;
    cell.classList.add("just-saved");
    setTimeout(function(){ cell.classList.remove("just-saved"); }, 1800);
  }

  /* ---------- wiring ---------- */
  $("addRow").onclick = addRow;
  $("copyWeek").onclick = copyWeek;
  $("tplBtn").onclick = applyTemplate;
  $("quickBtn").onclick = function(){ openQuick("", 2); };
  $("submitBtn").onclick = openSubmit;
  if($("saveBtn")) $("saveBtn").onclick = saveChanges;
  $("sugChip").onclick = function(){ $("sugPanel").scrollIntoView({block:"center"}); };
  $("acceptHi").onclick = function(){
    var hi = visibleSugs().filter(function(s){ return s.conf === "hi"; });
    if(!hi.length) return;
    toast(sugsSummary(acceptSugs(hi)));
  };
  $("vGrid").onclick = function(){ setView(true); };
  $("vCal").onclick = function(){ setView(false); };
  function setView(grid){
    $("viewGrid").hidden = !grid; $("viewCal").hidden = grid;
    $("vGrid").setAttribute("aria-pressed", grid ? "true" : "false");
    $("vCal").setAttribute("aria-pressed", grid ? "false" : "true");
    if($("addRow")) $("addRow").hidden = !grid;
  }
  function saveChanges(){
    state.needsSave = false;
    render();
    toast(t("toast_changes_saved"));
  }
  $("nlq").addEventListener("input", parseNL);
  $("nlSave").onclick = function(ev){ if(!saveNL()) ev.preventDefault(); };
  $("dtSave").onclick = saveDetail;
  $("dtCancel").onclick = function(){ dtNewRow = null; $("dlgDetail").close(); };
  $("subCancel").onclick = function(){ $("dlgSubmit").close(); };
  $("subOk").onclick = doSubmit;
  $("dataBtn").onclick = function(){ $("dlgData").showModal(); };
  $("dataClose").onclick = function(){ $("dlgData").close(); };
  $("dataWipe").onclick = function(){ $("dlgData").close(); state.sugs.length = 0; render(); toast(t("toast_timeline_deleted")); };
  $("helpBtn").onclick = function(){ $("dlgHelp").showModal(); };
  $("helpClose").onclick = function(){ $("dlgHelp").close(); };
  if($("settingsBtn")) $("settingsBtn").onclick = function(){
    ["pt","en","fr"].forEach(function(l){
      var b = $("lang" + l.toUpperCase());
      if(b) b.setAttribute("aria-pressed", state.lang === l ? "true" : "false");
    });
    $("dlgSettings").showModal();
  };
  if($("settingsClose")) $("settingsClose").onclick = function(){ $("dlgSettings").close(); };
  ["langPT","langEN","langFR"].forEach(function(id){
    var b = $(id);
    if(!b) return;
    b.onclick = function(){ setLang(b.getAttribute("data-lang")); $("dlgSettings").close(); };
  });
  $("prevW").onclick = function(){ changeWeek(-1); };
  $("nextW").onclick = function(){ changeWeek(1); };
  if($("prevW2")) $("prevW2").onclick = function(){ changeWeekByOne(-1); };
  if($("nextW2")) $("nextW2").onclick = function(){ changeWeekByOne(1); };

  $("fTbl").onclick = function(){ setFmt(true); };
  $("fPay").onclick = function(){ setFmt(false); };
  function setFmt(tbl){
    $("catsTable").hidden = !tbl; $("catsPayload").hidden = tbl;
    $("fTbl").setAttribute("aria-pressed", tbl ? "true" : "false");
    $("fPay").setAttribute("aria-pressed", tbl ? "false" : "true");
  }

  $("apAll").onchange = function(){
    var on = $("apAll").checked;
    tsQueue().forEach(function(a){ if(!a.warn && !a.approved) a.sel = on; });
    renderApprovals();
  };
  $("apSelClean").onclick = function(){
    tsQueue().forEach(function(a){ if(!a.warn && !a.approved) a.sel = true; });
    renderApprovals();
  };
  Array.prototype.forEach.call(document.querySelectorAll("#apFilter button"), function(b){
    b.onclick = function(){ state.apFilter = b.dataset.f; renderApprovals(); };
  });
  $("apApprove").onclick = function(){
    var n = 0;
    tsQueue().forEach(function(a){ if(a.sel && !a.approved){ a.approved = true; n++; } a.sel = false; });
    $("apAll").checked = false;
    renderApprovals();
    toast(t("toast_timesheets_approved", {n: n}));
  };

  /* One way to change screen, from the tabs, the assistant or Settings. The
     SAP mapping has no tab: it's a technical reference, opened from
     Settings, with a Back button to wherever the person was. */
  /* Two levels of tabs: the areas on top (the assistant, Timesheet and
     Leave Request), and under the open area a second row with its own
     tabs. An area opens on the tab last used in it, or its first one; the
     second row only shows when the area has more than one tab for this
     profile, otherwise the area tab alone says where the person is. */
  var NAV_AREA = {semana:"ts", team:"ts", aprov:"ts", leave:"lv", teamcal:"lv", lvaprov:"lv"};
  function areaTabs(area){
    return Array.prototype.filter.call(document.querySelectorAll("#navg-" + area + " button[data-screen]"), function(b){ return !b.hidden; });
  }
  function areaEntry(area){
    var tabs = areaTabs(area), last = state.areaLast[area];
    if(last && tabs.some(function(b){ return b.dataset.screen === last; })) return last;
    return tabs.length ? tabs[0].dataset.screen : null;
  }
  function syncNavAreas(){
    var cur = NAV_AREA[state.screen] || null;
    ["ts","lv"].forEach(function(area){
      var tabs = areaTabs(area), ab = $("area-" + area), row = $("navg-" + area);
      if(ab){ ab.hidden = !tabs.length; ab.setAttribute("aria-current", cur === area ? "true" : "false"); ab.setAttribute("aria-selected", cur === area ? "true" : "false"); ab.setAttribute("aria-expanded", cur === area ? "true" : "false"); }
      if(row) row.hidden = cur !== area || tabs.length < 2;
    });
  }
  function showScreen(s){ return inUiLang(function(){ showScreenNow(s); }); }
  function showScreenNow(s){
    if(s === "cats" && state.screen !== "cats") state.prevScreen = state.screen;
    Array.prototype.forEach.call(document.querySelectorAll("#appbar button[data-screen]"), function(x){ x.setAttribute("aria-current", x.dataset.screen === s ? "true" : "false"); x.setAttribute("aria-selected", x.dataset.screen === s ? "true" : "false"); });
    ["home","semana","leave","teamcal","lvaprov","team","aprov","cats"].forEach(function(k){ $("screen-"+k).hidden = k !== s; });
    state.screen = s;
    if(NAV_AREA[s]) state.areaLast[NAV_AREA[s]] = s;
    syncNavAreas();
    placeAssistant(s);
    if(s === "cats"){ renderCats(); renderLeaveMap(); }
    if(s === "team") renderTeam();
    if(s === "leave") renderLeave();
    if(s === "lvaprov") renderLeaveApprovals();
    if(s === "teamcal") renderTeamCalendar();
    if(s === "home") renderHome();
    window.scrollTo({top:0});
  }
  Array.prototype.forEach.call(document.querySelectorAll("#appbar button[data-screen]"), function(b){
    b.onclick = function(){ showScreen(b.dataset.screen); };
  });
  Array.prototype.forEach.call(document.querySelectorAll("#appbar button[data-area]"), function(b){
    b.onclick = function(){ var s = areaEntry(b.dataset.area); if(s) showScreen(s); };
  });
  if($("openMapping")) $("openMapping").onclick = function(){ $("dlgSettings").close(); showScreen("cats"); };
  if($("catsBack")) $("catsBack").onclick = function(){
    var back = state.prevScreen && profileHasScreen(state.prevScreen) ? state.prevScreen : "home";
    showScreen(back);
  };

  /* ---------- Leave Request, a mask over the standard ----------
     The application has no absence logic of its own. Every read and write
     goes through the standard Leave Request services, the same ones the
     standard My Leave Requests app (F1311A) uses: HCMFAB_LEAVE_REQUEST_CR_SRV
     to create, read and withdraw requests and to read balances and absence
     types, and the standard workflow (WS12300111, one approval step, the
     direct manager from the org structure) decided through TASKPROCESSING,
     the My Inbox service. Requests live in PTARQ (PTREQ_HEADER, PTREQ_ITEMS)
     and RPTARQPOST posts the approved ones to IT2001, where CATS reads them.
     The sample objects below carry the same field names as the OData
     entities, so the swap to the real service is a change of data source,
     not of model. Only the employee's requests (LEAVE) and the direct
     reports' requests a manager sees (LEAVE_TEAM) are kept, per company,
     like WEEKS and the approval queues. */
  var ABSENCE_TYPES = [
    {code:"0100", name:"Vacation",            quota:true,  partial:true,  attach:""},
    {code:"0210", name:"Medical appointment", quota:false, partial:true,  attach:"required"},
    {code:"0200", name:"Sick leave",          quota:false, partial:false, attach:"required"},
    {code:"0300", name:"Training",            quota:false, partial:true,  attach:""},
    {code:"0400", name:"Justified absence",   quota:false, partial:true,  attach:"required"}
  ];
  function absType(code){ return ABSENCE_TYPES.filter(function(x){ return x.code === code; })[0] || null; }
  /* the document an absence type needs attached */
  function attachDoc(ty){ return ty ? t("attach_doc_" + ty.code) : ""; }
  /* Absence type texts are language dependent in SAP (T554T), so unlike
     the rest of the sample master data they follow the interface language. */
  function absTypeLabel(a){
    var ty = absType(a && (a.awart || a.AbsenceTypeCode));
    return ty ? t("abs_" + ty.code) : (a && a.type) || "";
  }
  /* Direct manager from the org structure (OM), the one approval step of
     the standard workflow. Not the project owner: that scope is for hours. */
  var LINE_MANAGER = {
    PT01:{pernr:"00100210", name:"Sofia Almeida",  role:"Delivery Manager, Consulting"},
    PT02:{pernr:"00100320", name:"Patrícia Gomes", role:"Operations Manager, Building Solutions"}
  };
  function lineManager(){ return LINE_MANAGER[IT0001.bukrs] || LINE_MANAGER.PT01; }
  /* The line manager's own manager, who approves the line manager's leave. */
  var MANAGER_OF = {
    PT01:{name:"Henrique Vaz", role:"Director, Consulting"},
    PT02:{name:"Teresa Moura", role:"Director, Building Solutions"}
  };
  /* Whoever is testing, for their own leave: the employee, the project
     manager under test, or the line manager. */
  function selfId(){
    if(state.role === "pm"){
      var me = TEAM.filter(function(x){ return x.leaderOf === state.leader; })[0];
      return me ? me.pernr : PERNR;
    }
    if(state.role === "manager") return lineManager().pernr;
    return PERNR;
  }
  /* who approves someone's leave: the line manager, or for the line
     manager themselves, the next level up */
  function approverFor(id, bukrs){
    var b = bukrs || IT0001.bukrs;
    return id === LINE_MANAGER[b].pernr ? MANAGER_OF[b] : LINE_MANAGER[b];
  }
  /* Vacation quota (IT2006), read through TimeAccountSet. usedBefore is
     what was taken earlier in the year, before the sample weeks begin. */
  var QUOTA = {
    PT01:{year:2026, entitlement:22, carryover:3, usedBefore:4},
    PT02:{year:2026, entitlement:22, carryover:2, usedBefore:8}
  };
  var LEAVE = {PT01:[], PT02:[]};
  /* Day d (0 = Monday) of the week wk weeks after the current one: the
     sample requests keep the same place relative to today, whenever the
     mockup is opened. */
  function weekDay(wk, d){ return isoAdd(mondayOf(todayISO()), wk*7 + d); }
  var LEAVE_TEAM = {
    PT01:[
      {RequestID:"4500391", EmployeeID:"00104401", EmployeeName:"Ana Ferreira", role:"Senior consultant", AbsenceTypeCode:"0100", StartDate:weekDay(3,0), EndDate:weekDay(3,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"Family trip"},
      {RequestID:"4500388", EmployeeID:"00104402", EmployeeName:"Bruno Matos", role:"Consultant", AbsenceTypeCode:"0210", StartDate:weekDay(1,2), EndDate:weekDay(1,2), partial:true, hours:3, StartTime:"14:00", EndTime:"17:00", StatusID:"SENT", Notes:"Dentist", Attachment:"declaracao_presenca.pdf"},
      {RequestID:"4500395", EmployeeID:"00104404", EmployeeName:"Diogo Sousa", role:"Junior consultant", AbsenceTypeCode:"0300", StartDate:weekDay(2,0), EndDate:weekDay(2,1), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"S/4HANA certification course"},
      {RequestID:"4500393", EmployeeID:"00104403", EmployeeName:"Carla Nunes", role:"Consultant", AbsenceTypeCode:"0100", StartDate:weekDay(8,0), EndDate:weekDay(8,3), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"Christmas"},
      {RequestID:"4500372", EmployeeID:"00104405", EmployeeName:"Eva Lopes", role:"Architect", AbsenceTypeCode:"0100", StartDate:weekDay(3,0), EndDate:weekDay(3,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:""}
    ],
    PT02:[
      {RequestID:"4500396", EmployeeID:"00104510", EmployeeName:"Nuno Dias", role:"Technician", AbsenceTypeCode:"0100", StartDate:weekDay(4,0), EndDate:weekDay(4,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:""},
      {RequestID:"4500389", EmployeeID:"00104528", EmployeeName:"Luís Teixeira", role:"Technician", AbsenceTypeCode:"0210", StartDate:weekDay(1,3), EndDate:weekDay(1,3), partial:true, hours:3, StartTime:"14:00", EndTime:"17:00", StatusID:"SENT", Notes:"Physiotherapy", Attachment:"declaracao_presenca.pdf"},
      {RequestID:"4500397", EmployeeID:"00104530", EmployeeName:"Ana Pires", role:"Technician", AbsenceTypeCode:"0100", StartDate:weekDay(9,0), EndDate:weekDay(9,3), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"Christmas"},
      {RequestID:"4500380", EmployeeID:"00104512", EmployeeName:"Hugo Matos", role:"Technician", AbsenceTypeCode:"0100", StartDate:weekDay(4,1), EndDate:weekDay(4,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:""}
    ]
  };
  /* The line manager's direct reports, from the org structure, each with
     a vacation account (IT2006, read through TimeAccountSet): entitlement,
     days carried over from last year and days taken before the sample's
     own requests. The employee under test is one of them. */
  var DIRECT_REPORTS = {
    PT01:[
      {EmployeeID:PERNR, name:EMPLOYEE_NAME, role:"Consultant"},
      {EmployeeID:"00104401", name:"Ana Ferreira", role:"Senior consultant", entitlement:22, carryover:3, usedBefore:4},
      {EmployeeID:"00104402", name:"Bruno Matos", role:"Consultant", entitlement:22, carryover:0, usedBefore:8},
      {EmployeeID:"00104403", name:"Carla Nunes", role:"Consultant", entitlement:22, carryover:1, usedBefore:13},
      {EmployeeID:"00104404", name:"Diogo Sousa", role:"Junior consultant", entitlement:22, carryover:2, usedBefore:7},
      {EmployeeID:"00104405", name:"Eva Lopes", role:"Architect", entitlement:22, carryover:3, usedBefore:11},
      {EmployeeID:"00104406", name:"Filipe Reis", role:"Consultant", entitlement:22, carryover:0, usedBefore:7},
      {EmployeeID:"00104540", name:"Ricardo Nunes", role:"Project manager", entitlement:22, carryover:2, usedBefore:10},
      {EmployeeID:"00104541", name:"Pedro Alves", role:"Project manager", entitlement:22, carryover:1, usedBefore:12}
    ],
    PT02:[
      {EmployeeID:PERNR, name:EMPLOYEE_NAME, role:"Consultant"},
      {EmployeeID:"00104510", name:"Nuno Dias", role:"Technician", entitlement:22, carryover:2, usedBefore:7},
      {EmployeeID:"00104528", name:"Luís Teixeira", role:"Technician", entitlement:22, carryover:0, usedBefore:12},
      {EmployeeID:"00104530", name:"Ana Pires", role:"Technician", entitlement:22, carryover:1, usedBefore:14},
      {EmployeeID:"00104512", name:"Hugo Matos", role:"Technician", entitlement:22, carryover:2, usedBefore:14},
      {EmployeeID:"00104511", name:"Hélder Rocha", role:"Technician", entitlement:22, carryover:0, usedBefore:6},
      {EmployeeID:"00104542", name:"Carlos Pinto", role:"Project manager", entitlement:22, carryover:0, usedBefore:11},
      {EmployeeID:"00104543", name:"Marco Silva", role:"Project manager", entitlement:22, carryover:3, usedBefore:9}
    ]
  };
  /* the line managers' own vacation accounts */
  var MANAGER_QUOTA = {"00100210":{entitlement:25, carryover:2, usedBefore:12}, "00100320":{entitlement:25, carryover:0, usedBefore:14}};
  /* the project managers' own requests, decided by the line manager */
  LEAVE_TEAM.PT01.push(
    {RequestID:"4500341", EmployeeID:"00104540", EmployeeName:"Ricardo Nunes", role:"Project manager", AbsenceTypeCode:"0100", StartDate:weekDay(5,0), EndDate:weekDay(5,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"Family"},
    {RequestID:"4500342", EmployeeID:"00104541", EmployeeName:"Pedro Alves", role:"Project manager", AbsenceTypeCode:"0300", StartDate:weekDay(-2,2), EndDate:weekDay(-2,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:""}
  );
  LEAVE_TEAM.PT02.push(
    {RequestID:"4500343", EmployeeID:"00104542", EmployeeName:"Carlos Pinto", role:"Project manager", AbsenceTypeCode:"0100", StartDate:weekDay(2,2), EndDate:weekDay(2,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:""},
    {RequestID:"4500344", EmployeeID:"00104543", EmployeeName:"Marco Silva", role:"Project manager", AbsenceTypeCode:"0100", StartDate:weekDay(-1,0), EndDate:weekDay(-1,1), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:""}
  );
  /* absences already behind the team, so the calendars show some history */
  LEAVE_TEAM.PT01.push(
    {RequestID:"4500351", EmployeeID:"00104402", EmployeeName:"Bruno Matos", role:"Consultant", AbsenceTypeCode:"0100", StartDate:weekDay(-2,0), EndDate:weekDay(-2,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:""},
    {RequestID:"4500362", EmployeeID:"00104401", EmployeeName:"Ana Ferreira", role:"Senior consultant", AbsenceTypeCode:"0100", StartDate:weekDay(-3,3), EndDate:weekDay(-3,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:""},
    {RequestID:"4500377", EmployeeID:"00104406", EmployeeName:"Filipe Reis", role:"Consultant", AbsenceTypeCode:"0200", StartDate:weekDay(-1,1), EndDate:weekDay(-1,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:"", Attachment:"atestado.pdf"}
  );
  LEAVE_TEAM.PT02.push(
    {RequestID:"4500359", EmployeeID:"00104511", EmployeeName:"Hélder Rocha", role:"Technician", AbsenceTypeCode:"0100", StartDate:weekDay(-1,0), EndDate:weekDay(-1,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:""},
    {RequestID:"4500384", EmployeeID:"00104528", EmployeeName:"Luís Teixeira", role:"Technician", AbsenceTypeCode:"0200", StartDate:weekDay(0,0), EndDate:weekDay(0,0), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:"", Attachment:"atestado.pdf"}
  );
  /* One level further down (a senior consultant who leads two people) and
     the line manager's own peers, for the team calendar: their absences are
     approved by someone else, so they never reach this manager's inbox. */
  var SUB_REPORTS = {
    "00104401":[{EmployeeID:"00104461", name:"Rui Marques", role:"Consultant", manager:"Ana Ferreira"}, {EmployeeID:"00104462", name:"Joana Silva", role:"Junior consultant", manager:"Ana Ferreira"}],
    "00104510":[{EmployeeID:"00104561", name:"Pedro Lima", role:"Technician", manager:"Nuno Dias"}]
  };
  var MANAGER_PEERS = {
    PT01:[{EmployeeID:"00100211", name:"Miguel Costa", role:"Delivery Manager, Public Sector"}, {EmployeeID:"00100212", name:"Rita Santos", role:"Delivery Manager, Banking"}],
    PT02:[{EmployeeID:"00100321", name:"Jorge Antunes", role:"Operations Manager, Hospitals"}, {EmployeeID:"00100322", name:"Sara Lopes", role:"Operations Manager, Airports"}]
  };
  var OTHER_LEAVE = {
    PT01:[
      {RequestID:"4500331", EmployeeID:"00104461", EmployeeName:"Rui Marques", AbsenceTypeCode:"0100", StartDate:weekDay(0,3), EndDate:weekDay(1,1), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:"", ApproverName:"Ana Ferreira"},
      {RequestID:"4500332", EmployeeID:"00104462", EmployeeName:"Joana Silva", AbsenceTypeCode:"0300", StartDate:weekDay(2,2), EndDate:weekDay(2,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:"", ApproverName:"Ana Ferreira"},
      {RequestID:"4500333", EmployeeID:"00104462", EmployeeName:"Joana Silva", AbsenceTypeCode:"0100", StartDate:weekDay(6,0), EndDate:weekDay(6,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"", ApproverName:"Ana Ferreira"},
      {RequestID:"4500334", EmployeeID:"00100211", EmployeeName:"Miguel Costa", AbsenceTypeCode:"0100", StartDate:weekDay(-1,0), EndDate:weekDay(-1,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:"", ApproverName:"Henrique Vaz"},
      {RequestID:"4500335", EmployeeID:"00100212", EmployeeName:"Rita Santos", AbsenceTypeCode:"0100", StartDate:weekDay(4,2), EndDate:weekDay(4,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:"", ApproverName:"Henrique Vaz"}
    ],
    PT02:[
      {RequestID:"4500336", EmployeeID:"00104561", EmployeeName:"Pedro Lima", AbsenceTypeCode:"0100", StartDate:weekDay(1,0), EndDate:weekDay(1,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:"", ApproverName:"Nuno Dias"},
      {RequestID:"4500337", EmployeeID:"00100321", EmployeeName:"Jorge Antunes", AbsenceTypeCode:"0100", StartDate:weekDay(2,0), EndDate:weekDay(2,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:"", ApproverName:"Teresa Moura"},
      {RequestID:"4500338", EmployeeID:"00100322", EmployeeName:"Sara Lopes", AbsenceTypeCode:"0200", StartDate:weekDay(-1,3), EndDate:weekDay(-1,3), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"POSTED", Notes:"", ApproverName:"Teresa Moura"}
    ]
  };
  OTHER_LEAVE.PT01.push({RequestID:"4500345", EmployeeID:"00100210", EmployeeName:"Sofia Almeida", role:"Delivery Manager, Consulting", AbsenceTypeCode:"0100", StartDate:weekDay(7,0), EndDate:weekDay(7,4), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"APPROVED", Notes:"", ApproverName:"Henrique Vaz"});
  OTHER_LEAVE.PT02.push({RequestID:"4500346", EmployeeID:"00100320", EmployeeName:"Patrícia Gomes", role:"Operations Manager, Building Solutions", AbsenceTypeCode:"0100", StartDate:weekDay(6,1), EndDate:weekDay(6,2), partial:false, hours:8, StartTime:"", EndTime:"", StatusID:"SENT", Notes:"", ApproverName:"Teresa Moura"});
  ["PT01","PT02"].forEach(function(b){ OTHER_LEAVE[b].forEach(function(r){ r.bukrs = b; r.created = isoAdd(r.StartDate < todayISO() ? r.StartDate : todayISO(), -12); }); });
  /* every sample request gets a sending date, for the workflow history */
  ["PT01","PT02"].forEach(function(b){
    LEAVE_TEAM[b].forEach(function(r){
      if(!r.created) r.created = isoAdd(r.StartDate < todayISO() ? r.StartDate : todayISO(), -9);
      if(r.StatusID === "POSTED" || r.StatusID === "APPROVED"){ r.ApproverName = r.ApproverName || LINE_MANAGER[b].name; }
    });
  });
  var leaveSeq = 4500400;

  /* ---------- dates ---------- */
  function isoAdd(dateISO, n){
    var dt = new Date(Date.UTC(+dateISO.slice(0,4), +dateISO.slice(4,6)-1, +dateISO.slice(6,8)));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0,10).replace(/-/g,"");
  }
  /* 0 = Monday ... 6 = Sunday, the same index the weekly grid uses. */
  function weekdayOf(dateISO){
    var dt = new Date(Date.UTC(+dateISO.slice(0,4), +dateISO.slice(4,6)-1, +dateISO.slice(6,8)));
    return (dt.getUTCDay() + 6) % 7;
  }
  function fmtDate(dateISO){
    if(!dateISO) return "";
    return (+dateISO.slice(6,8)) + " " + MONTHS[+dateISO.slice(4,6)-1] + " " + dateISO.slice(0,4);
  }
  function fmtDateShort(dateISO){
    return WEEKDAY_ABBR[weekdayOf(dateISO)] + " " + (+dateISO.slice(6,8)) + " " + MONTHS[+dateISO.slice(4,6)-1];
  }
  function leavePeriodLabel(r){
    if(r.StartDate === r.EndDate) return fmtDate(r.StartDate) + (r.partial && r.StartTime ? ", " + t("leave_time_range", {b: r.StartTime, e: r.EndTime}) : "");
    return t("leave_range", {from: fmtDate(r.StartDate), to: fmtDate(r.EndDate)});
  }
  function isoToInput(d){ return d ? d.slice(0,4) + "-" + d.slice(4,6) + "-" + d.slice(6,8) : ""; }
  /* Dates typed and shown as DD/MM/YYYY, whatever the browser's own
     format (a native date field follows the browser, MM/DD/YYYY in an
     American English one). */
  function isoToDmy(d){ return d ? d.slice(6,8) + "/" + d.slice(4,6) + "/" + d.slice(0,4) : ""; }
  function dmyToIso(v){
    var s = String(v || "").trim(), m;
    if((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return m[1] + m[2] + m[3];
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/);
    if(!m) return "";
    var d = +m[1], mo = +m[2], y = m[3] ? +m[3] : +todayISO().slice(0,4);
    if(y < 100) y += 2000;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if(mo < 1 || mo > 12 || d < 1 || dt.getUTCMonth() !== mo - 1) return "";
    return "" + y + (mo < 10 ? "0" : "") + mo + (d < 10 ? "0" : "") + d;
  }
  /* A DD/MM/YYYY text field with the browser's calendar one click away:
     slashes go in as the digits are typed, and the picker writes back in
     the same format. */
  function enhanceDmyInput(inp){
    if(!inp || inp.dataset.dmy) return;
    inp.dataset.dmy = "1";
    var wrap = el("span","dmywrap","");
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    var hidden = document.createElement("input");
    hidden.type = "date"; hidden.className = "dmyhidden"; hidden.tabIndex = -1; hidden.setAttribute("aria-hidden", "true");
    var pick = el("button","btn sm dmypick","📅");
    pick.type = "button";
    pick.setAttribute("aria-label", t("aria_pick_date"));
    pick.title = t("aria_pick_date");
    pick.onclick = function(){
      if(inp.disabled) return;
      hidden.value = isoToInput(dmyToIso(inp.value));
      try{ if(hidden.showPicker) hidden.showPicker(); else hidden.click(); }catch(e){ hidden.click(); }
    };
    hidden.onchange = function(){
      inp.value = isoToDmy(inputToIso(hidden.value));
      inp.dispatchEvent(new Event("input", {bubbles:true}));
      inp.dispatchEvent(new Event("change", {bubbles:true}));
    };
    wrap.appendChild(pick);
    wrap.appendChild(hidden);
    inp.addEventListener("input", function(ev){
      if(ev.inputType && ev.inputType.indexOf("delete") === 0) return;
      var v = inp.value.replace(/[^\d\/]/g, "");
      if(/^\d{2}$/.test(v) || /^\d{1,2}\/\d{2}$/.test(v)) v += "/";
      if(v !== inp.value) inp.value = v;
    });
  }
  function inputToIso(v){ return String(v || "").replace(/-/g,""); }
  /* Working days of a request: Monday to Friday, less the public holidays
     of the company's holiday calendar. */
  function eachLeaveDay(r, fn){
    if(!r.StartDate || !r.EndDate || r.EndDate < r.StartDate) return;
    for(var d = r.StartDate, guard = 0; d <= r.EndDate && guard < 400; d = isoAdd(d, 1), guard++){
      if(weekdayOf(d) <= 4 && !holidayOn(d, r.bukrs)) fn(d);
    }
  }
  /* public holidays on weekdays inside a request, which it doesn't deduct */
  function leaveHolidaysIn(r){
    var n = 0;
    if(!r.StartDate || !r.EndDate || r.EndDate < r.StartDate) return 0;
    for(var d = r.StartDate, guard = 0; d <= r.EndDate && guard < 400; d = isoAdd(d, 1), guard++){
      if(weekdayOf(d) <= 4 && holidayOn(d, r.bukrs)) n++;
    }
    return n;
  }
  function leaveWorkdays(r){ var n = 0; eachLeaveDay(r, function(){ n++; }); return n; }
  /* What a request takes from the quota, in days: a part-day counts as its
     share of the 8h day. */
  function leaveDays(r){ return r.partial ? Math.round(r.hours / DAYCAP * 100) / 100 : leaveWorkdays(r); }
  /* Days read as whole numbers when they are whole (11, not 11.0); a
     part-day share keeps its decimals. */
  function fmtDays(n){ return String(Math.round(n*100)/100); }
  function leaveDurationLabel(r){
    if(r.partial) return fmt(r.hours) + " h";
    return plural(leaveWorkdays(r), "n_workdays");
  }
  function leaveActive(r){ return r.StatusID === "SENT" || r.StatusID === "APPROVED" || r.StatusID === "POSTED"; }
  function leaveStatusLabel(r){
    if(r.cancelRequested) return t("lr_status_cancel_requested");
    return t("lr_status_" + r.StatusID.toLowerCase());
  }
  function leaveStatusClass(r){
    if(r.cancelRequested) return "amber";
    return {SENT:"amber", APPROVED:"green", POSTED:"green", REJECTED:"grey", WITHDRAWN:"grey"}[r.StatusID] || "grey";
  }

  /* ---------- replication into the timesheet ----------
     The timesheet reads absences, it never creates them. A request shows up
     the moment it is sent, as pending, which warns without blocking; once
     approved it closes the day, or reduces its capacity for a part-day; if
     it's rejected or withdrawn it disappears. Same rules the grid already
     applied to absences, now fed by the request instead of fixed data.
     Mutates each week's absences array in place: ABSENCES points at the
     loaded week's array, and replacing it would leave that pointer stale. */
  /* ---------- one timesheet per person under test ----------
     Each profile is a different person with a timesheet of their own: the
     employee keeps the hand-written sample, and anyone else gets their own
     copy, built from the same calendar the first time they're tested, with
     their own projects and their own absences. Nothing recorded as one
     person shows up in another's. */
  var WEEKS_OF = {};
  /* whether each person left changes unsaved in their own timesheet */
  var UNSAVED = {};
  WEEKS_OF[PERNR] = {PT01: WEEKS_PT01, PT02: WEEKS_PT02};
  var BASE_WEEKS = null;
  /* what a line manager records time against: internal management first,
     then the projects of their unit */
  var MANAGER_PROJECTS = {PT01:[3, 0, 1, 2], PT02:[3, 4, 5]};
  function projectsOfPerson(id, bukrs){
    var pm = TEAM.filter(function(m){ return m.leaderOf && m.pernr === id; })[0];
    if(pm) return pm.projs.slice();
    if(id === LINE_MANAGER.PT01.pernr || id === LINE_MANAGER.PT02.pernr) return MANAGER_PROJECTS[bukrs].slice();
    return null;
  }
  function makeWeeksFor(id){
    var base = JSON.parse(BASE_WEEKS);
    WEEKS_OF[id] = base;
    ["PT01","PT02"].forEach(function(b){
      var mine = projectsOfPerson(id, b) || [];
      base[b].forEach(function(w){
        w.absences = []; w.allow = []; w.sugs = []; w.rows = [];
      });
      requestsOf(id, b).forEach(function(r){ syncLeaveToTimesheet(r); });
      prefillToToday(b, base[b], mine);
    });
    return base;
  }
  function weeksOfCompany(bukrs, emp){
    var id = emp || selfId();
    var store = WEEKS_OF[id] || (BASE_WEEKS ? makeWeeksFor(id) : WEEKS_OF[PERNR]);
    return bukrs === "PT02" ? store.PT02 : store.PT01;
  }
  function weekDayIn(weeks, dateISO){
    for(var i=0; i<weeks.length; i++){
      var idx = datesFor(weeks[i].start).indexOf(dateISO);
      if(idx !== -1) return {week:weeks[i], day:idx};
    }
    return null;
  }
  /* into the requester's own timesheet, whoever is testing */
  function syncLeaveToTimesheet(r){
    var store = WEEKS_OF[r.EmployeeID];
    if(!store) return;
    var weeks = r.bukrs === "PT02" ? store.PT02 : store.PT01;
    weeks.forEach(function(w){
      for(var i = w.absences.length - 1; i >= 0; i--){
        if(w.absences[i].req === r.RequestID) w.absences.splice(i, 1);
      }
    });
    if(!leaveActive(r)) return;
    var ty = absType(r.AbsenceTypeCode);
    eachLeaveDay(r, function(d){
      var wd = weekDayIn(weeks, d);
      if(!wd) return;
      wd.week.absences.push({
        id:"lr" + r.RequestID + "-" + d, day:wd.day, type: ty ? ty.name : r.AbsenceTypeCode, awart:r.AbsenceTypeCode,
        hours: r.partial ? r.hours : DAYCAP, status: r.StatusID === "SENT" ? "pending" : "approved",
        src:"Request " + r.RequestID, req:r.RequestID
      });
    });
  }
  /* The sample absences that were already in the weeks become the
     employee's request history, grouped by request number, so the list of
     requests and the timesheet tell the same story from the first click. */
  function seedLeaveFromWeeks(bukrs){
    var byReq = {}, out = [];
    weeksOfCompany(bukrs).forEach(function(w){
      var dates = datesFor(w.start);
      w.absences.forEach(function(a){
        var id = String(a.src || "").replace(/\D/g, "") || ("x" + a.id);
        a.req = id;
        var d = dates[a.day], r = byReq[id];
        if(!r){
          r = byReq[id] = {
            RequestID:id, EmployeeID:PERNR, EmployeeName:EMPLOYEE_NAME, bukrs:bukrs, AbsenceTypeCode:a.awart,
            StartDate:d, EndDate:d, partial:a.hours < DAYCAP, hours:a.hours, StartTime:"", EndTime:"",
            StatusID: a.status === "approved" ? "APPROVED" : "SENT", Notes:"", origin:"Manual",
            ApproverName: LINE_MANAGER[bukrs].name
          };
          out.push(r);
        }
        if(d < r.StartDate) r.StartDate = d;
        if(d > r.EndDate) r.EndDate = d;
      });
    });
    out.forEach(function(r){
      /* An approved request whose days are behind us has been through
         RPTARQPOST already, it's in IT2001. */
      if(r.StatusID === "APPROVED" && r.EndDate < todayISO()) r.StatusID = "POSTED";
      if(r.partial && profileFor(r.StartDate, bukrs).clock){
        r.StartTime = "09:00";
        r.EndTime = fmtClock(9*60 + Math.round(r.hours*60));
      }
    });
    return out;
  }
  LEAVE.PT01 = seedLeaveFromWeeks("PT01");
  LEAVE.PT02 = seedLeaveFromWeeks("PT02");
  /* Bring the employee's own sample around today: the two requests still
     waiting move to the weeks ahead (a request pending for a day long gone
     isn't realistic), and a part-day medical appointment, already approved,
     sits earlier this week. */
  ["PT01","PT02"].forEach(function(b){
    LEAVE[b].forEach(function(r){
      if(r.RequestID === "4500230"){ r.StartDate = r.EndDate = weekDay(5, 3); r.StatusID = "SENT"; syncLeaveToTimesheet(r); }
      if(r.RequestID === "4500255"){ r.StartDate = r.EndDate = weekDay(6, 0); r.StatusID = "SENT"; syncLeaveToTimesheet(r); }
    });
    var today = todayISO(), mon = mondayOf(today);
    var day = mon < today ? mon : weekDay(-1, 3);
    var clock = profileFor(day, b).clock;
    var appt = {
      RequestID:"4500290", EmployeeID:PERNR, EmployeeName:EMPLOYEE_NAME, bukrs:b, AbsenceTypeCode:"0210",
      StartDate:day, EndDate:day, partial:true, hours:4, StartTime: clock ? "14:00" : "", EndTime: clock ? "18:00" : "",
      StatusID: day < today ? "POSTED" : "APPROVED", Notes:"", origin:"Manual", ApproverName: LINE_MANAGER[b].name
    };
    LEAVE[b].push(appt);
    syncLeaveToTimesheet(appt);
  });
  prefillToToday("PT01");
  prefillToToday("PT02");
  /* the calendar every other person's own timesheet starts from */
  BASE_WEEKS = JSON.stringify({PT01: WEEKS_PT01, PT02: WEEKS_PT02});
  /* the app opens on today's week, and for consulting on today's month;
     nothing to save first, the placeholder week was never edited */
  loadWeek(todayWeekIndex());
  LEAVE_TEAM.PT01.forEach(function(r){ r.bukrs = "PT01"; });
  ["PT01","PT02"].forEach(function(b){ LEAVE[b].forEach(function(r){ if(!r.created) r.created = isoAdd(r.StartDate < todayISO() ? r.StartDate : todayISO(), -9); }); });
  LEAVE_TEAM.PT02.forEach(function(r){ r.bukrs = "PT02"; });

  /* ---------- the timesheet up to today ----------
     The sample's own weeks stop where they were written; this tops them up
     so the app opens on current data: every working day from the start of
     last month to the day before yesterday recorded to capacity, yesterday
     half done, today and the days ahead still open, and two suggestions
     for what's missing. Weeks wholly before this month are submitted. The
     hand-written rows stay; only the gaps are filled. */
  function mondayOf(dateISO){ return isoAdd(dateISO, -weekdayOf(dateISO)); }
  function previousWorkday(dateISO){
    var d = isoAdd(dateISO, -1);
    while(weekdayOf(d) > 4) d = isoAdd(d, -1);
    return d;
  }
  function todayWeekIndex(){
    var today = todayISO();
    for(var i=0; i<WEEKS.length; i++){ if(datesFor(WEEKS[i].start).indexOf(today) !== -1) return i; }
    return today > WEEKS[WEEKS.length - 1].start ? WEEKS.length - 1 : Math.min(6, WEEKS.length - 1);
  }
  function prefillToToday(bukrs, weeksArg, projsArg){
    var PREFILL_DESC = {
      0:"Payroll go-live support", 1:"Time tracking rollout support", 2:"WFM rollout stabilization",
      4:"Elevator preventive maintenance", 5:"Terminal HVAC inspection round", 3:"Team management and internal meetings"
    };
    var weeks = weeksArg || weeksOfCompany(bukrs), today = todayISO();
    if(projsArg && !projsArg.length) return;
    var y = +today.slice(0,4), m = +today.slice(4,6);
    var from = m === 1 ? (y - 1) + "1201" : "" + y + (m - 1 < 10 ? "0" : "") + (m - 1) + "01";
    var monthStart = today.slice(0,6) + "01";
    var yesterday = previousWorkday(today);
    weeks.forEach(function(w){
      var dates = datesFor(w.start);
      if(dates[6] < from || w.start > today) return;
      /* consulting splits the day between banking and a second project that
         changes week to week; building solutions mostly on the hospital */
      var plan = bukrs === "PT02" ? [[4, 6], [5, 2]] : [[0, 4], [w.num % 2 ? 1 : 2, 4]];
      /* someone else's own projects: the first half the day, the others in turn */
      if(projsArg) plan = projsArg.length > 1 ? [[projsArg[0], 4], [projsArg[1 + (w.num % (projsArg.length - 1))], 4]] : [[projsArg[0], 8]];
      var touched = false;
      for(var d=0; d<5; d++){
        var day = dates[d];
        if(day < from || day >= today) continue;
        if(holidayOn(day, bukrs)){ w.rows.forEach(function(r){ r.h[d] = 0; }); touched = true; continue; }
        if(!periodOpen(day, bukrs)) continue;
        var cap = capacityOf(w, d), have = dayTotalOf(w, d);
        var target = day === yesterday ? Math.min(cap, round15(cap / 2)) : cap;
        var gap = target - have;
        if(gap <= 0) continue;
        plan.forEach(function(pl){
          if(gap <= 0) return;
          var add = Math.min(gap, pl[1]);
          var row = w.rows.filter(function(r){ return r.p === pl[0]; })[0];
          if(!row){ row = {id:nextId++, p:pl[0], desc:PREFILL_DESC[pl[0]] || "", h:[0,0,0,0,0,0,0], origin:"Manual"}; w.rows.push(row); }
          row.h[d] = round15((row.h[d] || 0) + add);
          gap -= add;
        });
        touched = true;
      }
      if(touched && bukrs === "PT02") seedClockRows(w.rows);
      if(dates[4] < monthStart) w.submitted = true;
      /* suggestions belong to the week being worked on, not to past ones */
      if(dates[6] < today) w.sugs = [];
      /* what's missing in the current week, proposed rather than filled */
      if(dates.indexOf(today) !== -1){
        var sugs = [], td = dates.indexOf(today), yd = dates.indexOf(yesterday);
        var why = bukrs === "PT02" ? ["3 work orders closed in the maintenance log", "12 changes in the maintenance ticket system"]
                                   : ["3 client meetings on the calendar", "12 changes in the project repository"];
        if(td <= 4 && capacityOf(w, td) > 0) sugs.push({id:"st1", hours:2.5, day:td, p:plan[0][0], why:why[0], conf:"hi", desc:PREFILL_DESC[plan[0][0]]});
        if(yd !== -1 && capacityOf(w, yd) - dayTotalOf(w, yd) > 0) sugs.push({id:"st2", hours:round15(Math.min(2, capacityOf(w, yd) - dayTotalOf(w, yd))), day:yd, p:(plan[1] || plan[0])[0], why:why[1], conf:"mid", desc:PREFILL_DESC[(plan[1] || plan[0])[0]]});
        w.sugs = sugs;
      }
    });
  }
  function myLeave(){ return requestsOf(selfId()); }
  /* Scoped to one company: the two sample histories reuse the same request
     numbers (it's the same employee, opened under either company), so a
     lookup across both could pick up the other company's copy. */
  function leaveById(id, bukrs){
    var b = bukrs || IT0001.bukrs;
    return LEAVE[b].concat(LEAVE_TEAM[b], OTHER_LEAVE[b]).filter(function(r){ return r.RequestID === String(id); })[0] || null;
  }
  function reportsOf(bukrs){ return DIRECT_REPORTS[bukrs || IT0001.bukrs]; }
  function reportById(id, bukrs){ return reportsOf(bukrs).filter(function(m){ return m.EmployeeID === id; })[0] || null; }
  function requestsOf(id, bukrs){
    var b = bukrs || IT0001.bukrs;
    return id === PERNR ? LEAVE[b] : LEAVE_TEAM[b].concat(OTHER_LEAVE[b]).filter(function(r){ return r.EmployeeID === id; });
  }
  /* A vacation account: taken (in the past), planned (approved, ahead),
     pending, and what's left. With asOf, only requests starting by that
     date count, the balance as it will stand on that day. */
  function balanceOf(id, bukrs, asOf){
    var b = bukrs || IT0001.bukrs;
    var q = id === PERNR ? QUOTA[b] : (reportById(id, b) || MANAGER_QUOTA[id] || {entitlement:22, carryover:0, usedBefore:0});
    var total = q.entitlement + q.carryover, taken = q.usedBefore, planned = 0, requested = 0, today = todayISO();
    requestsOf(id, b).forEach(function(r){
      var ty = absType(r.AbsenceTypeCode);
      if(!ty || !ty.quota || !leaveActive(r)) return;
      if(asOf && r.StartDate > asOf) return;
      var n = leaveDays(r);
      if(r.StatusID === "SENT") requested += n;
      else if(r.StatusID === "POSTED" || r.EndDate < today) taken += n;
      else planned += n;
    });
    return {year:QUOTA[b].year, total:total, entitlement:q.entitlement, carryover:q.carryover, usedBefore:q.usedBefore,
      taken:taken, planned:planned, used:taken + planned, requested:requested, available: total - taken - planned - requested};
  }
  function leaveBalance(bukrs){ return balanceOf(selfId(), bukrs); }
  /* What sits in the direct manager's inbox: requests from the direct
     reports, plus the employee's own (the same manager approves them), plus
     cancellations of approved requests, which go back through the same
     workflow step in the standard. */
  function leaveQueue(){
    var b = IT0001.bukrs;
    return LEAVE_TEAM[b].concat(LEAVE[b]).filter(function(r){
      return r.StatusID === "SENT" || (r.cancelRequested && leaveActive(r));
    }).sort(function(x, y){ return x.StartDate < y.StartDate ? -1 : x.StartDate > y.StartDate ? 1 : 0; });
  }
  function leaveDecidedThisSession(){
    var b = IT0001.bukrs;
    return LEAVE_TEAM[b].concat(LEAVE[b]).filter(function(r){ return r.decidedBy; });
  }
  function daysUntil(dateISO){
    var a = todayISO(), n = 0;
    if(dateISO <= a) return 0;
    for(var d = a; d < dateISO && n < 400; d = isoAdd(d, 1)) n++;
    return n;
  }
  /* Other people's active requests touching the same working days, so the
     manager decides with the team picture in front of them. */
  function leaveOverlaps(r){
    var mine = {};
    eachLeaveDay(r, function(d){ mine[d] = 1; });
    var b = r.bukrs || IT0001.bukrs;
    return LEAVE_TEAM[b].concat(LEAVE[b]).filter(function(o){
      if(o === r || o.EmployeeID === r.EmployeeID || !leaveActive(o)) return false;
      var hit = false;
      eachLeaveDay(o, function(d){ if(mine[d]) hit = true; });
      return hit;
    });
  }
  /* What the person has left once this request goes through: a pending
     one is already counted, a cancellation gives its days back. */
  function leaveAvailableAfter(r){
    var ty = absType(r.AbsenceTypeCode);
    if(!ty || !ty.quota) return null;
    var bal = balanceOf(r.EmployeeID, r.bukrs);
    return r.cancelRequested ? bal.available + leaveDays(r) : bal.available;
  }
  /* Hours already in the timesheet on the days a request covers, from
     whatever sample weeks those days fall in. */
  function leaveHoursRecorded(r){
    var weeks = weeksOfCompany(r.bukrs || IT0001.bukrs), tot = 0, days = [];
    eachLeaveDay(r, function(d){
      var wd = weekDayIn(weeks, d);
      if(!wd) return;
      var h = dayTotalOf(wd.week, wd.day);
      if(h > 0){ tot += h; days.push(fmtDateShort(d)); }
    });
    return {hours:tot, days:days};
  }

  /* ---------- validation of a new request ----------
     The checks the standard service does on submit (overlap, quota,
     closed period, part-day rules), run while the request is still being
     filled, so nothing fails only at the end. Same three severities as the
     timesheet: an error blocks, a warning informs, info guides. */
  function validateLeave(d){
    var out = [];
    var ty = absType(d.AbsenceTypeCode);
    if(!ty){ out.push({sev:"e", txt:t("leave_err_type")}); return out; }
    if(!d.StartDate || !d.EndDate){ out.push({sev:"e", txt:t("leave_err_dates")}); return out; }
    if(d.EndDate < d.StartDate){ out.push({sev:"e", txt:t("leave_err_order")}); return out; }
    var days = leaveWorkdays(d);
    if(!days){ out.push({sev:"e", txt:t("leave_err_no_workdays")}); return out; }
    if(d.partial){
      if(!ty.partial) out.push({sev:"e", txt:t("leave_err_partial_type", {type: t("abs_" + ty.code)})});
      if(d.StartDate !== d.EndDate) out.push({sev:"e", txt:t("leave_err_partial_one_day")});
      if(profileFor(d.StartDate, d.bukrs).clock){
        var b = parseClock(d.StartTime), e = parseClock(d.EndTime);
        if(b === null || e === null || isNaN(b) || isNaN(e) || e <= b) out.push({sev:"e", txt:t("leave_err_times")});
      }
      if(!(d.hours > 0)) out.push({sev:"e", txt:t("leave_err_hours")});
      else if(d.hours >= DAYCAP) out.push({sev:"e", txt:t("leave_err_hours_full", {cap: fmt(DAYCAP)})});
    }
    var emp = d.EmployeeID || selfId();
    var mine = {};
    eachLeaveDay(d, function(x){ mine[x] = 1; });
    requestsOf(emp, d.bukrs).forEach(function(o){
      if(!leaveActive(o) || (d.RequestID && o.RequestID === d.RequestID)) return;
      var hit = false;
      eachLeaveDay(o, function(x){ if(mine[x]) hit = true; });
      if(hit) out.push({sev:"e", txt:t("leave_err_overlap", {id: o.RequestID, period: leavePeriodLabel(o)})});
    });
    var closed = false;
    eachLeaveDay(d, function(x){ if(!periodOpen(x, d.bukrs)) closed = true; });
    if(closed) out.push({sev:"e", txt:t("leave_err_period_closed")});
    if(ty.quota){
      var avail = leaveAvailableFor(d), need = d.partial ? Math.round(d.hours / DAYCAP * 100) / 100 : days;
      if(need > avail) out.push({sev:"e", txt:t("leave_err_quota", {n: fmtDays(need), avail: fmtDays(avail)})});
    }
    if(emp === selfId() && state.role !== "manager"){
      var rec = leaveHoursRecorded(d);
      if(rec.hours > 0) out.push({sev:"w", txt:t("leave_warn_hours", {h: fmt(rec.hours), days: rec.days.join(", ")})});
    }
    if(ty.attach === "required" && !d.Attachment) out.push({sev:"e", code:"attach", txt:t("leave_err_attachment", {doc: attachDoc(ty)})});
    var outside = false;
    eachLeaveDay(d, function(x){ if(!weekDayIn(weeksOfCompany(d.bukrs), x)) outside = true; });
    if(outside) out.push({sev:"i", txt:t("leave_info_outside_sample")});
    if(d.StartDate < todayISO()) out.push({sev:"i", txt:t("leave_info_retroactive")});
    return out;
  }
  /* What's free for a new request (or a changed one, whose own days are
     given back first). */
  function leaveAvailableFor(d){
    var avail = balanceOf(d.EmployeeID || selfId(), d.bukrs).available;
    if(d.RequestID){
      var old = leaveById(d.RequestID, d.bukrs);
      var oty = old && absType(old.AbsenceTypeCode);
      if(old && oty && oty.quota && leaveActive(old)) avail += leaveDays(old);
    }
    return avail;
  }
  /* Start/end profiles (Z_BSRV) always take the hours from the window;
     duration profiles (Z_CONS) take the hours given, or the window when
     only a window was given ("tomorrow 14h to 17h"). */
  function leaveDraftHours(d){
    if(!d.partial) return DAYCAP;
    var b = parseClock(d.StartTime), e = parseClock(d.EndTime);
    var span = (b === null || e === null || isNaN(b) || isNaN(e) || e <= b) ? 0 : round15((e - b) / 60);
    if(profileFor(d.StartDate, d.bukrs).clock) return span;
    return +d.hours > 0 ? round15(+d.hours) : span;
  }

  /* ---------- actions, the same for the screen and the assistant ---------- */
  function nowStamp(){
    var d = new Date();
    return fmtDate(todayISO()) + " " + (d.getHours()<10?"0":"") + d.getHours() + ":" + (d.getMinutes()<10?"0":"") + d.getMinutes();
  }
  /* A new request, from the person or, on behalf, from their line
     manager: what the approver records is approved as it's created. A
     draft carrying a RequestID changes that pending request instead. */
  function createLeave(d, origin){
    if(d.RequestID) return updateLeave(d);
    var emp = d.EmployeeID || selfId(), self = emp === selfId(), m = reportById(emp, d.bukrs) || {};
    var mgr = LINE_MANAGER[d.bukrs];
    var isMgr = emp === mgr.pernr;
    var r = {
      RequestID: String(++leaveSeq), EmployeeID:emp, EmployeeName: emp === PERNR ? EMPLOYEE_NAME : isMgr ? mgr.name : m.name,
      role: isMgr ? mgr.role : m.role, bukrs:d.bukrs,
      AbsenceTypeCode:d.AbsenceTypeCode, StartDate:d.StartDate, EndDate:d.EndDate,
      partial:!!d.partial, hours: d.partial ? leaveDraftHours(d) : DAYCAP,
      StartTime: d.partial ? (d.StartTime || "") : "", EndTime: d.partial ? (d.EndTime || "") : "",
      StatusID: d.onBehalf ? "APPROVED" : "SENT", Notes:d.Notes || "", origin: origin || "Manual",
      ApproverName: approverFor(emp, d.bukrs).name, created: nowStamp(), Attachment: d.Attachment || ""
    };
    if(d.onBehalf){
      r.onBehalf = mgr.name; r.decidedBy = mgr.name; r.decidedAt = r.created; r.decision = "approved"; r.decisionKind = "new";
      if(r.StartDate < todayISO()) r.StatusID = "POSTED";
    }
    (emp === PERNR ? LEAVE[d.bukrs] : reportById(emp, d.bukrs) ? LEAVE_TEAM[d.bukrs] : OTHER_LEAVE[d.bukrs]).push(r);
    syncLeaveToTimesheet(r);
    if(self) state.lastLeave = r;
    if(emp === PERNR && d.onBehalf) state.leaveNotices.push(r);
    render();
    return r;
  }
  function updateLeave(d){
    var r = leaveById(d.RequestID, d.bukrs);
    if(!r) return null;
    r.AbsenceTypeCode = d.AbsenceTypeCode; r.StartDate = d.StartDate; r.EndDate = d.EndDate;
    r.partial = !!d.partial; r.hours = d.partial ? leaveDraftHours(d) : DAYCAP;
    r.StartTime = d.partial ? (d.StartTime || "") : ""; r.EndTime = d.partial ? (d.EndTime || "") : "";
    r.Notes = d.Notes || ""; r.Attachment = d.Attachment || r.Attachment || "";
    r.StatusID = "SENT"; r.changed = nowStamp();
    syncLeaveToTimesheet(r);
    render();
    return r;
  }
  function canEditLeave(r){
    return r.EmployeeID === selfId() && r.StatusID === "SENT" && !r.cancelRequested;
  }
  /* A request still waiting is simply withdrawn. An approved one is
     already in (or on its way to) IT2001, so cancelling it is itself a
     request the manager approves, as in the standard. */
  function withdrawLeave(r){
    if(r.StatusID === "SENT"){
      r.StatusID = "WITHDRAWN";
      r.cancelRequested = false;
      syncLeaveToTimesheet(r);
      render();
      return "withdrawn";
    }
    r.cancelRequested = true;
    render();
    return "cancel_requested";
  }
  function canWithdraw(r){
    if(r.EmployeeID !== selfId() || r.cancelRequested) return false;
    if(r.StatusID === "SENT") return true;
    return (r.StatusID === "APPROVED" || r.StatusID === "POSTED") && r.StartDate >= todayISO();
  }
  function decideLeave(r, approve, reason){
    var mgr = LINE_MANAGER[r.bukrs || IT0001.bukrs];
    var wasCancel = !!r.cancelRequested;
    if(wasCancel){
      r.cancelRequested = false;
      if(approve) r.StatusID = "WITHDRAWN";
    } else {
      r.StatusID = approve ? "APPROVED" : "REJECTED";
    }
    r.ApproverComment = reason || "";
    r.decidedBy = mgr.name;
    r.decidedAt = nowStamp();
    r.decision = approve ? "approved" : "rejected";
    r.decisionKind = wasCancel ? "cancel" : "new";
    syncLeaveToTimesheet(r);
    state.leaveNotices.push(r);
    render();
    if(r.EmployeeID === PERNR && approve && !wasCancel && r.bukrs === IT0001.bukrs && state.role === "employee") leaveConflictToast(r);
  }
  /* The conflict the timesheet has always designed for: hours were
     recorded on a day whose absence gets approved afterwards. */
  function leaveConflictToast(r){
    var hit = -1;
    eachLeaveDay(r, function(d){
      var i = WORKDATES.indexOf(d);
      if(hit === -1 && i !== -1 && dayTotal(i) > capacity(i)) hit = i;
    });
    if(hit !== -1) toast(t("toast_absence_approved_conflict", {day: DAYS[hit], h: fmt(dayTotal(hit))}), t("ui_resolve"), function(){ resolveConflict(hit); });
  }

  /* ---------- Leave Request screen ---------- */
  function renderLeave(){
    if(!$("screen-leave")) return;
    var mgrView = state.role === "manager";
    /* everyone records their own leave; the line manager also sees the
       team's balances and can record on a report's behalf */
    $("lvTitle").textContent = t("hdr_my_time_off");
    $("lvActingWrap").hidden = true;
    $("lvNew").hidden = false;
    $("lvSub").textContent = t(mgrView ? "text_leave_sub_no_ts" : "text_leave_sub", {name: approverFor(selfId()).name});
    $("lvKpis").innerHTML = "";
    $("lvKpis").hidden = true;
    $("lvMineWrap").hidden = false;
    $("lvMinePanel").hidden = false;
    $("lvTeamPanel").hidden = true;
    $("lvBalPanel").hidden = !mgrView;
    $("lvDonePanel").hidden = true;
    renderAccounts(); renderMyCalendar(); renderMyLeave();
    if(mgrView) renderTeamBalances();
  }
  /* ---- shared pieces ---- */
  function monthAdd(key, n){
    var y = +key.slice(0,4), m = +key.slice(4,6) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return "" + y + (m < 9 ? "0" : "") + (m + 1);
  }
  function monthLabelOf(key){ return monthFullName(+key.slice(4,6) - 1) + " " + key.slice(0,4); }
  function leaveStateKey(r){ return r.cancelRequested ? "cancel" : r.StatusID === "SENT" ? "pending" : "approved"; }
  function onLeaveDay(r, d){
    if(!(leaveActive(r) || r.cancelRequested) || d < r.StartDate || d > r.EndDate) return false;
    return weekdayOf(d) <= 4 && !holidayOn(d, r.bukrs);
  }
  /* who in the team is out on a day (approved or waiting), the person under
     test included when it's the manager looking */
  function absentOn(d){
    var b = IT0001.bukrs;
    return LEAVE_TEAM[b].concat(LEAVE[b]).filter(function(r){ return onLeaveDay(r, d); });
  }
  function shortName(n){ var p = String(n).split(" "); return p[0] + (p.length > 1 ? " " + p[p.length - 1].charAt(0) + "." : ""); }
  function fmtStamp(v){ return /^\d{8}$/.test(v || "") ? fmtDate(v) : (v || ""); }
  function legend(box, items){
    box.innerHTML = "";
    items.forEach(function(it){
      var sp = el("span","","");
      sp.appendChild(el("i", it[0], ""));
      sp.appendChild(document.createTextNode(it[1]));
      box.appendChild(sp);
    });
  }

  /* ---- the employee: time account ---- */
  function renderAccounts(){
    var box = $("lvAccBody");
    box.innerHTML = "";
    var asOf = state.lvAsOf || todayISO();
    $("lvAsOf").value = isoToDmy(asOf);
    var bal = leaveBalance(), at = balanceOf(selfId(), null, asOf);
    box.appendChild(el("div","accname", t("acc_vacation", {y: bal.year})));
    var big = el("div","accbig", fmtDays(at.available));
    big.appendChild(el("small","", t("unit_days")));
    box.appendChild(big);
    box.appendChild(el("div","accsub", t("text_acc_available_as_of", {date: fmtDate(asOf)})));
    var dl = document.createElement("dl");
    [[t("acc_entitlement"), bal.total], [t("acc_taken"), -bal.taken], [t("acc_planned"), -bal.planned], [t("acc_pending"), -bal.requested]].forEach(function(r){
      dl.appendChild(el("dt","", r[0]));
      dl.appendChild(el("dd","", (r[1] < 0 ? "−" : "") + fmtDays(Math.abs(r[1]))));
    });
    dl.appendChild(el("dt","", t("acc_available")));
    dl.appendChild(el("dd","tot", fmtDays(bal.available)));
    box.appendChild(dl);
    if(bal.carryover) box.appendChild(el("div","accsub", t("acc_carryover_note", {n: bal.carryover, y: bal.year - 1})));
    box.appendChild(el("div","accnote", t("text_acc_after_all", {n: fmtDays(bal.available)})));
  }
  function openAccountMovements(){
    var bal = leaveBalance(), body = $("acBody");
    $("acTitle").textContent = t("dlg_account_title", {y: bal.year});
    body.innerHTML = "";
    function row(date, label, days, statusNode, cls){
      var tr = document.createElement("tr");
      if(cls) tr.className = cls;
      tr.appendChild(td2(date, ""));
      tr.appendChild(td2(label, ""));
      tr.appendChild(td2(days, "n"));
      var st = document.createElement("td");
      if(statusNode) st.appendChild(statusNode);
      tr.appendChild(st);
      body.appendChild(tr);
    }
    row(fmtDate(bal.year + "0101"), t("mv_entitlement"), "+" + fmtDays(bal.entitlement));
    if(bal.carryover) row(fmtDate(bal.year + "0101"), t("mv_carryover", {y: bal.year - 1}), "+" + fmtDays(bal.carryover));
    if(bal.usedBefore) row("", t("mv_used_before"), "−" + fmtDays(bal.usedBefore), el("span","chip green", t("lr_status_posted")));
    myLeave().filter(function(r){ var ty = absType(r.AbsenceTypeCode); return ty && ty.quota; })
      .sort(function(x, y){ return x.StartDate < y.StartDate ? -1 : 1; })
      .forEach(function(r){
        var counts = leaveActive(r);
        row(leavePeriodLabel(r), absTypeLabel(r) + " · " + r.RequestID, counts ? "−" + fmtDays(leaveDays(r)) : "0",
          el("span","chip " + leaveStatusClass(r), leaveStatusLabel(r)), counts ? "" : "muted");
      });
    var tr = document.createElement("tr");
    var a = td2(t("acc_available"), "who"); a.colSpan = 2;
    tr.appendChild(a);
    tr.appendChild(td2(fmtDays(bal.available), "n who"));
    tr.appendChild(document.createElement("td"));
    body.appendChild(tr);
    $("dlgAccount").showModal();
  }

  /* ---- the employee: calendar ---- */
  function renderMyCalendar(){
    var key = state.lvMonth || todayISO().slice(0,6);
    state.lvMonth = key;
    $("lvCalLabel").textContent = monthLabelOf(key);
    $("lvShowTeam").checked = !!state.lvShowTeam;
    $("lvCalHint").textContent = state.lvPick ? t("hint_cal_pick_end", {date: fmtDate(state.lvPick)}) : t("hint_cal_pick");
    var cal = $("lvCal");
    cal.innerHTML = "";
    for(var w=0; w<7; w++) cal.appendChild(el("div","dh", WEEKDAY_ABBR[w]));
    var first = key + "01", last = isoAdd(monthAdd(key, 1) + "01", -1);
    var start = isoAdd(first, -weekdayOf(first)), end = isoAdd(last, 6 - weekdayOf(last));
    var me = selfId(), mine = myLeave(), today = todayISO();
    var team = LEAVE_TEAM[IT0001.bukrs].concat(LEAVE[IT0001.bukrs]).filter(function(r){ return r.EmployeeID !== me; });
    for(var d = start; d <= end; d = isoAdd(d, 1)){
      (function(d){
        var hol = holidayOn(d), we = weekdayOf(d) > 4;
        var cls = "lvday" + (d.slice(0,6) === key ? "" : " out") + (we ? " we" : "") + (hol ? " hol" : "") + (d === today ? " today" : "");
        if(state.lvPick && d === state.lvPick) cls += " pick";
        var cell = el("div", cls, "");
        cell.appendChild(el("span","dn", String(+d.slice(6,8))));
        if(hol) cell.appendChild(el("span","hn", holidayName(hol)));
        mine.filter(function(r){ return onLeaveDay(r, d); }).forEach(function(r){
          var bar = el("button","lvbar " + leaveStateKey(r), absTypeLabel(r) + (r.partial ? " " + fmt(r.hours) + "h" : ""));
          bar.type = "button";
          bar.title = absTypeLabel(r) + " · " + leavePeriodLabel(r) + " · " + leaveStatusLabel(r);
          bar.onclick = function(ev){ ev.stopPropagation(); openLeaveDetail(r); };
          cell.appendChild(bar);
        });
        if(state.lvShowTeam){
          var out = team.filter(function(r){ return onLeaveDay(r, d); });
          if(out.length){
            var names = out.slice(0, 2).map(function(r){ return shortName(r.EmployeeName); }).join(", ") + (out.length > 2 ? " +" + (out.length - 2) : "");
            var tm = el("span","lvteam", names);
            tm.title = out.map(function(r){ return r.EmployeeName + ", " + colleagueTypeLabel(r) + " (" + leaveStatusLabel(r) + ")"; }).join("\n");
            cell.appendChild(tm);
          }
        }
        if(!we && !hol){
          cell.setAttribute("role", "button");
          cell.tabIndex = 0;
          cell.onclick = function(){ pickLeaveDay(d); };
          cell.onkeydown = function(ev){ if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); pickLeaveDay(d); } };
        }
        cal.appendChild(cell);
      })(d);
    }
    legend($("lvCalLegend"), [["approved", t("legend_approved")], ["pending", t("legend_pending")], ["cancel", t("legend_cancel")], ["hol", t("legend_holiday")], ["team", t("legend_team")]]);
  }
  /* first click picks the first day, the second the last one, then the
     request opens with that period */
  function pickLeaveDay(d){
    if(!state.lvPick){ state.lvPick = d; renderMyCalendar(); return; }
    var a = state.lvPick, b = d;
    state.lvPick = null;
    if(b < a){ var x = a; a = b; b = x; }
    renderMyCalendar();
    openLeaveDialog({StartDate:a, EndDate:b});
  }

  /* ---- the employee: requests ---- */
  function isUpcomingLeave(r){ return (leaveActive(r) || r.cancelRequested) && r.EndDate >= todayISO(); }
  function renderMyLeave(){
    var body = $("lvMineBody");
    body.innerHTML = "";
    var f = state.lvFilter || "upcoming";
    Array.prototype.forEach.call(document.querySelectorAll("#lvFilter button"), function(b){ b.setAttribute("aria-pressed", b.dataset.f === f ? "true" : "false"); });
    var list = myLeave().filter(function(r){ return f === "all" || (f === "upcoming") === isUpcomingLeave(r); })
      .sort(function(x, y){ var asc = f === "upcoming"; return (x.StartDate < y.StartDate ? -1 : x.StartDate > y.StartDate ? 1 : 0) * (asc ? 1 : -1); });
    $("lvMineCount").textContent = plural(list.length, "n_requests");
    if(!list.length){
      var tr0 = document.createElement("tr"), td0 = td2(t("text_no_requests_filter"), "sub");
      td0.colSpan = 7; tr0.appendChild(td0); body.appendChild(tr0);
      return;
    }
    list.forEach(function(r){
      var tr = document.createElement("tr");
      tr.appendChild(td2(r.RequestID, "num"));
      var ty = document.createElement("td");
      var link = el("button","lvlink", absTypeLabel(r));
      link.type = "button";
      link.onclick = function(){ openLeaveDetail(r); };
      ty.appendChild(link);
      if(r.origin === "Joule") ty.appendChild(el("div","sub", t("origin_joule_short")));
      if(r.Attachment) ty.appendChild(el("div","sub", "📎 " + r.Attachment));
      tr.appendChild(ty);
      var per = document.createElement("td");
      per.appendChild(el("div","", leavePeriodLabel(r)));
      if(r.Notes) per.appendChild(el("div","sub", r.Notes));
      tr.appendChild(per);
      tr.appendChild(td2(leaveDurationLabel(r), "n"));
      var st = document.createElement("td");
      st.appendChild(el("span","chip " + leaveStatusClass(r), leaveStatusLabel(r)));
      if(r.ApproverComment) st.appendChild(el("div","sub", "“" + r.ApproverComment + "”"));
      tr.appendChild(st);
      tr.appendChild(td2(r.ApproverName || lineManager().name, ""));
      var act = document.createElement("td");
      var acts = el("div","lvacts","");
      if(canEditLeave(r)) acts.appendChild(btn(t("btn_edit"), "btn sm", function(){ openLeaveDialog(r); }));
      if(canWithdraw(r)) acts.appendChild(btn(r.StatusID === "SENT" ? t("btn_withdraw") : t("btn_request_cancel"), "btn sm", function(){ withdrawFromScreen(r); }));
      act.appendChild(acts);
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }
  function withdrawFromScreen(r){
    var res = withdrawLeave(r);
    toast(t(res === "withdrawn" ? "toast_leave_withdrawn" : "toast_leave_cancel_requested", {id: r.RequestID, name: r.ApproverName}));
  }

  /* ---- detail of a request, for both sides ---- */
  function leaveWorkflow(r){
    var mgr = r.ApproverName || LINE_MANAGER[r.bukrs || IT0001.bukrs].name, steps = [];
    if(r.onBehalf) steps.push({cls:"ok", txt:t("wf_onbehalf", {name: r.onBehalf}), when:fmtStamp(r.created)});
    else steps.push({cls:"ok", txt:t("wf_submitted", {name: r.EmployeeName}), when:fmtStamp(r.created)});
    if(r.changed) steps.push({cls:"ok", txt:t("wf_changed"), when:r.changed});
    if(r.StatusID === "SENT") steps.push({cls:"wait", txt:t("wf_waiting", {name: mgr})});
    else if(r.StatusID === "REJECTED") steps.push({cls:"bad", txt:t("wf_rejected", {name: r.decidedBy || mgr}), when:r.decidedAt, note:r.ApproverComment});
    else if(r.StatusID === "WITHDRAWN" && r.decisionKind !== "cancel") steps.push({cls:"", txt:t("wf_withdrawn")});
    else if(!r.onBehalf) steps.push({cls:"ok", txt:t("wf_approved", {name: r.decisionKind === "cancel" ? mgr : (r.decidedBy || mgr)}), when: r.decisionKind === "cancel" ? "" : r.decidedAt, note: r.decisionKind === "cancel" ? "" : r.ApproverComment});
    if(r.cancelRequested) steps.push({cls:"wait", txt:t("wf_cancel_waiting", {name: mgr})});
    if(r.StatusID === "WITHDRAWN" && r.decisionKind === "cancel") steps.push({cls:"ok", txt:t("wf_cancelled", {name: r.decidedBy || mgr}), when:r.decidedAt, note:r.ApproverComment});
    if(r.StatusID === "POSTED") steps.push({cls:"ok", txt:t("wf_posted")});
    return steps;
  }
  function openLeaveDetail(r){
    var mgrView = state.role === "manager";
    $("ldTitle").textContent = t("dlg_leave_detail", {id: r.RequestID});
    var stc = $("ldStatus");
    stc.className = "chip " + leaveStatusClass(r);
    stc.textContent = leaveStatusLabel(r);
    var body = $("ldBody");
    body.innerHTML = "";
    var dl = el("dl","lvdl","");
    function line(k, v){ if(v === "" || v == null) return; dl.appendChild(el("dt","", k)); var dd = el("dd","", ""); if(typeof v === "string") dd.textContent = v; else dd.appendChild(v); dl.appendChild(dd); }
    if(r.EmployeeID !== selfId()) line(t("th_employee"), r.EmployeeName + (r.role ? " · " + r.role : ""));
    line(t("label_absence_type"), absTypeLabel(r));
    line(t("th_period"), leavePeriodLabel(r));
    line(t("th_duration"), leaveDurationLabel(r) + (leaveHolidaysIn(r) ? " · " + plural(leaveHolidaysIn(r), "n_holidays_skipped") : ""));
    var after = r.EmployeeID === selfId() || reportById(r.EmployeeID) ? leaveAvailableAfter(r) : null;
    if(after !== null) line(t("label_balance_after"), fmtDays(after) + " " + t("unit_days"));
    line(t("label_note"), r.Notes || "");
    var ty = absType(r.AbsenceTypeCode);
    if(r.Attachment) line(t("label_attachment"), "📎 " + r.Attachment);
    else if(ty && ty.attach && r.EmployeeID === selfId() && leaveActive(r)){
      var wrap = el("span","","");
      var inp = document.createElement("input");
      inp.type = "file";
      inp.setAttribute("aria-label", t("label_attachment") + ", " + attachDoc(ty));
      inp.onchange = function(){
        if(!inp.files || !inp.files[0]) return;
        r.Attachment = inp.files[0].name;
        toast(t("toast_attached", {file: r.Attachment, id: r.RequestID}));
        render();
        openLeaveDetail(r);
      };
      wrap.appendChild(inp);
      wrap.appendChild(el("div","lvattlbl", attachDoc(ty) + ". " + t("text_attach_local")));
      line(t("label_attachment"), wrap);
    }
    if(r.ApproverComment) line(t("label_manager_comment"), "“" + r.ApproverComment + "”");
    body.appendChild(dl);
    body.appendChild(el("div","lvsec", t("hdr_workflow")));
    var ul = el("ul","wf","");
    leaveWorkflow(r).forEach(function(st){
      var li = el("li", st.cls, "");
      li.appendChild(el("span","dot",""));
      var tx = el("div","", st.txt);
      if(st.when) tx.appendChild(el("small","", st.when));
      if(st.note) tx.appendChild(el("small","", "“" + st.note + "”"));
      li.appendChild(tx);
      ul.appendChild(li);
    });
    body.appendChild(ul);
    body.appendChild(el("div","lvsec", t("hdr_also_absent")));
    var ov = leaveOverlaps(r);
    if(!ov.length) body.appendChild(el("p","sub", t("text_nobody_else")));
    else {
      var ol = el("ul","wf","");
      ov.forEach(function(o){
        var li = el("li", o.StatusID === "SENT" ? "wait" : "ok", "");
        li.appendChild(el("span","dot",""));
        var tx = el("div","", o.EmployeeName + " · " + colleagueTypeLabel(o));
        tx.appendChild(el("small","", leavePeriodLabel(o) + " · " + leaveStatusLabel(o)));
        li.appendChild(tx);
        ol.appendChild(li);
      });
      body.appendChild(ol);
    }
    var acts = $("ldActs");
    acts.innerHTML = "";
    function act(label, cls, fn){ var b = btn(label, cls, function(){ $("dlgLvDetail").close(); fn(); }); b.type = "button"; acts.appendChild(b); }
    var inQueue = mgrView && leaveQueue().indexOf(r) !== -1;
    if(inQueue){
      act(t("btn_reject"), "btn", function(){ openRejectLeave(r); });
      act(t("btn_approve"), "btn primary", function(){
        decideLeave(r, true, "");
        toast(t(r.decisionKind === "cancel" ? "toast_leave_cancel_approved" : "toast_leave_approved", {name: r.EmployeeName, id: r.RequestID}));
      });
    }
    if(canEditLeave(r)) act(t("btn_edit"), "btn", function(){ openLeaveDialog(r); });
    if(canWithdraw(r)) act(r.StatusID === "SENT" ? t("btn_withdraw") : t("btn_request_cancel"), "btn", function(){ withdrawFromScreen(r); });
    var close = btn(t("btn_close"), "btn" + (inQueue ? "" : " primary"), function(){ $("dlgLvDetail").close(); });
    close.type = "button";
    acts.appendChild(close);
    $("dlgLvDetail").showModal();
  }

  /* ---- the line manager: requests to approve, several at once ---- */
  function lvSelKey(r){ return IT0001.bukrs + ":" + r.RequestID; }
  function renderLeaveQueue(){
    var body = $("lvTeamBody");
    body.innerHTML = "";
    var q = leaveQueue();
    state.lvSel = state.lvSel || {};
    Object.keys(state.lvSel).forEach(function(k){ if(!q.some(function(r){ return lvSelKey(r) === k; })) delete state.lvSel[k]; });
    $("lvTeamCount").textContent = plural(q.length, "n_requests");
    lvSelSync(q);
    if(!q.length){
      var tr0 = document.createElement("tr");
      var td0 = td2(t("text_leave_queue_empty"), "");
      td0.colSpan = 8;
      tr0.appendChild(td0);
      body.appendChild(tr0);
      return;
    }
    q.forEach(function(r){
      var tr = document.createElement("tr");
      var cb = document.createElement("td");
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!state.lvSel[lvSelKey(r)];
      box.setAttribute("aria-label", r.EmployeeName + ", " + absTypeLabel(r));
      box.onchange = function(){ if(box.checked) state.lvSel[lvSelKey(r)] = true; else delete state.lvSel[lvSelKey(r)]; lvSelSync(leaveQueue()); };
      cb.appendChild(box);
      tr.appendChild(cb);
      var who = document.createElement("td");
      var link = el("button","lvlink", r.EmployeeName);
      link.type = "button";
      link.onclick = function(){ openLeaveDetail(r); };
      who.appendChild(link);
      who.appendChild(el("div","sub", (r.role || t("role_employee")) + " · " + r.RequestID));
      tr.appendChild(who);
      var ty = document.createElement("td");
      ty.appendChild(el("div","", absTypeLabel(r)));
      if(r.cancelRequested) ty.appendChild(el("span","chip amber", t("lr_status_cancel_requested")));
      else if(r.Notes) ty.appendChild(el("div","sub", r.Notes));
      if(r.Attachment) ty.appendChild(el("div","sub", "📎 " + r.Attachment));
      tr.appendChild(ty);
      var per = document.createElement("td");
      per.appendChild(el("div","", leavePeriodLabel(r)));
      var du = daysUntil(r.StartDate);
      per.appendChild(el("div","sub", du === 0 ? t("text_starts_today_or_past") : plural(du, "text_starts_in_days")));
      tr.appendChild(per);
      tr.appendChild(td2(leaveDurationLabel(r), "n"));
      var after = leaveAvailableAfter(r);
      tr.appendChild(td2(after === null ? "–" : fmtDays(after) + " " + t("unit_days"), "n" + (after !== null && after < 0 ? " neg" : "")));
      var ov = leaveOverlaps(r);
      var ovTd = document.createElement("td");
      if(ov.length) ov.forEach(function(o){ ovTd.appendChild(el("div","sub", o.EmployeeName + ", " + leavePeriodLabel(o))); });
      else ovTd.appendChild(el("span","sub", t("text_no_overlap")));
      tr.appendChild(ovTd);
      var act = document.createElement("td");
      var acts = el("div","lvacts","");
      acts.appendChild(btn(t("btn_approve"), "btn sm primary", function(){
        decideLeave(r, true, "");
        toast(t(r.decisionKind === "cancel" ? "toast_leave_cancel_approved" : "toast_leave_approved", {name: r.EmployeeName, id: r.RequestID}));
      }));
      acts.appendChild(btn(t("btn_reject"), "btn sm", function(){ openRejectLeave(r); }));
      act.appendChild(acts);
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }
  /* the selection count and the "select all" box, without redrawing rows */
  function lvSelSync(q){
    var nSel = q.filter(function(r){ return state.lvSel[lvSelKey(r)]; }).length;
    $("lvMassApprove").textContent = t("btn_approve_selected_n", {n: nSel});
    $("lvMassApprove").disabled = !nSel;
    $("lvSelAll").checked = q.length > 0 && nSel === q.length;
    $("lvSelAll").disabled = !q.length;
  }
  function approveSelectedLeave(){
    var picked = leaveQueue().filter(function(r){ return state.lvSel && state.lvSel[lvSelKey(r)]; });
    picked.forEach(function(r){ decideLeave(r, true, ""); });
    state.lvSel = {};
    render();
    if(picked.length) toast(plural(picked.length, "n_leave_approved"));
  }

  /* ---- team absence calendar, as in SuccessFactors ----
     On the left, who's in view: the line manager's direct reports (one
     level further down on demand) or their peers; for an employee, the
     colleagues under the same manager. Each person can be ticked off,
     searched, or the list cut down to who's absent in the period. On the
     right, Day, Week or Month, with one bar per absence across its days
     and the public holidays marked on every row. A colleague's health
     related absence shows only as an absence, without the reason. */
  var SENSITIVE_TYPES = ["0200","0210"];
  /* a colleague's absence as anyone but their line manager may see it */
  function colleagueTypeLabel(r){
    return state.role === "manager" || r.EmployeeID === selfId() || SENSITIVE_TYPES.indexOf(r.AbsenceTypeCode) === -1 ? absTypeLabel(r) : t("text_absent_generic");
  }
  function tacState(){
    if(!state.tac) state.tac = {view:"month", anchor:todayISO(), tab:"reports", hidden:{}, expanded:{}, absentOnly:false, q:"", status:"all", type:"", full:false};
    return state.tac;
  }
  /* an employee only has colleagues to look at */
  function tacTab(st){ return state.role === "manager" ? st.tab : "peers"; }
  function tacRange(st){
    if(st.view === "day") return {from:st.anchor, to:st.anchor};
    if(st.view === "week"){ var m = mondayOf(st.anchor); return {from:m, to:isoAdd(m, 6)}; }
    var key = st.anchor.slice(0,6);
    return {from:key + "01", to:isoAdd(monthAdd(key, 1) + "01", -1)};
  }
  function tacPeople(st){
    var b = IT0001.bukrs, out = [];
    if(tacTab(st) === "reports"){
      reportsOf(b).forEach(function(m){
        var subs = SUB_REPORTS[m.EmployeeID] || [];
        out.push({id:m.EmployeeID, name:m.name, role:m.role, subs:subs.length, level:0, own:true});
        if(st.expanded[m.EmployeeID]) subs.forEach(function(x){ out.push({id:x.EmployeeID, name:x.name, role:x.role, subs:0, level:1, own:true}); });
      });
    } else if(state.role === "manager"){
      var mgr = lineManager();
      out.push({id:mgr.pernr, name:mgr.name, role:mgr.role, subs:reportsOf(b).length, level:0, self:true, own:true});
      MANAGER_PEERS[b].forEach(function(m){ out.push({id:m.EmployeeID, name:m.name, role:m.role, subs:0, level:0, own:false}); });
    } else {
      var me = selfId();
      reportsOf(b).forEach(function(m){ out.push({id:m.EmployeeID, name:m.name, role:m.role, subs:0, level:0, self:m.EmployeeID === me, own:m.EmployeeID === me}); });
    }
    return out;
  }
  function tacRequests(person, st, range){
    return requestsOf(person.id).filter(function(r){
      if(!(leaveActive(r) || r.cancelRequested) || r.EndDate < range.from || r.StartDate > range.to) return false;
      if(st.type && r.AbsenceTypeCode !== st.type) return false;
      var k = leaveStateKey(r);
      if(st.status === "approved" && k !== "approved") return false;
      if(st.status === "pending" && k === "approved") return false;
      return true;
    });
  }
  function initials(n){ var p = String(n).split(" "); return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : "")).toUpperCase(); }
  function avatar(n){ return el("span","av", initials(n)); }
  function shortRangeLabel(r){
    var s = r.StartDate, e = r.EndDate;
    if(s === e) return (+s.slice(6,8)) + " " + MONTHS[+s.slice(4,6)-1] + (r.partial && r.StartTime ? ", " + r.StartTime + "–" + r.EndTime : r.partial ? ", " + fmt(r.hours) + " h" : "");
    var sm = +s.slice(4,6)-1, em = +e.slice(4,6)-1;
    return sm === em ? t("label_range_same_month", {d1: +s.slice(6,8), d2: +e.slice(6,8), month: MONTHS[sm]})
                     : t("label_range_diff_month", {d1: +s.slice(6,8), m1: MONTHS[sm], d2: +e.slice(6,8), m2: MONTHS[em]});
  }
  function renderTeamCalendar(){
    if(!$("lvTcGrid")) return;
    var st = tacState(), mgrView = state.role === "manager";
    if($("tcSub")) $("tcSub").textContent = mgrView ? t("text_tc_sub_manager") : t("text_tc_sub");
    var range = tacRange(st), today = todayISO();
    /* toolbar */
    $("lvTcLabel").textContent = st.view === "day" ? fmtDateShort(range.from) + " " + range.from.slice(0,4) : t("leave_range", {from: fmtDate(range.from), to: fmtDate(range.to)});
    Array.prototype.forEach.call(document.querySelectorAll("#lvTcView button"), function(b){ b.setAttribute("aria-pressed", b.dataset.v === st.view ? "true" : "false"); });
    Array.prototype.forEach.call(document.querySelectorAll("#lvTcTabs button"), function(b){ b.setAttribute("aria-pressed", b.dataset.t === tacTab(st) ? "true" : "false"); });
    Array.prototype.forEach.call(document.querySelectorAll("#lvTcStatus button"), function(b){ b.setAttribute("aria-pressed", b.dataset.s === st.status ? "true" : "false"); });
    $("lvTcTabs").hidden = !mgrView;
    $("lvTcSideHd").textContent = mgrView ? (tacTab(st) === "reports" ? t("hdr_my_hierarchy") : t("tab_peers")) : t("hdr_my_colleagues");
    $("lvTeamCalPanel").classList.toggle("full", !!st.full);
    var sel = $("lvTcType");
    sel.innerHTML = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = t("filter_all_types"); sel.appendChild(o0);
    ABSENCE_TYPES.forEach(function(x){ var o = document.createElement("option"); o.value = x.code; o.textContent = t("abs_" + x.code); sel.appendChild(o); });
    sel.value = st.type;
    if($("lvTcSearch").value !== st.q) $("lvTcSearch").value = st.q;
    $("lvTcAbsent").checked = !!st.absentOnly;

    /* who's in view */
    var q = foldText(st.q).trim();
    var people = tacPeople(st);
    var matching = people.filter(function(pp){ return !q || foldText(pp.name).indexOf(q) !== -1; });
    var absentIds = {};
    matching.forEach(function(pp){ if(tacRequests(pp, st, range).length) absentIds[pp.id] = true; });
    $("lvTcAbsentLbl").textContent = t("label_absent_n", {n: Object.keys(absentIds).length});
    /* each person is listed once, in the calendar itself: the box beside the
       name shows or hides their absences, and an unticked row stays in place,
       greyed, so it can be ticked again */
    var shown = matching.filter(function(pp){ return !st.absentOnly || absentIds[pp.id]; });

    /* the grid */
    var days = [];
    for(var d = range.from; d <= range.to; d = isoAdd(d, 1)) days.push(d);
    var minW = st.view === "month" ? 30 : st.view === "week" ? 96 : 320;
    var grid = $("lvTcGrid");
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = "200px repeat(" + days.length + ", minmax(" + minW + "px, 1fr))";
    /* narrow screens scroll sideways instead of squeezing the days */
    grid.style.minWidth = (200 + days.length * minW) + "px";
    function put(node, row, col, span){
      node.style.gridRow = String(row);
      node.style.gridColumn = col + (span ? " / span " + span : "");
      grid.appendChild(node);
    }
    /* row 1: days, row 2: weeks */
    var allBox = el("label","tccorner tcall","");
    var allCb = document.createElement("input");
    allCb.type = "checkbox";
    allCb.checked = shown.length > 0 && shown.every(function(pp){ return !st.hidden[pp.id]; });
    allCb.indeterminate = !allCb.checked && shown.some(function(pp){ return !st.hidden[pp.id]; });
    allCb.onchange = function(){ shown.forEach(function(pp){ if(allCb.checked) delete st.hidden[pp.id]; else st.hidden[pp.id] = true; }); renderTeamCalendar(); };
    allBox.appendChild(allCb);
    allBox.appendChild(el("span","", $("lvTcSideHd").textContent));
    put(allBox, 1, 1);
    put(el("div","tccorner",""), 2, 1);
    days.forEach(function(d, i){
      var hol = holidayOn(d), we = weekdayOf(d) > 4 || !!hol;
      var h = el("div","tch" + (we ? " we" : "") + (d === today ? " today" : ""), "");
      h.appendChild(el("div","", st.view === "day" ? fmtDateShort(d) : WEEKDAY_ABBR[weekdayOf(d)]));
      if(st.view !== "day") h.appendChild(el("span","n", String(+d.slice(6,8))));
      if(hol) h.title = holidayName(hol);
      put(h, 1, i + 2);
    });
    var w0 = 0;
    while(w0 < days.length){
      var wk = isoWeekOf(days[w0]), span = 0;
      while(w0 + span < days.length && isoWeekOf(days[w0 + span]) === wk) span++;
      put(el("div","tcw", t("label_week_short", {n: wk})), 2, w0 + 2, span);
      w0 += span;
    }
    if(!shown.length){
      var em = el("div","tacempty", t("text_tac_nobody"));
      put(em, 3, 1, days.length + 1);
    }
    shown.forEach(function(pp, ri){
      var row = ri + 3;
      var off = !!st.hidden[pp.id];
      var nm = el("div","tcname" + (pp.level ? " lvl1" : "") + (off ? " off" : ""), "");
      if(pp.subs && tacTab(st) === "reports"){
        var ex = el("button","exp", st.expanded[pp.id] ? "▾" : "▸");
        ex.type = "button";
        ex.setAttribute("aria-label", t("aria_expand_reports", {name: pp.name}));
        ex.onclick = function(){ st.expanded[pp.id] = !st.expanded[pp.id]; renderTeamCalendar(); };
        nm.appendChild(ex);
      }
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !off;
      cb.setAttribute("aria-label", t("aria_show_person", {name: pp.name}));
      cb.onchange = function(){ if(cb.checked) delete st.hidden[pp.id]; else st.hidden[pp.id] = true; renderTeamCalendar(); };
      nm.appendChild(cb);
      nm.appendChild(avatar(pp.name));
      var tx = el("div","", "");
      tx.appendChild(el("div","who", pp.name + (pp.self ? " (" + t("text_you_suffix") + ")" : "")));
      tx.appendChild(el("small","", pp.subs ? plural(pp.subs, "n_direct_reports") : pp.role));
      nm.appendChild(tx);
      put(nm, row, 1);
      days.forEach(function(d, i){
        var hol = holidayOn(d);
        var cell = el("div","tcd" + (weekdayOf(d) > 4 || hol ? " we" : "") + (d === today ? " today" : ""), "");
        if(hol) cell.title = holidayName(hol);
        put(cell, row, i + 2);
        /* in the month the days are too narrow for the name: the shading and
           the day's tooltip say it */
        if(hol && st.view !== "month"){
          var tag = el("span","tchol", holidayName(hol));
          tag.title = holidayName(hol);
          put(tag, row, i + 2);
        }
      });
      if(!off) tacRequests(pp, st, range).forEach(function(r){
        var a = r.StartDate < range.from ? range.from : r.StartDate, z = r.EndDate > range.to ? range.to : r.EndDate;
        var c0 = days.indexOf(a), c1 = days.indexOf(z);
        if(c0 === -1 || c1 === -1) return;
        var full = pp.own || (mgrView && tacTab(st) === "reports");
        var label = full || SENSITIVE_TYPES.indexOf(r.AbsenceTypeCode) === -1 ? absTypeLabel(r) : t("text_absent_generic");
        var bar = el("button","tcbar " + leaveStateKey(r) + (full ? "" : " ro"), "");
        bar.type = "button";
        bar.appendChild(el("b","", label));
        bar.appendChild(el("span","", shortRangeLabel(r)));
        bar.title = pp.name + " · " + label + " · " + leavePeriodLabel(r) + " · " + leaveStatusLabel(r);
        bar.setAttribute("aria-label", bar.title);
        if(full) bar.onclick = function(){ openLeaveDetail(r); };
        put(bar, row, c0 + 2, c1 - c0 + 1);
      });
    });
    /* the month opens scrolled to today when it doesn't all fit */
    var ti = days.indexOf(today), main = $("lvTcMain");
    if(main) main.scrollLeft = ti === -1 ? 0 : Math.max(0, 200 + ti * minW - main.clientWidth / 2);
    var leg = [["approved", t("legend_approved")], ["pending", t("legend_pending")], ["cancel", t("legend_cancel")], ["hol", t("legend_holiday_weekend")]];
    legend($("lvTcLegend"), leg);
    if(tacTab(st) === "peers") $("lvTcLegend").appendChild(el("span","", t("text_tac_privacy")));
  }
  function tacMove(dir){
    var st = tacState();
    if(dir === 0) st.anchor = todayISO();
    else if(st.view === "day") st.anchor = isoAdd(st.anchor, dir);
    else if(st.view === "week") st.anchor = isoAdd(st.anchor, 7 * dir);
    else st.anchor = monthAdd(st.anchor.slice(0,6), dir) + "01";
    renderTeamCalendar();
  }

  /* ---- the line manager: the leave approval console ----
     The same shape as the timesheet approval console: requests without
     warnings can be approved together, the exceptions (an overlap in the
     team, a balance going negative, a cancellation, a retroactive request,
     sick leave without a certificate) one by one, each line opening its
     days with who else is off. "All" brings back what was decided in this
     session, read only. */
  function leaveWarnings(r){
    var out = [];
    if(r.cancelRequested) out.push(t("lvw_cancel"));
    var ov = leaveOverlaps(r);
    if(ov.length) out.push(t("lvw_overlap", {names: ov.map(function(o){ return o.EmployeeName.split(" ")[0]; }).filter(function(n, i, a){ return a.indexOf(n) === i; }).join(", ")}));
    var after = leaveAvailableAfter(r);
    if(after !== null && after < 0) out.push(t("lvw_balance"));
    if(r.StartDate < todayISO() && !r.cancelRequested) out.push(t("lvw_retro"));
    var ty = absType(r.AbsenceTypeCode);
    if(ty && ty.attach === "required" && !r.Attachment) out.push(t("lvw_no_attachment_doc", {doc: attachDoc(ty)}));
    return out;
  }
  function renderLeaveApprovals(){
    var body = $("laBody");
    if(!body || state.role !== "manager") return;
    var mgr = lineManager();
    $("laActingAs").textContent = mgr.name + " · " + mgr.role;
    $("laSub").textContent = t("text_leave_sub_manager", {name: mgr.name});
    state.laSel = state.laSel || {};
    state.laExp = state.laExp || {};
    var q = leaveQueue();
    Object.keys(state.laSel).forEach(function(k){ if(!q.some(function(r){ return lvSelKey(r) === k; })) delete state.laSel[k]; });
    var clean = q.filter(function(r){ return !leaveWarnings(r).length; });
    var flagged = q.filter(function(r){ return leaveWarnings(r).length; });
    $("laPend").textContent = q.length;
    $("laDays").innerHTML = fmtDays(q.reduce(function(a, r){ return a + (r.cancelRequested ? 0 : leaveDays(r)); }, 0)) + "<small> " + t("unit_days") + "</small>";
    $("laWarn").textContent = flagged.length;
    $("laSoon").textContent = q.filter(function(r){ return daysUntil(r.StartDate) <= 14; }).length;
    var showAll = state.laFilter === "all";
    Array.prototype.forEach.call(document.querySelectorAll("#laFilter button"), function(b){
      b.setAttribute("aria-pressed", (b.dataset.f === "all") === showAll ? "true" : "false");
    });
    body.innerHTML = "";
    function row(r, decided){
      var key = lvSelKey(r), warns = decided ? [] : leaveWarnings(r);
      var tr = document.createElement("tr");
      var c1 = document.createElement("td");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !decided && !warns.length && !!state.laSel[key];
      cb.disabled = decided || warns.length > 0;
      cb.setAttribute("aria-label", t("aria_select_leave_for", {name: r.EmployeeName}));
      cb.onchange = function(){ if(cb.checked) state.laSel[key] = true; else delete state.laSel[key]; laSelSync(); };
      c1.appendChild(cb);
      tr.appendChild(c1);
      var c2 = document.createElement("td");
      var who = document.createElement("button");
      who.type = "button";
      who.className = "apwho";
      who.setAttribute("aria-expanded", state.laExp[key] ? "true" : "false");
      var chev = el("span","apchev", state.laExp[key] ? "▾" : "▸");
      var wtxt = el("span","","");
      wtxt.appendChild(el("div","who", r.EmployeeName));
      wtxt.appendChild(el("div","sub", (r.role || t("role_employee")) + " · " + r.RequestID));
      who.appendChild(chev); who.appendChild(wtxt);
      who.onclick = function(){ state.laExp[key] = !state.laExp[key]; renderLeaveApprovals(); };
      c2.appendChild(who);
      tr.appendChild(c2);
      var c3 = document.createElement("td");
      c3.appendChild(el("div","", absTypeLabel(r)));
      if(r.cancelRequested) c3.appendChild(el("div","sub", t("text_cancellation")));
      else if(r.Notes) c3.appendChild(el("div","sub", r.Notes));
      tr.appendChild(c3);
      var c4 = document.createElement("td");
      c4.appendChild(el("div","", leavePeriodLabel(r)));
      var du = daysUntil(r.StartDate);
      if(!decided) c4.appendChild(el("div","sub", du === 0 ? t("text_starts_today_or_past") : plural(du, "text_starts_in_days")));
      tr.appendChild(c4);
      tr.appendChild(td2(leaveDurationLabel(r), "n"));
      var after = decided ? null : leaveAvailableAfter(r);
      tr.appendChild(td2(after === null ? "–" : fmtDays(after) + " " + t("unit_days"), "n" + (after !== null && after < 0 ? " neg" : "")));
      var c7 = document.createElement("td");
      if(decided) c7.appendChild(el("span","chip " + (r.decision === "approved" ? "green" : "grey"), t(r.decision === "approved" ? "chip_approved" : "chip_rejected")));
      else if(warns.length) warns.forEach(function(w){ c7.appendChild(el("span","chip amber", w)); });
      else c7.appendChild(el("span","chip blue", t("chip_in_approval")));
      tr.appendChild(c7);
      body.appendChild(tr);
      if(state.laExp[key]){
        var dtr = document.createElement("tr");
        dtr.className = "apdetail";
        var dtd = document.createElement("td");
        dtd.colSpan = 7;
        var days = el("div","apdays","");
        eachLeaveDay(r, function(d){
          var others = absentOn(d).filter(function(o){ return o.EmployeeID !== r.EmployeeID; });
          var chip = el("span","apday" + (others.length ? " busy" : ""), fmtDateShort(d) + " · " + (others.length ? t("text_n_also_out", {n: others.length}) : t("text_team_complete")));
          if(others.length) chip.title = others.map(function(o){ return o.EmployeeName; }).join(", ");
          days.appendChild(chip);
        });
        dtd.appendChild(days);
        var info = [];
        if(r.Attachment) info.push("📎 " + r.Attachment);
        if(r.ApproverComment) info.push("“" + r.ApproverComment + "”");
        if(info.length) dtd.appendChild(el("p","sub", info.join(" · ")));
        var acts = el("div","lvacts laacts","");
        if(!decided){
          acts.appendChild(btn(t("btn_approve"), "btn sm primary", function(){
            decideLeave(r, true, "");
            toast(t(r.decisionKind === "cancel" ? "toast_leave_cancel_approved" : "toast_leave_approved", {name: r.EmployeeName, id: r.RequestID}));
          }));
          acts.appendChild(btn(t("btn_reject"), "btn sm", function(){ openRejectLeave(r); }));
        }
        acts.appendChild(btn(t("btn_view_request"), "btn sm", function(){ openLeaveDetail(r); }));
        dtd.appendChild(acts);
        dtr.appendChild(dtd);
        body.appendChild(dtr);
      }
    }
    function group(title, list, decided){
      if(!list.length) return;
      var gh = document.createElement("tr");
      gh.className = "grouphead";
      var td = document.createElement("td");
      td.colSpan = 7; td.textContent = title;
      gh.appendChild(td); body.appendChild(gh);
      list.forEach(function(r){ row(r, decided); });
    }
    group(t("hdr_no_warnings_group"), clean, false);
    group(t("hdr_exceptions_group"), flagged, false);
    if(showAll) group(t("hdr_decided_group"), leaveDecidedThisSession(), true);
    if(!body.children.length){
      var er = document.createElement("tr");
      var et = td2(t("text_la_none_pending"), "sub");
      et.colSpan = 7;
      er.appendChild(et);
      body.appendChild(er);
    }
    $("laSelClean").textContent = plural(clean.length, "btn_select_clean");
    $("laSelClean").disabled = !clean.length;
    $("laAll").disabled = !clean.length;
    laSelSync();
    renderNavBadges();
  }
  function laSelSync(){
    var q = leaveQueue().filter(function(r){ return !leaveWarnings(r).length; });
    var n = q.filter(function(r){ return state.laSel[lvSelKey(r)]; }).length;
    $("laSel").textContent = plural(n, "n_selected");
    $("laApprove").disabled = !n;
    $("laAll").checked = q.length > 0 && n === q.length;
  }
  function approveLeaveConsole(){
    var picked = leaveQueue().filter(function(r){ return state.laSel[lvSelKey(r)] && !leaveWarnings(r).length; });
    picked.forEach(function(r){ decideLeave(r, true, ""); });
    state.laSel = {};
    render();
    if(picked.length) toast(plural(picked.length, "n_leave_approved"));
  }

  /* ---- the line manager: team balances, and recording on behalf ---- */
  function renderTeamBalances(){
    var body = $("lvBalBody");
    body.innerHTML = "";
    $("lvBalYear").textContent = String(QUOTA[IT0001.bukrs].year);
    reportsOf().forEach(function(m){
      var bal = balanceOf(m.EmployeeID);
      var tr = document.createElement("tr");
      var who = document.createElement("td");
      who.appendChild(el("div","who", m.name));
      who.appendChild(el("div","sub", m.role));
      tr.appendChild(who);
      tr.appendChild(td2(fmtDays(bal.total), "n"));
      tr.appendChild(td2(fmtDays(bal.taken), "n"));
      tr.appendChild(td2(fmtDays(bal.planned), "n"));
      tr.appendChild(td2(fmtDays(bal.requested), "n"));
      tr.appendChild(td2(fmtDays(bal.available), "n who" + (bal.available < 0 ? " neg" : "")));
      var act = document.createElement("td");
      act.appendChild(btn(t("btn_record_leave"), "btn sm", function(){ openLeaveDialog({EmployeeID: m.EmployeeID}); }));
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }

  /* ---------- new request dialog ---------- */
  function openLeaveDialog(prefill){ return inUiLang(function(){ openLeaveDialogNow(prefill); }); }
  function openLeaveDialogNow(prefill){
    var p = prefill || {};
    var dlg = $("dlgLeave");
    var emp = p.EmployeeID || selfId(), onBehalf = emp !== selfId(), editing = !!(p.RequestID && p.StatusID === "SENT");
    dlg.dataset.emp = emp;
    dlg.dataset.edit = editing ? p.RequestID : "";
    dlg.dataset.att = editing ? (p.Attachment || "") : "";
    var who = reportById(emp) || {name: currentActor().name};
    $("lvDlgTitle").textContent = editing ? t("dlg_edit_leave", {id: p.RequestID}) : onBehalf ? t("dlg_leave_for", {name: who.name}) : t("dlg_new_leave_title");
    $("lvSubmit").textContent = editing ? t("btn_save_changes") : onBehalf ? t("btn_record_leave") : t("btn_send_request");
    $("lvAtt").value = "";
    var sel = $("lvType");
    sel.innerHTML = "";
    ABSENCE_TYPES.forEach(function(ty){
      var o = document.createElement("option");
      o.value = ty.code; o.textContent = t("abs_" + ty.code);
      sel.appendChild(o);
    });
    sel.value = p.AbsenceTypeCode || "0100";
    var start = p.StartDate || nextWorkday(todayISO());
    $("lvStart").value = isoToDmy(start);
    $("lvEnd").value = isoToDmy(p.EndDate || start);
    $("lvPartial").checked = !!p.partial;
    $("lvHours").value = p.partial && p.hours ? String(p.hours) : "4";
    $("lvBeg").value = p.StartTime || "09:00";
    $("lvFin").value = p.EndTime || "13:00";
    $("lvNote").value = p.Notes || "";
    syncLeaveForm();
    $("dlgLeave").showModal();
  }
  function nextWorkday(d){
    var x = isoAdd(d, 1);
    while(weekdayOf(x) > 4) x = isoAdd(x, 1);
    return x;
  }
  function leaveFormDraft(){
    var dlg = $("dlgLeave"), file = $("lvAtt").files && $("lvAtt").files[0];
    var d = {
      EmployeeID: dlg.dataset.emp || selfId(), RequestID: dlg.dataset.edit || "", onBehalf: (dlg.dataset.emp || selfId()) !== selfId(),
      Attachment: file ? file.name : (dlg.dataset.att || ""),
      bukrs:IT0001.bukrs, AbsenceTypeCode:$("lvType").value,
      StartDate:dmyToIso($("lvStart").value), EndDate:dmyToIso($("lvEnd").value),
      partial:$("lvPartial").checked, StartTime:$("lvBeg").value, EndTime:$("lvFin").value,
      hours: parseDur($("lvHours").value), Notes:$("lvNote").value.trim()
    };
    if(d.partial && d.StartDate) d.EndDate = d.StartDate;
    /* a duration profile records the hours, not a window */
    if(!profileFor(d.StartDate || WORKDATES[0], d.bukrs).clock){ d.StartTime = ""; d.EndTime = ""; }
    d.hours = leaveDraftHours(d);
    return d;
  }
  function syncLeaveForm(){
    var ty = absType($("lvType").value);
    var partialOk = !!(ty && ty.partial);
    if(!partialOk) $("lvPartial").checked = false;
    $("lvPartial").disabled = !partialOk;
    var partial = $("lvPartial").checked;
    var d0 = dmyToIso($("lvStart").value);
    var clock = profileFor(d0 || WORKDATES[0]).clock;
    $("lvHoursWrap").hidden = !partial || clock;
    $("lvClockWrap").hidden = !partial || !clock;
    $("lvEnd").disabled = partial;
    if(partial) $("lvEnd").value = $("lvStart").value;
    $("lvAttWrap").hidden = !(ty && ty.attach);
    if(ty && ty.attach) $("lvAttHint").textContent = "(" + attachDoc(ty) + ", " + t("text_required_lower") + ")";
    $("lvAttCur").textContent = $("dlgLeave").dataset.att && !($("lvAtt").files && $("lvAtt").files[0]) ? "📎 " + $("dlgLeave").dataset.att : "";
    var d = leaveFormDraft();
    var msgs = validateLeave(d);
    var sum = $("lvSummary");
    sum.innerHTML = "";
    if(d.StartDate && d.EndDate && d.EndDate >= d.StartDate){
      var line = partial ? fmt(d.hours) + " h" : plural(leaveWorkdays(d), "n_workdays");
      var hols = leaveHolidaysIn(d);
      sum.appendChild(el("span","", line + (hols && !partial ? " · " + plural(hols, "n_holidays_skipped") : "")));
      if(ty && ty.quota){
        var avail = leaveAvailableFor(d);
        sum.appendChild(el("span","", t("text_balance_now_after", {now: fmtDays(avail), n: fmtDays(avail - (partial ? d.hours / DAYCAP : leaveWorkdays(d)))})));
      }
      sum.appendChild(el("span","", d.onBehalf ? t("text_onbehalf_note") : t("text_approver", {name: approverFor(d.EmployeeID).name})));
      var others = [];
      eachLeaveDay(d, function(x){
        absentOn(x).forEach(function(o){ if(o.EmployeeID !== d.EmployeeID && others.indexOf(o.EmployeeName) === -1) others.push(o.EmployeeName); });
      });
      if(others.length) sum.appendChild(el("span","", t("text_also_absent_short", {list: others.join(", ")})));
    }
    var box = $("lvMsgs");
    box.innerHTML = "";
    msgs.forEach(function(m){
      var row = el("div","msg " + m.sev, "");
      row.appendChild(el("span","ic", m.sev === "e" ? t("sev_error") : m.sev === "w" ? t("sev_warning") : t("sev_info")));
      row.appendChild(el("span","", m.txt));
      box.appendChild(row);
    });
    $("lvSubmit").disabled = msgs.some(function(m){ return m.sev === "e"; });
  }
  function submitLeaveForm(){
    var d = leaveFormDraft();
    if(validateLeave(d).some(function(m){ return m.sev === "e"; })){ syncLeaveForm(); return; }
    var r = createLeave(d, "Manual");
    $("dlgLeave").close();
    if(d.RequestID) toast(t("toast_leave_changed", {id: r.RequestID, name: r.ApproverName}));
    else if(d.onBehalf) toast(t("toast_leave_onbehalf", {name: r.EmployeeName}));
    else toast(t("toast_leave_sent", {id: r.RequestID, name: r.ApproverName}));
  }
  var lvRejectTarget = null;
  function openRejectLeave(r){
    lvRejectTarget = r;
    $("rjWho").textContent = r.EmployeeName + " · " + absTypeLabel(r) + " · " + leavePeriodLabel(r);
    $("rjReason").value = "";
    $("rjOk").disabled = true;
    $("dlgReject").showModal();
  }
  function confirmRejectLeave(){
    var r = lvRejectTarget, reason = $("rjReason").value.trim();
    if(!r || !reason) return;
    decideLeave(r, false, reason);
    $("dlgReject").close();
    toast(t("toast_leave_rejected", {name: r.EmployeeName, id: r.RequestID}));
  }

  /* ---------- the assistant's home: side panel ----------
     The conversation is the entry point; this column is the secondary
     view of the same data, refreshed on every render so what the
     assistant just did is visible next to it without leaving the screen. */
  function hsPanel(id, title, extra){
    var p = el("div","panel hspanel","");
    p.id = id;
    var h = document.createElement("header");
    h.appendChild(el("h2","", title));
    if(extra) h.appendChild(extra);
    p.appendChild(h);
    return p;
  }
  function renderHome(){
    var side = $("homeSide");
    if(!side) return;
    side.innerHTML = "";
    if(state.role === "manager"){ renderHomeManager(side); return; }
    if(state.role === "pm"){ renderHomePM(side); return; }

    /* the week */
    var nav = el("div","hsweeknav","");
    var prev = btn("‹","arrow", function(){ homeStepWeek(-1); });
    prev.setAttribute("aria-label", t("aria_prev_week"));
    prev.disabled = weekIdx === 0;
    var next = btn("›","arrow", function(){ homeStepWeek(1); });
    next.setAttribute("aria-label", t("aria_next_week"));
    next.disabled = weekIdx === WEEKS.length - 1;
    nav.appendChild(prev); nav.appendChild(next);
    var wk = hsPanel("hsWeek", weekLabelFor(WORKDATES, WEEKS[weekIdx].num), nav);
    var chips = el("div","hschips","");
    chips.appendChild(el("span","chip " + (state.submitted ? "blue" : "grey"), state.submitted ? t("state_in_approval") : t("state_draft")));
    var errs = errors().length;
    chips.appendChild(el("span","chip " + (errs ? "amber" : "green"), errs ? plural(errs, "n_errors") : t("val_no_errors")));
    wk.appendChild(chips);
    var days = el("div","hsdays","");
    for(var i=0; i<5; i++){
      var cap = capacity(i), tot = dayTotal(i);
      var row = el("div","hsday" + (WORKDATES[i] === todayISO() ? " today" : ""), "");
      row.appendChild(el("span","d", DAYS[i]));
      var bar = el("div","bar","");
      var fill = document.createElement("i");
      var pct = cap ? Math.min(100, Math.round(tot / cap * 100)) : (tot ? 100 : 0);
      fill.style.width = pct + "%";
      if(tot > cap) fill.className = "over"; else if(cap && tot >= cap) fill.className = "ok";
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el("span","h num", fmt(tot) + " / " + fmt(cap)));
      var abs = ABSENCES.filter(function(a){ return a.day === i; })[0];
      var tag = el("span","a","");
      if(abs) tag.appendChild(el("span","chip " + (abs.status === "approved" ? "grey" : "amber"), absTypeLabel(abs) + (abs.status === "approved" ? "" : " · " + t("text_pending_short"))));
      row.appendChild(tag);
      days.appendChild(row);
    }
    wk.appendChild(days);
    wk.appendChild(el("div","hstot", t("text_home_week_total", {tot: fmt(weekTotal()), exp: fmt(weekCapacity())})));
    var f1 = el("div","gridfoot","");
    f1.appendChild(btn(t("btn_open_timesheet"), "btn", function(){ clickNav("semana"); }));
    wk.appendChild(f1);
    side.appendChild(wk);

    /* absences */
    var bal = leaveBalance();
    var lv = hsPanel("hsLeave", t("hdr_home_leave"), el("span","chip blue", t("text_vacation_available", {n: fmtDays(bal.available)})));
    var list = el("div","hslist","");
    var upcoming = myLeave().filter(function(r){
      return (leaveActive(r) && r.EndDate >= todayISO()) || r.StatusID === "SENT" || (r.decidedBy && r.StatusID === "REJECTED");
    }).sort(function(x, y){ return x.StartDate < y.StartDate ? -1 : 1; }).slice(0, 5);
    if(!upcoming.length) list.appendChild(el("p","sub", t("text_no_upcoming_leave")));
    upcoming.forEach(function(r){
      var it = el("div","hsitem","");
      var l = el("div","","");
      l.appendChild(el("b","", absTypeLabel(r)));
      l.appendChild(el("div","sub", leavePeriodLabel(r) + " · " + leaveDurationLabel(r)));
      it.appendChild(l);
      it.appendChild(el("span","chip " + leaveStatusClass(r), leaveStatusLabel(r)));
      list.appendChild(it);
    });
    lv.appendChild(list);
    var f2 = el("div","gridfoot","");
    f2.appendChild(btn(t("btn_new_leave"), "btn primary", function(){ openLeaveDialog(); }));
    f2.appendChild(btn(t("btn_open_leave"), "btn", function(){ clickNav("leave"); }));
    lv.appendChild(f2);
    side.appendChild(lv);
  }
  function renderHomeManager(side){
    var mgr = lineManager();
    var q = leaveQueue();
    var ap = hsPanel("hsApprove", t("hdr_home_to_approve"), el("span","chip " + (q.length ? "amber" : "green"), String(q.length)));
    var list = el("div","hslist","");
    if(!q.length) list.appendChild(el("p","sub", t("text_leave_queue_empty")));
    q.slice(0, 6).forEach(function(r){
      var it = el("div","hsitem","");
      var l = el("div","","");
      l.appendChild(el("b","", r.EmployeeName));
      l.appendChild(el("div","sub", (r.cancelRequested ? t("text_cancellation") + ": " : "") + absTypeLabel(r) + " · " + leavePeriodLabel(r)));
      it.appendChild(l);
      var du = daysUntil(r.StartDate);
      it.appendChild(el("span","chip " + (du <= 7 ? "amber" : "grey"), du === 0 ? t("text_now") : plural(du, "text_in_days")));
      list.appendChild(it);
    });
    ap.appendChild(list);
    var f1 = el("div","gridfoot","");
    f1.appendChild(btn(t("btn_open_leave_approvals"), "btn primary", function(){ clickNav("lvaprov"); }));
    ap.appendChild(f1);
    side.appendChild(ap);


    /* who is away soon, so a decision is taken with the team in view */
    var away = LEAVE_TEAM[IT0001.bukrs].concat(myLeave()).filter(function(r){
      return (r.StatusID === "APPROVED" || r.StatusID === "POSTED") && r.EndDate >= todayISO() && daysUntil(r.StartDate) <= 60;
    }).sort(function(x, y){ return x.StartDate < y.StartDate ? -1 : 1; });
    var aw = hsPanel("hsAway", t("hdr_home_team_away"), null);
    var l2 = el("div","hslist","");
    if(!away.length) l2.appendChild(el("p","sub", t("text_nobody_away")));
    away.forEach(function(r){
      var it = el("div","hsitem","");
      var l = el("div","","");
      l.appendChild(el("b","", r.EmployeeName));
      l.appendChild(el("div","sub", absTypeLabel(r) + " · " + leavePeriodLabel(r)));
      it.appendChild(l);
      l2.appendChild(it);
    });
    aw.appendChild(l2);
    aw.appendChild(el("div","privacy", t("text_acting_as_manager", {name: mgr.name})));
    side.appendChild(aw);
  }
  /* The project manager: the timesheets waiting on the projects they own,
     and how far the team has got with this week, person by person. */
  function renderHomePM(side){
    var l = leaderById(state.leader);
    var pend = tsQueue().filter(function(a){ return !a.approved; });
    var ap = hsPanel("hsTsPm", t("hdr_home_timesheets"), el("span","chip " + (pend.length ? "amber" : "green"), String(pend.length)));
    var list = el("div","hslist","");
    if(!pend.length) list.appendChild(el("p","sub", t("bot_approval_nothing")));
    pend.slice(0, 6).forEach(function(a){
      var it = el("div","hsitem","");
      var left = el("div","","");
      left.appendChild(el("b","", a.who));
      left.appendChild(el("div","sub", a.proj + " · " + fmt(a.tot) + " h"));
      it.appendChild(left);
      it.appendChild(el("span","chip " + (a.warn ? "amber" : "blue"), a.warn ? approvalNoteLabel(a.note) : t("chip_in_approval")));
      list.appendChild(it);
    });
    ap.appendChild(list);
    var f1 = el("div","gridfoot","");
    f1.appendChild(btn(t("btn_open_ts_approvals"), "btn primary", function(){ clickNav("aprov"); }));
    ap.appendChild(f1);
    side.appendChild(ap);

    var pr = PROJECTS[massProject()] || PROJECTS[l.projs[0]];
    var tm = hsPanel("hsTeam", t("hdr_home_team_week", {project: pr.code}), el("span","chip grey", weekLabelFor(WORKDATES, WEEKS[weekIdx].num)));
    var days = el("div","hsdays","");
    teamOf(state.leader).forEach(function(m){
      var already = alreadyHoursFor(m, WEEKS[weekIdx].num), cap = 0, tot = 0;
      for(var d=0; d<5; d++){ tot += already[d] || 0; if(!memberBlocked(m, d)) cap += teamDailyCap(m); }
      var row = el("div","hsday","");
      row.appendChild(el("span","d", m.name.split(" ")[0]));
      var bar = el("div","bar","");
      var fill = document.createElement("i");
      fill.style.width = (cap ? Math.min(100, Math.round(tot / cap * 100)) : 0) + "%";
      if(tot > cap) fill.className = "over"; else if(cap && tot >= cap) fill.className = "ok";
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el("span","h num", fmt(tot) + " / " + fmt(cap)));
      row.appendChild(el("span","a",""));
      days.appendChild(row);
    });
    tm.appendChild(days);
    var f2 = el("div","gridfoot","");
    f2.appendChild(btn(t("btn_open_team"), "btn", function(){ clickNav("team"); }));
    tm.appendChild(f2);
    tm.appendChild(el("div","privacy", t("text_acting_as_pm", {name: l.name, projects: pmProjectsLabel()})));
    side.appendChild(tm);
  }
  function homeStepWeek(delta){
    var next = weekIdx + delta;
    if(next < 0 || next >= WEEKS.length) return;
    saveCurrentWeek();
    loadWeek(next);
    if(isClock()) seedClock();
    render();
  }
  function clickNav(key){ showScreen(key); }
  /* A count on the Leave Request tab for whoever is acting as manager:
     the same alert the assistant gives, visible from any screen. */
  function renderNavBadges(){
    setNavBadge("tab-lvaprov", state.role === "manager" ? leaveQueue().length : 0);
    setNavBadge("tab-aprov", state.role === "pm" ? tsQueue().filter(function(a){ return !a.approved; }).length : 0);
    /* the area tab repeats its approval count, so it shows while the
       area is closed and its second row of tabs hidden */
    [["area-ts","tab-aprov"],["area-lv","tab-lvaprov"]].forEach(function(p){
      var ab = $(p[0]), src = $(p[1]) && $(p[1]).querySelector(".navbadge");
      var badge = ab && ab.querySelector(".navbadge");
      if(!badge) return;
      badge.hidden = !src;
      badge.textContent = src ? src.textContent : "";
    });
  }
  function setNavBadge(id, n){
    var b = $(id);
    if(!b) return;
    var badge = b.querySelector(".navbadge");
    if(!n){ if(badge) badge.remove(); return; }
    if(!badge){ badge = el("span","navbadge",""); b.appendChild(badge); }
    badge.textContent = String(n);
  }

  /* ---------- the test being run ----------
     Chosen when the app opens, and changed from the Test button in the
     header: the company (IT0001) and whose eyes the app is seen through.
     Three profiles, each with its own job, as in the real process: the
     employee records time and requests absences; the project manager
     records for the project team and approves its timesheets (approval by
     project ownership); the line manager, from the org structure, approves
     absences. Each profile only sees the screens it uses, and the
     assistant's alerts and permissions follow the same split. Data stays
     across changes, so a request sent as the employee can be approved as
     the line manager in the same session. */
  var PROFILE_TABS = {
    employee: ["home","semana","leave","teamcal"],
    pm:       ["home","semana","leave","teamcal","team","aprov"],
    manager:  ["home","semana","leave","teamcal","lvaprov"]
  };
  function currentActor(){
    if(state.role === "pm") return {name: leaderById(state.leader).name, label: t("profile_pm")};
    if(state.role === "manager") return {name: lineManager().name, label: t("profile_manager")};
    return {name: EMPLOYEE_NAME, label: t("profile_employee")};
  }
  function renderContextButton(){
    var b = $("ctxTxt");
    if(!b) return;
    var a = currentActor();
    b.textContent = IT0001.bukrs + " · " + a.label + " · " + a.name;
  }
  function applyProfileChrome(){
    var tabs = PROFILE_TABS[state.role] || PROFILE_TABS.employee;
    Array.prototype.forEach.call(document.querySelectorAll("#appbar button[data-screen]"), function(b){
      b.hidden = tabs.indexOf(b.dataset.screen) === -1;
    });
    /* an area with none of its tabs in this profile isn't shown at all */
    syncNavAreas();
    /* the project manager under test is fixed; Team's own picker follows it */
    var ls = $("leadSel");
    if(ls){ ls.value = state.leader; ls.disabled = state.role === "pm"; }
    if(!profileHasScreen(state.screen)) clickNav("home");
  }
  /* the SAP mapping is reference material, open to every profile from Settings */
  function profileHasScreen(key){
    return key === "cats" || (PROFILE_TABS[state.role] || PROFILE_TABS.employee).indexOf(key) !== -1;
  }
  function applyTestSetup(co, role, leader, quiet){
    if(!PROFILE_TABS[role]) role = "employee";
    var changed = co !== IT0001.bukrs || role !== state.role || (role === "pm" && leader !== state.leader);
    var oldKey = convoKey(), oldSelf = selfId();
    saveCurrentWeek();
    UNSAVED[oldSelf] = !!state.needsSave;
    if(co === "PT01" || co === "PT02") switchCompany(co, true);
    state.role = role;
    if(role === "pm"){
      var mine = leadersForCompany(IT0001.bukrs).filter(function(l){ return l.id === leader; })[0];
      if(mine && mine.id !== state.leader){
        state.leader = mine.id;
        var pj = $("mProj"); if(pj) pj.dataset.for = "";
        clearMass();
      }
    }
    renderLeaderOptions();
    /* this person's own timesheet, on the same week */
    var curNum = WEEKS[weekIdx] ? WEEKS[weekIdx].num : null;
    WEEKS = weeksOfCompany(IT0001.bukrs);
    var same = WEEKS.filter(function(w){ return w.num === curNum; })[0];
    loadWeek(same ? WEEKS.indexOf(same) : todayWeekIndex());
    if(isClock()) seedClock();
    state.needsSave = !!UNSAVED[selfId()];
    applyProfileChrome();
    updateApproverChrome();
    renderContextButton();
    render();
    try{ localStorage.setItem("vesiTest", JSON.stringify({co: IT0001.bukrs, role: state.role, leader: state.leader})); }catch(e){}
    if(!state.setupDone){ state.setupDone = true; assistantEnsureGreeted(); }
    else if(changed && typeof chat !== "undefined"){
      /* each person has their own conversation: put this one away and
         bring back (or start) the other person's */
      stashConvo(oldKey);
      restoreConvo(convoKey());
    }
  }

  /* The setup window: the first thing on screen, prefilled with the last
     test this browser ran (a convenience only, the app works without it). */
  var setupDraft = null;
  function openSetup(){
    var saved = null;
    try{ saved = JSON.parse(localStorage.getItem("vesiTest") || "null"); }catch(e){}
    setupDraft = state.setupDone || !saved
      ? {co: IT0001.bukrs, role: state.role, leader: state.leader}
      : {co: saved.co === "PT02" ? "PT02" : "PT01", role: PROFILE_TABS[saved.role] ? saved.role : "employee", leader: saved.leader || state.leader};
    renderSetup();
    $("dlgSetup").showModal();
  }
  function renderSetup(){
    var d = setupDraft;
    if(!d) return;
    Array.prototype.forEach.call(document.querySelectorAll("#setupCo button"), function(b){
      b.setAttribute("aria-pressed", b.dataset.co === d.co ? "true" : "false");
    });
    $("setupCoHint").textContent = t(d.co === "PT02" ? "setup_co_hint_pt02" : "setup_co_hint_pt01");
    Array.prototype.forEach.call(document.querySelectorAll("#setupRoles .setupcard"), function(b){
      b.setAttribute("aria-checked", b.dataset.role === d.role ? "true" : "false");
    });
    var leaders = leadersForCompany(d.co);
    if(!leaders.some(function(l){ return l.id === d.leader; })) d.leader = leaders[0].id;
    var sel = $("setupLeader");
    sel.innerHTML = "";
    leaders.forEach(function(l){
      var o = document.createElement("option");
      o.value = l.id; o.textContent = l.name + " · " + l.label;
      sel.appendChild(o);
    });
    sel.value = d.leader;
    $("setupWhoEmp").textContent = EMPLOYEE_NAME;
    $("setupWhoPm").textContent = leaderById(d.leader).name;
    $("setupWhoMgr").textContent = LINE_MANAGER[d.co].name;
    $("setupLeaderWrap").hidden = d.role !== "pm";
    Array.prototype.forEach.call(document.querySelectorAll("#setupLang button"), function(b){
      b.setAttribute("aria-pressed", b.dataset.lang === state.lang ? "true" : "false");
    });
  }
  /* ?company=PT02&profile=pm&leader=CP skips the window: for the test suite,
     and for a link straight into one scenario. */
  function setupFromUrl(){
    var q = (window.location && window.location.search) || "";
    var get = function(k){ var m = new RegExp("[?&]" + k + "=([A-Za-z0-9]+)").exec(q); return m ? m[1] : null; };
    var role = get("profile");
    if(!role || !PROFILE_TABS[role]) return false;
    applyTestSetup(get("company") || IT0001.bukrs, role, get("leader") || state.leader, true);
    return true;
  }

  /* ---------- SAP mapping of the Leave Request ----------
     Same reading as the CATS table above it: what each element on screen
     is in the standard, and where it lives. Nothing here is custom except
     the origin marker, which has no standard field and stays in BTP. */
  var LR_MAP = [
    ["lrmap_type",      "AbsenceTypeSet · AbsenceTypeCode",                 "AWART (T554S), rule group from feature WEBMO",            "S/4HANA, standard"],
    ["lrmap_dates",     "LeaveRequestSet · StartDate, EndDate",             "PTREQ_ATTABSDATA, then IT2001 BEGDA, ENDDA",               "S/4HANA, standard"],
    ["lrmap_partial",   "LeaveRequestSet · StartTime, EndTime, PlannedWorkingHours", "IT2001 BEGUZ, ENDUZ, STDAZ",                     "S/4HANA, standard"],
    ["lrmap_note",      "LeaveRequestSet · Notes",                          "PTREQ_NOTICE",                                             "S/4HANA, standard"],
    ["lrmap_status",    "LeaveRequestSet · StatusID",                       "PTREQ_HEADER STATUS: SENT, APPROVED, POSTED, REJECTED, WITHDRAWN", "S/4HANA, standard"],
    ["lrmap_approver",  "LeaveRequestSet · ApproverEmployeeID",             "Direct manager from OM, next processor in PTREQ_ACTOR",    "S/4HANA, standard"],
    ["lrmap_balance",   "TimeAccountSet",                                   "IT2006, absence quotas",                                   "S/4HANA, standard"],
    ["lrmap_decision",  "TASKPROCESSING · Decision",                        "Workflow WS12300111, one approval step",                   "S/4HANA, My Inbox"],
    ["lrmap_posting",   "none, background job",                             "RPTARQPOST, APPROVED to POSTED, writes IT2001",            "S/4HANA, job"],
    ["lrmap_timesheet", "LeaveRequestSet (pending) and IT2001 (posted), read", "Day capacity; CATS reads IT2001",                    "BTP reads, S/4HANA holds"],
    ["lrmap_withdraw",  "LeaveRequestSet · withdrawal",                     "WITHDRAWN; an approved one becomes a cancellation request in WS12300111", "S/4HANA, standard"],
    ["lrmap_origin",    "none",                                             "No standard field",                                        "BTP only"],
    ["lrmap_asof",      "TimeAccountSet, read at a key date",               "IT2006 quota less the requests deducting it up to that date", "S/4HANA, standard"],
    ["lrmap_holidays",  "none, read with the work schedule",                "Holiday calendar of the work schedule (SCAL), not deducted, no target hours", "S/4HANA, standard"],
    ["lrmap_teamcal",   "LeaveRequestSet, the direct reports' requests",    "PTREQ of the reports from OM, plus the holiday calendar",   "S/4HANA, standard"],
    ["lrmap_mass",      "TASKPROCESSING · Decision, several work items",    "WS12300111, one decision per work item, as in My Inbox",    "S/4HANA, My Inbox"],
    ["lrmap_change",    "LeaveRequestSet · update of a pending request",    "Same request, back to the approver",                        "S/4HANA, standard"],
    ["lrmap_attach",    "LeaveRequestSet · attachments",                    "Attachments enabled per absence type in customizing",       "S/4HANA, standard"],
    ["lrmap_onbehalf",  "LeaveRequestSet, created by the manager for a report", "Approved at creation, the approver is the one recording", "S/4HANA, standard"]
  ];
  function lrDate(d){ return d.slice(0,4) + "-" + d.slice(4,6) + "-" + d.slice(6,8) + "T00:00:00"; }
  function lrTime(hhmm){ var p = String(hhmm || "").split(":"); return p.length === 2 ? "PT" + p[0] + "H" + p[1] + "M00S" : null; }
  function renderLeaveMap(){
    var body = $("lrMapBody");
    if(!body) return;
    body.innerHTML = "";
    LR_MAP.forEach(function(r){
      var tr = document.createElement("tr");
      tr.appendChild(td2(t(r[0]), ""));
      tr.appendChild(td2(r[1], "num"));
      tr.appendChild(td2(r[2], ""));
      tr.appendChild(td2(r[3], ""));
      body.appendChild(tr);
    });
    var pre = $("lrPayload");
    var r = state.lastLeave;
    if(!r){ pre.textContent = t("text_lr_payload_empty"); return; }
    var req = {
      EmployeeID: r.EmployeeID, AbsenceTypeCode: r.AbsenceTypeCode,
      StartDate: lrDate(r.StartDate), EndDate: lrDate(r.EndDate),
      StartTime: r.partial ? lrTime(r.StartTime) : null, EndTime: r.partial ? lrTime(r.EndTime) : null,
      PlannedWorkingHours: r.partial ? r.hours.toFixed(2) : null, Notes: r.Notes || ""
    };
    var resp = {RequestID: r.RequestID, StatusID: "SENT", ApproverEmployeeID: LINE_MANAGER[r.bukrs].pernr, ApproverEmployeeName: r.ApproverName};
    pre.textContent = "POST /sap/opu/odata/sap/HCMFAB_LEAVE_REQUEST_CR_SRV/LeaveRequestSet\n" + JSON.stringify(req, null, 2) +
      "\n\n201 Created\n" + JSON.stringify(resp, null, 2) +
      "\n\n// status now: " + r.StatusID + (r.cancelRequested ? ", cancellation pending" : "") +
      "\n// origin: " + r.origin + ", kept in BTP, the standard has no field for it";
  }

  /* ---------- the assistant and the Leave Request ----------
     Same contract as hours: the assistant reads, proposes and shows what
     it will send, in business terms and in SAP terms; nothing reaches the
     standard service until the person confirms on the card. */
  function leaveCardLines(d){
    var ty = absType(d.AbsenceTypeCode);
    var lines = [
      [t("label_absence_type"), t("abs_" + ty.code)],
      [t("label_period"), leavePeriodLabel(d)],
      [t("label_duration"), d.partial ? fmt(d.hours) + " h" : plural(leaveWorkdays(d), "n_workdays")]
    ];
    /* a changed request gives its old days back before taking the new ones */
    if(ty.quota) lines.push([t("label_balance_after"), fmtDays(leaveAvailableFor(d) - leaveDays(d)) + " " + t("unit_days")]);
    if(d.onBehalf){
      lines.unshift([t("th_employee"), (reportById(d.EmployeeID, d.bukrs) || {}).name || ""]);
      lines.push([t("th_status"), t("lr_status_approved")]);
    }
    else lines.push([t("label_approver"), approverFor(selfId(), d.bukrs).name + " · " + t("role_manager")]);
    if(d.Notes) lines.push([t("label_note"), d.Notes]);
    return lines;
  }
  function offerLeave(d){
    d.bukrs = IT0001.bukrs;
    if(d.partial){ d.EndDate = d.StartDate; d.hours = leaveDraftHours(d); }
    else { d.hours = DAYCAP; d.StartTime = ""; d.EndTime = ""; }
    if(!d.EndDate) d.EndDate = d.StartDate;
    var msgs = validateLeave(d);
    /* a missing attachment is asked for on the card itself */
    var needAttach = msgs.some(function(m){ return m.code === "attach"; });
    var errs = msgs.filter(function(m){ return m.sev === "e" && m.code !== "attach"; });
    var notes = msgs.filter(function(m){ return m.sev !== "e"; }).map(function(m){ return m.txt; });
    chat.leaveDraft = null;
    if(errs.length){
      botSay("bot", t("bot_leave_cant", {reason: errs[0].txt}));
      botChips([t("chip_my_leave"), t("chip_leave_form")]);
      chat.leaveFormPrefill = d;
      return;
    }
    chat.pending = "leave";
    var card = botCard(leaveCardLines(d), t(d.RequestID ? "btn_save_changes" : d.onBehalf ? "btn_record_leave" : "btn_send_request"), function(){
      var r = createLeave(d, "Joule");
      botSay("bot", t(d.RequestID ? "bot_leave_changed_msg" : d.onBehalf ? "bot_leave_onbehalf_done" : "bot_leave_sent", {id: r.RequestID, name: d.onBehalf ? r.EmployeeName : r.ApproverName}));
      botChips(d.onBehalf ? managerChips() : [t("chip_my_leave"), t("chip_hours_i_have")]);
    }, notes.length ? notes.join(" ") : null);
    if(needAttach){
      var ty = absType(d.AbsenceTypeCode), send = card.querySelector(".acts .btn.primary");
      var row = el("div","jrow jattach","");
      row.appendChild(el("span","k", t("label_attachment")));
      var inp = document.createElement("input");
      inp.type = "file";
      inp.setAttribute("aria-label", t("label_attachment") + ", " + attachDoc(ty));
      var v = el("span","v","");
      v.appendChild(inp);
      v.appendChild(el("div","lvattlbl", attachDoc(ty) + ", " + t("text_required_lower")));
      row.appendChild(v);
      card.insertBefore(row, card.querySelector(".acts"));
      if(send){ send.disabled = true; send.title = t("leave_err_attachment", {doc: attachDoc(ty)}); }
      inp.onchange = function(){
        d.Attachment = inp.files && inp.files[0] ? inp.files[0].name : "";
        if(send){ send.disabled = !d.Attachment; send.title = ""; }
      };
    }
    var lead = d.RequestID ? t("bot_leave_confirm_change", {id: d.RequestID, name: approverFor(selfId(), d.bukrs).name})
      : d.onBehalf ? t("bot_leave_onbehalf_confirm", {name: (reportById(d.EmployeeID, d.bukrs) || {}).name || ""}) : "";
    botSay("bot", (lead ? lead + " " : "") + (needAttach ? t("bot_leave_confirm_attach", {doc: attachDoc(absType(d.AbsenceTypeCode))}) : lead ? "" : t("bot_leave_confirm")), card);
    chat.history.push({role:"assistant", content:"Proposed leave request: " + d.AbsenceTypeCode + ", " + d.StartDate + " to " + d.EndDate + ". Waiting for confirmation."});
  }
  function upcomingLeave(){
    return myLeave().filter(function(r){
      return (leaveActive(r) && r.EndDate >= todayISO()) || r.StatusID === "SENT";
    }).sort(function(x, y){ return x.StartDate < y.StartDate ? -1 : 1; });
  }
  function showMyLeave(){
    var bal = leaveBalance();
    var node = el("div","jlist","");
    var list = upcomingLeave();
    if(!list.length) node.appendChild(el("div","jrow2", t("text_no_upcoming_leave")));
    list.forEach(function(r){
      node.appendChild(el("div","jrow2", r.RequestID + " · " + absTypeLabel(r) + " · " + leavePeriodLabel(r) + " · " + leaveStatusLabel(r)));
    });
    botSay("bot", t("bot_leave_list_intro", {avail: fmtDays(bal.available), req: fmtDays(bal.requested)}), node);
    botChips([t("chip_request_vacation"), t("chip_my_absences")]);
  }
  function showLeaveBalance(){
    var b = leaveBalance();
    botSay("bot", t("bot_leave_balance", {y: b.year, total: fmtDays(b.total), used: fmtDays(b.used), req: fmtDays(b.requested), avail: fmtDays(b.available)}));
    botChips([t("chip_request_vacation"), t("chip_my_leave")]);
  }
  /* A request number wins; otherwise a date it covers; otherwise, when
     there's exactly one request that could be cancelled, that one. */
  function findLeaveTarget(txt, dateISO){
    var m = String(txt || "").match(/\b(45\d{5})\b/);
    if(m){ var byId = leaveById(m[1]); if(byId && byId.EmployeeID === PERNR) return byId; }
    var d = dateISO || (parseLeaveDates(String(txt || "").toLowerCase()) || {}).start;
    var cands = myLeave().filter(canWithdraw);
    if(d){
      var hit = cands.filter(function(r){ return r.StartDate <= d && r.EndDate >= d; })[0];
      if(hit) return hit;
    }
    return cands.length === 1 ? cands[0] : null;
  }
  function offerWithdraw(r){
    if(!r){
      var cands = myLeave().filter(canWithdraw);
      if(!cands.length){ botSay("bot", t("bot_leave_nothing_to_cancel")); return; }
      var node = el("div","jlist","");
      cands.forEach(function(c){ node.appendChild(el("div","jrow2", c.RequestID + " · " + absTypeLabel(c) + " · " + leavePeriodLabel(c) + " · " + leaveStatusLabel(c))); });
      botSay("bot", t("bot_leave_which_cancel"), node);
      return;
    }
    if(!canWithdraw(r)){
      botSay("bot", t("bot_leave_cannot_cancel", {id: r.RequestID, status: leaveStatusLabel(r).toLowerCase()}));
      return;
    }
    var pendingOnly = r.StatusID === "SENT";
    chat.pending = "leave-cancel";
    botSay("bot", t(pendingOnly ? "bot_leave_confirm_withdraw" : "bot_leave_confirm_cancel", {id: r.RequestID}), botCard([
      [t("label_absence_type"), absTypeLabel(r)], [t("label_period"), leavePeriodLabel(r)], [t("th_status"), leaveStatusLabel(r)]
    ], pendingOnly ? t("btn_withdraw") : t("btn_request_cancel"), function(){
      var res = withdrawLeave(r);
      botSay("bot", t(res === "withdrawn" ? "bot_leave_withdrawn" : "bot_leave_cancel_requested", {id: r.RequestID, name: r.ApproverName}));
      botChips([t("chip_my_leave")]);
    }));
  }

  /* ---------- the manager's side: alerts and decisions ---------- */
  /* The line manager is told about absences, the project manager about
     timesheets: each approves one thing, as in the real process. */
  function managerAlertText(){
    var q = leaveQueue();
    if(!q.length) return t("bot_nothing_pending");
    var first = q[0];
    return plural(q.length, "bot_alert_leave") + " " +
      t("bot_alert_soonest", {name: first.EmployeeName, type: (first.cancelRequested ? t("text_cancellation").toLowerCase() + ", " : "") + absTypeLabel(first).toLowerCase(), when: leaveWhenLabel(first)});
  }
  function pmAlertText(){
    var ts = tsQueue().filter(function(a){ return !a.approved; });
    if(!ts.length) return t("bot_approval_nothing");
    return plural(ts.length, "bot_alert_ts_pm", {x: ts.filter(function(a){ return a.warn; }).length});
  }
  function pmChips(){
    var list = [t("chip_pending_approvals")];
    if(tsQueue().some(function(a){ return !a.approved && !a.warn; })) list.push(t("chip_approve_clean_ts"));
    return list;
  }
  /* "starting today", "starting in 3 days", or, for a request still
     waiting although its days are behind us, "already in the past". */
  function leaveWhenLabel(r){
    var today = todayISO();
    if(r.StartDate < today) return t("when_past");
    if(r.StartDate === today) return t("when_today");
    return plural(daysUntil(r.StartDate), "when_in_days");
  }
  function managerChips(){
    var q = leaveQueue(), list = [];
    if(q.length) list.push(t("chip_pending_approvals"));
    if(q.length) list.push(t("chip_approve_leave_of", {name: q[0].EmployeeName.split(" ")[0]}));
    return list;
  }
  function showPendingApprovals(ym){
    if(state.role === "employee"){ showMyLeave(); return; }
    if(state.role === "pm"){ showTimesheetQueue(); return; }
    var q = leaveQueue();
    /* "what's waiting for November": the requests touching that month */
    if(ym){
      q = q.filter(function(r){ return r.StartDate.slice(0,6) <= ym && r.EndDate.slice(0,6) >= ym; });
      var mLbl = monthSentenceOf(ym);
      var nodeM = el("div","jlist","");
      q.forEach(function(r){ nodeM.appendChild(el("div","jrow2", r.RequestID + " · " + r.EmployeeName + " · " + (r.cancelRequested ? t("text_cancellation") + ", " : "") + absTypeLabel(r) + " · " + leavePeriodLabel(r))); });
      botSay("bot", q.length ? plural(q.length, "bot_pending_in_month", {month: mLbl}) : t("bot_pending_in_month_none", {month: mLbl}), q.length ? nodeM : null);
      botChips(managerChips());
      return;
    }
    var node = el("div","jlist","");
    q.forEach(function(r){
      var ov = leaveOverlaps(r);
      node.appendChild(el("div","jrow2", r.RequestID + " · " + r.EmployeeName + " · " + (r.cancelRequested ? t("text_cancellation") + ", " : "") + absTypeLabel(r) + " · " + leavePeriodLabel(r) + " · " + leaveDurationLabel(r) + (ov.length ? " · " + t("text_overlaps_n", {n: ov.length}) : "")));
    });
    botSay("bot", managerAlertText(), q.length ? node : null);
    botChips(managerChips());
  }
  function showTimesheetQueue(){
    var q = tsQueue().filter(function(a){ return !a.approved; });
    var node = el("div","jlist","");
    q.forEach(function(a){
      node.appendChild(el("div","jrow2", a.who + " · " + a.proj + " · " + fmt(a.tot) + " h" + (a.warn ? " · " + approvalNoteLabel(a.note) : "")));
    });
    /* Consulting approves each person's month, Building Solutions the week */
    var period = state.approvals === APPROVALS_PT01
      ? t("bot_ts_queue_month", {month: monthSentenceOf(approvalMonth())})
      : t("bot_ts_queue_week");
    botSay("bot", pmAlertText() + " " + period, q.length ? node : null);
    botChips(pmChips());
  }
  function matchLeaveTargets(txt){
    var low = String(txt || "").toLowerCase(), q = leaveQueue();
    if(/\b(todos|todas|tudo|everyone|everything|all|tous|toutes|tout)\b/.test(low)) return q;
    var m = low.match(/\b(45\d{5})\b/);
    if(m) return q.filter(function(r){ return r.RequestID === m[1]; });
    return q.filter(function(r){
      var parts = r.EmployeeName.toLowerCase().split(" ");
      return low.indexOf(r.EmployeeName.toLowerCase()) !== -1 || new RegExp("\\b" + parts[0] + "\\b").test(low);
    });
  }
  function offerLeaveDecision(targets, approve, reason){
    if(state.role !== "manager"){
      botSay("bot", t("bot_leave_only_manager", {name: approverFor(selfId()).name}));
      botChips([t("chip_my_leave")]);
      return;
    }
    if(!targets.length){
      botSay("bot", t("bot_leave_decide_who"));
      showPendingApprovals();
      return;
    }
    if(!approve && !reason){
      chat.rejectDraft = targets;
      botSay("bot", t("bot_leave_reason_needed", {name: targets.map(function(r){ return r.EmployeeName; }).join(", ")}));
      return;
    }
    chat.rejectDraft = null;
    var lines = targets.map(function(r){
      return [r.EmployeeName, (r.cancelRequested ? t("text_cancellation") + ", " : "") + absTypeLabel(r) + ", " + leavePeriodLabel(r)];
    });
    if(!approve) lines.push([t("label_reason"), reason]);
    var warn = null;
    if(approve){
      var ovs = [];
      targets.forEach(function(r){
        leaveOverlaps(r).forEach(function(o){ ovs.push(r.EmployeeName.split(" ")[0] + " / " + o.EmployeeName + " (" + leavePeriodLabel(o) + ")"); });
      });
      if(ovs.length) warn = t("bot_leave_overlap_warn", {list: ovs.join("; ")});
    }
    chat.pending = "leave-decision";
    botSay("bot", approve ? plural(targets.length, "bot_leave_confirm_approve") : t("bot_leave_confirm_reject"), botCard(lines,
      approve ? t("btn_approve") : t("btn_reject"), function(){
        targets.forEach(function(r){ decideLeave(r, approve, reason || ""); });
        var left = leaveQueue().length;
        botSay("bot", (approve ? plural(targets.length, "bot_leave_approved_msg") : t("bot_leave_rejected_msg", {name: targets.map(function(r){ return r.EmployeeName; }).join(", ")}))
          + (left ? " " + plural(left, "bot_leave_remaining") : " " + t("bot_leave_inbox_empty")));
        botChips(managerChips());
      }, warn));
  }

  /* ---------- greeting, role change and notices ---------- */
  function assistantGreet(){
    if(state.role === "manager"){
      botSay("bot", t("bot_greeting_manager", {name: lineManager().name.split(" ")[0]}) + " " + managerAlertText());
      botChips(managerChips());
      return;
    }
    if(state.role === "pm"){
      botSay("bot", t("bot_greeting_pm", {name: leaderById(state.leader).name.split(" ")[0], projects: pmProjectsLabel()}) + " " + pmAlertText());
      botChips(pmChips());
      return;
    }
    botSay("bot", t("bot_greeting_home", {name: EMPLOYEE_NAME.split(" ")[0]}));
    botChips([t("chip_hours_i_have"), t("chip_request_vacation"), t("chip_my_leave"), chipSubmit()]);
  }
  function assistantEnsureGreeted(){
    /* nobody is greeted before the test has been chosen */
    if(chat.greeted || !state.setupDone) return;
    chat.greeted = true;
    assistantGreet();
    flushLeaveNotices();
  }
  /* ---------- the language the person writes in ----------
     The assistant answers in the language of the message, not only the
     one picked in the selector: a message clearly in Portuguese, English
     or French switches the whole app to it, with a line in the chat
     saying so. Only distinctive words count, project names are left out
     (they're English in every language) and a chip the assistant offered
     never switches anything. */
  var LANG_WORDS = {
    pt: "ontem hoje amanhã amanha anteontem segunda terça terca quarta quinta sexta sábado sabado domingo horas hora férias ferias consulta médica medica " +
        "ausência ausencia ausências ausencias pedido pedidos semana mês projeto projecto registar regista registo quero queria preciso tenho quantas quantos " +
        "para com não nao sim olá ola obrigado obrigada bom boa aprovar aprova rejeitar submeter saldo quilómetros quilometros ida volta dos das uma " +
        "mostra mostrar ver estou está esta minhas meus minha meu equipa todos dias formação formacao doença doenca falta janeiro fevereiro março marco " +
        "abril maio junho julho agosto setembro outubro novembro dezembro também tambem fiz fui trabalhei porque mudar escritório escritorio casa ajuda",
    en: "yesterday today tomorrow monday tuesday wednesday thursday friday saturday sunday hours hour the my what how many much log record please show " +
        "vacation holiday leave doctor request requests approve reject submit week month project for from with have can you is are january february " +
        "march april may june july august september october november december balance mileage round trip team everyone sick hello thanks worked went " +
        "need want would like help change office home i'm i've don't",
    fr: "hier aujourd'hui demain lundi mardi mercredi jeudi vendredi samedi dimanche heures heure congés conges médecin medecin demande demandes semaine " +
        "mois projet je j'ai les des du au aux pour avec sont combien montre montrer approuver refuser soumettre solde aller retour équipe equipe " +
        "tous bonjour merci oui non janvier février fevrier avril juin juillet août aout septembre octobre novembre décembre decembre et en suis veux " +
        "voudrais besoin travaillé travaille aide bureau maison"
  };
  var LANG_SETS = {};
  Object.keys(LANG_WORDS).forEach(function(l){ LANG_SETS[l] = {}; LANG_WORDS[l].split(" ").forEach(function(w){ LANG_SETS[l][w] = true; }); });
  function detectMessageLang(txt){
    if((chat.lastChips || []).indexOf(String(txt).trim()) !== -1) return "";
    var skip = {};
    PROJECTS.forEach(function(pr){ pr.name.toLowerCase().split(/[^a-zà-ÿ]+/).forEach(function(w){ if(w) skip[w] = true; }); });
    var score = {pt:0, en:0, fr:0};
    String(txt).toLowerCase().split(/[^a-zà-ÿ']+/).forEach(function(w){
      w = w.replace(/^'+|'+$/g, "");
      if(!w || skip[w]) return;
      Object.keys(score).forEach(function(l){ if(LANG_SETS[l][w]) score[l]++; });
    });
    var ranked = Object.keys(score).sort(function(a, b){ return score[b] - score[a]; });
    var best = ranked[0], second = ranked[1];
    /* clearly ahead, or nothing to go on */
    if(score[best] < 1 || score[best] <= 2 * score[second]) return "";
    return best;
  }
  /* switched before the message is shown: on a first message the
     greeting is redone in the new language, and the message stays */
  /* The reply's language: the message's when it's clear, else the one
     the conversation was already in, else the interface's. */
  function replyLangFor(txt){ return detectMessageLang(txt) || chat.replyLang || state.lang; }
  /* ---------- one conversation per person under test ----------
     What was said as one person, the drafts and the history sent to Claude
     stay with that person: switching the test puts the conversation away
     and brings back (or starts) the other person's. */
  var CONVOS = {};
  var CHAT_FIELDS = ["pending","draft","draftWeek","history","leaveDraft","leaveFormPrefill","kmDraft","projectDraft","rejectDraft","replyLang","lastChips","greeted","langNote"];
  function convoKey(){ return IT0001.bukrs + ":" + state.role + (state.role === "pm" ? ":" + state.leader : ""); }
  function stashConvo(key){
    var log = $("jlog"), chips = $("jchips"), saved = {log: document.createDocumentFragment(), chips: document.createDocumentFragment()};
    if(log) while(log.firstChild) saved.log.appendChild(log.firstChild);
    if(chips) while(chips.firstChild) saved.chips.appendChild(chips.firstChild);
    CHAT_FIELDS.forEach(function(f){ saved[f] = chat[f]; });
    CONVOS[key] = saved;
  }
  function restoreConvo(key){
    var saved = CONVOS[key];
    delete CONVOS[key];
    CHAT_FIELDS.forEach(function(f){ chat[f] = saved ? saved[f] : null; });
    chat.history = saved ? saved.history : [];
    chat.greeted = saved ? saved.greeted : false;
    if(saved){
      $("jlog").appendChild(saved.log);
      $("jchips").appendChild(saved.chips);
      flushLeaveNotices();
      var log = $("jlog"); if(log) log.scrollTop = log.scrollHeight;
      return;
    }
    var a = currentActor();
    $("jlog").appendChild(el("div","jdivider", IT0001.bukrs + " · " + a.label + " · " + a.name));
    assistantEnsureGreeted();
  }
  /* What the manager decided reaches the employee the next time the
     employee is the one using the app, the way a workflow notification
     would, instead of being lost in a list nobody reopens. */
  /* the decisions on this person's own requests, and only theirs */
  function flushLeaveNotices(){
    var me = selfId();
    var mine = state.leaveNotices.filter(function(r){ return r.EmployeeID === me; });
    state.leaveNotices = state.leaveNotices.filter(function(r){ return r.EmployeeID !== me; });
    mine.forEach(function(r){
      var key = r.decisionKind === "cancel"
        ? (r.decision === "approved" ? "bot_notice_cancel_approved" : "bot_notice_cancel_rejected")
        : (r.decision === "approved" ? "bot_notice_approved" : "bot_notice_rejected");
      var msg = t(key, {id: r.RequestID, name: r.decidedBy, period: leavePeriodLabel(r), reason: r.ApproverComment || ""});
      if(r.decision === "approved" && r.decisionKind === "new" && !r.partial){
        var rec = leaveHoursRecorded(r);
        if(rec.hours > 0) msg += " " + t("bot_notice_conflict", {h: fmt(rec.hours), days: rec.days.join(", ")});
      }
      botSay("bot", msg);
    });
  }

  /* ---------- local reading of leave requests, PT, EN and FR ----------
     Used when Claude isn't configured. Deliberately narrow: an absence type,
     dates, and part-day hours or a window. Anything it can't read is asked
     for, never guessed. */
  var LEAVE_TYPE_RE = [
    ["0200", /doen[çc]a|doente|baixa|sick|illness|maladie|malade/],
    ["0210", /consulta|m[ée]dic|doctor|dentist|m[ée]decin|exame|physio|fisio/],
    ["0300", /forma[çc][ãa]o|training|curso|course|formation|certifica/],
    ["0400", /falta justificada|justified|justifi[ée]e|motivos? pessoa|personal reasons|raisons personnelles/],
    ["0100", /f[ée]rias|vacation|vacances|cong[ée]s? pay[ée]s|\bcong[ée]s?\b|holiday|annual leave|day off|folga/]
  ];
  var LEAVE_GENERIC_RE = /aus[êe]ncia|absence|\bleave\b|time off|\bfolga|\bcong[ée]/;
  function detectLeaveType(low){
    for(var i=0; i<LEAVE_TYPE_RE.length; i++){ if(LEAVE_TYPE_RE[i][1].test(low)) return LEAVE_TYPE_RE[i][0]; }
    return null;
  }
  var LEAVE_MONTH_RE = [
    /^(jan|janeiro|january|janvier)$/, /^(fev|fevereiro|feb|february|f[ée]v|f[ée]vrier)$/, /^(mar|mar[çc]o|march|mars)$/,
    /^(abr|abril|apr|april|avr|avril)$/, /^(mai|maio|may)$/, /^(jun|junho|june|juin)$/, /^(jul|julho|july|juil|juillet)$/,
    /^(ago|agosto|aug|august|ao[uû]t)$/, /^(set|setembro|sep|sept|september|septembre)$/, /^(out|outubro|oct|october|octobre)$/,
    /^(nov|novembro|november|novembre)$/, /^(dez|dezembro|dec|december|d[ée]c|d[ée]cembre)$/
  ];
  function monthIndexOf(word){
    var w = String(word || "").replace(/\.$/, "");
    for(var i=0; i<12; i++){ if(LEAVE_MONTH_RE[i].test(w)) return i; }
    return -1;
  }
  /* No year given: this year, unless that date is already well behind us,
     in which case it can only mean next year. */
  function leaveDateFrom(day, monthIdx, year){
    if(monthIdx < 0 || day < 1 || day > 31) return null;
    var today = todayISO(), y = year ? (+year < 100 ? 2000 + (+year) : +year) : +today.slice(0,4);
    var iso = "" + y + (monthIdx < 9 ? "0" : "") + (monthIdx + 1) + (day < 10 ? "0" : "") + day;
    if(!year && iso < isoAdd(today, -60)) iso = (y + 1) + iso.slice(4);
    return iso;
  }
  var WEEKDAY_WORDS = [
    /segunda|monday|lundi/, /ter[çc]a|tuesday|mardi/, /quarta|wednesday|mercredi/, /quinta|thursday|jeudi/, /sexta|friday|vendredi/
  ];
  function parseLeaveDates(low){
    var m, d1, d2;
    var W = "([a-zà-ÿ]{3,}\\.?)";
    /* 3 to 7 November, de 3 a 7 de novembro, du 3 au 7 novembre, 28 Dec to 2 Jan.
       "de"/"of" only counts as a word of its own: optional and glued, it
       used to eat the start of "december" or "dezembro". */
    m = low.match(new RegExp("(\\d{1,2})(?:\\s*(?:(?:de|of)\\s+)?" + W + ")?\\s*(?:a|à|ao|até|ate|to|till|until|through|-|–|au|e|and)\\s*(\\d{1,2})\\s*(?:(?:de|of)\\s+)?" + W + "(?:\\s*(?:de\\s*)?(\\d{4}))?"));
    if(m && monthIndexOf(m[4]) !== -1 && (!m[2] || monthIndexOf(m[2]) !== -1)){
      var mEnd = monthIndexOf(m[4]), mStart = m[2] ? monthIndexOf(m[2]) : mEnd;
      d1 = leaveDateFrom(+m[1], mStart, m[5]); d2 = leaveDateFrom(+m[3], mEnd, m[5]);
      if(d1 && d2 && d2 < d1) d2 = leaveDateFrom(+m[3], mEnd, String(+d1.slice(0,4) + 1));
      if(d1 && d2) return {start:d1, end:d2};
    }
    /* November 3 to 7, Nov 3 - Nov 7 */
    m = low.match(new RegExp(W + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|till|until|through)\\s*(?:" + W + "\\s+)?(\\d{1,2})"));
    if(m && monthIndexOf(m[1]) !== -1 && (!m[3] || monthIndexOf(m[3]) !== -1)){
      d1 = leaveDateFrom(+m[2], monthIndexOf(m[1])); d2 = leaveDateFrom(+m[4], m[3] ? monthIndexOf(m[3]) : monthIndexOf(m[1]));
      if(d1 && d2) return {start:d1, end:d2};
    }
    /* 2026-11-03, optionally to 2026-11-07 */
    m = low.match(/(\d{4})-(\d{2})-(\d{2})(?:\s*(?:a|à|até|to|-|–|au)\s*(\d{4})-(\d{2})-(\d{2}))?/);
    if(m) return {start:m[1]+m[2]+m[3], end: m[4] ? m[4]+m[5]+m[6] : m[1]+m[2]+m[3]};
    /* 03/11 a 07/11, slash only: "1.5h" is a duration, not the 1st of May */
    m = low.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:a|à|até|to|-|–|au)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?/);
    if(m){
      d1 = leaveDateFrom(+m[1], +m[2] - 1, m[3]);
      d2 = m[4] ? leaveDateFrom(+m[4], +m[5] - 1, m[6] || m[3]) : d1;
      if(d1 && d2) return {start:d1, end:d2};
    }
    /* a single day: 12 de novembro, 12 November, November 12 */
    m = low.match(new RegExp("(\\d{1,2})\\s*(?:(?:de|of)\\s+)?" + W + "(?:\\s*(?:de\\s*)?(\\d{4}))?"));
    if(m && monthIndexOf(m[2]) !== -1){ d1 = leaveDateFrom(+m[1], monthIndexOf(m[2]), m[3]); if(d1) return {start:d1, end:d1}; }
    m = low.match(new RegExp(W + "\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b"));
    if(m && monthIndexOf(m[1]) !== -1){ d1 = leaveDateFrom(+m[2], monthIndexOf(m[1])); if(d1) return {start:d1, end:d1}; }
    /* relative */
    var today = todayISO();
    if(/depois de amanh[ãa]|day after tomorrow|apr[èe]s-demain/.test(low)) return {start:isoAdd(today,2), end:isoAdd(today,2)};
    if(/amanh[ãa]|tomorrow|demain/.test(low)) return {start:isoAdd(today,1), end:isoAdd(today,1)};
    if(/\bhoje\b|\btoday\b|aujourd'hui/.test(low)) return {start:today, end:today};
    if(/pr[óo]xima semana|next week|semaine prochaine/.test(low)){
      var mon = isoAdd(today, 7 - weekdayOf(today));
      return {start:mon, end:isoAdd(mon, 4)};
    }
    for(var i=0; i<5; i++){
      if(WEEKDAY_WORDS[i].test(low)){
        var ahead = (i - weekdayOf(today) + 7) % 7 || 7;
        var d = isoAdd(today, ahead);
        return {start:d, end:d};
      }
    }
    return null;
  }
  function parseLeaveTime(low){
    var m = low.match(/(\d{1,2})(?:[:h](\d{2})|h)\s*(?:às|as|a|à|to|-|–|até|until|e|and)\s*(\d{1,2})(?:[:h](\d{2})|h)?/);
    if(m){
      var b = (+m[1])*60 + (+(m[2] || 0)), e = (+m[3])*60 + (+(m[4] || 0));
      if(e > b) return {partial:true, StartTime:fmtClock(b), EndTime:fmtClock(e), hours:round15((e-b)/60)};
    }
    if(/manh[ãa]|morning|\bmatin|matinée/.test(low)) return {partial:true, StartTime:"09:00", EndTime:"13:00", hours:4};
    if(/\btarde\b|afternoon|apr[èe]s-midi/.test(low)) return {partial:true, StartTime:"14:00", EndTime:"18:00", hours:4};
    if(/meio dia|meio-dia|half day|half-day|demi-journ[ée]e|demi journ[ée]e/.test(low)) return {partial:true, StartTime:"09:00", EndTime:"13:00", hours:4};
    m = low.match(/(\d+(?:[.,]\d+)?)\s*(?:h|horas?|hours?|heures?)\b/);
    if(m){ var h = round15(+m[1].replace(",", ".")); if(h > 0 && h < DAYCAP) return {partial:true, StartTime:"09:00", EndTime:fmtClock(9*60 + Math.round(h*60)), hours:h}; }
    return null;
  }
  function parseLeaveText(txt){
    var low = String(txt || "").toLowerCase();
    var dates = parseLeaveDates(low), tm = parseLeaveTime(low);
    var note = (txt.match(/(?:motivo|nota|note|reason|raison)\s*:\s*(.+)$/i) || [])[1] || "";
    return {type: detectLeaveType(low), dates: dates, time: tm, Notes: note.trim()};
  }
  function leaveDraftFrom(p, base){
    var d = base ? JSON.parse(JSON.stringify(base)) : {};
    if(p.type) d.AbsenceTypeCode = p.type;
    if(p.dates){ d.StartDate = p.dates.start; d.EndDate = p.dates.end; }
    if(p.time){ d.partial = true; d.StartTime = p.time.StartTime; d.EndTime = p.time.EndTime; d.hours = p.time.hours; }
    if(p.Notes) d.Notes = p.Notes;
    return d;
  }
  /* Asks for whatever is still missing (the type, or the dates) and keeps
     the rest, so the next short answer completes the same request. */
  function askLeaveMissing(d){
    chat.leaveDraft = d;
    if(!d.AbsenceTypeCode){
      botSay("bot", t("bot_leave_which_type"));
      botChips(ABSENCE_TYPES.map(function(ty){ return t("abs_" + ty.code); }));
      return;
    }
    botSay("bot", t("bot_leave_when", {type: t("abs_" + d.AbsenceTypeCode).toLowerCase()}));
    botChips([t("chip_leave_tomorrow"), t("chip_leave_next_week"), t("chip_leave_form")]);
  }
  function continueLeaveDraft(txt){
    var p = parseLeaveText(txt);
    if(!p.type && !p.dates && !p.time) return false;
    var d = leaveDraftFrom(p, chat.leaveDraft);
    if(d.AbsenceTypeCode && d.StartDate) offerLeave(d);
    else askLeaveMissing(d);
    return true;
  }
  /* A month named in a question ("feriados em dezembro", "this month"):
     full names only, since "out", "set" or "mar" are words too. No year
     given means the next time that month comes round. */
  function monthFromText(low){
    var cur = todayISO().slice(0,6);
    if(/este m[eê]s|this month|ce mois/.test(low)) return cur;
    if(/pr[óo]ximo m[eê]s|m[eê]s que vem|next month|mois prochain/.test(low)) return monthAdd(cur, 1);
    var words = low.split(/[^a-zà-ÿ]+/), yr = low.match(/\b(20\d\d)\b/);
    for(var i=0; i<words.length; i++){
      var w = words[i], mi = monthIndexOf(w);
      if(mi === -1 || (w.length < 4 && !(w === "mai" && /\b(en|de|em) mai\b/.test(low)))) continue;
      var ym = (yr ? yr[1] : cur.slice(0,4)) + (mi < 9 ? "0" : "") + (mi + 1);
      if(!yr && ym < cur) ym = monthAdd(ym, 12);
      return ym;
    }
    return "";
  }
  /* Questions about what the screens show, read ahead of the leave
     request parser: public holidays, the team calendar, balances (on a
     date, the team's), the account's movements, a request's status, who
     approves, what blocks the submission. Returns true when answered. */
  var HOLIDAY_Q_RE = /feriado|public holiday|bank holiday|national holiday|\bf[ée]ri[ée]s?(?![a-zà-ÿ])/;
  var TEAMCAL_Q_RE = /calend[áa]rio da equipa|team calendar|calendrier de l'[ée]quipe|quem (é que )?(est[áa]|vai estar|anda|fica) (de f[ée]rias|ausente|fora|de baixa)|quem (é que )?(falta|est[áa] fora)|who('s| is| will be|s going to be) (off|out|away|absent|on (vacation|leave|holiday))|qui (est|sera|va [êe]tre) (absent|en cong[ée]s?|en vacances)|aus[êe]ncias da equipa|f[ée]rias da equipa|team('s)? absences|absences de l'[ée]quipe|colegas (de f[ée]rias|ausentes)|colleagues (off|away|absent)|coll[èe]gues absents/;
  var TEAM_BAL_Q_RE = /(saldos?|balances?|soldes?)( de f[ée]rias| de cong[ée]s| of vacation)? (da|de l'|of the|of my|de mon|de mon [ée]quipe|de la) ?(equipa|team|[ée]quipe)|team('s)? (vacation |leave )?balances?|saldos da equipa/;
  var MOVES_Q_RE = /movimentos|movements|mouvements|extrato|account history|hist[óo]rico (da conta|do saldo|das f[ée]rias)|historique (du compte|des cong[ée]s)/;
  var BAL_Q_RE = /\b(saldo|balance|solde)\b/;
  var STATUS_WORD_RE = /estado|status|statut|situa[çc][ãa]o|como (est[áa]|vai)|em que p[ée]|where('s| is)|o[uù] en est|what happened|o que aconteceu|qu'est devenue?|j[áa] (foi )?aprovad|been approved|est.elle approuv|workflow/;
  var WHO_APPROVES_RE = /quem (é que )?(me )?aprova|quem (é )?(o |a )?(meu |minha )?aprovador|who approves|who('s| is) my approver|who (do|should) i (send|submit)|who does (it|my \w+) go to|qui (m')?approuve|qui valide|mon approbateur|(a|para) quem (vai|v[ãa]o|envio|submeto|mando)|[àa] qui (va|vont|j'envoie)/;
  var WHY_SUBMIT_RE = /(porque|por que|porqu[êe]|why).{0,30}(n[ãa]o|can'?t|cannot|can not|isn'?t|won'?t|doesn'?t).{0,30}(submeter|submeto|submit|submiss)|o que (é que )?(falta|bloqueia|impede|me impede).{0,30}(submeter|submiss)|what('s| is) (blocking|stopping|missing).{0,30}submi|pourquoi.{0,40}soumettre|qu'est-ce qui (bloque|emp[êe]che)|^\s*(posso|j[áa] posso) submeter|^\s*can i submit|^\s*(puis-je|est-ce que je peux) soumettre/;
  var CHANGE_LEAVE_RE = /\b(alterar|altera|altere|mudar|muda|mude|modificar|modifica|change|modify|move|reschedule|modifier|modifie[rz]?|changer|change[rz]?|d[ée]placer|d[ée]place[rz]?)\b.{0,40}(pedido|request|demande|f[ée]rias|vacation|cong[ée]s|aus[êe]ncia|absence|\b45\d{5}\b)/;
  /* "what is missing this month", "list the hours I recorded in October":
     read from the period the timesheet shows, the month in Consulting and
     the week in Building Solutions */
  var GAPS_Q_RE = /(\bwhat('s| is)?\b|\bo que\b|qu'est.ce qui|\bque\b(?! (horas|heures))).{0,40}(missing|left to (record|log)|falta|manque|reste)|missing (hours|days)|(horas|dias) em falta|heures manquantes|jours manquants|what (do i|have i) (still )?(need|got|have) to (record|log)|il me manque/;
  var RECORDED_Q_RE = /(list|show|lista|mostra|quais|que|which|what|affiche|liste|quelles).{0,40}(hours|horas|heures).{0,50}(recorded|logged|registad|registei|lancei|lan[çc]ad|saisi|enregistr)|(hours|horas|heures) (per|por|par) (project|projeto|projet)|o que (é que )?(registei|lancei)|what (have i|did i) (record|log)|qu'est.ce que j'ai (saisi|enregistr)/;
  function periodDates(){
    return isMonthly() ? activeMonthDates() : datesFor(WEEKS[weekIdx].start).slice(0, 5);
  }
  function periodLabel(){ return isMonthly() ? monthSentenceLabel() : t("fmt_week_n", {n: isoWeekOf(WEEKS[weekIdx].start)}); }
  function showGaps(){
    var gaps = [], miss = 0, tot = 0, exp = 0;
    periodDates().forEach(function(d){
      var wd = weekDayFor(d);
      if(!wd || wd.day > 4) return;
      var cap = capacityOf(wd.week, wd.day), done = dayTotalOf(wd.week, wd.day);
      tot += done; exp += cap;
      if(wd.week.submitted || done >= cap) return;
      gaps.push(t("bot_gap_row", {day: monthDayLabel(wd.week, wd.day), h: fmt(done), cap: fmt(cap), left: fmt(cap - done)}));
      miss += cap - done;
    });
    if(!gaps.length){ botSay("bot", t("bot_gaps_none", {period: periodLabel(), tot: fmt(tot), exp: fmt(exp)})); botChips([chipSubmit()]); return; }
    var node = el("div","jlist","");
    gaps.forEach(function(g){ node.appendChild(el("div","jrow2", g)); });
    botSay("bot", plural(gaps.length, "bot_gaps_head", {period: periodLabel(), h: fmt(miss), tot: fmt(tot), exp: fmt(exp)}), node);
    botChips([t("chip_fill_missing"), chipSubmit()]);
  }
  function showRecorded(){
    var byP = {}, order = [], byW = {}, wOrder = [], tot = 0, exp = 0;
    periodDates().forEach(function(d){
      var wd = weekDayFor(d);
      if(!wd) return;
      exp += capacityOf(wd.week, wd.day);
      var n = isoWeekOf(wd.week.start);
      wd.week.rows.forEach(function(r){
        var h = r.h[wd.day] || 0;
        if(!h) return;
        var k = PROJECTS[r.p].code;
        if(!byP[k]){ byP[k] = {name: PROJECTS[r.p].name, h: 0}; order.push(k); }
        byP[k].h += h; tot += h;
        if(!byW[n]){ byW[n] = 0; wOrder.push(n); }
        byW[n] += h;
      });
    });
    if(!tot){ botSay("bot", t("bot_recorded_none", {period: periodLabel()})); return; }
    var node = el("div","jlist","");
    order.forEach(function(k){ node.appendChild(el("div","jrow2", k + " · " + byP[k].name + " · " + fmt(byP[k].h) + " h")); });
    if(isMonthly() && wOrder.length > 1){
      node.appendChild(el("div","jsub", t("label_weeks")));
      wOrder.forEach(function(n){ node.appendChild(el("div","jrow2", t("fmt_week_n", {n: n}) + " · " + fmt(byW[n]) + " h")); });
    }
    botSay("bot", t("bot_recorded_head", {period: periodLabel(), tot: fmt(tot), exp: fmt(exp)}), node);
    botChips([t("chip_what_missing"), chipSubmit()]);
  }
  function answerInfoLocal(txt){
    var low = txt.toLowerCase();
    var tsWord = /timesheet|folha|horas\b|hours\b|heures\b/.test(low);
    if(WHY_SUBMIT_RE.test(low)){ explainSubmit(); return true; }
    if(GAPS_Q_RE.test(low) && !FILL_VERB_RE.test(low)){ showGaps(); return true; }
    if(RECORDED_Q_RE.test(low)){ showRecorded(); return true; }
    if(WHO_APPROVES_RE.test(low)){ showApprovers(); return true; }
    if(HOLIDAY_Q_RE.test(low)){ showHolidays(monthFromText(low)); return true; }
    /* "holidays in December", a month and no request: the public ones */
    if(/\bholidays\b/.test(low) && monthFromText(low) && !LEAVE_REQUEST_VERB_RE.test(low) && !/\d/.test(low)){ showHolidays(monthFromText(low)); return true; }
    if(TEAM_BAL_Q_RE.test(low)){ showTeamBalances(); return true; }
    if(TEAMCAL_Q_RE.test(low)){
      var ym = monthFromText(low), dd = ym ? null : parseLeaveDates(low);
      if(ym) showTeamCalendar(ym + "01", isoAdd(monthAdd(ym, 1) + "01", -1));
      else showTeamCalendar(dd ? dd.start : "", dd ? dd.end : "");
      return true;
    }
    if(MOVES_Q_RE.test(low)){ showMovements(); return true; }
    var num = (low.match(/\b(45\d{5})\b/) || [])[1] || "";
    if(CHANGE_LEAVE_RE.test(low)){
      var p = parseLeaveText(txt.replace(/\b45\d{5}\b/g, " "));
      var ch = leaveDraftFrom(p, null);
      offerChangeLeave(num, ch);
      return true;
    }
    if(STATUS_WORD_RE.test(low) && (num || /pedido|request|demande/.test(low))){ showRequestStatus(num); return true; }
    if(BAL_Q_RE.test(low) && !tsWord){
      var bd = parseLeaveDates(low);
      if(bd && !/\bhoje\b|\btoday\b|aujourd'hui/.test(low)) showBalanceAsOf(bd.end); else showLeaveBalance();
      return true;
    }
    return false;
  }
  var LEAVE_REQUEST_VERB_RE = /\b(quero|queria|gostava|pedir|pe[çc]o|marcar|preciso|tirar|request|book|take|need|want|poser|demander|prendre)\b|would like|je veux|je voudrais|j'aimerais/;
  /* Returns true when the message was about leave and has been answered. */
  function handleLeaveLocal(txt){
    var low = txt.toLowerCase();
    /* the assistant serves the person talking to it, never another profile */
    if(/mudar (o |de )?(teste|perfil)|change (the |my )?(test|profile)|changer (de |le )?(test|profil)|ver como|view as|voir en tant que|switch (to|profile)/.test(low)){ botSay("bot", t("bot_no_profile_switch")); botChips([t("chip_hours_i_have"), t("chip_my_leave")]); return true; }
    if(/formul[áa]rio|request form|open the form|formulaire/.test(low)){ openLeaveDialog(chat.leaveFormPrefill || chat.leaveDraft || null); chat.leaveFormPrefill = null; chat.leaveDraft = null; botSay("bot", t("bot_leave_form_opened")); return true; }
    if(answerInfoLocal(txt)) return true;

    var type = detectLeaveType(low);
    var hasLeave = !!type || LEAVE_GENERIC_RE.test(low);
    var tsWord = /timesheet|folha|horas\b|relev[ée]|hours\b/.test(low);

    /* the manager's inbox */
    if(/para aprovar|por aprovar|pendentes?\b|pending|to approve|[àa] approuver|en attente|o que (é que )?tenho|what do i have|qu'est-ce que j'ai|what('s| is) waiting|waiting for me|[àa] minha espera|m'attend/.test(low) && !tsWord){
      if(state.role !== "employee" || hasLeave){ showPendingApprovals(state.role === "manager" ? monthFromText(low) : ""); return true; }
    }
    var targets = matchLeaveTargets(txt);
    /* "all" on its own still means the timesheets, as it always has; it
       only reaches leave requests when the message is about leave. */
    var named = /\b(todos|todas|tudo|everyone|everything|all|tous|toutes|tout)\b/.test(low) ? [] : targets;
    var reject = /\brejeita(r)?\b|\brecusa(r)?\b|\breject\b|\bdecline\b|\brefuse[rz]?\b|\brejette[rz]?\b/.test(low);
    var approve = /\baprova(r)?\b|\baprove\b|\bapprove\b|\bapprouve[rz]?\b|\bvalide[rz]?\b/.test(low);
    if((reject || approve) && !tsWord && (hasLeave || /\b45\d{5}\b/.test(low) || (named.length && state.role === "manager"))){
      /* the project manager approves timesheets: a bare name means theirs */
      if(state.role === "pm" && !hasLeave && !/\b45\d{5}\b/.test(low)) return false;
      var tsHit = state.role === "pm" ? matchApprovalTargets(txt) : null;
      if(!hasLeave && approve && tsHit && tsHit.one && targets.length === 1 && targets[0].EmployeeName.split(" ")[0] === tsHit.one.who.split(" ")[0]){
        var first = targets[0].EmployeeName.split(" ")[0];
        botSay("bot", t("bot_leave_ambiguous", {name: first}));
        botChips([t("chip_approve_leave_of", {name: first}), t("chip_approve_ts_of", {name: first})]);
        return true;
      }
      var reason = (txt.match(/(?:porque|pois|because|since|car|parce que|motivo:?|reason:?|raison:?)\s+(.+)$/i) || [])[1] || "";
      offerLeaveDecision(targets, approve && !reject, reason.trim());
      return true;
    }
    if(!hasLeave) return false;

    if(/cancel|anul|retir|withdraw|annul|desmarc/.test(low)){ offerWithdraw(findLeaveTarget(txt)); return true; }
    /* "vacation for Ana 3 to 5 November": an absence for someone else,
       which only the line manager records, for a direct report */
    var forWho = txt.match(/\b(?:para|for|pour)\s+(?:o\s+|a\s+|the\s+)?([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/);
    var forReport = forWho && reportsOf().filter(function(m){ return m.EmployeeID !== selfId() && foldText(m.name.split(" ")[0]) === foldText(forWho[1].split(" ")[0]); })[0];
    if(forReport){ offerLeaveOnBehalf(forReport.name, leaveDraftFrom(parseLeaveText(txt), null)); return true; }
    if(/saldo|balance|solde|quantos dias|how many (\w+ )?days|combien de jours|dias dispon|days (do i have )?left|restam|sobram|me restent/.test(low)){
      /* with a date, the balance as it will stand that day */
      var bd = parseLeaveDates(low);
      if(bd && !/\bhoje\b|\btoday\b|aujourd'hui/.test(low)) showBalanceAsOf(bd.end); else showLeaveBalance();
      return true;
    }

    var p = parseLeaveText(txt);
    if(p.dates || (LEAVE_REQUEST_VERB_RE.test(low) && type)){
      var d = leaveDraftFrom(p, null);
      if(d.AbsenceTypeCode && d.StartDate) offerLeave(d); else askLeaveMissing(d);
      return true;
    }
    if(LEAVE_REQUEST_VERB_RE.test(low)){ askLeaveMissing(leaveDraftFrom(p, null)); return true; }
    if(/pedidos|requests|demandes/.test(low)){ showMyLeave(); return true; }
    showAbsences();
    return true;
  }
  /* ---------- kilometres between two places ----------
     Own-car kilometres (wage type KMS) are recorded with their route, and
     the distance is worked out here and shown for confirmation instead of
     being typed from memory. In SAP this comes from a routing service; the
     mockup carries road distances for the usual trips between Portuguese
     cities and, for any other pair, an estimate from the map. */
  var PLACES = [
    {name:"Lisboa", en:"Lisbon", fr:"Lisbonne", alias:["lisboa","lisbon","lisbonne"], lat:38.7223, lon:-9.1393},
    {name:"Porto", alias:["porto","oporto"], lat:41.1579, lon:-8.6291},
    {name:"Vila Nova de Gaia", alias:["vila nova de gaia","gaia"], lat:41.1239, lon:-8.6118},
    {name:"Matosinhos", alias:["matosinhos"], lat:41.1844, lon:-8.6963},
    {name:"Braga", alias:["braga"], lat:41.5454, lon:-8.4265},
    {name:"Guimarães", alias:["guimaraes"], lat:41.4425, lon:-8.2918},
    {name:"Viana do Castelo", alias:["viana do castelo","viana"], lat:41.6932, lon:-8.8329},
    {name:"Vila Real", alias:["vila real"], lat:41.3006, lon:-7.7441},
    {name:"Bragança", alias:["braganca"], lat:41.8061, lon:-6.7567},
    {name:"Aveiro", alias:["aveiro"], lat:40.6405, lon:-8.6538},
    {name:"Viseu", alias:["viseu"], lat:40.6566, lon:-7.9125},
    {name:"Coimbra", alias:["coimbra"], lat:40.2033, lon:-8.4103},
    {name:"Leiria", alias:["leiria"], lat:39.7436, lon:-8.8071},
    {name:"Castelo Branco", alias:["castelo branco"], lat:39.8222, lon:-7.4909},
    {name:"Santarém", alias:["santarem"], lat:39.2369, lon:-8.6850},
    {name:"Sintra", alias:["sintra"], lat:38.8029, lon:-9.3817},
    {name:"Cascais", alias:["cascais"], lat:38.6979, lon:-9.4215},
    {name:"Oeiras", alias:["oeiras"], lat:38.6913, lon:-9.3109},
    {name:"Almada", alias:["almada"], lat:38.6790, lon:-9.1569},
    {name:"Setúbal", alias:["setubal"], lat:38.5244, lon:-8.8882},
    {name:"Évora", alias:["evora"], lat:38.5714, lon:-7.9135},
    {name:"Beja", alias:["beja"], lat:38.0151, lon:-7.8632},
    {name:"Sines", alias:["sines"], lat:37.9560, lon:-8.8698},
    {name:"Portimão", alias:["portimao"], lat:37.1386, lon:-8.5370},
    {name:"Faro", alias:["faro"], lat:37.0194, lon:-7.9322},
    /* the places abroad a consultant most often travels between, so a trip
       in France or Spain works like one in Portugal; anywhere else, Claude
       sends the place's coordinates and the page estimates the road */
    {name:"Paris", alias:["paris"], lat:48.8566, lon:2.3522},
    {name:"Lyon", alias:["lyon","lyons"], lat:45.7640, lon:4.8357},
    {name:"Marseille", alias:["marseille","marselha","marseilles"], lat:43.2965, lon:5.3698},
    {name:"Bordeaux", alias:["bordeaux","bordeus"], lat:44.8378, lon:-0.5792},
    {name:"Arcachon", alias:["arcachon"], lat:44.6586, lon:-1.1689},
    {name:"Toulouse", alias:["toulouse"], lat:43.6047, lon:1.4442},
    {name:"Nantes", alias:["nantes"], lat:47.2184, lon:-1.5536},
    {name:"Lille", alias:["lille"], lat:50.6292, lon:3.0573},
    {name:"Nice", alias:["nice"], lat:43.7102, lon:7.2620},
    {name:"Strasbourg", alias:["strasbourg","estrasburgo"], lat:48.5734, lon:7.7521},
    {name:"Montpellier", alias:["montpellier"], lat:43.6108, lon:3.8767},
    {name:"Rennes", alias:["rennes"], lat:48.1173, lon:-1.6778},
    {name:"Grenoble", alias:["grenoble"], lat:45.1885, lon:5.7245},
    {name:"Tours", alias:["tours"], lat:47.3941, lon:0.6848},
    {name:"Orléans", alias:["orleans"], lat:47.9030, lon:1.9093},
    {name:"Poitiers", alias:["poitiers"], lat:46.5802, lon:0.3404},
    {name:"La Rochelle", alias:["la rochelle"], lat:46.1603, lon:-1.1511},
    {name:"Limoges", alias:["limoges"], lat:45.8336, lon:1.2611},
    {name:"Clermont-Ferrand", alias:["clermont-ferrand","clermont ferrand"], lat:45.7772, lon:3.0870},
    {name:"Dijon", alias:["dijon"], lat:47.3220, lon:5.0415},
    {name:"Reims", alias:["reims"], lat:49.2583, lon:4.0317},
    {name:"Metz", alias:["metz"], lat:49.1193, lon:6.1757},
    {name:"Nancy", alias:["nancy"], lat:48.6921, lon:6.1844},
    {name:"Rouen", alias:["rouen"], lat:49.4432, lon:1.0999},
    {name:"Le Havre", alias:["le havre"], lat:49.4944, lon:0.1079},
    {name:"Toulon", alias:["toulon"], lat:43.1242, lon:5.9280},
    {name:"Perpignan", alias:["perpignan"], lat:42.6887, lon:2.8948},
    {name:"Pau", alias:["pau"], lat:43.2951, lon:-0.3708},
    {name:"Bayonne", alias:["bayonne"], lat:43.4929, lon:-1.4748},
    {name:"Biarritz", alias:["biarritz"], lat:43.4832, lon:-1.5586},
    {name:"Madrid", alias:["madrid"], lat:40.4168, lon:-3.7038},
    {name:"Barcelona", en:"Barcelona", fr:"Barcelone", alias:["barcelona","barcelone"], lat:41.3874, lon:2.1686},
    {name:"Sevilha", en:"Seville", fr:"Séville", alias:["sevilha","sevilla","seville"], lat:37.3891, lon:-5.9845},
    {name:"Valência", en:"Valencia", fr:"Valence (Espagne)", alias:["valencia"], lat:39.4699, lon:-0.3763},
    {name:"Bilbau", en:"Bilbao", fr:"Bilbao", alias:["bilbau","bilbao"], lat:43.2630, lon:-2.9350},
    {name:"Vigo", alias:["vigo"], lat:42.2406, lon:-8.7207},
    {name:"Corunha", en:"A Coruña", fr:"La Corogne", alias:["corunha","coruna","a coruna","la coruna","la corogne"], lat:43.3623, lon:-8.4115},
    {name:"Salamanca", alias:["salamanca","salamanque"], lat:40.9701, lon:-5.6635},
    {name:"Badajoz", alias:["badajoz"], lat:38.8794, lon:-6.9707},
    {name:"Bruxelas", en:"Brussels", fr:"Bruxelles", alias:["bruxelas","brussels","bruxelles"], lat:50.8503, lon:4.3517},
    {name:"Luxemburgo", en:"Luxembourg", fr:"Luxembourg", alias:["luxemburgo","luxembourg"], lat:49.6116, lon:6.1319},
    {name:"Genebra", en:"Geneva", fr:"Genève", alias:["genebra","geneva","geneve"], lat:46.2044, lon:6.1432}
  ];
  function kmKey(a, b){ return [a, b].sort().join("|"); }
  var ROAD_KM = {};
  [
    ["Lisboa","Porto",313], ["Lisboa","Coimbra",205], ["Lisboa","Braga",365], ["Lisboa","Faro",278],
    ["Lisboa","Setúbal",50], ["Lisboa","Évora",134], ["Lisboa","Leiria",145], ["Lisboa","Aveiro",255],
    ["Lisboa","Santarém",85], ["Lisboa","Sintra",28], ["Lisboa","Cascais",32], ["Lisboa","Oeiras",18],
    ["Lisboa","Almada",12], ["Lisboa","Viseu",290], ["Lisboa","Beja",178], ["Lisboa","Sines",160],
    ["Lisboa","Castelo Branco",220], ["Lisboa","Portimão",285],
    ["Porto","Braga",55], ["Porto","Guimarães",55], ["Porto","Aveiro",75], ["Porto","Coimbra",122],
    ["Porto","Viseu",128], ["Porto","Vila Real",95], ["Porto","Viana do Castelo",72], ["Porto","Matosinhos",9],
    ["Porto","Vila Nova de Gaia",5], ["Porto","Faro",555], ["Porto","Leiria",190], ["Porto","Bragança",210],
    ["Coimbra","Aveiro",62], ["Coimbra","Leiria",72], ["Coimbra","Viseu",92], ["Faro","Portimão",67],
    ["Braga","Guimarães",25],
    ["Paris","Lyon",465], ["Paris","Bordeaux",585], ["Paris","Arcachon",645], ["Bordeaux","Arcachon",65],
    ["Paris","Marseille",775], ["Paris","Lille",225], ["Paris","Nantes",385], ["Paris","Toulouse",680],
    ["Paris","Strasbourg",490], ["Paris","Rennes",350], ["Paris","Tours",240], ["Paris","Orléans",130],
    ["Paris","Nice",930], ["Paris","Reims",145], ["Paris","Rouen",135], ["Lyon","Marseille",315],
    ["Lyon","Grenoble",110], ["Bordeaux","Toulouse",245], ["Bordeaux","Biarritz",190], ["Marseille","Nice",200],
    ["Lisboa","Madrid",625], ["Lisboa","Badajoz",225], ["Lisboa","Sevilha",460], ["Lisboa","Paris",1735],
    ["Porto","Vigo",150], ["Porto","Madrid",560], ["Madrid","Barcelona",620], ["Porto","Salamanca",320]
  ].forEach(function(r){ ROAD_KM[kmKey(r[0], r[1])] = r[2]; });
  /* where a trip starts when only the destination is said */
  var OFFICE_PLACE = {PT01:"Lisboa", PT02:"Porto"};
  function foldText(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function placeLabel(p){ var l = curLang(); return (l === "en" && p.en) || (l === "fr" && p.fr) || p.name; }
  function placeByName(name){
    var f = foldText(name).trim().replace(/^(o|a|the|le|la)\s+/, "");
    if(!f) return null;
    return PLACES.filter(function(p){ return p.alias.indexOf(f) !== -1 || foldText(p.name) === f; })[0] || null;
  }
  function officePlace(){ return placeByName(OFFICE_PLACE[IT0001.bukrs] || "Lisboa"); }
  function roadKm(a, b){
    if(a === b) return {km:0, exact:true};
    var known = ROAD_KM[kmKey(a.name, b.name)];
    if(known) return {km:known, exact:true};
    var rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(a.lat*rad) * Math.cos(b.lat*rad) * Math.sin(dLon/2) * Math.sin(dLon/2);
    /* roads are rarely straight: a quarter on top of the straight line */
    return {km:Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25), exact:false};
  }
  var KM_FROM_RE = /(?:^|\s)(?:de|do|da|desde|from|depuis|du)\s+(?:o\s+|a\s+|the\s+)?$/;
  var KM_TO_RE = /(?:^|\s)(?:para|pra|to|ate|a|ao|pour|vers|au|jusqu'a)\s+(?:o\s+|a\s+|the\s+)?$/;
  /* The places named in a message, in the order written; the words just
     before each one ("de", "para", "from", "to") say which end it is. */
  function findPlaces(txt){
    var f = " " + foldText(txt) + " ", hits = [];
    PLACES.forEach(function(p){
      var best = null;
      p.alias.forEach(function(al){
        var m = f.match(new RegExp("[^a-z]" + al.replace(/ /g, "\\s+") + "(?=[^a-z])"));
        if(m && (!best || m.index < best.idx)) best = {place:p, idx:m.index, before:f.slice(Math.max(0, m.index - 14), m.index + 1)};
      });
      if(best) hits.push(best);
    });
    return hits.sort(function(x, y){ return x.idx - y.idx; });
  }
  var KM_STOP = ("o a os as the um uma le la registar regista registo record log add enter mim me my hoje today ontem yesterday anteontem amanha tomorrow " +
    "segunda terca quarta quinta sexta sabado domingo monday tuesday wednesday thursday friday saturday sunday lundi mardi mercredi jeudi vendredi samedi dimanche " +
    "ida volta km kms quilometros kilometres kilometers projeto project projet dia day jour semana week manha tarde morning afternoon cliente client viagem trip ").split(" ");
  /* A word after "to"/"para"/"de" that isn't a place the mockup knows. */
  function unknownPlaceIn(txt){
    var f = foldText(txt).replace(/\d+([.,]\d+)?\s*(km|kms|quilometros?|kilometres?|kilometers?)\b/g, " ");
    var re = /(?:^|\s)(?:de|do|da|desde|from|depuis|para|pra|to|ate|pour|vers)\s+(?:o\s+|a\s+|the\s+)?([a-z][a-z'-]{2,}(?:\s+[a-z][a-z'-]{2,})?)/g, m;
    while((m = re.exec(f))){
      var words = m[1].split(/\s+/);
      /* the next search starts right after this word, so "de lisboa para casa" still reaches "para casa" */
      re.lastIndex = m.index + m[0].length - m[1].length + words[0].length;
      if(KM_STOP.indexOf(words[0]) !== -1 || monthIndexOf(words[0]) !== -1 || placeByName(words[0]) || placeByName(m[1])) continue;
      /* "para o BNK" is a project, not a place */
      if(PROJECTS.some(function(pr){ return foldText(pr.code.split("-")[0]) === words[0]; })) continue;
      var two = words.length > 1 && KM_STOP.indexOf(words[1]) === -1 && monthIndexOf(words[1]) === -1 && !placeByName(words[1]) ? m[1] : words[0];
      return two.replace(/\b\w/g, function(c){ return c.toUpperCase(); });
    }
    return "";
  }
  function kmDateFrom(txt){
    var low = String(txt).toLowerCase().replace(/\d+([.,]\d+)?\s*(km|kms|quil[óo]metros?|kilom[eè]tres?|kilometers?)\b/g, " ");
    var f = foldText(low), today = todayISO();
    if(/anteontem|day before yesterday|avant-hier/.test(f)) return isoAdd(today, -2);
    if(/\bontem\b|yesterday|\bhier\b/.test(f)) return isoAdd(today, -1);
    if(/\bhoje\b|\btoday\b|aujourd'hui/.test(f)) return today;
    if(/amanha|tomorrow|demain/.test(f)) return isoAdd(today, 1);
    var WD = [/segunda|monday|lundi/, /terca|tuesday|mardi/, /quarta|wednesday|mercredi/, /quinta|thursday|jeudi/, /sexta|friday|vendredi/, /sabado|saturday|samedi/, /domingo|sunday|dimanche/];
    /* a trip is in the past: "Monday" is the last Monday, today included */
    for(var i=0; i<7; i++){ if(WD[i].test(f)) return isoAdd(today, -((weekdayOf(today) - i + 7) % 7)); }
    if(/\d/.test(low)){ var dd = parseLeaveDates(low); if(dd) return dd.start; }
    return "";
  }
  function kmProjectFromText(txt){
    var allowed = profileProjects(), up = " " + String(txt).toUpperCase() + " ", i;
    for(i=0; i<allowed.length; i++){ if(up.indexOf(PROJECTS[allowed[i]].code.toUpperCase()) !== -1) return allowed[i]; }
    for(i=0; i<allowed.length; i++){
      if(new RegExp("[^A-Z]" + PROJECTS[allowed[i]].code.split("-")[0].toUpperCase() + "[^A-Z]").test(up)) return allowed[i];
    }
    return -1;
  }
  /* the project the person spent most of that day on, else their first */
  function kmDefaultProject(week, day){
    var allowed = profileProjects(), best = -1, most = 0;
    (week.rows || []).forEach(function(r){ if(allowed.indexOf(r.p) !== -1 && (r.h[day] || 0) > most){ most = r.h[day]; best = r.p; } });
    if(best !== -1) return best;
    var any = (week.rows || []).filter(function(r){ return allowed.indexOf(r.p) !== -1; })[0];
    return any ? any.p : (allowed.length ? allowed[0] : 0);
  }
  function setKmEnd(d, end, raw, lat, lon){
    var place = placeByName(raw);
    if(!place && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)){
      var label = String(raw).trim().replace(/\b\w/g, function(c){ return c.toUpperCase(); });
      place = {name: label, alias: [], lat: Number(lat), lon: Number(lon), adhoc: true};
    }
    d[end] = place;
    d[end + "Label"] = place ? placeLabel(place) : String(raw).trim().replace(/\b\w/g, function(c){ return c.toUpperCase(); });
    if(!place) d.unknown = d[end + "Label"];
    if(end === "from") d.fromOffice = false;
  }
  /* Reads a message into a kilometres draft, on top of the one already on
     screen when there is one, so "round trip" or "from Coimbra" corrects
     it. Returns null when the message says nothing about the trip. */
  function kmDraftFromText(txt, base){
    var d = base ? Object.assign({}, base) : {}, seen = false, strong = false;
    var f = foldText(txt);
    var q = f.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kms|quilometros?|kilometres?|kilometers?)\b/);
    if(q){ d.given = Math.round(parseFloat(q[1].replace(",", "."))); seen = true; }
    if(/ida e volta|ida-e-volta|round.?trip|return trip|there and back|both ways|aller.?retour|aller et retour/.test(f)){ d.round = true; seen = true; }
    else if(/\bso (a )?ida\b|apenas ida|one.?way|aller simple/.test(f)){ d.round = false; seen = true; }
    strong = seen;
    var hits = findPlaces(txt);
    if(hits.length >= 2){
      var a = hits[0], b = hits[1];
      /* "to Porto from Lisbon": the first one named is where it ends */
      var swap = KM_TO_RE.test(a.before) && KM_FROM_RE.test(b.before);
      setKmEnd(d, "from", (swap ? b : a).place.name); setKmEnd(d, "to", (swap ? a : b).place.name);
      d.unknown = ""; seen = true;
    } else if(hits.length === 1){
      var h = hits[0];
      if(KM_FROM_RE.test(h.before)){
        setKmEnd(d, "from", h.place.name);
        if(!d.to && !d.toLabel){ var off = officePlace(); d.to = off; d.toLabel = placeLabel(off); }
      } else {
        setKmEnd(d, "to", h.place.name);
        if(!d.from && !d.fromLabel){ var o = officePlace(); d.from = o; d.fromLabel = t("label_office_base", {city: placeLabel(o)}); d.fromOffice = true; }
      }
      d.unknown = "";
      var other = unknownPlaceIn(txt);
      if(other){ if(KM_FROM_RE.test(h.before)) setKmEnd(d, "to", other); else setKmEnd(d, "from", other); }
      seen = true;
    } else {
      var unk = unknownPlaceIn(txt);
      if(unk){ setKmEnd(d, "to", unk); seen = true; }
    }
    if(seen) strong = true;
    var dt = kmDateFrom(txt);
    if(dt){ d.date = dt; seen = true; }
    var pj = kmProjectFromText(txt);
    if(pj !== -1){ d.p = pj; d.pAuto = false; seen = true; }
    /* a day or a project alone only corrects the trip in a short reply:
       "2h BNK today" is a new time entry, not this trip moving to today */
    d.strong = strong;
    return seen ? d : null;
  }
  var KM_WORD_RE = /(?:\b|\d)kms?\b|quilometr|kilomet|\bmileage\b/;
  function offerKm(d){
    chat.kmDraft = d;
    chat.pending = "km";
    var known = d.from && d.to;
    if(!d.toLabel || (known && d.from === d.to)){
      botSay("bot", t("bot_km_which_route"));
      botChips([t("chip_km_example")]);
      return;
    }
    if(!known && !d.given){
      botSay("bot", t("bot_km_unknown_place", {place: d.unknown || d.toLabel}));
      return;
    }
    var today = todayISO();
    if(!d.date) d.date = today;
    var stop = null;
    var wd = weekDayIn(WEEKS, d.date);
    if(d.date > today) stop = t("bot_km_future", {date: fmtDate(d.date)});
    else if(!wd) stop = t("bot_km_no_week", {date: fmtDate(d.date)});
    else if(wd.week.submitted) stop = t("bot_km_week_submitted", {date: fmtDate(d.date)});
    else if(!periodOpen(d.date)) stop = t("bot_km_period_closed", {date: fmtDate(d.date)});
    if(stop){
      botSay("bot", stop);
      botChips([t("chip_km_example")]);
      return;
    }
    if(d.p == null || d.p === -1 || d.pAuto !== false){ d.p = kmDefaultProject(wd.week, wd.day); d.pAuto = true; }
    var leg = known ? roadKm(d.from, d.to) : null;
    var calc = leg ? leg.km * (d.round ? 2 : 1) : null;
    var qty = d.given || calc;
    var route = d.fromLabel + " → " + d.toLabel + " (" + t(d.round ? "km_round_trip" : "km_one_way") + ")";
    var lines = [
      [t("label_allowance"), wtName(wt("KMS"))],
      [t("label_route"), route]
    ];
    if(leg) lines.push([t("label_road_distance"), t("km_per_leg", {km: leg.km}) + (leg.exact ? "" : " " + t("km_estimated"))]);
    lines.push([t("label_to_record"), qty + " km"]);
    lines.push([t("label_day"), fmtDateShort(d.date)]);
    lines.push([t("label_project"), PROJECTS[d.p].code + " · " + PROJECTS[d.p].name]);
    var warn = d.given && calc && Math.abs(d.given - calc) > calc * 0.1 ? t("warn_km_differs", {given: d.given, calc: calc}) : null;
    if(chat.curTurn) chat.curTurn.path = chat.curTurn.path || "km";
    botSay("bot", t(leg ? "bot_km_confirm" : "bot_km_confirm_given"), botCard(lines, t("btn_register"), function(){
      chat.kmDraft = null;
      recordKm(d, wd, qty, d.fromLabel.replace(/\s*\(.*\)$/, "") + " → " + d.toLabel + (d.round ? " (" + t("km_round_trip") + ")" : ""));
    }, warn));
    var kmChips = known && !d.given ? [t(d.round ? "chip_km_one_way" : "chip_km_round")] : [];
    if(d.pAuto) kmChips = kmChips.concat(profileProjects().filter(function(i){ return i !== d.p; }).map(function(i){ return PROJECTS[i].code; }));
    botChips(kmChips);
    chat.history.push({role:"assistant", content:"Proposed " + qty + " km own-car kilometres, " + route + ", on " + d.date + ". Waiting for confirmation."});
  }
  function recordKm(d, wd, qty, note){
    var week = wd.week;
    if(!week.allow) week.allow = [];
    week.allow.push({id:"al" + (nextId++), day:wd.day, p:d.p, code:"KMS", qty:qty, amount:0, note:note,
      by:IT0001.pernr, onBehalf:IT0001.pernr, byName:"self", origin:"Joule"});
    if(week === WEEKS[weekIdx]) state.allow = week.allow;
    render();
    botSay("bot", t("bot_km_recorded", {km: qty, day: fmtDateShort(d.date), route: note, code: PROJECTS[d.p].code}));
    botChips([t("chip_hours_i_have"), t("chip_help")]);
  }
  /* the screen's own Add allowance form, for kilometres: origin and
     destination give the quantity, shown before it's recorded */
  function syncAllowRoute(){
    var isKm = $("alCode").value === "KMS";
    $("alRouteWrap").hidden = !isKm; $("alRoundWrap").hidden = !isKm; $("alRouteInfo").hidden = !isKm;
    if(!isKm) return;
    $("alNoteWrap").hidden = true;
    var a = placeByName($("alFrom").value), b = placeByName($("alTo").value);
    var info = $("alRouteInfo");
    if(a && b && a !== b){
      var leg = roadKm(a, b), tot = leg.km * ($("alRound").checked ? 2 : 1);
      $("alQty").value = String(tot);
      info.textContent = t("hint_km_route", {route: placeLabel(a) + " → " + placeLabel(b), km: leg.km, total: tot}) + (leg.exact ? "" : " " + t("km_estimated"));
    } else if($("alTo").value.trim() && $("alFrom").value.trim()){
      info.textContent = t("hint_km_unknown");
    } else {
      info.textContent = t("hint_km_enter_route");
    }
  }
  /* "2026-11-03" from Claude to the YYYYMMDD the app keys on. */
  function isoArg(v){
    var s = String(v || "").trim();
    var m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    return m ? m[1] + m[2] + m[3] : "";
  }

  /* ---------- where the assistant lives ----------
     On the Assistant screen it is the page itself, docked next to the
     secondary view of the data. Anywhere else it goes back to being the
     floating panel behind the button, with the same conversation. */
  function placeAssistant(screen){
    var p = $("joulePanel"), home = $("homeChat"), fab = $("jouleFab");
    if(!p || !home || !fab) return;
    if(screen === "home"){
      if(p.parentNode !== home) home.appendChild(p);
      p.classList.add("docked");
      p.hidden = false;
      fab.hidden = true;
      assistantEnsureGreeted();
    } else {
      /* the assistant lives on its own tab only: no floating button or
         panel on the other screens */
      p.hidden = true;
      fab.hidden = true;
    }
  }

  /* ---------- learning loop: Claude in the page, and the conversation log ----------
     Published as an Artifact on claude.ai, the page asks Claude itself (the
     `sample` capability, on the viewer's own account, no API key needed)
     with the same functions and instructions as api/chat.js, and keeps each
     conversation in the artifact's database (`db`). A scheduled task reads
     those conversations every night, turns what went wrong into test cases
     and opens a pull request with the fix. Anywhere else (Vercel, a local
     file) window.claude is absent or use() resolves null, and the page
     behaves exactly as before: /api/chat, then the local interpreter, and
     nothing is recorded. Only the mockup's fictitious data is involved. */
  var learn = {sample:null, sampleOff:false, db:null, sessionId:null, part:0, started:null, turns:[], writing:false, dirty:false, timer:null};
  (function(){
    if(!(window.claude && typeof window.claude.use === "function")) return;
    window.claude.use("sample").then(function(sm){ learn.sample = sm || null; }, function(){});
    window.claude.use("db").then(function(db){
      if(!db) return;
      learn.db = db;
      learn.started = new Date().toISOString();
      learn.sessionId = learn.started.replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 7);
      var chipEl = $("jLogChip");
      if(chipEl) chipEl.hidden = false;
    }, function(){});
  })();

  /* `sample` has no system prompt: the instructions go in a leading user
     turn, followed by the conversation the page keeps, ending on the new
     message. The reply is the same {funcao, argumentos, texto} that
     /api/chat returns, so botDispatch doesn't know which one answered. */
  function sampleInput(payload){
    var P = window.VESI_PROMPT;
    var rules = P.buildSystemPrompt(payload.contexto, payload.idioma) +
      "\n\nFunções disponíveis, com os argumentos em JSON Schema:\n" +
      JSON.stringify(P.FUNCTIONS.map(function(f){ return {nome: f.name, descricao: f.description, argumentos: f.parameters}; })) +
      "\n\nResponde só com um objeto JSON, sem mais texto: {\"funcao\": o nome de uma das funções acima, ou null, \"argumentos\": o objeto com os argumentos dessa função, ou null, \"texto\": uma frase curta para a pessoa, na língua indicada, ou null}. Quando escolhes uma função, \"texto\" é opcional; quando não escolhes nenhuma, \"texto\" é obrigatório.";
    var turns = [{role:"user", content: rules}];
    (payload.historico || []).forEach(function(h){
      if(h && (h.role === "user" || h.role === "assistant") && h.content) turns.push({role: h.role, content: String(h.content).slice(0, 600)});
    });
    turns.push({role:"user", content: String(payload.mensagem)});
    return turns;
  }
  async function askViaSample(payload){
    if(!learn.sample || learn.sampleOff || !window.VESI_PROMPT) return null;
    try{
      var r = await learn.sample.json(sampleInput(payload), {model:"claude-sonnet-5-5", modelTier:"default", effort:"low", cache:false});
      if(!r || typeof r !== "object") return null;
      var names = window.VESI_PROMPT.FUNCTIONS.map(function(f){ return f.name; });
      var fn = typeof r.funcao === "string" && names.indexOf(r.funcao) !== -1 ? r.funcao : null;
      var out = {
        funcao: fn,
        argumentos: fn && r.argumentos && typeof r.argumentos === "object" ? r.argumentos : null,
        texto: typeof r.texto === "string" && r.texto.trim() ? r.texto.trim() : null
      };
      return out.funcao || out.texto ? out : null;
    }catch(e){
      var code = (e && e.code) || "error";
      if(chat.curTurn) chat.curTurn.sample_error = code;
      /* a viewer who declined, or an account without Claude: stop asking for this visit */
      if(/^(not_granted|sampling_disabled|not_declared|capability_disabled|capability_removed)$/.test(code)) learn.sampleOff = true;
      return null;
    }
  }

  /* One document per visit, conversations/<visit id>, with every turn in
     it: what was typed, which engine read it, the function and arguments
     it chose, what the assistant answered, whether the card was confirmed
     or cancelled, and the 👍/👎 the person gave. A document holds at most
     256 KiB, so a very long visit carries on in a second one. */
  function logTurnStart(txt){
    if(!learn.db) return null;
    var turn = {
      n: learn.turns.length + 1, at: new Date().toISOString(), lang: state.lang, company: IT0001.bukrs,
      role: state.role, screen: state.screen, user: String(txt).slice(0, 1000),
      engine: null, local: false, path: null, funcao: null, argumentos: null, replies: [], card: null,
      outcome: null, feedback: null, comment: null
    };
    learn.turns.push(turn);
    return turn;
  }
  function logSave(){
    if(!learn.db) return;
    clearTimeout(learn.timer);
    learn.timer = setTimeout(logWrite, 700);
  }
  function logWrite(){
    if(!learn.db) return;
    if(learn.writing){ learn.dirty = true; return; }
    var body = {app:"vesi-timesheet", session: learn.sessionId, part: learn.part, started_at: learn.started, updated_at: new Date().toISOString(), turns: learn.turns};
    if(JSON.stringify(body).length > 200000 && learn.turns.length > 1){
      learn.part++;
      learn.turns = learn.turns.slice(-1);
      body.part = learn.part;
      body.turns = learn.turns;
    }
    learn.writing = true;
    learn.db.doc("conversations/" + learn.sessionId + (learn.part ? "-" + learn.part : "")).set(body).then(function(){}, function(e){
      if(e && /^(quota_exceeded|revoked|not_granted|capability_disabled|capability_removed|invalid_argument)$/.test(e.code)) learn.db = null;
    }).then(function(){
      learn.writing = false;
      if(learn.dirty){ learn.dirty = false; logWrite(); }
    });
  }
  /* 👍/👎 under the assistant's last answer of each turn. 👎 asks what it
     should have done: the most useful line the nightly review reads. */
  function addFeedback(turn){
    var log = $("jlog");
    var bots = log ? log.querySelectorAll(".jmsg.bot") : [];
    var last = bots[bots.length - 1];
    if(!last || last.querySelector(".jfb")) return;
    var row = el("div","jfb","");
    var up = btn("👍","jfbbtn", function(){
      turn.feedback = "up";
      row.innerHTML = "";
      row.appendChild(el("span","jfbdone", t("fb_thanks")));
      logSave();
    });
    up.type = "button"; up.title = t("fb_helpful"); up.setAttribute("aria-label", t("fb_helpful"));
    var down = btn("👎","jfbbtn", function(){
      turn.feedback = "down";
      logSave();
      row.innerHTML = "";
      var f = el("form","jfbform","");
      var inp = document.createElement("input");
      inp.type = "text"; inp.maxLength = 300; inp.placeholder = t("fb_placeholder");
      f.appendChild(inp);
      f.appendChild(btn(t("fb_send"),"btn sm", null));
      f.onsubmit = function(ev){
        ev.preventDefault();
        turn.comment = inp.value.trim() || null;
        row.innerHTML = "";
        row.appendChild(el("span","jfbdone", t("fb_noted")));
        logSave();
      };
      row.appendChild(f);
      setTimeout(function(){ inp.focus(); }, 30);
    });
    down.type = "button"; down.title = t("fb_not_helpful"); down.setAttribute("aria-label", t("fb_not_helpful"));
    row.appendChild(up);
    row.appendChild(down);
    last.appendChild(row);
  }

  /* ---------- conversational assistant, Joule pattern ---------- */
  var chat = {pending:null, greeted:false, draft:null, draftWeek:null, history:[], busy:false};
  var VOICE_LANGS = {PT:"pt-PT", EN:"en-US", FR:"fr-FR"};
  var VOICE_LANG_ORDER = ["PT","EN","FR"];
  /* Starts aligned with the app's own language (state.lang) instead of a
     hardcoded default - setLang() keeps it in sync when that changes, via
     syncVoiceLangBtn below. The person can still override it by clicking
     the mic's language button, independently of the app language. */
  var voice = {lang: state.lang.toUpperCase(), usedVoice:false, speakReply:false};
  function syncVoiceLangBtn(){
    var langBtn = $("jMicLang");
    if(!langBtn) return;
    langBtn.textContent = voice.lang;
    var next = VOICE_LANG_ORDER[(VOICE_LANG_ORDER.indexOf(voice.lang) + 1) % VOICE_LANG_ORDER.length];
    langBtn.title = t("aria_voice_lang", {lang: t("voice_lang_" + voice.lang), next: t("voice_lang_" + next)});
    langBtn.setAttribute("aria-label", langBtn.title);
  }
  function speakText(txt){
    if(!voice.speakReply || !window.speechSynthesis) return;
    try{
      var u = new SpeechSynthesisUtterance(txt);
      u.lang = VOICE_LANGS[voice.lang];
      window.speechSynthesis.speak(u);
    }catch(e){}
  }

  function botToggle(force){
    var p = $("joulePanel");
    /* docked on the Assistant screen it is the page, never closed */
    if(p.classList.contains("docked")){
      assistantEnsureGreeted();
      setTimeout(function(){ $("jinput").focus(); }, 60);
      return;
    }
    var open = typeof force === "boolean" ? force : p.hidden;
    p.hidden = !open;
    $("jouleFab").setAttribute("aria-expanded", open ? "true" : "false");
    if(!open && window.speechSynthesis) window.speechSynthesis.cancel();
    if(open){
      assistantEnsureGreeted();
      setTimeout(function(){ $("jinput").focus(); }, 60);
    }
  }
  /* applyI18n's hook for the one corner a static data-i18n sweep can't
     reach: the chat log is a transcript, built once from whichever
     language was active line by line, not re-rendered from scratch like
     the rest of the page. Nothing real said yet (still just the
     auto-greeting, chat.history empty) isn't really "history" though, so
     it's safe to reset and re-greet fresh in the new language instead of
     leaving it stuck in whichever language the panel first opened in. A
     real exchange is left exactly as it was said - only the quick-reply
     chips get cleared, since those are live actions, not a transcript,
     and worded in the wrong language they'd be actively misleading. */
  function refreshAssistantForLang(){
    if(typeof chat === "undefined") return;
    if(chat.greeted && !chat.history.length){
      chat.greeted = false;
      var log = $("jlog");
      if(log) log.innerHTML = "";
      botChips([]);
      if($("joulePanel") && !$("joulePanel").hidden) botToggle(true);
    } else if(chat.history.length){
      botChips([]);
    }
  }
  /* allowHtml is opt-in and only for our own static strings (the two help
     messages that style an example with <span class="num">). Everything
     else here can carry text the person typed or, for a Claude-backed
     reply, text the model wrote after reading what the person typed -
     prompt injection could put markup in either - so the default stays
     textContent, never innerHTML, for both bot and user lines. */
  function botSay(who, txt, node, allowHtml){
    if(who === "bot" && chat.curTurn){
      var said = (txt ? (allowHtml ? String(txt).replace(/<[^>]+>/g, "") : String(txt)) : "");
      /* a confirmation card is already kept, field by field, in turn.card */
      if(node && !(node.classList && node.classList.contains("jcard"))) said += (said ? " | " : "") + String(node.textContent || "").replace(/\s+/g, " ").trim();
      chat.curTurn.replies.push(said.slice(0, 1500));
    }
    var log = $("jlog");
    var b = el("div","jmsg "+who,"");
    if(txt){
      var t = el("div","jtxt","");
      if(who === "bot" && allowHtml) t.innerHTML = txt; else t.textContent = txt;
      b.appendChild(t);
    }
    if(node) b.appendChild(node);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    if(who === "bot" && txt) speakText(txt);
    return b;
  }
  function sleep(ms){ return new Promise(function(resolve){ setTimeout(resolve, ms); }); }
  /* A reply that lands the instant you hit send reads as canned, not
     conversational. A short, slightly randomised pause plus a typing
     bubble gives the exchange a human beat, matched to how long a person
     takes to skim a message and start answering. */
  function thinkingDelay(){ return sleep(450 + Math.random()*400); }
  function showTyping(){
    hideTyping();
    var log = $("jlog");
    var b = el("div","jmsg bot","");
    b.id = "jtypingBubble";
    var t = el("div","jtxt typing","");
    t.appendChild(el("span","","")); t.appendChild(el("span","","")); t.appendChild(el("span","",""));
    b.appendChild(t);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
  }
  function hideTyping(){
    var b = $("jtypingBubble");
    if(b) b.remove();
  }
  function botChips(list){
    var box = $("jchips");
    box.innerHTML = "";
    chat.lastChips = (list || []).slice();
    (list || []).forEach(function(t){
      box.appendChild(btn(t,"btn sm", function(){ botHandle(t); }));
    });
    /* the chips take room from the log above them: without this the last
       message ends up half hidden behind them */
    var log = $("jlog");
    if(log) log.scrollTop = log.scrollHeight;
  }
  var CARD_DONE = {btn_save:"chip_done_saved", btn_register:"chip_done_saved", btn_fill_and_register:"chip_done_saved",
    btn_copy:"chip_done_saved", btn_apply:"chip_done_saved", btn_save_changes:"chip_done_saved", btn_record_leave:"chip_done_saved",
    btn_submit:"chip_done_submitted", btn_send_request:"chip_done_sent", btn_withdraw:"chip_done_withdrawn",
    btn_approve:"chip_done_approved", btn_approve_all:"chip_done_approved"};
  function cardDoneLabel(label){
    var keys = Object.keys(CARD_DONE);
    for(var i=0; i<keys.length; i++){ if(t(keys[i]) === label) return "✓ " + t(CARD_DONE[keys[i]]); }
    return t("chip_confirmed");
  }
  function botCard(lines, confirmLabel, onConfirm, warn){
    var turn = chat.curTurn;
    if(turn) turn.card = lines.map(function(l){ return l[0] + ": " + l[1]; }).concat(warn ? ["! " + warn] : []);
    /* what the card's buttons say afterwards belongs to the turn that showed it */
    var cardLang = REPLY_LANG;
    function inTurn(fn){
      var prev = chat.curTurn, prevLang = REPLY_LANG;
      chat.curTurn = turn;
      setReplyLang(cardLang);
      try{ fn(); } finally{ chat.curTurn = prev; setReplyLang(prevLang); logSave(); }
    }
    var c = el("div","jcard" + (warn ? " warn" : ""), "");
    lines.forEach(function(l){
      var r = el("div","jrow","");
      r.appendChild(el("span","k", l[0]));
      r.appendChild(el("span","v", l[1]));
      c.appendChild(r);
    });
    if(warn) c.appendChild(el("div","jwarn", warn));
    var acts = el("div","acts","");
    acts.appendChild(btn(confirmLabel,"btn sm primary", function(){
      chat.pending = null;
      chat.draft = null;
      chat.draftWeek = null;
      acts.innerHTML = "";
      var doneChip = el("span","chip green",t("chip_confirmed"));
      acts.appendChild(doneChip);
      if(turn) turn.outcome = "confirmed";
      chat.committing = true;
      try{ inTurn(onConfirm); } finally{ chat.committing = false; }
      commitAssistantChanges();
      /* the card says plainly what happened: saved, submitted, sent... */
      doneChip.textContent = cardDoneLabel(confirmLabel);
    }));
    acts.appendChild(btn(t("btn_cancel"),"btn sm", function(){
      chat.pending = null;
      chat.draft = null;
      chat.draftWeek = null;
      acts.innerHTML = "";
      acts.appendChild(el("span","chip grey",t("chip_cancelled")));
      if(turn) turn.outcome = "cancelled";
      inTurn(function(){ botSay("bot",t("bot_cancelled_no_save")); });
    }));
    c.appendChild(acts);
    return c;
  }
  function nextFreeDay(){
    for(var i=0; i<5; i++){ if(capacity(i) - dayTotal(i) > 0) return i; }
    return -1;
  }
  function weekSummaryText(){
    if(isMonthly()){
      var dates = activeMonthDates(), me = monthErrors(dates).length;
      return t("bot_month_summary", {month: monthSentenceLabel(), tot: fmt(monthTotalHours(dates)), exp: fmt(monthCapacityTotal(dates))}) +
        (me ? plural(me, "bot_week_errors_block") : t("bot_month_no_errors_submit"));
    }
    var errs = errors().length;
    return t("bot_week_summary", {tot: fmt(weekTotal()), exp: fmt(weekCapacity())}) +
      (errs ? plural(errs, "bot_week_errors_block") : t("bot_week_no_errors_submit"));
  }
  /* The "Receiver object" line a confirmation card shows: PEP if the
     project carries one, the cost center otherwise - same either/or every
     card in this file (offerEntry, offerEntryWeek, offerFillMissing,
     offerFillMissingMonth) used to spell out on its own. */
  function receiverObjectLabel(pr){
    return pr.sap.rproj ? t("bot_receiver_pep", {code: pr.sap.rproj}) : t("bot_receiver_cost_center", {code: pr.sap.rkostl});
  }

  /* assistant actions, shared between Claude (via /api/chat) and the local interpreter */
  function showAbsences(){
    var node = el("div","jlist","");
    ABSENCES.forEach(function(a){
      node.appendChild(el("div","jrow2", DAYS[a.day] + " · " + absTypeLabel(a) + " · " + fmt(a.hours) + " h · " + absStatusLabel(a.status)));
    });
    var next = upcomingLeave();
    if(next.length){
      node.appendChild(el("div","jsub", t("chip_my_leave")));
      next.forEach(function(r){
        node.appendChild(el("div","jrow2", r.RequestID + " · " + absTypeLabel(r) + " · " + leavePeriodLabel(r) + " · " + leaveStatusLabel(r)));
      });
    }
    botSay("bot",t("bot_absences_intro"), node);
    botChips([t("chip_request_vacation"),t("chip_my_leave"),t("chip_hours_i_have")]);
  }
  function showWeekStatus(){
    botSay("bot", weekSummaryText());
    botChips([t("chip_my_absences"),chipSubmit()]);
  }
  function showHelp(){
    botSay("bot",t("bot_help_text_home"), null, true);
    botChips([t("chip_hours_i_have"),t("chip_my_absences"),t("chip_copy_last_week"),chipSubmit()]);
  }

  /* ---------- what the screens show, asked in the chat ----------
     Each answer reads the same data as its screen and stays inside the
     profile: the person's own account and requests, the colleagues the
     team calendar shows them (health related reasons masked for anyone
     but the line manager), and the line manager's team balances. */
  function myRequestRow(r){ return r.RequestID + " · " + absTypeLabel(r) + " · " + leavePeriodLabel(r) + " · " + leaveStatusLabel(r); }
  function showBalanceAsOf(dateISO){
    var b = balanceOf(selfId(), null, dateISO);
    botSay("bot", t("bot_balance_asof", {date: fmtDate(dateISO), avail: fmtDays(b.available), total: fmtDays(b.total), used: fmtDays(b.used), req: fmtDays(b.requested)}));
    botChips([t("chip_request_vacation"), t("chip_my_leave")]);
  }
  function showMovements(){
    var bal = leaveBalance(), node = el("div","jlist","");
    node.appendChild(el("div","jrow2", fmtDate(bal.year + "0101") + " · " + t("mv_entitlement") + " · +" + fmtDays(bal.entitlement)));
    if(bal.carryover) node.appendChild(el("div","jrow2", fmtDate(bal.year + "0101") + " · " + t("mv_carryover", {y: bal.year - 1}) + " · +" + fmtDays(bal.carryover)));
    if(bal.usedBefore) node.appendChild(el("div","jrow2", t("mv_used_before") + " · −" + fmtDays(bal.usedBefore)));
    myLeave().filter(function(r){ var ty = absType(r.AbsenceTypeCode); return ty && ty.quota; })
      .sort(function(x, y){ return x.StartDate < y.StartDate ? -1 : 1; })
      .forEach(function(r){
        node.appendChild(el("div","jrow2", leavePeriodLabel(r) + " · " + absTypeLabel(r) + " " + r.RequestID + " · " + (leaveActive(r) ? "−" + fmtDays(leaveDays(r)) : "0") + " · " + leaveStatusLabel(r)));
      });
    botSay("bot", t("bot_movements_intro", {y: bal.year, avail: fmtDays(bal.available)}), node);
    botChips([t("chip_request_vacation"), t("chip_my_leave")]);
  }
  /* A request's status and workflow: the person's own, or for the line
     manager one of the requests their console shows. */
  function visibleRequest(id){
    var r = leaveById(id);
    if(!r) return null;
    if(r.EmployeeID === selfId()) return r;
    if(state.role === "manager" && (reportById(r.EmployeeID) || leaveQueue().indexOf(r) !== -1)) return r;
    return null;
  }
  function showRequestStatus(id){
    var r = id ? visibleRequest(id) : null;
    if(!r){
      var mine = myLeave().filter(function(x){ return x.StatusID === "SENT" || x.cancelRequested; });
      if(!id && mine.length === 1) r = mine[0];
      else {
        var node = el("div","jlist",""), list = upcomingLeave();
        if(!list.length) node.appendChild(el("div","jrow2", t("text_no_upcoming_leave")));
        list.forEach(function(x){ node.appendChild(el("div","jrow2", myRequestRow(x))); });
        botSay("bot", id ? t("bot_request_not_found", {id: id}) : t("bot_request_which"), node);
        botChips([t("chip_my_leave")]);
        return;
      }
    }
    var steps = el("div","jlist","");
    leaveWorkflow(r).forEach(function(s){ steps.appendChild(el("div","jrow2", s.txt + (s.when ? " · " + s.when : "") + (s.note ? " · “" + s.note + "”" : ""))); });
    botSay("bot", t("bot_request_status", {id: r.RequestID, who: r.EmployeeID === selfId() ? "" : r.EmployeeName + ", ", type: absTypeLabel(r), period: leavePeriodLabel(r), status: leaveStatusLabel(r)}), steps);
    botChips(canEditLeave(r) ? [t("chip_my_leave"), t("chip_leave_form")] : [t("chip_my_leave")]);
  }
  /* who approves what this person sends: the timesheet by project (owner
     of each, or one level up), per month in PT01 and per week in PT02,
     and the absences, always the direct manager */
  function periodRows(){
    return isMonthly() ? openMonthWeeks().reduce(function(a, w){ return a.concat(w.rows); }, []) : state.rows;
  }
  function approverByProject(){
    var ps = rowsProjects(periodRows());
    if(!ps.length) ps = profileProjects();
    return ps.map(function(p){ return {code: PROJECTS[p].code, name: timesheetApprovers([p])[0]}; });
  }
  function showApprovers(){
    var rows = approverByProject(), names = [];
    rows.forEach(function(x){ if(names.indexOf(x.name) === -1) names.push(x.name); });
    var node = el("div","jlist","");
    rows.forEach(function(x){ node.appendChild(el("div","jrow2", x.code + " · " + x.name)); });
    botSay("bot", t(isMonthly() ? "bot_approvers_ts_month" : "bot_approvers_ts_week", {names: names.join(", ")}) + " " + t("bot_approvers_leave", {name: approverFor(selfId()).name}), node);
    botChips([chipSubmit(), t("chip_my_leave")]);
  }
  /* "why can't I submit?": what blocks the period, or that nothing does,
     without submitting anything */
  function explainSubmit(){
    if(isMonthly()){
      var dates = activeMonthDates(), month = monthSentenceLabel(), open = openMonthWeeks();
      if(!open.length){ botSay("bot", t("bot_month_already_submitted", {month: month})); return; }
      var mErrs = monthErrors(dates);
      if(mErrs.length){ var mp = submitProblems(mErrs); sayCantSubmit(plural(mp.length, "bot_cant_submit_month", {month: month}), mp); return; }
      var mWarns = 0;
      open.forEach(function(w){ withWeek(w, function(){ mWarns += validate().filter(function(m){ return m.sev === "w"; }).length; }); });
      botSay("bot", t("bot_submit_check_ok_month", {month: month, total: fmt(monthTotalHours(dates)), exp: fmt(monthCapacityTotal(dates)), names: approverNames(periodRows())}) + (mWarns ? " " + plural(mWarns, "n_warnings_no_block") + "." : ""));
      botChips([chipSubmit()]);
      return;
    }
    var num = isoWeekOf(WEEKS[weekIdx].start);
    if(state.submitted){ botSay("bot", t("bot_week_already_submitted")); return; }
    var errs = errors();
    if(errs.length){ var wp = submitProblems(errs); sayCantSubmit(plural(wp.length, "bot_cant_submit_week", {num: num}), wp); return; }
    var warns = validate().filter(function(m){ return m.sev === "w"; }).length;
    botSay("bot", t("bot_submit_check_ok_week", {num: num, total: fmt(weekTotal()), exp: fmt(weekCapacity()), names: approverNames(state.rows)}) + (warns ? " " + plural(warns, "n_warnings_no_block") + "." : ""));
    botChips([chipSubmit()]);
  }
  /* the company's public holidays: those in a month, or the next ones */
  function showHolidays(ym){
    var today = todayISO(), office = placeLabel(officePlace());
    var list = HOLIDAYS.filter(function(h){
      if(h[4] && h[4] !== IT0001.bukrs) return false;
      return ym ? h[0].slice(0,6) === ym : h[0] >= today;
    });
    if(!ym) list = list.slice(0, 6);
    var monthLbl = ym ? monthSentenceOf(ym) : "";
    if(!list.length){ botSay("bot", t("bot_holidays_none", {month: monthLbl, office: office})); botChips([t("chip_request_vacation")]); return; }
    var node = el("div","jlist","");
    list.forEach(function(h){ node.appendChild(el("div","jrow2", fmtDateShort(h[0]) + " " + h[0].slice(0,4) + " · " + holidayName(h))); });
    botSay("bot", t(ym ? "bot_holidays_month" : "bot_holidays_next", {month: monthLbl, office: office}), node);
    botChips([t("chip_request_vacation")]);
  }
  /* The people the team calendar shows this profile: colleagues under the
     same manager, or for the line manager the reports (one level further
     down included) and the peers. */
  function calendarPeople(){
    var b = IT0001.bukrs, me = selfId(), out = [];
    if(state.role === "manager"){
      reportsOf(b).forEach(function(m){
        out.push({id:m.EmployeeID, name:m.name});
        (SUB_REPORTS[m.EmployeeID] || []).forEach(function(x){ out.push({id:x.EmployeeID, name:x.name}); });
      });
      MANAGER_PEERS[b].forEach(function(m){ out.push({id:m.EmployeeID, name:m.name}); });
    } else {
      reportsOf(b).forEach(function(m){ if(m.EmployeeID !== me) out.push({id:m.EmployeeID, name:m.name}); });
    }
    return out;
  }
  function calendarAbsences(from, to){
    var out = [];
    calendarPeople().forEach(function(pp){
      requestsOf(pp.id).forEach(function(r){
        if(!(leaveActive(r) || r.cancelRequested) || r.EndDate < from || r.StartDate > to) return;
        out.push({name: pp.name, r: r});
      });
    });
    return out.sort(function(x, y){ return x.r.StartDate < y.r.StartDate ? -1 : x.r.StartDate > y.r.StartDate ? 1 : 0; });
  }
  function showTeamCalendar(from, to){
    if(!from){ from = mondayOf(todayISO()); to = isoAdd(from, 6); }
    if(!to || to < from) to = from;
    var list = calendarAbsences(from, to);
    var when = from === to ? fmtDate(from) : t("leave_range", {from: fmtDate(from), to: fmtDate(to)});
    if(!list.length){ botSay("bot", t("bot_teamcal_none", {when: when})); botChips([t("chip_request_vacation")]); return; }
    var masked = false, node = el("div","jlist","");
    list.forEach(function(x){
      var lbl = colleagueTypeLabel(x.r);
      if(lbl === t("text_absent_generic")) masked = true;
      node.appendChild(el("div","jrow2", x.name + " · " + lbl + " · " + leavePeriodLabel(x.r) + " · " + leaveStatusLabel(x.r)));
    });
    botSay("bot", t("bot_teamcal_intro", {when: when}) + (masked ? " " + t("text_tac_privacy") : ""), node);
    botChips([t("chip_request_vacation")]);
  }
  /* the line manager's view of the team's vacation accounts */
  function showTeamBalances(){
    if(state.role !== "manager"){
      botSay("bot", t("bot_team_balances_only_manager", {name: approverFor(selfId()).name}));
      botChips([t("chip_my_leave")]);
      return;
    }
    var node = el("div","jlist","");
    reportsOf().forEach(function(m){
      var b = balanceOf(m.EmployeeID);
      node.appendChild(el("div","jrow2", t("text_team_balance_row", {name: m.name, avail: fmtDays(b.available), req: fmtDays(b.requested)})));
    });
    botSay("bot", t("bot_team_balances_intro", {y: leaveBalance().year}), node);
    botChips(managerChips());
  }
  /* "change request 4500400 to 5 to 7 November": the same card as a new
     request, carrying the request number, so it goes back to the approver */
  function offerChangeLeave(id, changes){
    var r = id ? leaveById(id) : null;
    if(r && r.EmployeeID !== selfId()) r = null;
    if(!r){
      var cands = myLeave().filter(canEditLeave);
      if(!cands.length){ botSay("bot", t("bot_leave_nothing_to_change")); botChips([t("chip_my_leave")]); return; }
      if(cands.length === 1 && !id) r = cands[0];
      else {
        var node = el("div","jlist","");
        cands.forEach(function(c){ node.appendChild(el("div","jrow2", myRequestRow(c))); });
        botSay("bot", t("bot_leave_which_change"), node);
        return;
      }
    }
    if(!canEditLeave(r)){
      botSay("bot", t("bot_leave_cannot_change", {id: r.RequestID, status: leaveStatusLabel(r).toLowerCase()}));
      botChips([t("chip_my_leave")]);
      return;
    }
    var d = {RequestID: r.RequestID, AbsenceTypeCode: r.AbsenceTypeCode, StartDate: r.StartDate, EndDate: r.EndDate, partial: r.partial, hours: r.hours,
      StartTime: r.StartTime, EndTime: r.EndTime, Notes: r.Notes || "", Attachment: r.Attachment || ""};
    var c = changes || {};
    if(c.AbsenceTypeCode) d.AbsenceTypeCode = c.AbsenceTypeCode;
    if(c.StartDate){ d.StartDate = c.StartDate; d.EndDate = c.EndDate || c.StartDate; if(!c.partial){ d.partial = false; } }
    if(c.partial){ d.partial = true; d.StartTime = c.StartTime; d.EndTime = c.EndTime; d.hours = c.hours; }
    if(c.Notes) d.Notes = c.Notes;
    if(d.StartDate === r.StartDate && d.EndDate === r.EndDate && d.AbsenceTypeCode === r.AbsenceTypeCode && d.partial === r.partial && d.StartTime === r.StartTime && d.Notes === (r.Notes || "")){
      botSay("bot", t("bot_leave_change_what", {id: r.RequestID}));
      botChips([t("chip_leave_form")]);
      chat.leaveFormPrefill = r;
      return;
    }
    offerLeave(d);
  }
  /* The line manager records an absence for a direct report, approved as
     it's recorded, as on the Leave Request screen. Nobody else can. */
  function offerLeaveOnBehalf(name, d){
    if(state.role !== "manager"){
      botSay("bot", t("bot_leave_onbehalf_only_manager", {name: approverFor(selfId()).name}));
      botChips([t("chip_request_vacation")]);
      return;
    }
    var low = foldText(name).trim();
    var hits = reportsOf().filter(function(m){ return m.EmployeeID !== selfId() && low && (foldText(m.name).indexOf(low) !== -1 || foldText(m.name.split(" ")[0]) === low.split(" ")[0]); });
    if(hits.length !== 1){
      botSay("bot", t("bot_leave_onbehalf_who", {list: reportsOf().map(function(m){ return m.name; }).join(", ")}));
      return;
    }
    d.EmployeeID = hits[0].EmployeeID;
    d.onBehalf = true;
    if(!d.AbsenceTypeCode || !d.StartDate){ askLeaveMissing(d); return; }
    offerLeave(d);
  }
  /* The person's own per diem or shift allowance on a day of the visible
     week (kilometres have their own card, with the distance worked out;
     the bonus is the project owner's, on Team entry). */
  function offerOwnAllowance(code, day, qty, note, pIdx){
    var w = wt(code);
    if(!w || code === "BONUS"){ botSay("bot", t("bot_allow_bonus_owner")); botChips([t("chip_help")]); return; }
    if(code === "KMS"){ offerKm({}); return; }
    if(wtFor().indexOf(w) === -1){ botSay("bot", t("bot_allow_turno_pt02")); botChips([t("chip_help")]); return; }
    if(state.submitted){ botSay("bot", t("bot_week_locked")); return; }
    if(day == null || day === -1){ botSay("bot", t("bot_day_outside_week")); botChips([t("chip_help")]); return; }
    if(!periodOpen(WORKDATES[day])){ botSay("bot", t("bot_day_closed", {day: DAYS[day]})); return; }
    if(w.noteLabel && !note){ botSay("bot", t("bot_allow_country")); return; }
    var allowed = profileProjects();
    if(w.needProj){
      if(pIdx !== -1 && pIdx != null && allowed.indexOf(pIdx) === -1){ sayNotAllocated(pIdx, null); return; }
      if(pIdx === -1 || pIdx == null){
        if(allowed.length !== 1){ botSay("bot", t("bot_allow_which_project", {name: wtName(w)})); botChips(projectChoices(-1).map(function(i){ return PROJECTS[i].code; })); return; }
        pIdx = allowed[0];
      }
    }
    var q = qty > 0 ? qty : 1;
    var lines = [[t("label_allowance"), wtName(w) + " · " + w.lgart], [t("label_day"), DAYS[day]], [t("label_to_record"), fmt(q) + " " + t("unit_days")]];
    if(w.needProj) lines.push([t("label_project"), PROJECTS[pIdx].code + " · " + PROJECTS[pIdx].name]);
    if(note) lines.push([t("label_note"), note]);
    lines.push([t("label_origin"), "Joule"]);
    chat.pending = "allow";
    botSay("bot", t("bot_allow_confirm"), botCard(lines, t("btn_register"), function(){
      state.allow.push({id:"al" + (nextId++), day:day, p: w.needProj ? pIdx : 3, code:code, qty:q, amount:0, note:note || "",
        by:IT0001.pernr, onBehalf:IT0001.pernr, byName:"self", origin:"Joule"});
      render();
      botSay("bot", t("bot_allow_recorded", {name: wtName(w), day: DAYS[day], qty: fmt(q)}));
      botChips([t("chip_hours_i_have"), chipSubmit()]);
    }));
  }
  /* the local reading of "per diem yesterday on BNK", "subsídio de turno hoje" */
  var OWN_ALLOW_RE = [
    ["AJC_INT", /ajudas? de custo (no )?estrangeiro|di[áa]ria (no )?estrangeiro|foreign per\s*diem|indemnit[ée]s? (de d[ée]placement )?(à l'|a l')?[ée]tranger|per\s*diem (à l'|a l')?[ée]tranger/],
    ["AJC_NAC", /ajudas? de custo|di[áa]ria|per\s*diem|daily allowance|indemnit[ée]s? de d[ée]placement|frais de mission/],
    ["TURNO", /subs[íi]dio de turno|shift allowance|prime (de travail post[ée]|de quart|d'[ée]quipe|de [ée]quipe)/],
    ["BONUS", /b[óo]nus|prime de projet|project bonus/]
  ];
  function ownAllowanceFromText(txt){
    var low = txt.toLowerCase(), code = null;
    for(var i=0; i<OWN_ALLOW_RE.length; i++){ if(OWN_ALLOW_RE[i][1].test(low)){ code = OWN_ALLOW_RE[i][0]; break; } }
    if(!code) return null;
    var rest = " " + txt + " ";
    var dm = matchDayMention(rest);
    var day = dm ? dm.day : todayDayIdx();
    var qm = rest.match(/(\d+(?:[.,]\d+)?)\s*(?:dias?|days?|jours?)\b/i);
    var pm = matchProject(rest);
    var cm = txt.match(/(?:pa[íi]s|country|pays)\s*:?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]+)$/i) || txt.match(/\b(?:em|in|en|au)\s+(Espanha|Spain|Espagne|Fran[çc]a|France|Alemanha|Germany|Allemagne|Angola|Brasil|Brazil|Br[ée]sil|Mo[çc]ambique|Mozambique|Reino Unido|United Kingdom|Royaume.Uni)\b/i);
    return {code:code, day:day, qty: qm ? parseDur(qm[1]) : 1, p: pm ? pm.p : -1, note: cm ? cm[1].trim() : ""};
  }
  function goToScreen(key, label){
    if(!profileHasScreen(key)){
      botSay("bot", t("bot_screen_not_in_profile", {screen: label}));
      botChips([t("chip_help")]);
      return;
    }
    showScreen(key);
    botSay("bot",t("bot_switched_to", {screen: label}));
  }
  function goToTeamScreen(){ goToScreen("team",t("nav_team")); }
  /* the line manager's approvals are leave requests, in their own console */
  function goToApprovalScreen(){
    if(state.role === "manager") goToScreen("lvaprov", t("nav_leave_approval"));
    else goToScreen("aprov",t("nav_approval"));
  }
  function goToCatsScreen(){ goToScreen("cats",t("nav_cats")); }
  function showSuggestionsPanel(){
    var vis = visibleSugs();
    botSay("bot", vis.length
      ? t("bot_suggestions_available", {n: vis.length})
      : t("bot_no_suggestions"));
    if(vis.length) botChips([t("chip_apply_high_conf")]);
  }
  function offerApplyHighConfidence(){
    var hi = visibleSugs().filter(function(s){ return s.conf === "hi"; });
    if(!hi.length){ botSay("bot",t("bot_no_high_conf")); return; }
    chat.pending = "sugs";
    var room = {};
    botSay("bot",t("bot_confirm_apply_suggestions"), botCard(
      hi.map(function(s){
        var left = room[s.day] != null ? room[s.day] : sugRoom(s);
        var add = Math.min(s.hours, left);
        room[s.day] = left - add;
        return [DAYS[s.day] + ", " + PROJECTS[s.p].code, add <= 0 ? t("text_sug_day_full") : add < s.hours ? fmt(add) + " h (" + t("text_sug_trimmed_short", {h: fmt(s.hours)}) + ")" : fmt(s.hours) + " h"];
      }),
      t("btn_apply"), function(){
        var res = acceptSugs(hi);
        botSay("bot", sugsSummary(res) + " " + weekSummaryText());
      }));
  }
  function offerCopyWeek(){
    chat.pending = "copy";
    botSay("bot",t("bot_copy_week_offer"), botCard(
      [[t("label_action"),t("bot_copy_rows_value")],[t("label_durations"),t("bot_stay_zero_value")]],
      t("btn_copy"), function(){ copyWeek(); botSay("bot",t("bot_copy_week_done")); }));
  }
  /* Submitting follows the period the timesheet shows: the whole month in
     Consulting (time by duration, monthly view), the week in Building
     Solutions. When something blocks it, the reply says so before anything
     else and lists what to fix, instead of offering what wasn't asked. */
  function chipSubmit(){ return t(isMonthly() ? "chip_submit_month" : "chip_submit_week"); }
  function monthSentenceLabel(){ return monthSentenceOf(monthKeyOf(WEEKS[weekIdx])); }
  function monthSentenceOf(ym){
    var name = monthFullName(+ym.slice(4,6) - 1);
    return t("fmt_month_year", {month: curLang() === "en" ? name : name.toLowerCase(), y: ym.slice(0,4)});
  }
  /* the same problem in several weeks of the month is said once, with
     the weeks it is in */
  function submitProblems(errs){
    var out = [], by = {};
    errs.forEach(function(m){
      if(!by[m.txt]){ by[m.txt] = {txt:m.txt, weeks:[]}; out.push(by[m.txt]); }
      var n = m.week && isMonthly() ? isoWeekOf(m.week.start) : null;
      if(n && by[m.txt].weeks.indexOf(n) === -1) by[m.txt].weeks.push(n);
    });
    return out.map(function(g){
      if(!g.weeks.length) return g.txt;
      return t(g.weeks.length > 1 ? "val_weeks_label_prefix" : "val_week_label_prefix", {n: g.weeks.join(", "), txt: g.txt});
    });
  }
  function sayCantSubmit(head, probs){
    var node = el("div","jlist","");
    probs.slice(0, 4).forEach(function(txt){ node.appendChild(el("div","jrow2", txt)); });
    if(probs.length > 4) node.appendChild(el("div","jsub", "+" + (probs.length - 4)));
    botSay("bot", head + " " + t("bot_cant_submit_fix"), node);
    botChips([t("chip_hours_i_have")]);
  }
  function approverNames(rowsList){
    var names = timesheetApprovers(rowsProjects(rowsList));
    return (names.length ? names : [approverFor(selfId()).name]).join(", ");
  }
  function offerSubmit(){
    if(isMonthly()){ offerSubmitMonth(); return; }
    var num = isoWeekOf(WEEKS[weekIdx].start);
    if(state.submitted){ botSay("bot",t("bot_week_already_submitted")); return; }
    var errs = errors();
    if(errs.length){ var probs = submitProblems(errs); sayCantSubmit(plural(probs.length, "bot_cant_submit_week", {num: num}), probs); return; }
    var warns = validate().filter(function(m){ return m.sev === "w"; }).length;
    var names = approverNames(state.rows);
    var lines = [[t("th_total"),fmt(weekTotal()) + " h"],[t("label_expected"),fmt(weekCapacity()) + " h"]];
    if(warns) lines.push([t("label_warnings"), plural(warns, "n_warnings_no_block")]);
    lines.push([t("label_approver"), names], [t("label_status_after_submit"),t("state_in_approval")]);
    chat.pending = "submit";
    botSay("bot",t("bot_confirm_submit_week", {num: num}), botCard(lines,
      t("btn_submit"), function(){ submitWeekNow(""); botSay("bot",t("bot_week_submitted_msg", {num: num, names: names})); }));
  }
  function offerSubmitMonth(){
    var dates = activeMonthDates(), month = monthSentenceLabel();
    var open = openMonthWeeks();
    if(!open.length){ botSay("bot", t("bot_month_already_submitted", {month: month})); return; }
    var errs = monthErrors(dates);
    if(errs.length){ var probs = submitProblems(errs); sayCantSubmit(plural(probs.length, "bot_cant_submit_month", {month: month}), probs); return; }
    var warns = 0;
    open.forEach(function(w){ withWeek(w, function(){ warns += validate().filter(function(m){ return m.sev === "w"; }).length; }); });
    var names = approverNames(open.reduce(function(a, w){ return a.concat(w.rows); }, []));
    var lines = [
      [t("label_month"), month],
      [t("label_weeks"), open.map(function(w){ return isoWeekOf(w.start); }).join(", ")],
      [t("th_total"), fmt(monthTotalHours(dates)) + " h"],
      [t("label_expected"), fmt(monthCapacityTotal(dates)) + " h"]
    ];
    if(warns) lines.push([t("label_warnings"), plural(warns, "n_warnings_no_block")]);
    lines.push([t("label_approver"), names], [t("label_status_after_submit"), t("state_in_approval")]);
    chat.pending = "submit";
    botSay("bot", t("bot_confirm_submit_month", {month: month}), botCard(lines,
      t("btn_submit"), function(){ submitMonthNow(""); botSay("bot", t("bot_month_submitted_msg", {month: month, names: names})); }));
  }
  function offerEntry(day, dur, pIdx, desc){
    var pr = PROJECTS[pIdx];
    if(state.submitted){
      botSay("bot", t("bot_week_locked"));
      return;
    }
    var alt = null;
    if(isBlocked(day)){
      alt = nextFreeDay();
      if(alt === -1){
        botSay("bot", t("bot_day_absence_no_alt", {day: DAYS[day], type: absTypeLabel(absOn(day,"approved")[0]).toLowerCase()}));
        return;
      }
      botSay("bot", t("bot_day_absence_suggest", {day: DAYS[day], type: absTypeLabel(absOn(day,"approved")[0]).toLowerCase(), alt: DAYS[alt]}));
      day = alt;
    }
    if(!periodOpen(WORKDATES[day])){
      botSay("bot", t("bot_day_closed", {day: DAYS[day]}));
      return;
    }
    var livre = capacity(day) - dayTotal(day);
    if(dur > livre){
      /* Same hard rule as a manual grid cell (durCell): never let a day go
         over capacity, not even with a warning, refuse it here instead. */
      var abs = absOn(day, "approved")[0];
      var capMsg = abs
        ? t("bot_day_abs_cap", {day: DAYS[day], type: absTypeLabel(abs).toLowerCase()})
        : t("bot_day_capacity", {day: DAYS[day], cap: fmt(capacity(day))});
      botSay("bot", capMsg + (livre > 0 ? t("bot_hours_left_suffix", {left: fmt(livre)}) : t("bot_no_hours_suffix")));
      return;
    }
    chat.pending = "entry";
    chat.draft = {day:day, dur:dur, p:pIdx, desc:desc};
    var existing = state.rows.filter(function(r){ return r.p === pIdx; })[0];
    var holder = {desc: desc || (existing ? existing.desc : "")};
    var descOk = String(holder.desc || "").trim().length >= 10;
    var lines = [
      [t("label_day"), DAYS[day]],
      [t("label_duration"), fmt(dur) + " h"],
      [t("label_project"), pr.code + " · " + pr.name],
      [t("label_receiver_object"), receiverObjectLabel(pr)],
      [t("label_activity_type"), pr.sap.lstar + ", " + pr.act]
    ];
    if(descOk) lines.push([t("label_description"), holder.desc]);
    lines.push([t("label_origin"), "Joule"]);
    var cardE = botCard(lines, t("btn_save"), function(){
      var row = state.rows.filter(function(r){ return r.p === pIdx; })[0];
      if(!row){ row = {id:nextId++, p:pIdx, desc:holder.desc, h:[0,0,0,0,0,0,0], origin:"Joule"}; state.rows.push(row); }
      if(holder.desc) row.desc = holder.desc;
      row.origin = "Joule";
      row.h[day] += dur;
      state.needsSave = true;
      render();
      flashCell(row.id, day);
      botSay("bot", t("bot_entry_saved", {dur: fmt(dur), day: DAYS[day], code: pr.code}) + weekSummaryText());
      botChips([chipSubmit(),t("chip_my_absences")]);
    });
    requireDescOnCard(cardE, holder);
    chat.draft.needsDesc = !descOk;
    botSay("bot", descOk ? t("bot_confirm_entry") : t(desc ? "bot_desc_too_short" : "bot_confirm_entry_desc"), cardE);
  }
  /* Whether a message reads as a description rather than a new request:
     no duration in it, and nothing the assistant would act on. */
  function looksLikeDescription(txt){
    var low = String(txt).toLowerCase().trim();
    if(low.length < 3) return false;
    if(/\d\s*(h|horas?|hours?|heures?|m|min)\b|\d:\d\d/.test(low)) return false;
    if(KM_WORD_RE.test(foldText(low)) || detectLeaveType(low) || LEAVE_GENERIC_RE.test(low)) return false;
    if(/\b(aprova|approve|approuve|rejeita|reject|submete|submit|soumet|cancela|cancel|ajuda|help|aide)\w*\b/.test(low)) return false;
    return true;
  }
  /* A line's description is required: a card for a line still without a
     good one (10 characters at least) gets a field for it, and Save waits
     until it's there. holder.desc carries what was typed to the callback. */
  function requireDescOnCard(card, holder){
    if(String(holder.desc || "").trim().length >= 10) return;
    var save = card.querySelector(".acts .btn.primary");
    var row = el("div","jrow jattach","");
    row.appendChild(el("span","k", t("label_description")));
    var v = el("span","v","");
    var inp = document.createElement("input");
    inp.type = "text"; inp.className = "jdesc"; inp.maxLength = 300;
    inp.placeholder = t("placeholder_desc_card");
    inp.value = holder.desc || "";
    inp.setAttribute("aria-label", t("label_description"));
    v.appendChild(inp);
    var hint = el("div","lvattlbl", t("hint_desc_min"));
    v.appendChild(hint);
    row.appendChild(v);
    card.insertBefore(row, card.querySelector(".acts"));
    function sync(){
      holder.desc = inp.value.trim();
      if(chat.draft) chat.draft.desc = holder.desc;
      var ok = holder.desc.length >= 10;
      if(save){ save.disabled = !ok; save.title = ok ? "" : t("hint_desc_min"); }
    }
    inp.addEventListener("input", sync);
    inp.addEventListener("keydown", function(ev){ if(ev.key === "Enter" && save && !save.disabled){ ev.preventDefault(); save.click(); } });
    sync();
  }
  /* Same idea as offerEntry, but for "8h RTL-TT all days this week": one
     duration, repeated on every working day, skipping days with an approved
     absence instead of shifting the whole request like offerEntry does for a
     single blocked day. */
  function offerEntryWeek(days, dur, pIdx, desc){
    var pr = PROJECTS[pIdx];
    if(state.submitted){
      botSay("bot", t("bot_week_locked"));
      return;
    }
    var free = days.filter(function(d){ return !isBlocked(d) && periodOpen(WORKDATES[d]); });
    var blocked = days.filter(function(d){ return isBlocked(d); });
    var closed = days.filter(function(d){ return !isBlocked(d) && !periodOpen(WORKDATES[d]); });
    /* Same hard rule as offerEntry: a day that can't take the full amount
       is left out, not just flagged, matching a manual grid cell. */
    var over = free.filter(function(d){ return dur > capacity(d) - dayTotal(d); });
    var applicable = free.filter(function(d){ return dur <= capacity(d) - dayTotal(d); });
    if(!applicable.length){
      botSay("bot",t("bot_every_day_blocked"));
      return;
    }
    var skipParts = [];
    if(blocked.length || closed.length){
      skipParts.push(t("bot_skip_absence_closed", {days: blocked.concat(closed).map(function(d){ return DAYS[d]; }).join(", ")}));
    }
    if(over.length) skipParts.push(t("bot_skip_over_capacity", {days: over.map(function(d){ return DAYS[d]; }).join(", ")}));
    var daysLabel = applicable.map(function(d){ return DAYS[d]; }).join(", ")
      + (skipParts.length ? t("bot_days_skipped_suffix", {parts: skipParts.join("; ")}) : "");

    chat.pending = "entryWeek";
    chat.draftWeek = {days:applicable, dur:dur, p:pIdx, desc:desc};
    var existingW = state.rows.filter(function(r){ return r.p === pIdx; })[0];
    var holderW = {desc: desc || (existingW ? existingW.desc : "")};
    var descOkW = String(holderW.desc || "").trim().length >= 10;
    var cardW = botCard([
      [t("label_days"), daysLabel],
      [t("label_duration_per_day"), fmt(dur) + " h"],
      [t("th_total"), fmt(dur * applicable.length) + " h"],
      [t("label_project"), pr.code + " · " + pr.name],
      [t("label_receiver_object"), receiverObjectLabel(pr)],
      [t("label_activity_type"), pr.sap.lstar + ", " + pr.act],
      [t("label_description"), descOkW ? holderW.desc : t("bot_desc_tbd")],
      [t("label_origin"), "Joule"]
    ], t("btn_save"), function(){
      var row = state.rows.filter(function(r){ return r.p === pIdx; })[0];
      if(!row){ row = {id:nextId++, p:pIdx, desc:holderW.desc, h:[0,0,0,0,0,0,0], origin:"Joule"}; state.rows.push(row); }
      if(holderW.desc) row.desc = holderW.desc;
      row.origin = "Joule";
      applicable.forEach(function(d){ row.h[d] += dur; });
      state.needsSave = true;
      render();
      applicable.forEach(function(d){ flashCell(row.id, d); });
      botSay("bot", plural(applicable.length, "bot_entry_saved_days", {dur: fmt(dur), total: fmt(dur * applicable.length), code: pr.code}) + weekSummaryText());
      botChips([chipSubmit(),t("chip_my_absences")]);
    });
    if(!descOkW) cardW.querySelectorAll('.jrow').forEach(function(r){ if(r.querySelector('.k') && r.querySelector('.k').textContent === t('label_description')) r.remove(); });
    requireDescOnCard(cardW, holderW);
    if(chat.draftWeek) chat.draftWeek.needsDesc = !descOkW;
    botSay("bot", t(descOkW ? "bot_confirm_entry" : "bot_confirm_entry_desc"), cardW);
  }

  /* "fill in my missing hours [on BNK]": the personal equivalent of
     offerFillMissingTeam. For PT02 (weekly), scoped to the visible week
     like every other personal chat entry (registar_horas/registar_horas_
     semana never reach across weeks either); for PT01 (monthly), covers
     every week touched by the visible month, the same scope the month
     grid and its Submit already use - a person filling in a whole
     month's gaps one week at a time would defeat the point of this
     command.
     "Missing" tops a day up to its own capacity, not just days sitting
     at exactly zero: a day already at 2h of an 8h capacity still has 6h
     missing. dur, when given, caps how much gets added to any one day
     instead of always closing the whole gap - never more than what's
     actually left, same hard rule as everywhere else. */
  function offerFillMissing(pIdx, dur){
    if(isMonthly()) return offerFillMissingMonth(pIdx, dur);
    if(state.submitted){
      botSay("bot", t("bot_week_locked"));
      return;
    }
    var pr = PROJECTS[pIdx];
    var plan = [0,1,2,3,4].map(function(d){
      var gap = capacity(d) - dayTotal(d);
      return {day:d, add: dur ? Math.min(dur, gap) : gap};
    }).filter(function(x){ return x.add > 0; });
    if(!plan.length){
      botSay("bot", t("bot_week_capacity_full"));
      botChips([t("chip_hours_i_have")]);
      return;
    }
    var total = plan.reduce(function(a,x){ return a + x.add; }, 0);
    var daysLabel = plan.map(function(x){ return DAYS[x.day] + " +" + fmt(x.add) + "h"; }).join(", ");
    chat.pending = "entryWeek";
    var existingF = state.rows.filter(function(r){ return r.p === pIdx; })[0];
    var holderF = {desc: existingF ? existingF.desc : ""};
    var cardF = botCard([
      [t("label_days"), daysLabel],
      [t("th_total"), fmt(total) + " h"],
      [t("label_project"), pr.code + " · " + pr.name],
      [t("label_receiver_object"), receiverObjectLabel(pr)],
      [t("label_activity_type"), pr.sap.lstar + ", " + pr.act],
      [t("label_origin"), "Joule"]
    ], t("btn_save"), function(){
      var row = state.rows.filter(function(r){ return r.p === pIdx; })[0];
      if(!row){ row = {id:nextId++, p:pIdx, desc:"", h:[0,0,0,0,0,0,0], origin:"Joule"}; state.rows.push(row); }
      if(String(row.desc || "").trim().length < 10) row.desc = holderF.desc;
      row.origin = "Joule";
      plan.forEach(function(x){ row.h[x.day] += x.add; });
      state.needsSave = true;
      render();
      plan.forEach(function(x){ flashCell(row.id, x.day); });
      botSay("bot", plural(plan.length, "bot_filled_saved", {total: fmt(total), code: pr.code}) + weekSummaryText());
      botChips([chipSubmit(),t("chip_my_absences")]);
    });
    requireDescOnCard(cardF, holderF);
    botSay("bot", t(String(holderF.desc || "").trim().length >= 10 ? "bot_confirm_entry" : "bot_confirm_entry_desc"), cardF);
  }
  function offerFillMissingMonth(pIdx, dur){
    var pr = PROJECTS[pIdx];
    var plan = activeMonthDates().map(function(dateISO){
      var wd = weekDayFor(dateISO);
      if(!wd || wd.day > 4 || wd.week.submitted || !periodOpen(dateISO)) return null;
      var gap = capacityOf(wd.week, wd.day) - dayTotalOf(wd.week, wd.day);
      return gap > 0 ? {dateISO:dateISO, week:wd.week, day:wd.day, add: dur ? Math.min(dur, gap) : gap} : null;
    }).filter(function(x){ return x; });
    if(!plan.length){
      botSay("bot", t("bot_month_capacity_full"));
      botChips([t("chip_hours_i_have")]);
      return;
    }
    var total = plan.reduce(function(a,x){ return a + x.add; }, 0);
    var daysLabel = plan.map(function(x){ return monthDayLabel(x.week, x.day) + " +" + fmt(x.add) + "h"; }).join(", ");

    chat.pending = "entryWeek";
    var anyRow = plan.map(function(x){ return monthRowIn(x.week, pIdx); }).filter(function(r){ return r && String(r.desc || "").trim().length >= 10; })[0];
    var holderM = {desc: anyRow ? anyRow.desc : ""};
    var cardM = botCard([
      [t("label_days"), daysLabel],
      [t("th_total"), fmt(total) + " h"],
      [t("label_project"), pr.code + " · " + pr.name],
      [t("label_receiver_object"), receiverObjectLabel(pr)],
      [t("label_activity_type"), pr.sap.lstar + ", " + pr.act],
      [t("label_origin"), "Joule"]
    ], t("btn_save"), function(){
      plan.forEach(function(x){
        var row = monthRowIn(x.week, pIdx);
        if(!row){ row = {id:nextId++, p:pIdx, desc:"", h:[0,0,0,0,0,0,0], origin:"Joule"}; x.week.rows.push(row); }
        if(String(row.desc || "").trim().length < 10) row.desc = holderM.desc;
        row.origin = "Joule";
        row.h[x.day] += x.add;
      });
      state.needsSave = true;
      render();
      var errs = monthErrors(activeMonthDates()).length;
      botSay("bot", plural(plan.length, "bot_filled_saved_month", {total: fmt(total), code: pr.code})
        + (errs ? plural(errs, "bot_week_errors_block") : t("bot_month_no_errors_submit")));
      botChips([t("chip_submit_month"),t("chip_my_absences")]);
    });
    requireDescOnCard(cardM, holderM);
    botSay("bot", t(String(holderM.desc || "").trim().length >= 10 ? "bot_confirm_entry" : "bot_confirm_entry_desc"), cardM);
  }

  /* asks Claude, at /api/chat, to interpret the text and choose a function.
     Returns null on any failure (no key configured, network, engine error),
     and in that case the caller falls back to the local regex interpreter. */
  async function askAssistant(txt){
    try{
      var payload = {
          mensagem: txt,
          historico: chat.history.slice(0, -1).slice(-12),
          /* the language of this message (botHandle set it as the reply
             language), not the screens': the assistant answers in it */
          idioma: curLang(),
          contexto: {
            ecra_atual: {home:"Assistant", semana:"My Timesheet", leave:"Leave Request", team:"Team", aprov:"Approval", cats:"CATS mapping"}[state.screen] || "My Timesheet",
            hoje: isoToInput(todayISO()),
            papel: {employee:"colaborador", pm:"gestor_projeto", manager:"chefia"}[state.role] || "colaborador",
            gestor_projeto_em_teste: state.role === "pm" ? {nome: leaderById(state.leader).name, projetos: pmProjectsLabel()} : null,
            chefia_direta: approverFor(selfId()).name,
            tipos_ausencia: ABSENCE_TYPES.map(function(ty){ return {codigo: ty.code, nome: t("abs_" + ty.code), parte_do_dia: ty.partial, desconta_ferias: ty.quota}; }),
            saldo_ferias: (function(){ var b = leaveBalance(); return {direito: b.total, gozados: b.used, pedidos: b.requested, disponivel: b.available}; })(),
            pedidos_ausencia: myLeave().filter(function(r){ return r.EndDate >= isoAdd(todayISO(), -30) || r.StatusID === "SENT"; }).map(function(r){
              return {pedido: r.RequestID, tipo: r.AbsenceTypeCode, inicio: isoToInput(r.StartDate), fim: isoToInput(r.EndDate), horas: r.partial ? r.hours : null, estado: r.StatusID, cancelamento_pendente: !!r.cancelRequested, pode_cancelar: canWithdraw(r), pode_alterar: canEditLeave(r), aprovador: r.ApproverName || approverFor(selfId()).name, motivo_rejeicao: r.StatusID === "REJECTED" ? (r.ApproverComment || "") : null};
            }),
            /* who approves what this person sends, and the company's public
               holidays from today on (no hours expected, not deducted) */
            aprovadores: {horas: approverByProject().map(function(x){ return {projeto: x.code, aprovador: x.name}; }), periodo: isMonthly() ? "mensal" : "semanal", ausencias: approverFor(selfId()).name},
            feriados: HOLIDAYS.filter(function(h){ return (!h[4] || h[4] === IT0001.bukrs) && h[0] >= todayISO(); }).slice(0, 10).map(function(h){ return {data: isoToInput(h[0]), nome: holidayName(h)}; }),
            /* the team calendar as this profile sees it, two weeks back and
               twelve ahead: a colleague's health related reason is never
               sent, only that they're absent, except to the line manager */
            calendario_equipa: calendarAbsences(isoAdd(todayISO(), -14), isoAdd(todayISO(), 84)).map(function(x){
              var masked = state.role !== "manager" && SENSITIVE_TYPES.indexOf(x.r.AbsenceTypeCode) !== -1;
              return {nome: x.name, tipo: masked ? "ausente" : x.r.AbsenceTypeCode, inicio: isoToInput(x.r.StartDate), fim: isoToInput(x.r.EndDate), estado: x.r.StatusID};
            }),
            saldos_equipa: state.role !== "manager" ? [] : reportsOf().map(function(m){ var b = balanceOf(m.EmployeeID); return {nome: m.name, disponivel: b.available, pedidos: b.requested}; }),
            /* only what this profile has: approvals of leave for the line
               manager, the team and timesheet approvals for the project
               manager, and everyone's own timesheet and leave */
            pedidos_para_aprovar: state.role === "manager" ? leaveQueue().map(function(r){
              return {pedido: r.RequestID, nome: r.EmployeeName, tipo: r.AbsenceTypeCode, inicio: isoToInput(r.StartDate), fim: isoToInput(r.EndDate), duracao: leaveDurationLabel(r), cancelamento: !!r.cancelRequested, sobreposicoes: leaveOverlaps(r).map(function(o){ return o.EmployeeName; })};
            }) : [],
            pedido_ausencia_por_completar: chat.leaveDraft ? {tipo: chat.leaveDraft.AbsenceTypeCode || null, inicio: chat.leaveDraft.StartDate ? isoToInput(chat.leaveDraft.StartDate) : null, fim: chat.leaveDraft.EndDate ? isoToInput(chat.leaveDraft.EndDate) : null} : null,
            rejeicao_sem_motivo: chat.rejectDraft ? chat.rejectDraft.map(function(r){ return r.RequestID; }) : null,
            /* Which CATS data entry profile the person writing this message is on
               right now (IT0001.bukrs), the fact buildSystemPrompt's business-rule
               instruction asks it to ground any explanation of the fill-in logic
               in, instead of hedging ("se não tens esse perfil..."). */
            meu_registo: isClock() ? "relogio" : "duracao",
            projetos: profileProjects().map(function(i){ var p = PROJECTS[i]; return {codigo: p.code.split("-")[0], nome: p.name, indice: i}; }),
            ausencias: ABSENCES.map(function(a){ return {dia: DAYS[a.day], indice: a.day, tipo: a.type, horas: a.hours, estado: a.status}; }),
            capacidades: [0,1,2,3,4].map(function(d){ return {dia: DAYS[d], indice: d, capacidade: capacity(d), registado: dayTotal(d)}; }),
            /* For consulting (monthly), this has to cover every week the
               visible month touches, the same scope offerFillMissingMonth
               actually fills - a context scoped to just the anchor week
               would tell the assistant there's nothing to fill even when
               other weeks in the month clearly have gaps. */
            dias_uteis_sem_horas_pessoa: isMonthly()
              ? activeMonthDates().filter(function(dateISO){
                  var wd = weekDayFor(dateISO);
                  return wd && wd.day <= 4 && !wd.week.submitted && periodOpen(dateISO)
                    && capacityOf(wd.week, wd.day) - dayTotalOf(wd.week, wd.day) > 0;
                }).map(function(dateISO){ var wd = weekDayFor(dateISO); return monthDayLabel(wd.week, wd.day); })
              : state.submitted ? [] : [0,1,2,3,4].filter(function(d){ return periodOpen(WORKDATES[d]) && capacity(d) - dayTotal(d) > 0; }).map(function(d){ return DAYS[d]; }),
            semana: {total: weekTotal(), esperado: weekCapacity(), erros: errors().length, problemas: submitProblems(errors()), submetida: state.submitted},
            /* what "submit" sends: the month in Consulting, the week in
               Building Solutions; for the month, its own totals and what
               blocks it, so the reply never says it can't submit the month */
            submissao: isMonthly() ? "mensal" : "semanal",
            mes: !isMonthly() ? null : (function(){
              var dates = activeMonthDates(), errs = monthErrors(dates);
              return {
                mes: monthSentenceLabel(), total: monthTotalHours(dates), esperado: monthCapacityTotal(dates),
                semanas_por_submeter: openMonthWeeks().map(function(w){ return isoWeekOf(w.start); }),
                erros: submitProblems(errs),
                submetido: !openMonthWeeks().length
              };
            })(),
            semanas_anteriores: WEEKS.slice(0, weekIdx).map(function(w){
              var porProjeto = {};
              w.rows.forEach(function(r){
                var tot = r.h.reduce(function(a,b){ return a+(b||0); }, 0);
                if(!tot) return;
                var code = PROJECTS[r.p].code.split("-")[0];
                porProjeto[code] = (porProjeto[code] || 0) + tot;
              });
              return {
                semana: isoWeekOf(w.start),
                submetida: w.submitted,
                projetos: Object.keys(porProjeto).map(function(c){ return {codigo:c, horas: round15(porProjeto[c])}; }),
                ausencias: w.absences.map(function(a){ return {tipo:a.type, horas:a.hours, estado:a.status}; })
              };
            }),
            projeto_equipa_ativo: state.role !== "pm" ? null : (function(){
              var p = PROJECTS[massProject()];
              return p ? {codigo: p.code.split("-")[0], nome: p.name} : null;
            })(),
            projetos_do_lider: state.role !== "pm" ? [] : projectsOf(state.leader).map(function(i){
              return {codigo: PROJECTS[i].code.split("-")[0], nome: PROJECTS[i].name};
            }),
            equipa: state.role !== "pm" ? [] : teamOf(state.leader).map(function(m){
              return {
                nome: m.name, aprovado_bloqueado: !!m.locked,
                projetos: m.projs.map(function(i){ return PROJECTS[i].code.split("-")[0]; }),
                dias_uteis_sem_horas: missingWeekdaysFor(m).map(function(d){ return DAYS[d]; }),
                /* A leader can manage people on both profiles at once (e.g. Carlos
                   Pinto's team), so this is per member, not a single team-wide flag. */
                regista: profileFor(WORKDATES[0], m.bukrs).clock ? "relogio" : "duracao"
              };
            }),
            periodo_aprovacao: state.role !== "pm" ? null : state.approvals === APPROVALS_PT01 ? {tipo: "mensal", mes: monthSentenceOf(approvalMonth())} : {tipo: "semanal"},
            aprovacoes: state.role !== "pm" ? [] : tsQueue().map(function(a){ return {nome: a.who, tem_excecao: !!a.warn, nota: a.note || null, aprovado: !!a.approved}; }),
            pedido_por_confirmar: chat.pending === "entry" && chat.draft
              ? {dia: DAYS[chat.draft.day], duracao_horas: chat.draft.dur, projeto: PROJECTS[chat.draft.p].code.split("-")[0], descricao: chat.draft.desc}
              : null
          }
      };
      /* Inside claude.ai, Claude answers from the page itself; elsewhere
         the serverless function does, when it has a key. */
      if(learn.sample && !learn.sampleOff){
        var viaSample = await askViaSample(payload);
        if(viaSample){ if(chat.curTurn) chat.curTurn.engine = "claude.ai"; return viaSample; }
        return null;
      }
      var res = await fetch("/api/chat", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      if(!res.ok){
        /* what the server said, for whoever opens the browser console */
        try{ console.warn("assistant /api/chat", res.status, await res.text()); }catch(e){}
        return null;
      }
      var data = await res.json();
      if(!data || data.error) return null;
      if(chat.curTurn) chat.curTurn.engine = "api";
      return data;
    }catch(e){
      return null;
    }
  }

  /* Claude reads teamOf(state.leader) too (the 'equipa' list in its
     context), scoped to whichever leader and project are currently active
     above the Team grid - so a name it names correctly can still fail to
     resolve here if Acting as / Project moved on since, and "couldn't
     confirm who, the days or the hours" said nothing about which, or why.
     This says which part is missing and, for the person specifically,
     names the likely cause: right person, wrong Acting as / Project. */
  function teamActionProblem(pessoaArg, hasTarget, hasDays, hasAmount, amountLabel){
    var missing = [];
    if(!hasTarget){
      var name = String(pessoaArg || "").trim();
      missing.push(name
        ? t("bot_team_not_found", {name: name, code: PROJECTS[massProject()].code, leader: leaderById(state.leader).name})
        : t("bot_team_who_unclear"));
    }
    if(!hasDays) missing.push(t("bot_team_day_unclear"));
    if(!hasAmount) missing.push(t("bot_team_amount_unclear", {amount: amountLabel}));
    return missing.join("; ") + ".";
  }
  /* Claude sends back a project code, possibly abbreviated or lowercased
     ("bnk" for "BNK-2026"); resolves it to a PROJECTS index by matching the
     start of the code, case-insensitively, or -1 if nothing matches.
     registar_horas, registar_horas_semana and preencher_horas_em_falta each
     used to run this same loop themselves. */
  function matchProjectCodePrefix(str){
    /* An empty needle is a prefix of every code ("anything".indexOf("")
       === 0), so without this guard a missing/blank project argument
       silently resolved to the LAST project in the list instead of
       failing - Claude omitting 'projeto' then booked hours against
       whichever project happened to be last, rather than the caller
       correctly treating it as unresolved. */
    var needle = String(str || "").trim().toLowerCase();
    if(!needle) return -1;
    var pIdx = -1;
    PROJECTS.forEach(function(pr,i){
      if(pr.code.toLowerCase().indexOf(needle) === 0) pIdx = i;
    });
    return pIdx;
  }
  function dispatchTeamAllowance(intent){
        var al = intent.argumentos || {};
        var teamMembersAl = teamOf(state.leader);
        var targetsAl = /^(todos|toda a equipa|equipa toda)$/i.test(String(al.pessoa || "").trim())
          ? teamMembersAl
          : teamMembersAl.filter(function(m){ return m.name.toLowerCase().indexOf(String(al.pessoa || "").toLowerCase()) !== -1; });
        var wAl = wt(al.rubrica);
        var rawDaysAl = Array.isArray(al.dias) && al.dias.length ? al.dias : (al.dia ? [al.dia] : []);
        var daysAl = rawDaysAl.map(function(d){ return resolveDayArg(d); }).filter(function(i){ return i !== -1; });
        var qtyAl = round15(Number(al.quantidade));
        var hasAmountAl = !!(qtyAl && qtyAl > 0);
        if(!targetsAl.length || !wAl || !daysAl.length || !hasAmountAl){
          var msgAl = intent.texto || teamActionProblem(al.pessoa, targetsAl.length > 0, daysAl.length > 0, hasAmountAl, t("label_the_quantity"));
          if(!intent.texto && !wAl) msgAl += " " + t("bot_also_unrecognized_wage_type");
          botSay("bot", msgAl);
          botChips([t("chip_help")]);
          return true;
        }
        offerTeamAllowance(targetsAl, daysAl, al.rubrica, qtyAl, String(al.nota || "").trim());
        return true;
  }
  /* maps Claude's response (function + arguments) to the same bot actions */
  function botDispatch(intent){
    var la = intent.argumentos || {};
    if(chat.curTurn){ chat.curTurn.funcao = intent.funcao || null; chat.curTurn.argumentos = intent.argumentos || null; }
    switch(intent.funcao){
      case "pedir_ausencia":
        var dl = {
          AbsenceTypeCode: absType(la.tipo) ? la.tipo : "", StartDate: isoArg(la.data_inicio), EndDate: isoArg(la.data_fim || la.data_inicio),
          partial: !!(Number(la.horas) > 0 || (la.hora_inicio && la.hora_fim)), hours: round15(Number(la.horas) || 0),
          StartTime: la.hora_inicio || "", EndTime: la.hora_fim || "", Notes: String(la.nota || "").trim()
        };
        if(dl.partial && !dl.StartTime){ dl.StartTime = "09:00"; dl.EndTime = fmtClock(9*60 + Math.round(dl.hours*60)); }
        /* on behalf of someone else: only the line manager, for a report */
        if(String(la.pessoa || "").trim()){ offerLeaveOnBehalf(String(la.pessoa), dl); return true; }
        if(!dl.AbsenceTypeCode || !dl.StartDate){
          if(intent.texto){ chat.leaveDraft = dl; botSay("bot", intent.texto); }
          else askLeaveMissing(dl);
          return true;
        }
        offerLeave(dl);
        return true;
      case "consultar_ausencias":
        if(la.pedido) showRequestStatus(String(la.pedido).replace(/\D/g, ""));
        else if(la.movimentos) showMovements();
        else if(isoArg(la.data)) showBalanceAsOf(isoArg(la.data));
        else if(la.saldo) showLeaveBalance(); else showMyLeave();
        return true;
      case "alterar_ausencia":
        var ch = {AbsenceTypeCode: absType(la.tipo) ? la.tipo : "", StartDate: isoArg(la.data_inicio), EndDate: isoArg(la.data_fim || la.data_inicio), Notes: String(la.nota || "").trim()};
        if(Number(la.horas) > 0 || (la.hora_inicio && la.hora_fim)){
          ch.partial = true; ch.hours = round15(Number(la.horas) || 0); ch.StartTime = la.hora_inicio || "09:00";
          ch.EndTime = la.hora_fim || fmtClock(9*60 + Math.round(ch.hours*60));
        }
        offerChangeLeave(String(la.pedido || "").replace(/\D/g, ""), ch);
        return true;
      case "quem_aprova": showApprovers(); return true;
      case "verificar_submissao": explainSubmit(); return true;
      case "consultar_feriados":
        var hm = String(la.mes || "").match(/^(\d{4})-?(\d{2})/);
        showHolidays(hm ? hm[1] + hm[2] : "");
        return true;
      case "consultar_calendario_equipa": showTeamCalendar(isoArg(la.data_inicio), isoArg(la.data_fim || la.data_inicio)); return true;
      case "consultar_saldos_equipa": showTeamBalances(); return true;
      case "registar_abono":
        var abDays = la.dia ? resolveDayArg(la.dia) : todayDayIdx();
        offerOwnAllowance(la.rubrica, abDays, round15(Number(la.quantidade) || 1), String(la.nota || "").trim(), la.projeto ? matchProjectCodePrefix(la.projeto) : -1);
        return true;
      case "cancelar_ausencia":
        offerWithdraw(findLeaveTarget(String(la.pedido || ""), isoArg(la.data)));
        return true;
      case "listar_pendentes_aprovacao":
        var pm0 = String(la.mes || "").match(/^(\d{4})-?(\d{2})/);
        showPendingApprovals(pm0 ? pm0[1] + pm0[2] : "");
        return true;
      case "decidir_ausencia":
        var who = String(la.pedido || la.pessoa || "");
        offerLeaveDecision(/^(todos|todas|all|tous|toutes)$/i.test(who.trim()) ? leaveQueue() : matchLeaveTargets(who), la.decisao !== "rejeitar", String(la.motivo || "").trim());
        return true;
      case "ir_para_ausencias":
        if(la.separador === "calendario_equipa") goToScreen("teamcal", t("nav_team_calendar"));
        else if(la.separador === "aprovacao") goToScreen("lvaprov", t("nav_leave_approval"));
        else goToScreen("leave", t("nav_leave"));
        return true;
      case "registar_quilometros":
        var kd = {round: !!la.ida_e_volta};
        if(la.destino) setKmEnd(kd, "to", la.destino, la.destino_lat, la.destino_lon);
        if(la.origem) setKmEnd(kd, "from", la.origem, la.origem_lat, la.origem_lon);
        else if(kd.toLabel){ var ko = officePlace(); kd.from = ko; kd.fromLabel = t("label_office_base", {city: placeLabel(ko)}); kd.fromOffice = true; }
        if(Number(la.km) > 0) kd.given = Math.round(Number(la.km));
        if(isoArg(la.data)) kd.date = isoArg(la.data);
        var kp = matchProjectCodePrefix(la.projeto);
        if(kp !== -1 && profileProjects().indexOf(kp) !== -1){ kd.p = kp; kd.pAuto = false; }
        if(!kd.toLabel && intent.texto){ chat.kmDraft = kd; chat.pending = "km"; botSay("bot", intent.texto); return true; }
        offerKm(kd);
        return true;
      case "listar_ausencias": showAbsences(); return true;
      case "consultar_semana": showWeekStatus(); return true;
      case "aplicar_sugestoes": offerApplyHighConfidence(); return true;
      case "ir_para_equipa": goToTeamScreen(); return true;
      case "ir_para_aprovacao": goToApprovalScreen(); return true;
      case "ir_para_cats": goToCatsScreen(); return true;
      case "copiar_semana": offerCopyWeek(); return true;
      case "submeter_semana": offerSubmit(); return true;
      case "registar_horas_equipa":
      case "preencher_horas_em_falta_equipa":
      case "registar_allowance_equipa":
        if(state.role !== "pm"){ botSay("bot", t("bot_team_only_pm")); botChips([t("chip_help")]); return true; }
        if(intent.funcao === "preencher_horas_em_falta_equipa"){
          var fp0 = intent.argumentos || {};
          var durFp0 = round15(Number(fp0.duracao_horas));
          offerFillMissingTeam(fp0.pessoa, durFp0 > 0 ? durFp0 : 0);
          return true;
        }
        if(intent.funcao === "registar_allowance_equipa") return dispatchTeamAllowance(intent);
        var ae = intent.argumentos || {};
        var teamMembersE = teamOf(state.leader);
        var targetsE = /^(todos|toda a equipa|equipa toda)$/i.test(String(ae.pessoa || "").trim())
          ? teamMembersE
          : teamMembersE.filter(function(m){ return m.name.toLowerCase().indexOf(String(ae.pessoa || "").toLowerCase()) !== -1; });
        var rawDaysE = Array.isArray(ae.dias) && ae.dias.length ? ae.dias : (ae.dia ? [ae.dia] : []);
        var daysE = rawDaysE
          .map(function(d){ return resolveDayArg(d); })
          .filter(function(i){ return i !== -1; });
        var clockE = null;
        if(ae.hora_inicio && ae.hora_fim){
          var bE = parseClock(ae.hora_inicio), eE = parseClock(ae.hora_fim);
          if(!isNaN(bE) && bE !== null && !isNaN(eE) && eE !== null) clockE = {b:bE, e:eE};
        }
        var durE = clockE ? null : round15(Number(ae.duracao_horas));
        var hasAmountE = !!(clockE || (durE && durE > 0));
        if(!targetsE.length || !daysE.length || !hasAmountE){
          botSay("bot", intent.texto || teamActionProblem(ae.pessoa, targetsE.length > 0, daysE.length > 0, hasAmountE, t("label_the_hours")));
          botChips([t("chip_help")]);
          return true;
        }
        offerTeamEntry(targetsE, daysE, durE, clockE);
        return true;
      case "aprovar":
        var aa = intent.argumentos || {};
        var isAll = /^(todos|toda a equipa|equipa toda)$/i.test(String(aa.pessoa || "").trim());
        handleApprovalRequest(isAll ? "approve everyone" : "approve " + String(aa.pessoa || ""));
        return true;
      case "registar_horas":
        var a = intent.argumentos || {};
        var pIdx = matchProjectCodePrefix(a.projeto);
        var dur = round15(Number(a.duracao_horas));
        /* 'dias' (several explicit dates, e.g. "nos dias 14, 15 e 16") takes
           priority over the single 'dia' when both somehow show up. A single
           resolved day still goes through offerEntry, which has its own
           "day is blocked, suggest the next free one" handling that
           offerEntryWeek doesn't need to duplicate for the common case. */
        var rawDays = Array.isArray(a.dias) && a.dias.length ? a.dias : (a.dia ? [a.dia] : []);
        var days = rawDays.map(function(d){ return resolveDayArg(d); }).filter(function(i){ return i !== -1 && i <= 4; });
        if(!days.length || !dur || dur <= 0){
          botSay("bot", intent.texto || t("bot_parse_failed_generic"));
          botChips([t("chip_hours_i_have"),t("chip_my_absences")]);
          return true;
        }
        var draftH = days.length === 1 ? {kind:"entry", day:days[0], dur:dur, desc:a.descricao || ""} : {kind:"week", days:days, dur:dur, desc:a.descricao || ""};
        if(!checkProjectArg(pIdx, draftH, intent.texto)) return true;
        if(days.length === 1) offerEntry(days[0], dur, pIdx, a.descricao || "");
        else offerEntryWeek(days, dur, pIdx, a.descricao || "");
        return true;
      case "registar_horas_semana":
        var aw = intent.argumentos || {};
        var pIdxW = matchProjectCodePrefix(aw.projeto);
        var durW = round15(Number(aw.duracao_horas));
        if(!durW || durW <= 0){
          botSay("bot", intent.texto || t("bot_parse_failed_generic"));
          botChips([t("chip_hours_i_have"),t("chip_my_absences")]);
          return true;
        }
        if(!checkProjectArg(pIdxW, {kind:"week", days:[0,1,2,3,4], dur:durW, desc:aw.descricao || ""}, intent.texto)) return true;
        offerEntryWeek([0,1,2,3,4], durW, pIdxW, aw.descricao || "");
        return true;
      case "preencher_horas_em_falta":
        var af = intent.argumentos || {};
        var pIdxF = matchProjectCodePrefix(af.projeto);
        var durF = round15(Number(af.duracao_horas));
        if(!checkProjectArg(pIdxF, {kind:"fill", dur:durF > 0 ? durF : 0}, intent.texto)) return true;
        offerFillMissing(pIdxF, durF > 0 ? durF : 0);
        return true;
      default:
        if(intent.texto){
          botSay("bot", intent.texto);
          botChips([t("chip_hours_i_have"),t("chip_my_absences"),t("chip_help")]);
          return true;
        }
        return false;
    }
  }

  /* Every message the person sends is one turn of the log (when there is
     one): whatever the assistant says while handling it lands in that
     turn, and the 👍/👎 goes under its last answer. */
  async function botHandle(txt){
    if(!txt || !txt.trim()) return;
    var lang = replyLangFor(txt);
    chat.langNote = lang !== state.lang && lang !== chat.replyLang;
    chat.replyLang = lang;
    setReplyLang(lang);
    /* dictation listens in the language the conversation is in */
    if(VOICE_LANGS[lang.toUpperCase()] && voice.lang !== lang.toUpperCase()){ voice.lang = lang.toUpperCase(); syncVoiceLangBtn(); }
    var turn = logTurnStart(txt);
    if(turn) turn.replyLang = lang;
    chat.curTurn = turn;
    try{ await botHandleTurn(txt); }
    finally{
      chat.curTurn = null;
      setReplyLang(null);
      if(turn){ addFeedback(turn); logSave(); }
    }
  }
  async function botHandleTurn(txt){
    if(!txt || !txt.trim()) return;
    botSay("me", txt);
    if(chat.langNote && $("jlog")) $("jlog").appendChild(el("div","jdivider", t("bot_reply_lang_note")));
    botChips([]);
    chat.history.push({role:"user", content:txt});
    showTyping();

    /* A card is already open waiting for confirmation: read this message as
       a correction to it first (checked here, ahead of Claude, so it holds
       even when the language model isn't configured or doesn't pick up on
       the open card from context alone). */
    if(chat.pending === "entry" && chat.draft){
      var fix = tryCorrectDraft(txt);
      if(fix && fix.handled){ await thinkingDelay(); hideTyping(); return; }
      if(fix){
        await thinkingDelay();
        hideTyping();
        offerEntry(fix.day, fix.dur, fix.p, fix.desc);
        chat.history.push({role:"assistant", content:"Updated the pending entry: " + fmt(fix.dur) + "h, " + PROJECTS[fix.p].name + ", " + DAYS[fix.day] + "."});
        return;
      }
    }

    /* Kilometres on screen or still missing the route: "round trip",
       "from Coimbra", "250 km" or another day corrects the same trip. */
    if(chat.pending === "km" && chat.kmDraft){
      var kmFix = /\d\s*(h|horas?|hours?|heures?)\b/i.test(txt) ? null : kmDraftFromText(txt, chat.kmDraft);
      if(kmFix && (kmFix.strong || txt.trim().split(/\s+/).length <= 4)){
        await thinkingDelay();
        hideTyping();
        if(chat.curTurn) chat.curTurn.path = "km_draft";
        offerKm(kmFix);
        return;
      }
    }

    /* "Which project?" is open: a code or a chip completes the entry. */
    if(chat.projectDraft){
      if(continueProjectDraft(txt)){
        await thinkingDelay();
        hideTyping();
        if(chat.curTurn) chat.curTurn.path = "project_answer";
        return;
      }
      chat.projectDraft = null;
    }

    /* A card waiting for its line's description: a reply that isn't a new
       request or a correction is that description. */
    var waitingDesc = (chat.pending === "entry" && chat.draft && chat.draft.needsDesc) || (chat.pending === "entryWeek" && chat.draftWeek && chat.draftWeek.needsDesc);
    if(waitingDesc && looksLikeDescription(txt)){
      await thinkingDelay();
      hideTyping();
      if(chat.curTurn) chat.curTurn.path = "entry_description";
      if(chat.pending === "entry"){ var dd = chat.draft; offerEntry(dd.day, dd.dur, dd.p, txt.trim()); }
      else { var dw = chat.draftWeek; offerEntryWeek(dw.days, dw.dur, dw.p, txt.trim()); }
      return;
    }

    /* A rejection waiting for its reason: this message is the reason. */
    if(chat.rejectDraft){
      if(chat.curTurn) chat.curTurn.path = "reject_reason";
      var targetsR = chat.rejectDraft;
      chat.rejectDraft = null;
      await thinkingDelay();
      hideTyping();
      offerLeaveDecision(targetsR, false, txt.trim());
      return;
    }
    /* A leave request still missing its type or dates: a short answer
       ("vacation", "tomorrow afternoon") completes the same request. */
    if(chat.leaveDraft){
      await thinkingDelay();
      hideTyping();
      if(continueLeaveDraft(txt)){ if(chat.curTurn) chat.curTurn.path = "leave_draft"; return; }
      showTyping();
    }

    var hist = chat.history;
    var intentP = askAssistant(txt);
    var intent = (await Promise.all([intentP, thinkingDelay()]))[0];
    hideTyping();
    if(intent && botDispatch(intent)){
      hist.push({role:"assistant", content: intent.texto || ("Called " + intent.funcao + ".")});
      return;
    }

    /* Every answer comes from Claude Sonnet; the regex interpreter below
       only runs for the automated test suites (engine=local in the
       address). Without Claude, the assistant says so instead of guessing. */
    if(LOCAL_ENGINE){ botHandleLocal(txt); return; }
    if(chat.curTurn) chat.curTurn.path = "claude_unavailable";
    botSay("bot", t("bot_claude_unavailable"));
  }
  var LOCAL_ENGINE = /[?&]engine=local\b/.test(location.search);

  var FILL_VERB_RE = /preench|complet|\bfill|rempli|compl[eéè]t|acabar de registar|finish (my|the)/;
  var FILL_GAP_RE = /falta|missing|\bgaps?\b|manquant|\bvides?\b|\bburacos?\b|\bo resto\b|\bthe rest\b|\ble reste\b/;
  var FILL_SCOPE_RE = /semana|\bweek\b|semaine|m[eê]s\b|\bmonth\b|\bmois\b|timesheet|folha|relev[ée]/;
  /* local regex interpreter, used when Claude isn't configured or fails.
     The pending-entry correction is checked earlier, in botHandle, ahead of
     Claude, so it isn't repeated here. */
  function botHandleLocal(txt){
    if(chat.curTurn) chat.curTurn.local = true;
    var low = txt.toLowerCase();

    /* greeting, no task in it: a short human reply, not the parsing-failure
       message. Checked as a whole-message match so "hi, log 2h BNK today"
       still falls through to the real parsers below. */
    if(/^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening)|ol[aá]|oi|bom dia|boa tarde|boa noite)[!.,\s]*$/i.test(txt)){
      var greetings = [t("bot_greeting_1"), t("bot_greeting_2"), t("bot_greeting_3")];
      botSay("bot", greetings[Math.floor(Math.random()*greetings.length)]);
      botChips([t("chip_hours_i_have"),t("chip_my_absences"),t("chip_help")]);
      return;
    }
    /* help */
    if(/\bhelp\b|what can you do|what do you do|how does this work|ajuda|o que (é que )?podes fazer|aide|que pouvez-vous faire/.test(low)){ showHelp(); return; }
    /* absences and the Leave Request, the manager's inbox, View as */
    if(handleLeaveLocal(txt)) return;
    /* absences */
    if(/absen|vacation|holiday|leave|time off/.test(low)){ showAbsences(); return; }
    /* week status */
    if(/how many hours|week status|status|summary|how('| i)?s (the week|it going)|check (the|my) week|quantas horas|estado da semana|resumo|como (est[áa]|vai) a semana|combien d'heures|[ée]tat de la semaine|r[ée]sum[ée]/.test(low)){ showWeekStatus(); return; }
    /* suggestions */
    if(/suggest/.test(low) && !/high.confidence/.test(low)){ showSuggestionsPanel(); return; }
    if(/high.confidence/.test(low)){ offerApplyHighConfidence(); return; }
    /* copy week */
    if(/copy|last week|previous week/.test(low)){ offerCopyWeek(); return; }
    /* submit */
    if(/submit|\bsubmet|\bsoumet|send the week|close the week/.test(low)){
      if(!isMonthly() && /\b(month|m[eê]s|mois)\b/.test(low)) botSay("bot", t("bot_submit_weekly_only"));
      offerSubmit();
      return;
    }
    /* screen navigation */
    if(/mass entry|team entry|team screen|go to team|switch to team|open team/.test(low)){ goToTeamScreen(); return; }
    if(/approval screen|go to approval|switch to approval|open approval/.test(low)){ goToApprovalScreen(); return; }
    if(/cats mapping|cats screen|go to cats|switch to cats|open cats/.test(low)){ goToCatsScreen(); return; }

    /* approve a timesheet, or the whole clean batch, from the Approval
       screen's data, checked ahead of the self-entry parser since "approve"
       never means a time entry */
    if(/\bapprove\b|\baprova(r)?\b|\bapprouve[rz]?\b/.test(low)){ handleApprovalRequest(txt); return; }

    /* log hours or an allowance for someone else's team, checked ahead of
       the self-entry and whole-week parsers since a named target should
       never be read as an entry for the person typing. Allowance first,
       since a distinctive wage-type word ("per diem", "km") is a much
       safer signal than the bare-number fallback the hours parser falls
       back to, which would otherwise misread "2 km" as "2 hours". */
    var teamMembers = teamOf(state.leader);
    /* "fill in my missing hours on BNK", "completa a semana da equipa":
       the person's own gaps, or on the Team screen (or naming the team)
       the project manager's team, each day up to its own capacity */
    if(FILL_VERB_RE.test(low) && (FILL_GAP_RE.test(low) || (FILL_SCOPE_RE.test(low) && !/\d\s*(h|horas?|hours?|heures?)\b|\d:\d\d/.test(low)))){
      var fd = (low.match(/(\d+(?:[.,]\d+)?)\s*(?:h|horas?|hours?|heures?)\b/) || [])[1];
      var fDur = fd ? round15(parseDur(fd)) : 0;
      var named = teamMembers.filter(function(m){ return new RegExp("\\b" + foldText(m.name.split(" ")[0]) + "\\b").test(foldText(txt)); })[0];
      var forTeam = !/\b(my|minhas?|meus?|mes)\b/.test(low) && (named || /equipa|\bteam\b|[ée]quipe|everyone|todos|\btous\b/.test(low) || (state.role === "pm" && state.screen === "team"));
      if(forTeam){
        if(state.role !== "pm"){ botSay("bot", t("bot_team_only_pm")); botChips([t("chip_help")]); return; }
        offerFillMissingTeam(named ? named.name : "", fDur);
        return;
      }
      var fp = matchProject(" " + txt + " ");
      if(fp && fp.notAllowed){ sayNotAllocated(fp.p, {kind:"fill", dur:fDur}); return; }
      if(!fp){ askProject({kind:"fill", dur:fDur}, projectFromNameWord(txt)); return; }
      offerFillMissing(fp.p, fDur);
      return;
    }
    var ta = botParseTeamAllowance(txt, teamMembers);
    var tp = ta ? null : botParseTeamHours(txt, teamMembers);
    if((ta || tp) && state.role !== "pm"){ botSay("bot", t("bot_team_only_pm")); botChips([t("chip_help")]); return; }
    if(ta){ offerTeamAllowance(ta.members, ta.days, ta.code, ta.qty, ta.note); return; }
    if(tp){ offerTeamEntry(tp.members, tp.days, tp.dur, tp.clock); return; }

    /* the person's own kilometres, with the distance worked out */
    if(KM_WORD_RE.test(foldText(txt))){ offerKm(kmDraftFromText(txt, null) || {}); return; }
    /* the person's own per diem or shift allowance */
    var oa = ownAllowanceFromText(txt);
    if(oa){ offerOwnAllowance(oa.code, oa.day, oa.qty, oa.note, oa.p); return; }

    /* a request for every working day ("8h RTL-TT all days this week"),
       checked ahead of the single-day parser since it matches a duration
       and a project too and would otherwise just default to "today" */
    if(ALL_WEEK_RE.test(low)){
      var pw = botParseWeek(txt);
      if(pw && pw.p === -1){ askProject({kind:"week", days:pw.days, dur:pw.dur, desc:pw.desc}, projectFromNameWord(txt)); return; }
      if(pw && pw.notAllowed){ sayNotAllocated(pw.p, {kind:"week", days:pw.days, dur:pw.dur, desc:pw.desc}); return; }
      if(pw){
        offerEntryWeek(pw.days, pw.dur, pw.p, pw.desc);
        chat.history.push({role:"assistant", content:"Proposed " + fmt(pw.dur) + "h/day, " + PROJECTS[pw.p].name + ", every working day this week. Waiting for confirmation."});
        return;
      }
    }

    /* time entry, reuses the same parser as quick add */
    var p = botParse(txt);
    if(!p){
      botSay("bot",t("bot_parse_failed"), null, true);
      botChips([t("chip_hours_i_have"),t("chip_my_absences"),t("chip_help")]);
      chat.history.push({role:"assistant", content:"Couldn't parse a duration and project from that message."});
      return;
    }
    if(p.day === -1){ botSay("bot", t("bot_day_outside_week")); botChips([t("chip_hours_i_have"), t("chip_help")]); return; }
    if(p.p === -1){ askProject({kind:"entry", day:p.day, dur:p.dur, desc:p.desc}, projectFromNameWord(txt)); return; }
    if(p.notAllowed){ sayNotAllocated(p.p, {kind:"entry", day:p.day, dur:p.dur, desc:p.desc}); return; }
    offerEntry(p.day, p.dur, p.p, p.desc);
    chat.history.push({role:"assistant", content:"Proposed an entry: " + fmt(p.dur) + "h, " + PROJECTS[p.p].name + ", " + DAYS[p.day] + ". Waiting for confirmation."});
  }

  /* Weekday names and "yesterday"/"today" only cover a relative reading of
     the visible week. A calendar date ("September 15", "15 Sep", "15/09")
     needs to be matched against WORKDATES instead. Returns the day index if
     the date falls in the visible week, -1 if it's a real date outside it,
     or null if nothing date-shaped was found at all. */
  var MONTHS_NLP = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  /* Finds the WORKDATES index whose day-of-month matches dd, and whose
     month matches mm when mm is given; -1 when nothing in the visible week
     fits. parseDateMention, resolveDayArg and matchDaysMention each used
     to run this same loop with their own slightly different copy. */
  function workdateIndexFor(dd, mm){
    for(var i=0; i<WORKDATES.length; i++){
      if(+WORKDATES[i].slice(6,8) === dd && (mm == null || +WORKDATES[i].slice(4,6) === mm)) return i;
    }
    return -1;
  }
  function parseDateMention(rest){
    var m, dd, mm;
    if((m = rest.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/))){ dd = +m[1]; mm = +m[2]; }
    else if((m = rest.match(new RegExp("\\b("+MONTHS_NLP.join("|")+")\\s+(\\d{1,2})\\b","i")))){ mm = MONTHS_NLP.indexOf(m[1].toLowerCase())+1; dd = +m[2]; }
    else if((m = rest.match(new RegExp("\\b(\\d{1,2})\\s+("+MONTHS_NLP.join("|")+")\\b","i")))){ dd = +m[1]; mm = MONTHS_NLP.indexOf(m[2].toLowerCase())+1; }
    else return null;
    return {day: workdateIndexFor(dd, mm), match:m[0]};
  }

  /* Resolves a day argument coming back from Claude's tool call, which isn't
     always the clean YYYY-MM-DD the tool schema asks for (a bare "15", a
     "2026-9-15" with unpadded month, "15/09"). Tries, in order: exact ISO
     match against WORKDATES, a calendar-date mention via parseDateMention,
     then a bare day-of-month number against the visible week. Returns -1
     when nothing in the visible week matches. */
  function resolveDayArg(dia){
    var s = String(dia == null ? "" : dia).trim();
    if(!s) return -1;
    var digits = s.replace(/[-\/]/g,"");
    var idx = WORKDATES.indexOf(digits);
    if(idx !== -1) return idx;
    var dm = parseDateMention(" " + s + " ");
    if(dm && dm.day !== -1) return dm.day;
    var bare = s.match(/^(\d{1,2})$/);
    if(bare) return workdateIndexFor(+bare[1]);
    return -1;
  }

  /* Duration token: "8h", "8 hours", "1:30", "90m" or a bare number, matched
     as a WHOLE token so nothing leaks into the description afterwards — the
     bare "h" pattern used to match only "8 h" out of "8 hours" and leave
     "ours" behind in the text. */
  function matchDuration(rest){
    var m;
    if((m = rest.match(/(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?|oras?|eures?)?\b/i))) return {dur:parseDur(m[1]), match:m[0]};
    if((m = rest.match(/(\d{1,2}):(\d{2})\b/))) return {dur:parseDur(m[0]), match:m[0]};
    if((m = rest.match(/(\d+)\s*m(?:in(?:ute)?s?)?\b/i))) return {dur:parseDur(m[1]+"m"), match:m[0]};
    if((m = rest.match(/\s(\d+(?:[.,]\d+)?)\s/))) return {dur:parseDur(m[1]), match:m[0]};
    return null;
  }
  /* Project code, plus any WBS suffix attached to it ("RTL-TT.2.1"), so that
     doesn't leak into the description either. */
  /* A project code in the message, read against the person's own
     projects first: PT01's AER is AER-WFM, not PT02's AER-FAC. A code
     that only exists outside their projects comes back marked notAllowed,
     so the assistant says so instead of booking hours there. */
  function matchProject(rest){
    var allowed = profileProjects(), full = null, mine = null, other = null;
    PROJECTS.forEach(function(pr,i){
      var mf = rest.match(new RegExp("\\b" + pr.code.replace(/-/g, "\\-") + "[\\w.\\-]*", "i"));
      if(mf && !full) full = {p:i, match:mf[0]};
      var m = rest.match(new RegExp("\\b"+pr.code.split("-")[0]+"[\\w.\\-]*","i"));
      if(!m) return;
      if(allowed.indexOf(i) !== -1){ if(!mine) mine = {p:i, match:m[0]}; }
      else if(!other) other = {p:i, match:m[0]};
    });
    var hit = full || mine || other;
    if(hit && allowed.indexOf(hit.p) === -1) hit.notAllowed = true;
    return hit;
  }
  /* A word of a project's name ("payroll", "retail") that belongs to only
     one of the person's projects: a hint for which one to offer first,
     never a reason to book it without asking. */
  function projectFromNameWord(txt){
    var allowed = profileProjects(), f = foldText(txt), hits = [];
    allowed.forEach(function(i){
      var words = foldText(PROJECTS[i].name).split(/[^a-z]+/).filter(function(w){ return w.length >= 5; });
      if(words.some(function(w){ return new RegExp("\\b" + w + "\\b").test(f); })) hits.push(i);
    });
    return hits.length === 1 ? hits[0] : -1;
  }
  /* The person's projects for a question, the likeliest first: the hinted
     one, then by hours already recorded this week. */
  function projectChoices(prefer){
    var hours = {};
    state.rows.forEach(function(r){ hours[r.p] = (hours[r.p] || 0) + r.h.reduce(function(a, b){ return a + b; }, 0); });
    return profileProjects().slice().sort(function(a, b){
      return ((b === prefer) - (a === prefer)) || ((hours[b] || 0) - (hours[a] || 0));
    });
  }
  function projectChip(i){ return PROJECTS[i].code + " · " + PROJECTS[i].name; }
  /* Hours never go to a project the person didn't name: with a duration
     and a day but no project, the assistant asks, with their projects as
     the answers, and keeps the rest so one click completes the entry. */
  function askProject(draft, prefer, msg){
    if(!profileProjects().length){ botSay("bot", t("bot_km_not_in_profile")); botChips([t("chip_help")]); return; }
    chat.projectDraft = draft;
    var when = draft.kind === "week" ? t("text_every_weekday") : draft.kind === "fill" ? t("text_days_missing") : DAYS[draft.day];
    botSay("bot", msg || (draft.kind === "fill" ? t("bot_which_project_fill") : t("bot_which_project_for", {dur: fmt(draft.dur), when: when})));
    botChips(projectChoices(prefer).map(projectChip));
  }
  function sayNotAllocated(pIdx, draft){
    chat.projectDraft = draft || null;
    botSay("bot", t("bot_project_not_allocated", {code: PROJECTS[pIdx].code, list: profileProjects().map(function(i){ return PROJECTS[i].code; }).join(", ")}));
    botChips(draft ? projectChoices(-1).map(projectChip) : [t("chip_help")]);
  }
  function runProjectDraft(d, pIdx){
    chat.projectDraft = null;
    if(d.kind === "week") offerEntryWeek(d.days, d.dur, pIdx, d.desc || "");
    else if(d.kind === "fill") offerFillMissing(pIdx, d.dur || 0);
    else offerEntry(d.day, d.dur, pIdx, d.desc || "");
  }
  /* The answer to "which project?": a code, or a chip. */
  function continueProjectDraft(txt){
    /* a message with its own duration is a new request, not the answer */
    if(/\d\s*(h|horas?|hours?|hrs?|heures?|m|min)\b|\d:\d\d/i.test(txt)) return false;
    var pm = matchProject(" " + txt + " ");
    if(!pm) return false;
    if(pm.notAllowed){ sayNotAllocated(pm.p, chat.projectDraft); return true; }
    runProjectDraft(chat.projectDraft, pm.p);
    return true;
  }
  /* Claude's project must be one of the person's, and one they named in
     the last few messages; one picked for them is asked about instead. */
  function projectMentioned(pIdx){
    var said = chat.history.filter(function(h){ return h.role === "user"; }).slice(-3).map(function(h){ return h.content; }).join(" ");
    var pm = matchProject(" " + said + " ");
    if(pm && pm.p === pIdx) return true;
    var f = foldText(said);
    if(new RegExp("\\b" + foldText(PROJECTS[pIdx].code.split("-")[0]) + "\\b").test(f)) return true;
    return projectFromNameWord(said) === pIdx;
  }
  function checkProjectArg(pIdx, draft, texto){
    var allowed = profileProjects();
    if(pIdx !== -1 && allowed.indexOf(pIdx) === -1){ sayNotAllocated(pIdx, draft); return false; }
    if(pIdx === -1){ askProject(draft, -1, texto || null); return false; }
    if(allowed.length > 1 && !projectMentioned(pIdx)){ askProject(draft, pIdx); return false; }
    return true;
  }
  var ALL_WEEK_RE = /\ball\s+days?\b|\bevery\s+day\b|\beach\s+day\b|\ball\s+week\b|\bwhole\s+week\b|\bfor\s+the\s+week\b|\btodos\s+os\s+dias\b|\b(?:a\s+|esta\s+)?semana\s+toda\b|\btoda\s+a\s+semana\b|\btous\s+les\s+jours\b|\btoute\s+la\s+semaine\b/i;

  /* Weekday token, "yesterday"/"today", or a calendar date, whichever is
     found first. Returns null (no mention at all, caller keeps its own
     default) or {day, match}, where day is -1 for a real date outside the
     visible week, a signal the caller should treat as "can't place this". */
  var DAY_WORDS_NLP = [
    {re:/\b(anteontem|avant-hier)\b|\bday before yesterday\b/i, off:-2},
    {re:/\b(yesterday|ontem|hier)\b/i, off:-1},
    {re:/\b(today|hoje)\b|aujourd'hui/i, off:0}
  ];
  var WEEKDAYS_NLP = [
    /\b(monday|segunda(?:-feira)?|lundi)\b/i, /\b(tuesday|ter[çc]a(?:-feira)?|mardi)\b/i, /\b(wednesday|quarta(?:-feira)?|mercredi)\b/i,
    /\b(thursday|quinta(?:-feira)?|jeudi)\b/i, /\b(friday|sexta(?:-feira)?|vendredi)\b/i, /\b(saturday|s[áa]bado|samedi)\b/i, /\b(sunday|domingo|dimanche)\b/i
  ];
  /* where "today" sits in the visible week, or Monday when it's elsewhere */
  function todayDayIdx(){ var i = WORKDATES.indexOf(todayISO()); return i === -1 ? 0 : i; }
  function matchDayMention(rest){
    var m, i;
    for(i=0; i<DAY_WORDS_NLP.length; i++){
      if((m = rest.match(DAY_WORDS_NLP[i].re))) return {day:WORKDATES.indexOf(isoAdd(todayISO(), DAY_WORDS_NLP[i].off)), match:m[0]};
    }
    for(i=0; i<WEEKDAYS_NLP.length; i++){
      if((m = rest.match(WEEKDAYS_NLP[i]))) return {day:i, match:m[0]};
    }
    var dmDate = parseDateMention(rest);
    if(dmDate) return dmDate;
    return null;
  }

  /* assistant parser: duration, day and project */
  function botParse(txt){
    var rest = " " + txt + " ";
    var dm = matchDuration(rest);
    if(!dm || dm.dur <= 0) return null;
    rest = rest.replace(dm.match," ");
    /* an explicit "2h", "1:30" or "90m", not just any number in the text */
    var explicit = /[hm:]/i.test(dm.match);

    var day = todayDayIdx();
    var dayM = matchDayMention(rest);
    if(dayM){
      if(dayM.day === -1) return null;
      day = dayM.day;
      rest = rest.replace(dayM.match," ");
    }
    var pm = matchProject(rest);
    if(!pm) return explicit ? {dur:round15(dm.dur), day:day, p:-1, desc:rest.replace(/\s+/g," ").trim()} : null;
    rest = rest.replace(pm.match," ");
    return {dur:round15(dm.dur), day:day, p:pm.p, notAllowed:!!pm.notAllowed, desc:rest.replace(/\s+/g," ").trim()};
  }

  /* "log 8h for João today" / "record 4h for everyone tomorrow": a mass
     entry made through the assistant instead of the Team screen's own
     form. Only fires when a colleague's name or "everyone"/"the team" is
     explicitly present, so a normal self-entry never gets misread as one. */
  function matchTeamTargets(rest, members){
    var m = rest.match(/\bfor\s+(everyone|the\s+whole\s+team|the\s+team|all)\b/i);
    if(m) return {list:members, match:m[0]};
    for(var i=0; i<members.length; i++){
      var first = members[i].name.split(" ")[0];
      var re = new RegExp("\\bfor\\s+(the\\s+)?"+first+"\\b","i");
      if((m = rest.match(re))) return {list:[members[i]], match:m[0]};
    }
    return null;
  }
  /* "from 08:00 till 14:00" / "08:00 to 14h00": a clock window, for
     Z_BSRV people, read before falling back to a plain duration so it
     isn't misread as one (a bare "08:00" would otherwise parse as an
     8-hour duration through matchDuration's H:MM pattern). */
  function matchClockRange(rest){
    var m = rest.match(/\bfrom\s+(\d{1,2}(?:[:.h]\d{2})?)\s*(?:to|till|until|-|–)\s*(\d{1,2}(?:[:.h]\d{2})?)\b/i);
    if(!m) return null;
    var b = parseClock(m[1]), e = parseClock(m[2]);
    if(b === null || e === null || isNaN(b) || isNaN(e)) return null;
    return {b:b, e:e, match:m[0]};
  }

  /* "September 16, 17 and 18" / "Monday, Tuesday and Wednesday": more than
     one day in the same request. Falls back to matchDayMention (single
     day, or today by default) when no list is found. */
  function matchDaysMention(rest){
    var monthListRe = new RegExp("\\b("+MONTHS_NLP.join("|")+")\\s+(\\d{1,2}(?:\\s*(?:,|and)\\s*\\d{1,2})*)\\b","i");
    var mm = rest.match(monthListRe);
    if(mm){
      var month = MONTHS_NLP.indexOf(mm[1].toLowerCase())+1;
      var nums = mm[2].match(/\d{1,2}/g).map(Number);
      var days = [];
      nums.forEach(function(dd){
        var i = workdateIndexFor(dd, month);
        if(i !== -1) days.push(i);
      });
      if(days.length) return {days:days};
    }
    var names = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    var found = [];
    names.forEach(function(n,i){
      var re = new RegExp("\\b"+n+"\\b","gi"), m2;
      while((m2 = re.exec(rest))) found.push({i:i, idx:m2.index});
    });
    if(found.length){
      found.sort(function(a,b){ return a.idx - b.idx; });
      var seen = {}, days2 = [];
      found.forEach(function(f){ if(!seen[f.i]){ seen[f.i] = true; days2.push(f.i); } });
      return {days:days2};
    }
    var single = matchDayMention(rest);
    if(single) return single.day === -1 ? {invalid:true} : {days:[single.day]};
    return null;
  }

  function botParseTeamHours(txt, members){
    var rest = " " + txt + " ";
    var clock = matchClockRange(rest);
    var dm = null;
    if(clock){ rest = rest.replace(clock.match," "); }
    else {
      dm = matchDuration(rest);
      if(!dm || dm.dur <= 0) return null;
      rest = rest.replace(dm.match," ");
    }

    var tgt = matchTeamTargets(rest, members);
    if(!tgt) return null;
    rest = rest.replace(tgt.match," ");

    var dmn = matchDaysMention(rest);
    if(dmn && dmn.invalid) return null;
    var days = dmn ? dmn.days : [2];
    return {members:tgt.list, days:days, dur: clock ? null : round15(dm.dur), clock:clock};
  }

  /* Drives the same form the Team screen's "Fill several people at once"
     panel uses (project, duration or start/end, day checkboxes, then
     Apply and Save), so a chat-staged entry goes through exactly the same
     validation as a manually staged one, mixed clock/duration teams and
     absences/closed periods included, instead of a second copy of that
     logic that could drift from the real one. */
  function offerTeamEntry(members, days, dur, clock){
    var pIdx = massProject();
    var pr = PROJECTS[pIdx];
    var locked = members.filter(function(m){ return m.locked; });
    var selected = members.filter(function(m){ return !m.locked; });
    if(!selected.length){
      botSay("bot",t("bot_cant_stage", {list: locked.map(function(m){ return t("bot_week_already_approved", {name: m.name.split(" ")[0]}); }).join(", ")}));
      botChips([t("chip_hours_i_have"),t("chip_help")]);
      return;
    }
    var dayLabel = days.map(function(d){ return DAYS[d]; }).join(", ");
    var amountLabel = clock ? (fmtClock(clock.b) + "–" + fmtClock(clock.e)) : (fmt(dur) + " h");
    var lines = [
      [t("label_people"), selected.map(function(m){ return m.name; }).join(", ")],
      [t("label_days"), dayLabel],
      [clock ? t("label_time") : t("label_duration_each"), amountLabel],
      [t("label_project"), pr.name],
      [t("label_week_card"), teamWeekLabel(true)]
    ];
    if(locked.length) lines.push([t("label_skipped"), locked.map(function(m){ return t("bot_week_already_approved", {name: m.name.split(" ")[0]}); }).join(", ")]);
    botSay("bot",t("bot_confirm_register_staging"), botCard(lines, t("btn_register"), function(){
      teamOf(state.leader).forEach(function(m){ stagedOf(m.pernr).sel = false; });
      selected.forEach(function(m){ stagedOf(m.pernr).sel = true; });
      if($("mDur")) $("mDur").value = clock ? "" : String(dur);
      if($("mBeg")) $("mBeg").value = clock ? fmtClock(clock.b) : "";
      if($("mEnd")) $("mEnd").value = clock ? fmtClock(clock.e) : "";
      Array.prototype.forEach.call(document.querySelectorAll(".mHoursDays input"), function(c){
        c.checked = days.indexOf(+c.value) !== -1;
      });
      var beforeLog = state.massLog.length;
      applyMass();
      saveMass(selected.map(function(m){ return m.pernr; }));
      /* Team entry opens on what was just recorded */
      setTeamTab("hours");
      var savedPernrs = {};
      state.massLog.slice(beforeLog).forEach(function(e){ savedPernrs[e.pernr] = true; });
      var saved = selected.filter(function(m){ return savedPernrs[m.pernr]; }).map(function(m){ return m.name.split(" ")[0]; });
      var notSaved = selected.filter(function(m){ return !savedPernrs[m.pernr]; }).map(function(m){ return m.name.split(" ")[0]; });
      var msg = saved.length
        ? t("bot_staged_saved", {names: saved.join(", "), days: dayLabel, code: pr.code, week: teamWeekLabel()})
        : t("bot_staged_nothing");
      if(notSaved.length) msg += t("bot_staged_not_saved_suffix", {names: notSaved.join(", "), code: pr.code});
      botSay("bot", msg);
      botChips([t("chip_hours_i_have"),t("chip_help")]);
    }));
    chat.history.push({role:"assistant", content:"Proposed " + amountLabel + " on " + dayLabel + " for " + selected.map(function(m){return m.name;}).join(", ") + ". Waiting for confirmation."});
  }

  /* "a per diem for João today" / "2 km for everyone Mon and Tue": the same
     mass-entry idea as offerTeamEntry, but for allowances, driving the Team
     screen's own Allowances form (#mAllowCode/#mAllowQty/#mAllowNote/
     .mAllowDays) and its real applyMassAllow()/saveMassAllow(), so mixed
     companies, missing required notes and closed periods are handled the
     same way a person clicking through the screen would hit them. */
  var ALLOWANCE_TYPES = [
    {code:"AJC_INT", re:/\bforeign\s*per\s*diem\b/i},
    {code:"AJC_NAC", re:/\bper\s*diem\b|\bdaily\s*allowance\b/i},
    {code:"KMS", re:/\bkil?ometh?res?\b|\bkilometers?\b|\bkms?\b|\bmileage\b/i},
    {code:"TURNO", re:/\bshift\s*allowance\b|\bshift\b/i}
  ];
  function matchAllowanceType(rest){
    for(var i=0; i<ALLOWANCE_TYPES.length; i++){
      var m = rest.match(ALLOWANCE_TYPES[i].re);
      if(m) return {code:ALLOWANCE_TYPES[i].code, match:m[0]};
    }
    return null;
  }
  function matchQty(rest){
    var m;
    if((m = rest.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kilometres?|kilometers?)\b/i))) return {qty:parseDur(m[1]), match:m[0]};
    if((m = rest.match(/(\d+(?:[.,]\d+)?)\s*days?\b/i))) return {qty:parseDur(m[1]), match:m[0]};
    if((m = rest.match(/\s(\d+(?:[.,]\d+)?)\s/))) return {qty:parseDur(m[1]), match:m[0]};
    return null;
  }
  function botParseTeamAllowance(txt, members){
    var rest = " " + txt + " ";
    var typ = matchAllowanceType(rest);
    if(!typ) return null;
    rest = rest.replace(typ.match," ");

    var tgt = matchTeamTargets(rest, members);
    if(!tgt) return null;
    rest = rest.replace(tgt.match," ");

    var qm = matchQty(rest);
    var qty = qm ? round15(qm.qty) : 1;
    if(qm) rest = rest.replace(qm.match," ");

    var dmn = matchDaysMention(rest);
    if(dmn && dmn.invalid) return null;
    var days = dmn ? dmn.days : [2];

    /* Whatever's left after type/target/qty could be a real note (KMS's
       "Lisbon to Porto", AJC_INT's country) or just filler ("log", "today",
       a leftover weekday) the day parsing above didn't consume since, unlike
       the other matchers, matchDaysMention doesn't report back what it
       matched. Strip the usual filler so a bare "log today" doesn't get
       mistaken for a genuine note and skip the required-field check below. */
    var weekdayNames = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
    var note = rest
      .replace(/\b(log|record|add|please|stage|enter|on|this|the)\b/gi," ")
      .replace(/\b(today|yesterday)\b/gi," ")
      .replace(new RegExp("\\b("+weekdayNames.join("|")+")\\b","gi")," ")
      .replace(new RegExp("\\b("+MONTHS_NLP.join("|")+")\\b","gi")," ")
      .replace(/\b\d{1,2}\b/g," ")
      .replace(/^[\s,]+|[\s,]+$/g,"")
      .replace(/\s+/g," ")
      .trim();

    return {members:tgt.list, days:days, code:typ.code, qty:qty, note:note};
  }
  function offerTeamAllowance(members, days, code, qty, note){
    var w = wt(code);
    var locked = members.filter(function(m){ return m.locked; });
    var selected = members.filter(function(m){ return !m.locked; });
    if(!selected.length){
      botSay("bot",t("bot_cant_stage", {list: locked.map(function(m){ return t("bot_week_already_approved", {name: m.name.split(" ")[0]}); }).join(", ")}));
      botChips([t("chip_help")]);
      return;
    }
    if(w.noteLabel && !note){
      botSay("bot", t("bot_note_required", {noteLabel: w.noteLabel, name: wtName(w)}));
      botChips([t("chip_help")]);
      return;
    }
    var dayLabel = days.map(function(d){ return DAYS[d]; }).join(", ");
    var lines = [
      [t("label_people"), selected.map(function(m){ return m.name; }).join(", ")],
      [t("label_days"), dayLabel],
      [t("label_wage_type"), wtName(w)],
      [t("label_quantity_each"), fmt(qty) + " " + w.unit]
    ];
    if(note) lines.push([w.noteLabel || t("label_note"), note]);
    if(locked.length) lines.push([t("label_skipped"), locked.map(function(m){ return t("bot_week_already_approved", {name: m.name.split(" ")[0]}); }).join(", ")]);
    botSay("bot",t("bot_confirm_register_staging"), botCard(lines, t("btn_register"), function(){
      teamOf(state.leader).forEach(function(m){ stagedOf(m.pernr).sel = false; });
      selected.forEach(function(m){ stagedOf(m.pernr).sel = true; });
      if($("mAllowCode")){ $("mAllowCode").value = code; syncMassAllowForm(); }
      if($("mAllowQty")) $("mAllowQty").value = String(qty);
      if($("mAllowNote")) $("mAllowNote").value = note || "";
      Array.prototype.forEach.call(document.querySelectorAll(".mAllowDays input"), function(c){
        c.checked = days.indexOf(+c.value) !== -1;
      });
      var beforeLog = state.massLog.length;
      applyMassAllow();
      saveMassAllow(selected.map(function(m){ return m.pernr; }));
      setTeamTab("allow");
      var savedPernrs = {};
      state.massLog.slice(beforeLog).forEach(function(e){ savedPernrs[e.pernr] = true; });
      var saved = selected.filter(function(m){ return savedPernrs[m.pernr]; }).map(function(m){ return m.name.split(" ")[0]; });
      var notSaved = selected.filter(function(m){ return !savedPernrs[m.pernr]; }).map(function(m){ return m.name.split(" ")[0]; });
      var msg = saved.length
        ? t("bot_staged_saved_allow", {names: saved.join(", "), days: dayLabel, name: wtName(w), week: teamWeekLabel()})
        : t("bot_staged_nothing");
      if(notSaved.length) msg += t("bot_staged_not_saved_allow_suffix", {names: notSaved.join(", "), code: PROJECTS[massProject()].code});
      botSay("bot", msg);
      botChips([t("chip_hours_i_have"),t("chip_help")]);
    }));
    chat.history.push({role:"assistant", content:"Proposed " + fmt(qty) + " " + w.unit + " " + w.name + " on " + dayLabel + " for " + selected.map(function(m){return m.name;}).join(", ") + ". Waiting for confirmation."});
  }

  /* "fill in whoever's missing hours" / "complete the team's week": unlike
     every other mass entry, this one can't share a single day set across
     everyone, since each person's gaps are their own. Computes
     missingWeekdaysFor()/teamGapFor() per person, so someone on Tue and
     Wed alone doesn't also get filled on Thu just because a teammate was
     free then, and each day is topped up to that person's own capacity
     rather than always the same flat amount. dur, when given, caps how
     much gets added to any one day instead of always closing the whole
     gap - never more than what's actually left, same hard rule as
     everywhere else. */
  function offerFillMissingTeam(pessoaArg, dur){
    var members = teamOf(state.leader).filter(function(m){ return !m.locked; });
    var name = String(pessoaArg || "").trim().toLowerCase();
    var matched = name ? members.filter(function(m){ return m.name.toLowerCase().indexOf(name) !== -1; }) : members;
    var plan = matched.map(function(m){
      var days = missingWeekdaysFor(m).map(function(d){
        var gap = teamGapFor(m, d);
        return {day:d, add: dur ? Math.min(dur, gap) : gap};
      });
      return {member:m, days:days};
    }).filter(function(p){ return p.days.length; });
    if(!plan.length){
      var msg;
      if(!name) msg = t("bot_team_nobody_missing", {code: PROJECTS[massProject()].code});
      else if(matched.length) msg = t("bot_team_already_full", {names: matched.map(function(m){ return m.name; }).join(", "), code: PROJECTS[massProject()].code});
      else msg = t("bot_team_person_not_found", {name: pessoaArg, code: PROJECTS[massProject()].code});
      botSay("bot", msg);
      botChips([t("chip_help")]);
      return;
    }
    var lines = plan.map(function(p){
      /* a reduced schedule is said, so a day filled to 6 h reads as complete */
      var cap = teamDailyCap(p.member);
      return [p.member.name + (cap !== DAYCAP ? " (" + t("text_schedule_h_day", {h: fmt(cap)}) + ")" : ""), p.days.map(function(x){ return DAYS[x.day] + " +" + fmt(x.add) + "h"; }).join(", ")];
    });
    lines.push([t("label_project"), PROJECTS[massProject()].code]);
    lines.push([t("label_week_card"), teamWeekLabel(true)]);
    var total = plan.reduce(function(a,p){ return a + p.days.reduce(function(b,x){ return b+x.add; }, 0); }, 0);
    lines.push([t("th_total"), fmt(total) + " h"]);
    botSay("bot", t("bot_confirm_fill_team"), botCard(lines, t("btn_fill_and_register"), function(){
      teamOf(state.leader).forEach(function(m){ stagedOf(m.pernr).sel = false; });
      plan.forEach(function(p){
        var st = stagedOf(p.member.pernr);
        st.sel = true;
        var clock = profileFor(WORKDATES[0], p.member.bukrs).clock;
        p.days.forEach(function(x){
          var newTotal = (st.h[x.day] || 0) + x.add;
          if(clock){
            /* the missing hours go after what the day already holds, never
               on top of it: a window that starts where the last one ended */
            var startMin = dayEndMin(p.member, x.day);
            var win = {b:startMin, e:startMin + x.add*60 + LUNCH_MIN};
            st.t[x.day] = win; st.h[x.day] = slotHours(win);
          } else {
            st.t[x.day] = null; st.h[x.day] = newTotal;
          }
        });
      });
      var beforeLog = state.massLog.length;
      saveMass(plan.map(function(p){ return p.member.pernr; }));
      setTeamTab("hours");
      var savedPernrs = {};
      state.massLog.slice(beforeLog).forEach(function(e){ savedPernrs[e.pernr] = true; });
      var saved = plan.filter(function(p){ return savedPernrs[p.member.pernr]; }).map(function(p){ return p.member.name.split(" ")[0]; });
      var notSaved = plan.filter(function(p){ return !savedPernrs[p.member.pernr]; }).map(function(p){ return p.member.name.split(" ")[0]; });
      var msg = saved.length
        ? t("bot_team_filled_saved", {names: saved.join(", "), week: teamWeekLabel()})
        : t("bot_team_filled_nothing");
      if(notSaved.length) msg += t("bot_team_filled_not_saved_suffix", {names: notSaved.join(", ")});
      botSay("bot", msg);
      botChips([t("chip_help")]);
    }));
    chat.history.push({role:"assistant", content:"Proposto preencher " + fmt(total) + "h em dias em falta para " + plan.map(function(p){return p.member.name;}).join(", ") + ". Aguardando confirmação."});
  }

  /* "approve João" / "approve everyone": mirrors exactly what the Approval
     screen's own checkboxes + Approve button do, never more, so an
     exception still can't be bulk-approved through the assistant either. */
  function matchApprovalTargets(txt){
    var t = txt.toLowerCase();
    if(/\b(everyone|the\s+whole\s+team|the\s+team|all|todos|todas|toda\s+a\s+equipa|tous|toutes)\b/.test(t)) return {all:true};
    var found = null;
    tsQueue().forEach(function(a){
      if(t.indexOf(a.who.split(" ")[0].toLowerCase()) !== -1) found = a;
    });
    return found ? {one:found} : null;
  }
  function handleApprovalRequest(txt){
    if(state.role !== "pm"){
      botSay("bot", t("bot_ts_only_pm"));
      botChips([t("chip_help")]);
      return;
    }
    var tgt = matchApprovalTargets(txt);
    if(!tgt){
      botSay("bot",t("bot_approval_ask_who"));
      botChips([t("chip_help")]);
      return;
    }
    if(tgt.all){
      var clean = tsQueue().filter(function(a){ return !a.warn && !a.approved; });
      if(!clean.length){
        botSay("bot",t("bot_approval_nothing"));
        return;
      }
      botSay("bot",t("bot_confirm_approve_all", {n: clean.length}), botCard(
        clean.map(function(a){ return [a.who, fmt(a.tot) + " h"]; }),
        t("btn_approve_all"), function(){
          clean.forEach(function(a){ a.approved = true; a.sel = false; });
          renderApprovals();
          botSay("bot", t("bot_approved_all_msg", {n: clean.length}));
          botChips([t("chip_help")]);
        }
      ));
      return;
    }
    var a = tgt.one;
    if(a.approved){ botSay("bot", t("bot_already_approved", {name: a.who})); return; }
    if(a.warn){
      botSay("bot", t("bot_has_exception", {name: a.who, note: a.note}));
      return;
    }
    botSay("bot",t("bot_confirm_approve_one", {name: a.who}), botCard([
      [t("label_project"), a.proj], [t("th_total"), fmt(a.tot) + " h"], [t("label_in_project"), fmt(a.inproj) + " h"]
    ], t("btn_approve"), function(){
      a.approved = true; a.sel = false;
      renderApprovals();
      botSay("bot", t("bot_approved_one_msg", {name: a.who}));
      botChips([t("chip_help")]);
    }));
  }

  /* Same reading as botParse, but for a request meant to repeat across every
     working day of the visible week ("8h RTL-TT all days this week"),
     instead of the one day botParse would default to. */
  function botParseWeek(txt){
    var rest = " " + txt + " ";
    var dm = matchDuration(rest);
    if(!dm || dm.dur <= 0) return null;
    rest = rest.replace(dm.match," ").replace(ALL_WEEK_RE," ").replace(/\bthis\s+week\b|\bthe\s+week\b|\besta\s+semana\b|\bcette\s+semaine\b/gi," ");
    var pm = matchProject(rest);
    if(!pm) return {dur:round15(dm.dur), days:[0,1,2,3,4], p:-1, desc:rest.replace(/\s+/g," ").trim()};
    rest = rest.replace(pm.match," ");
    return {dur:round15(dm.dur), days:[0,1,2,3,4], p:pm.p, notAllowed:!!pm.notAllowed, desc:rest.replace(/\s+/g," ").trim()};
  }

  /* A card is already open for chat.draft: read this message for just the
     part that changes (a different day, duration or project), and keep the
     rest of the draft as it was, instead of demanding the whole sentence
     again. Returns null if nothing recognizable was found, so the caller can
     fall through to every other interpretation. Duration deliberately skips
     the bare-number fallback matchDuration has for a fresh request: on a
     short correction like "actually September 16", that fallback would
     misread the "16" as a duration instead of leaving it to the date match. */
  function tryCorrectDraft(txt){
    var rest = " " + txt + " ", m;
    var draft = chat.draft, day = draft.day, dur = draft.dur, pIdx = draft.p, changed = false;
    /* "every day this week" is a new request for the week, not a correction */
    if(ALL_WEEK_RE.test(rest)) return null;

    var dmn = matchDayMention(rest);
    if(dmn && dmn.day !== -1){ day = dmn.day; changed = true; rest = rest.replace(dmn.match," "); }

    if((m = rest.match(/(\d+(?:[.,]\d+)?)\s*h(?:ours?|rs?|oras?|eures?)?\b/i))){ dur = parseDur(m[1]); changed = true; }
    else if((m = rest.match(/(\d{1,2}):(\d{2})\b/))){ dur = parseDur(m[0]); changed = true; }
    else if((m = rest.match(/(\d+)\s*m(?:in(?:ute)?s?)?\b/i))){ dur = parseDur(m[1]+"m"); changed = true; }

    var pm = matchProject(rest);
    if(pm && pm.notAllowed){ sayNotAllocated(pm.p, {kind:"entry", day:day, dur:round15(dur), desc:draft.desc}); return {handled:true}; }
    if(pm){ pIdx = pm.p; changed = true; }

    if(!changed) return null;
    return {day:day, dur:round15(dur), p:pIdx, desc:draft.desc};
  }

  $("jouleFab").onclick = function(){ showScreen("home"); };
  $("jClose").onclick = function(){ botToggle(false); };
  $("jform").onsubmit = function(ev){
    ev.preventDefault();
    if(chat.busy) return;
    var v = $("jinput").value.trim();
    if(!v) return;
    $("jinput").value = "";
    voice.speakReply = voice.usedVoice;
    voice.usedVoice = false;
    chat.busy = true;
    $("jinput").disabled = true;
    if($("jsend")) $("jsend").disabled = true;
    botHandle(v).finally(function(){
      voice.speakReply = false;
      chat.busy = false;
      $("jinput").disabled = false;
      if($("jsend")) $("jsend").disabled = false;
      $("jinput").focus();
    });
  };

  (function setupVoiceInput(){
    var micBtn = $("jMic"), langBtn = $("jMicLang");
    if(!micBtn || !langBtn) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    /* Inside the claude.ai viewer the page runs in a frame without the
       microphone, so the browser's dictation can't start there. The
       button then says why and points to the system's own dictation,
       which types straight into the box and works anywhere. */
    function micAllowed(){
      try{ if(document.permissionsPolicy && !document.permissionsPolicy.allowsFeature("microphone")) return false; }catch(e){}
      try{ if(document.featurePolicy && !document.featurePolicy.allowsFeature("microphone")) return false; }catch(e){}
      return true;
    }
    function explainVoice(key){
      if(!chat.greeted) assistantEnsureGreeted();
      botSay("bot", t(key));
      $("jinput").focus();
    }
    syncVoiceLangBtn();
    if(!SR || !micAllowed()){
      langBtn.disabled = true;
      micBtn.title = t(SR ? "voice_blocked_short" : "voice_not_supported");
      micBtn.onclick = function(){ explainVoice(SR ? "bot_voice_blocked" : "bot_voice_unsupported"); };
      return;
    }
    function nextLang(l){ return VOICE_LANG_ORDER[(VOICE_LANG_ORDER.indexOf(l) + 1) % VOICE_LANG_ORDER.length]; }
    langBtn.onclick = function(){
      voice.lang = nextLang(voice.lang);
      syncVoiceLangBtn();
    };

    var recog = new SR();
    recog.continuous = false;
    recog.interimResults = true;
    var listening = false;

    function stopUI(){
      listening = false;
      micBtn.classList.remove("listening");
    }
    recog.onresult = function(ev){
      var text = "";
      for(var i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      $("jinput").value = text;
      voice.usedVoice = true;
    };
    recog.onerror = function(ev){
      stopUI();
      if(ev.error === "no-speech" || ev.error === "aborted") return;
      if(ev.error === "not-allowed" || ev.error === "service-not-allowed") explainVoice("bot_voice_blocked");
      else if(ev.error === "audio-capture") toast(t("voice_err_no_mic"));
      else if(ev.error === "network") explainVoice("bot_voice_network");
      else toast(t("toast_voice_error", {err: ev.error}));
    };
    recog.onend = function(){
      stopUI();
      $("jinput").focus();
    };
    $("jinput").addEventListener("input", function(){
      if(!listening) voice.usedVoice = false;
    });

    micBtn.onclick = function(){
      if(listening){ recog.stop(); return; }
      if(window.speechSynthesis) window.speechSynthesis.cancel();
      recog.lang = VOICE_LANGS[voice.lang];
      try{
        recog.start();
        listening = true;
        micBtn.classList.add("listening");
      }catch(e){ stopUI(); }
    };
  })();

  document.addEventListener("keydown", function(ev){
    /* in either row of tabs, the arrows and Home/End move along the row,
       as in any tablist, instead of changing the week */
    var tabRow = ev.target.getAttribute && ev.target.getAttribute("role") === "tab" ? ev.target.parentNode : null;
    if(tabRow && /^(ArrowLeft|ArrowRight|Home|End)$/.test(ev.key)){
      var tabs = Array.prototype.filter.call(tabRow.querySelectorAll('[role="tab"]'), function(b){ return !b.hidden; });
      var ti = tabs.indexOf(ev.target), tn = tabs.length;
      ev.preventDefault();
      if(tn) tabs[ev.key === "Home" ? 0 : ev.key === "End" ? tn - 1 : (ti + (ev.key === "ArrowRight" ? 1 : -1) + tn) % tn].focus();
      return;
    }
    var tag = (ev.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || tag === "select";
    if(ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)){ ev.preventDefault(); if(!$("submitBtn").disabled) openSubmit(); return; }
    if(typing) return;
    if(document.querySelector("dialog[open]")) return;
    if(ev.key === "j" || ev.key === "J"){ ev.preventDefault(); showScreen("home"); }
    else if(ev.key === "n" || ev.key === "N"){ ev.preventDefault(); openQuick("", 2); }
    else if((ev.key === "c" || ev.key === "C") && !isMonthly()){ ev.preventDefault(); copyWeek(); }
    else if(ev.key === "ArrowLeft"){ ev.preventDefault(); changeWeek(-1); }
    else if(ev.key === "ArrowRight"){ ev.preventDefault(); changeWeek(1); }
    else if(ev.key === "?"){ ev.preventDefault(); $("dlgHelp").showModal(); }
  });

  /* ---------- wiring: company, allowances, team ---------- */
  (function(){
    var sel = $("coSel");
    if(sel){
      sel.value = IT0001.bukrs;
      sel.onchange = function(){ switchCompany(sel.value); };
    }
    var ls = $("leadSel");
    if(ls){
      renderLeaderOptions();
      ls.onchange = function(){
        state.leader = ls.value;
        var pj = $("mProj"); if(pj) pj.dataset.for = "";
        clearMass();
      };
    }
  })();
  function setPanelOpen(panelId, togId, open){
    var p = $(panelId), tg = $(togId);
    if(!p || !tg) return;
    p.classList.toggle("collapsed", !open);
    tg.textContent = open ? "▾" : "▸";
    tg.setAttribute("aria-expanded", open ? "true" : "false");
    /* the name says what a click does next, and follows a language change */
    var ak = tg.dataset.i18nAria;
    if(ak && /^aria_(expand|collapse)_/.test(ak)){
      tg.dataset.i18nAria = ak.replace(/^aria_(expand|collapse)_/, open ? "aria_collapse_" : "aria_expand_");
      tg.setAttribute("aria-label", t(tg.dataset.i18nAria));
    }
  }
  function setTeamTab(tab){
    state.teamTab = tab;
    var panels = {hours:"hoursPanel", allow:"teamAllowPanel", bonus:"bonusPanel"};
    Object.keys(panels).forEach(function(k){
      var p = $(panels[k]);
      if(p) p.hidden = (k !== tab);
    });
    var buttons = {hours:"ttHours", allow:"ttAllow", bonus:"ttBonus"};
    Object.keys(buttons).forEach(function(k){
      var b = $(buttons[k]);
      if(b) b.setAttribute("aria-pressed", k === tab ? "true" : "false");
    });
    /* "Already recorded" switches what it shows with the active tab: the
       hours grid has nothing to say about allowances and vice versa. */
    var showAllow = tab === "allow";
    if($("alreadyHoursWrap")) $("alreadyHoursWrap").hidden = showAllow;
    if($("alreadyAllowWrap")) $("alreadyAllowWrap").hidden = !showAllow;
    if($("alreadyTitle")) $("alreadyTitle").textContent = showAllow ? t("hdr_already_allow") : t("hdr_already_recorded");
    if($("alreadyHint")) $("alreadyHint").title = showAllow ? t("hint_already_allow") : t("hint_already");
  }

  if($("allowAdd")) $("allowAdd").onclick = openAllow;
  if($("alCode")) $("alCode").onchange = syncAllowForm;
  /* a <form method="dialog">: kept open when the save is refused, as Quick add */
  if($("alSave")) $("alSave").onclick = function(ev){ if(!saveAllow()) ev.preventDefault(); };
  ["alFrom","alTo","alRound"].forEach(function(id){
    var n = $(id);
    if(n){ n.addEventListener("input", syncAllowRoute); n.addEventListener("change", syncAllowRoute); }
  });
  if($("alCancel")) $("alCancel").onclick = function(){ $("dlgAllow").close(); };
  if($("mProj")) $("mProj").onchange = renderTeam;
  if($("mApply")) $("mApply").onclick = applyMass;
  if($("mSave")) $("mSave").onclick = function(){ saveMass(); };
  if($("teamSaveAll")) $("teamSaveAll").onclick = saveTeamAll;
  if($("mClear")) $("mClear").onclick = function(){ clearMass(); toast(t("toast_staged_entries_cleared")); };
  if($("bSave")) $("bSave").onclick = saveBonus;
  if($("mAllowCode")) $("mAllowCode").onchange = syncMassAllowForm;
  if($("mAllowApply")) $("mAllowApply").onclick = applyMassAllow;
  if($("mAllowSave")) $("mAllowSave").onclick = function(){ saveMassAllow(); };
  if($("mAllowClear")) $("mAllowClear").onclick = function(){ clearMassAllow(); toast(t("toast_staged_allow_cleared")); };

  /* ---------- collapsible panels and in-screen tabs ----------
     Pure display state: which mass-entry tab is showing, and a panel's
     collapsed state, none of it part of the timesheet data, so it lives on
     state.* but never touches WEEKS. */
  if($("sugTog")) $("sugTog").onclick = function(){
    state.sugManualOpen = $("sugPanel").classList.contains("collapsed");
    setPanelOpen("sugPanel", "sugTog", state.sugManualOpen);
  };
  /* The icon alone (.pTog) was a ~24px target, easy to miss; the whole
     header now opens/closes the panel, the icon is still there as the
     visual affordance but isn't the only way in. */
  if($("alreadyHead")) $("alreadyHead").onclick = function(){
    setPanelOpen("alreadyPanel", "alreadyTog", $("alreadyPanel").classList.contains("collapsed"));
  };
  if($("allowHead")) $("allowHead").onclick = function(){
    state.allowManualOpen = $("allowPanel").classList.contains("collapsed");
    setPanelOpen("allowPanel", "allowTog", state.allowManualOpen);
  };
  /* Open by default for whoever hasn't seen it yet; remembered across
     visits (not just this session) once collapsed, since its content
     never changes and showing it again would just be in the way. */
  (function(){
    var open = true;
    try{ var v = localStorage.getItem("vesiHowOpen"); if(v !== null) open = v === "1"; }catch(e){}
    setPanelOpen("howPanel", "howTog", open);
  })();
  if($("howHead")) $("howHead").onclick = function(){
    var open = $("howPanel").classList.contains("collapsed");
    setPanelOpen("howPanel", "howTog", open);
    try{ localStorage.setItem("vesiHowOpen", open ? "1" : "0"); }catch(e){}
  };

  if($("ttHours")) $("ttHours").onclick = function(){ state.teamTab = "hours"; renderTeam(); };
  if($("ttAllow")) $("ttAllow").onclick = function(){ state.teamTab = "allow"; renderTeam(); };
  if($("ttBonus")) $("ttBonus").onclick = function(){ state.teamTab = "bonus"; renderTeam(); };

  /* ---------- wiring: Leave Request and View as ---------- */
  /* ---------- wiring: the test setup ---------- */
  if($("ctxBtn")) $("ctxBtn").onclick = openSetup;
  Array.prototype.forEach.call(document.querySelectorAll("#setupCo button"), function(b){
    b.onclick = function(){ setupDraft.co = b.dataset.co; renderSetup(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll("#setupRoles .setupcard"), function(b){
    b.onclick = function(){ setupDraft.role = b.dataset.role; renderSetup(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll("#setupLang button"), function(b){
    b.onclick = function(){ setLang(b.dataset.lang); };
  });
  if($("setupLeader")) $("setupLeader").onchange = function(){ setupDraft.leader = $("setupLeader").value; renderSetup(); };
  if($("setupGo")) $("setupGo").onclick = function(ev){
    ev.preventDefault();
    var d = setupDraft;
    $("dlgSetup").close("go");
    applyTestSetup(d.co, d.role, d.leader);
  };
  /* closed with Escape on the first open: carry on with what's on screen */
  if($("dlgSetup")) $("dlgSetup").addEventListener("close", function(){
    if(!state.setupDone) applyTestSetup(IT0001.bukrs, state.role, state.leader);
  });
  if($("lvNew")) $("lvNew").onclick = function(){ openLeaveDialog(); };
  ["lvAsOf","lvStart","lvEnd"].forEach(function(id){ enhanceDmyInput($(id)); });
  if($("lvAsOf")) $("lvAsOf").onchange = function(){
    var iso = dmyToIso($("lvAsOf").value);
    if(!iso && $("lvAsOf").value.trim()) return;
    state.lvAsOf = iso || "";
    renderAccounts();
  };
  /* outside lvAccBody, which a changed date redraws: a button drawn
     inside it was gone by the time the click that blurred the date landed */
  if($("lvMovements")) $("lvMovements").onclick = openAccountMovements;
  if($("lvCalPrev")) $("lvCalPrev").onclick = function(){ state.lvMonth = monthAdd(state.lvMonth || todayISO().slice(0,6), -1); renderMyCalendar(); };
  if($("lvCalNext")) $("lvCalNext").onclick = function(){ state.lvMonth = monthAdd(state.lvMonth || todayISO().slice(0,6), 1); renderMyCalendar(); };
  if($("lvCalToday")) $("lvCalToday").onclick = function(){ state.lvMonth = todayISO().slice(0,6); state.lvPick = null; renderMyCalendar(); };
  if($("lvShowTeam")) $("lvShowTeam").onchange = function(){ state.lvShowTeam = $("lvShowTeam").checked; renderMyCalendar(); };
  Array.prototype.forEach.call(document.querySelectorAll("#lvFilter button"), function(b){ b.onclick = function(){ state.lvFilter = b.dataset.f; renderMyLeave(); }; });
  if($("lvMassApprove")) $("lvMassApprove").onclick = approveSelectedLeave;
  if($("laApprove")) $("laApprove").onclick = approveLeaveConsole;
  if($("laSelClean")) $("laSelClean").onclick = function(){
    state.laSel = {};
    leaveQueue().forEach(function(r){ if(!leaveWarnings(r).length) state.laSel[lvSelKey(r)] = true; });
    renderLeaveApprovals();
  };
  if($("laAll")) $("laAll").onchange = function(){
    state.laSel = {};
    if($("laAll").checked) leaveQueue().forEach(function(r){ if(!leaveWarnings(r).length) state.laSel[lvSelKey(r)] = true; });
    renderLeaveApprovals();
  };
  Array.prototype.forEach.call(document.querySelectorAll("#laFilter button"), function(b){ b.onclick = function(){ state.laFilter = b.dataset.f; renderLeaveApprovals(); }; });
  if($("lvSelAll")) $("lvSelAll").onchange = function(){
    state.lvSel = {};
    if($("lvSelAll").checked) leaveQueue().forEach(function(r){ state.lvSel[lvSelKey(r)] = true; });
    renderLeaveQueue();
  };
  if($("lvTcPrev")) $("lvTcPrev").onclick = function(){ tacMove(-1); };
  if($("lvTcNext")) $("lvTcNext").onclick = function(){ tacMove(1); };
  if($("lvTcToday")) $("lvTcToday").onclick = function(){ tacMove(0); };
  Array.prototype.forEach.call(document.querySelectorAll("#lvTcView button"), function(b){ b.onclick = function(){ tacState().view = b.dataset.v; renderTeamCalendar(); }; });
  Array.prototype.forEach.call(document.querySelectorAll("#lvTcTabs button"), function(b){ b.onclick = function(){ tacState().tab = b.dataset.t; renderTeamCalendar(); }; });
  Array.prototype.forEach.call(document.querySelectorAll("#lvTcStatus button"), function(b){ b.onclick = function(){ tacState().status = b.dataset.s; renderTeamCalendar(); }; });
  if($("lvTcType")) $("lvTcType").onchange = function(){ tacState().type = $("lvTcType").value; renderTeamCalendar(); };
  if($("lvTcSearch")) $("lvTcSearch").oninput = function(){ tacState().q = $("lvTcSearch").value; renderTeamCalendar(); };
  if($("lvTcAbsent")) $("lvTcAbsent").onchange = function(){ tacState().absentOnly = $("lvTcAbsent").checked; renderTeamCalendar(); };
  if($("lvTcFull")) $("lvTcFull").onclick = function(){ var st = tacState(); st.full = !st.full; renderTeamCalendar(); };
  document.addEventListener("keydown", function(ev){ if(ev.key === "Escape" && state.tac && state.tac.full && !document.querySelector("dialog[open]")){ state.tac.full = false; renderTeamCalendar(); } });
  if($("lvAtt")) $("lvAtt").onchange = syncLeaveForm;
  ["lvType","lvStart","lvEnd","lvPartial","lvHours","lvBeg","lvFin"].forEach(function(id){
    var n = $(id);
    if(n){ n.addEventListener("input", syncLeaveForm); n.addEventListener("change", syncLeaveForm); }
  });
  if($("lvSubmit")) $("lvSubmit").onclick = function(ev){ ev.preventDefault(); submitLeaveForm(); };
  if($("lvCancel")) $("lvCancel").onclick = function(){ $("dlgLeave").close(); };
  if($("rjReason")) $("rjReason").oninput = function(){ $("rjOk").disabled = !$("rjReason").value.trim(); };
  if($("rjOk")) $("rjOk").onclick = function(ev){ ev.preventDefault(); confirmRejectLeave(); };
  if($("rjCancel")) $("rjCancel").onclick = function(){ $("dlgReject").close(); };

  /* the top bar is sticky: its height, which changes when the shell bar
     wraps or the language changes, is what sticky panels sit under */
  (function(){
    var bar = $("appbar");
    if(!bar) return;
    var nav = bar.querySelector(".nav");
    /* on a phone only the two rows of tabs stick (the wrapper has no box
       of its own), the second one right under the first */
    function measure(){
      var sub = Array.prototype.filter.call(bar.querySelectorAll(".subnav"), function(x){ return !x.hidden; })[0];
      document.documentElement.style.setProperty("--nav-h", nav.offsetHeight + "px");
      document.documentElement.style.setProperty("--appbar-h", (bar.offsetHeight || nav.offsetHeight + (sub ? sub.offsetHeight : 0)) + "px");
    }
    if(window.ResizeObserver){
      var ro = new ResizeObserver(measure); ro.observe(bar); ro.observe(nav);
      Array.prototype.forEach.call(bar.querySelectorAll(".subnav"), function(x){ ro.observe(x); });
    }
    else window.addEventListener("resize", measure);
    measure();
  })();
  applyLocaleArrays();
  applyI18n();
  renderContextButton();
  applyProfileChrome();
  render();
  /* The app opens on the assistant: the conversation is the way in, the
     screens are where the data can be checked or edited directly. The
     first thing asked is which test is being run. */
  placeAssistant("home");
  if(!setupFromUrl()) openSetup();
})();
