// src/SmartCalendar.jsx
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { gapi } from 'gapi-script';

// ------------- CONSTANTS -------------
const initialCategoryColors = {
  work: 'bg-blue-200',
  class: 'bg-orange-200',
  exercise: 'bg-green-200',
  social: 'bg-purple-200',
  personal: 'bg-yellow-200',
};
const colorOptions = [
  'bg-blue-200','bg-orange-200','bg-green-200','bg-purple-200','bg-yellow-200',
  'bg-pink-200','bg-red-200'
];
const hours         = Array.from({ length:24 },(_,i)=>i.toString().padStart(2,'0'));
const minuteOptions = ['00','15','30','45'];
const gridHours     = hours.map(h=>`${h}:00`);
const days          = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// Google OAuth info
const CLIENT_ID      = '860532901417-eos75c7iicf4n31tf4sapahjugpd7hmn.apps.googleusercontent.com';
const API_KEY        = 'AIzaSyAGM86BLqXWdSQ_iQFA5hYVNn_IcghxdzM';
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES         = "https://www.googleapis.com/auth/calendar.readonly";

// ------------- HELPERS -------------
function startOfWeek(date) {
  const d = new Date(date);
  const diff = (d.getDay()+6) % 7; // Monday=0
  d.setDate(d.getDate() - diff);
  d.setHours(0,0,0,0);
  return d;
}

function categorizeEvent(title='') {
  const t = title?.toLowerCase() || '';
  if (/(gym|run|yoga|workout|walk|lift)/.test(t)) return 'exercise';
  if (/(class|study|lecture|exam)/.test(t))     return 'class';
  if (/[A-Za-z]{3,4}\s?\d{3,5}/.test(title))    return 'class';
  if (/(meeting|work|deadline|interview|shift)/.test(t)) return 'work';
  if (/(party|dinner|hangout|brunch|lunch)/.test(t))    return 'social';
  if (/(doctor|errand|call|appointment)/.test(t))       return 'personal';
  return 'personal';
}

// Construct the Google OAuth2 redirect URL:
const buildGoogleAuthUrl = () => {
  const root = 'https://accounts.google.com/o/oauth2/v2/auth';
  const params = {
    client_id:             CLIENT_ID,
    redirect_uri:          window.location.origin,      // must match your Console origin
    response_type:         'token',
    scope:                 encodeURIComponent(SCOPES),
    include_granted_scopes:'true',
    prompt:                'consent'
  };
  const query = Object.entries(params)
    .map(([k,v]) => `${k}=${v}`)
    .join('&');
  return `${root}?${query}`;
};

export default function SmartCalendar() {
  // ----------- UI STATE ------------
  const [darkMode,   setDarkMode]   = useState(false);
  const [userSetEndTime, setUserSetEndTime] = useState({});
  const [weekStart,  setWeekStart]  = useState(() => startOfWeek(new Date()));
  const [showPast,   setShowPast]   = useState(false);

  // --------- Persists ---------
  const [events, setEvents] = useState(() => JSON.parse(localStorage.getItem('smartcalendar-events')) || {});
  const [tasks,  setTasks]  = useState(() => JSON.parse(localStorage.getItem('smartcalendar-tasks'))  || {});

  // ----------- Helpers/UI ------------
  const [categoryColors, setCategoryColors] = useState(initialCategoryColors);
  const [formVisible,    setFormVisible]    = useState({});
  const [taskInput,      setTaskInput]      = useState({});
  const [editingTask,    setEditingTask]    = useState(null);
  const [hoveredEvent,   setHoveredEvent]   = useState(null);
  const [dragHover,      setDragHover]      = useState(null);

  // Time selects by date
  const [startHours, setStartHours] = useState({});
  const [startMins,  setStartMins ] = useState({});
  const [endHours,   setEndHours ]  = useState({});
  const [endMins,    setEndMins ]   = useState({});

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('smartcalendar-events', JSON.stringify(events)); }, [events]);
  useEffect(() => { localStorage.setItem('smartcalendar-tasks',  JSON.stringify(tasks));  }, [tasks]);

  // Build 7-day array
  const weekDates = days.map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dateKeys = weekDates.map(d => d.toISOString().split('T')[0]);

  // Friendly column headers: “Monday 4/21”
  const headerLabels = weekDates.map(d => {
    const w  = d.toLocaleDateString(undefined, { weekday: 'long' });
    const m  = d.getMonth()+1, day = d.getDate();
    return `${w} ${m}/${day}`;
  });

  // ------------- REDIRECT-FLOW AUTH -------------
  const [accessToken, setAccessToken] = useState(null);

  // On mount: if URL hash has a token, grab it
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      if (token) {
        // clear the hash so it’s not lingering
        window.history.replaceState(null, '', window.location.pathname);
        setAccessToken(token);
      }
    }
  }, []);

  // Once we have a token, initialize gapi and fetch events
  useEffect(() => {
    if (!accessToken) return;
    function initClient() {
      gapi.client.init({
        apiKey:        API_KEY,
        clientId:      CLIENT_ID,
        discoveryDocs: DISCOVERY_DOCS,
      }).then(() => {
        // manually set the token so subsequent gapi calls use it
        gapi.auth.setToken({ access_token: accessToken });
        fetchGoogleEvents();
      });
    }
    gapi.load('client', initClient);
  }, [accessToken]);

  // ========== IMPORT GOOGLE EVENTS ==========
  async function fetchGoogleEvents() {
    try {
      const resp = await gapi.client.calendar.events.list({
        calendarId: 'primary',
        timeMin:    new Date().toISOString(),
        showDeleted:false,
        singleEvents:true,
        maxResults:250,
        orderBy:   'startTime',
      });
      const items = resp.result.items || [];
      const imported = items
        .filter(it => it.start.dateTime)       // skip all-day
        .map(it => {
          const sd = it.start.dateTime;
          const ed = it.end.dateTime;
          const [, s] = sd.split('T');
          const e      = ed.split('T')[1];
          return {
            id:        it.id,
            title:     it.summary || '(No Title)',
            startTime: s.slice(0,5),
            endTime:   e.slice(0,5),
            category:  categorizeEvent(it.summary),
            completed: false
          };
        });

      // merge into our state
      setEvents(prev => {
        const nxt = { ...prev };
        imported.forEach(evt => {
          const dayKey = evt.startTime && evt.id && // find its ISO date
            items.find(i=>i.id===evt.id).start.dateTime.split('T')[0];
          if (!nxt[dayKey]) nxt[dayKey] = [];
          if (!nxt[dayKey].some(e=>e.id===evt.id)) {
            nxt[dayKey].push(evt);
          }
        });
        return nxt;
      });
    } catch(e) {
      console.error('Google fetch error:', e);
    }
  }

  // ------------- AUTO END-TIME -------------
  useEffect(() => {
    dateKeys.forEach(dk => {
      const sh = startHours[dk], sm = startMins[dk];
      if (sh && sm && !userSetEndTime[dk]) {
        const total = parseInt(sh,10)*60 + parseInt(sm,10);
        const end   = (total + 60) % (24*60);
        const eh    = String(Math.floor(end/60)).padStart(2,'0');
        const em    = String(end%60).padStart(2,'0');
        setEndHours(h=>({ ...h, [dk]: eh }));
        setEndMins(  m=>({ ...m, [dk]: em }));
      }
    });
  }, [startHours, startMins, dateKeys, userSetEndTime]);
  

  // ------------- FORM HELPERS -------------
  const toggleForm = key => setFormVisible(f=>({ ...f, [key]: !f[key] }));

  const onStartHour = (dk,val) => {
    setStartHours(h => ({ ...h, [dk]: val }));
    // default minutes to “00” if empty
    setStartMins( m => ({ ...m, [dk]: m[dk] || '00' }));
  };
  const onStartMin =  (dk,val) => setStartMins(m => ({ ...m, [dk]: val }));
  const onEndHour = (dk,val) => {
    setEndHours(h => ({ ...h, [dk]: val }));
    setUserSetEndTime(f => ({ ...f, [dk]: true }));
  };
  const onEndMin = (dk,val) => {
    setEndMins(m => ({ ...m, [dk]: val }));
    setUserSetEndTime(f => ({ ...f, [dk]: true }));
  };
  

  // ------------- ADD EVENT w/ REPEAT -------------
  const addEvent = dk => {
    const title = formVisible[`title-${dk}`]   || '';
    const sh    = startHours[dk], sm = startMins[dk];
    const eh    = endHours[dk],   em = endMins[dk];
    const rpt   = formVisible[`repeat-${dk}`]  || 'None';
    if (!title || !sh || !sm || !eh || !em) return;

    const seriesId = Date.now() + Math.random();
    const base = {
      id:        seriesId,
      title,
      startTime: `${sh}:${sm}`,
      endTime:   `${eh}:${em}`,
      category:  categorizeEvent(title),
      completed: false
    };

    setEvents(prev => {
      const nxt = { ...prev };
      const pushOn = iso => {
        if (!nxt[iso]) nxt[iso] = [];
        nxt[iso].push({ ...base });
      };
      // first
      pushOn(dk);
      if (rpt !== 'None') {
        const limit = new Date(); limit.setMonth(limit.getMonth()+3);
        const step  = rpt === 'Daily' ? 1 : 7;
        const tmp   = new Date(dk);
        while(tmp <= limit) {
          tmp.setDate(tmp.getDate()+step);
          pushOn(tmp.toISOString().split('T')[0]);
        }
      }
      return nxt;
    });

    // reset
    setFormVisible(fv=>({
      ...fv,
      [`title-${dk}`]:   '',
      [`event-${dk}`]:   false,
      [`repeat-${dk}`]:  'None'
    }));
    setStartHours(h=>({ ...h, [dk]: '' }));
    setStartMins( m=>({ ...m, [dk]: '' }));
    setEndHours(  h=>({ ...h, [dk]: '' }));
    setEndMins(   m=>({ ...m, [dk]: '' }));
    setUserSetEndTime(u => ({ ...u, [dk]: false }));
  };

  // ------------- TASK HELPERS -------------
  const addTask = dk => {
    const txt = taskInput[dk] || '';
    if (!txt) return;
    const tk = { id:Date.now(), text:txt, completed:false };
    setTasks(ts=>({ ...ts, [dk]: [ ...(ts[dk]||[]), tk ] }));
    setTaskInput(ti=>({ ...ti, [dk]: '' }));
  };
  const updateTaskText    = (dk,id,txt) => setTasks(ts=>({
    ...ts,
    [dk]: ts[dk].map(t=> t.id===id ? { ...t, text: txt } : t )
  }));
  const toggleTaskComplete= (dk,id) => setTasks(ts=>({
    ...ts,
    [dk]: ts[dk].map(t=> t.id===id ? { ...t, completed: !t.completed } : t )
  }));

  // ------------- EVENT TOGGLES & DELETE -------------
  const toggleComplete = (dk,id) => setEvents(ev=>({
    ...ev,
    [dk]: ev[dk].map(e=> e.id===id ? { ...e, completed: !e.completed } : e )
  }));
  const deleteEvent = (dk,id) => setEvents(ev=>({
    ...ev,
    [dk]: ev[dk].filter(e=> e.id!==id)
  }));

  // ------------- CLEAR ALL -------------
  const clearAll = () => {
    setEvents({}); setTasks({});
    localStorage.removeItem('smartcalendar-events');
    localStorage.removeItem('smartcalendar-tasks');
  };

  // ------------- DRAG & DROP -------------
  const handleDragStart = (e,evt,dk) => {
    e.dataTransfer.setData('application/json',
      JSON.stringify({ id:evt.id, dateKey:dk })
    );
  };
  const handleDrop = (e,dk,hour) => {
    e.preventDefault(); setDragHover(null);
    const data = JSON.parse(e.dataTransfer.getData('application/json'));
    if (!data) return;

    const rect    = e.currentTarget.getBoundingClientRect();
    const rawMin  = ((e.clientY - rect.top) / rect.height) * 60;
    const snapped = Math.round(rawMin / 15) * 15;
    const newStart= Number(hour)*60 + snapped;

    setEvents(prev => {
      const col   = prev[data.dateKey] || [];
      const found = col.find(x=> x.id===data.id);
      if (!found) return prev;
      const rest  = col.filter(x=> x.id!==data.id);

      const [oSh,oSm] = found.startTime.split(':').map(Number);
      const [oEh,oEm] = found.endTime.split(':').map(Number);
      const dur       = (oEh*60+oEm) - (oSh*60+oSm);

      const moved = {
        ...found,
        startTime:`${String(Math.floor(newStart/60)).padStart(2,'0')}:${String(newStart%60).padStart(2,'0')}`,
        endTime:  `${String(Math.floor((newStart+dur)/60)%24).padStart(2,'0')}:${String((newStart+dur)%60).padStart(2,'0')}`
      };

      const nxt = { ...prev, [data.dateKey]: rest };
      nxt[dk]   = dk===data.dateKey
        ? [...rest, moved]
        : [...(nxt[dk]||[]), moved];
      return nxt;
    });
  };

  // ------------- RENDER -------------
  return (
    <div className={darkMode ? 'bg-gray-900 text-white min-h-screen' : 'bg-white text-black min-h-screen'}>
      <div className="p-4 max-w-7xl mx-auto">

        {/* NAV / GOOGLE AUTH */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-2">
            <button
              onClick={()=> setWeekStart(d=>{ const n=new Date(d); n.setDate(n.getDate()-7); return n; })}
              className="px-3 py-1 bg-gray-300 rounded"
            >Prev Week</button>

            <button
              onClick={()=>setDarkMode(dm=>!dm)}
              className="px-3 py-1 bg-gray-300 rounded"
            >{darkMode ? 'Light' : 'Dark'} Mode</button>

            <button
              onClick={()=>setShowPast(p=>!p)}
              className="px-3 py-1 bg-gray-300 rounded"
            >{showPast ? 'Hide Past' : 'Show Past'}</button>

            <button
              onClick={clearAll}
              className="px-3 py-1 bg-red-400 text-white rounded"
            >Clear Calendar</button>
          </div>

          <div className="flex gap-2">
            {accessToken ? (
              <button
                onClick={()=>{ setAccessToken(null); }}
                className="px-3 py-1 bg-red-600 text-white rounded"
              >Sign Out</button>
            ) : (
              <a
                href={buildGoogleAuthUrl()}
                className="px-3 py-1 bg-blue-600 text-white rounded"
              >Sync Google</a>
            )}

            <button
              onClick={()=> setWeekStart(d=>{ const n=new Date(d); n.setDate(n.getDate()+7); return n; })}
              className="px-3 py-1 bg-gray-300 rounded"
            >Next Week</button>
          </div>
        </div>

        {/* WEEK LABEL */}
        <h1 className="text-2xl font-bold mb-4">
          Week of {weekStart.toLocaleDateString()}
        </h1>

        {/* DAY HEADERS + ADD FORMS */}
        <div className="grid grid-cols-[100px_repeat(7,1fr)] gap-1 mb-2">
          <div /> {/* corner */}
          {dateKeys.map((dk, idx) => (
            <div key={dk} className="border-b pb-2">
              <div className="text-center font-semibold">{headerLabels[idx]}</div>

              {/* Add Event */}
              <button
                onClick={()=>toggleForm(`event-${dk}`)}
                className="mt-1 w-full bg-black text-white py-1 text-sm rounded"
              >Add Event</button>
              {formVisible[`event-${dk}`] && (
                <div className="mt-2 p-2 space-y-2 bg-gray-100 rounded">
                  <input
                    placeholder="Title"
                    className="w-full border p-1 text-sm"
                    value={formVisible[`title-${dk}`]||''}
                    onChange={e=>setFormVisible(fv=>({...fv, [`title-${dk}`]: e.target.value}))}
                  />

                  <select
                    className="w-full border p-1 text-sm"
                    value={formVisible[`repeat-${dk}`]||'None'}
                    onChange={e=>setFormVisible(fv=>({...fv, [`repeat-${dk}`]: e.target.value}))}
                  >
                    <option value="None">No Repeat</option>
                    <option value="Daily">Repeat Daily</option>
                    <option value="Weekly">Repeat Weekly</option>
                  </select>

                  <div className="flex gap-1">
                    <select
                      className="border p-1 text-sm flex-1"
                      value={startHours[dk]||''}
                      onChange={e=>onStartHour(dk,e.target.value)}
                    >
                      <option value="">HH</option>
                      {hours.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                    <select
                      className="border p-1 text-sm flex-1"
                      value={startMins[dk]||''}
                      onChange={e=>onStartMin(dk,e.target.value)}
                    >
                      <option value="">MM</option>
                      {minuteOptions.map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      className="border p-1 text-sm flex-1"
                      value={endHours[dk]||''}
                      onChange={e=>onEndHour(dk,e.target.value)}
                    >
                      <option value="">HH</option>
                      {hours.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                    <select
                      className="border p-1 text-sm flex-1"
                      value={endMins[dk]||''}
                      onChange={e=>onEndMin(dk,e.target.value)}
                    >
                      <option value="">MM</option>
                      {minuteOptions.map(m=><option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  <button
                    onClick={()=>addEvent(dk)}
                    className="w-full bg-blue-600 text-white py-1 rounded"
                  >Add</button>
                </div>
              )}

              {/* Add Task */}
              <button
                onClick={()=>toggleForm(`tasks-${dk}`)}
                className="mt-1 w-full bg-gray-600 text-white py-1 text-sm rounded"
              >Tasks</button>
              {formVisible[`tasks-${dk}`] && (
                <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} className="mt-2 p-2 bg-gray-100 rounded space-y-2">
                  <input
                    placeholder="New Task"
                    className="w-full border p-1 text-sm"
                    value={taskInput[dk]||''}
                    onChange={e=>setTaskInput(ti=>({...ti, [dk]: e.target.value}))}
                    onKeyDown={e=>e.key==='Enter' && addTask(dk)}
                  />
                  <button
                    onClick={()=>addTask(dk)}
                    className="w-full bg-gray-700 text-white py-1 rounded"
                  >Add Task</button>
                  <ul className="space-y-1">
                    {(tasks[dk]||[]).map(t=>(
                      <li key={t.id} className={`flex justify-between items-center p-1 rounded ${
                        t.completed ? 'opacity-50 bg-gray-300' : 'bg-blue-200'
                      }`}>
                        {editingTask===t.id ? (
                          <input
                            autoFocus
                            className="flex-1 border p-1 text-sm"
                            value={t.text}
                            onChange={e=>updateTaskText(dk,t.id,e.target.value)}
                            onBlur={()=>setEditingTask(null)}
                            onKeyDown={e=>e.key==='Enter'&&setEditingTask(null)}
                          />
                        ) : (
                          <span onDoubleClick={()=>setEditingTask(t.id)}>{t.text}</span>
                        )}
                        <input
                          type="checkbox"
                          checked={t.completed}
                          onChange={()=>toggleTaskComplete(dk,t.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </div>
          ))}
        </div>

        {/* TIME GRID + EVENTS */}
        <div className="relative overflow-y-auto max-h-[70vh]">
          <div className="grid grid-cols-[100px_repeat(7,1fr)] gap-1">
            {gridHours.map(h=>(
              <React.Fragment key={h}>
                <div className="text-sm border-t py-2 pr-2 text-right">{h}</div>
                {dateKeys.map(dk=>(
                  <motion.div
                    key={`${dk}-${h}`}
                    className="relative border-t"
                    onDragOver={e=>{
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - r.top;
                      const pct = Math.round((y/r.height)*60/15)*15;
                      setDragHover({ dateKey: dk, hour: h.split(':')[0], minute: pct });
                    }}
                    onDrop={e=>handleDrop(e, dk, h.split(':')[0])}
                    initial={{ minHeight:48 }}
                    animate={{ minHeight:48 }}
                    transition={{ duration:0.2 }}
                  >
                    {/* drop highlight */}
                    {dragHover?.dateKey===dk && dragHover.hour===h.split(':')[0] && (
                      <div
                        className="absolute left-0 right-0 bg-blue-400"
                        style={{ top:`${(dragHover.minute/60)*100}%`, height:'2px', zIndex:50 }}
                      />
                    )}

                    {/* events */}
                    {(events[dk]||[]).map((evt,_,all)=>{
                      const [sh,sm] = evt.startTime.split(':').map(Number);
                      const [eh,em] = evt.endTime.split(':').map(Number);
                      const s = sh*60 + sm, e = eh*60 + em;
                      const base = Number(h.split(':')[0])*60;
                      if (s < base || s >= base+60) return null;

                      const overlaps = all.filter(x=>{
                        const [os,om]=x.startTime.split(':').map(Number);
                        const [oe,om2]=x.endTime.split(':').map(Number);
                        return os*60+om < e && oe*60+om2 > s;
                      });
                      const idx  = overlaps.findIndex(x=>x.id===evt.id);
                      const wPct = 100 / overlaps.length;
                      const lPct = idx * wPct;
                      const topPx= (s - base)/15*12;
                      const hPx  = (e - s)/15*12;

                      return (
                        <div
                          key={evt.id}
                          draggable
                          onDragStart={e=>handleDragStart(e,evt,dk)}
                          onMouseEnter={()=>setHoveredEvent(evt.id)}
                          onMouseLeave={()=>setHoveredEvent(null)}
                          className={`${categoryColors[evt.category]} absolute m-1 p-1 text-xs rounded ${
                            evt.completed ? 'opacity-50 line-through' : ''
                          }`}
                          style={{
                            top:`${topPx}px`, left:`${lPct}%`,
                            width:`${wPct}%`, minHeight:`${hPx}px`,
                            whiteSpace:'normal', overflowWrap:'break-word',
                            zIndex:1
                          }}
                        >
                          {/* color picker */}
                          {hoveredEvent===evt.id && wPct>50 && (
                            <div className="absolute top-1 left-1 flex gap-1">
                              {colorOptions.map(c=>(
                                <button
                                  key={c}
                                  onClick={()=>setCategoryColors(pc=>({...pc,[evt.category]:c}))}
                                  className={`${c} w-2.5 h-2.5 rounded-full border border-white hover:scale-110`}
                                />
                              ))}
                            </div>
                          )}

                          {/* delete */}
                          {hoveredEvent===evt.id && (
                            <button
                              onClick={()=>deleteEvent(dk,evt.id)}
                              className="absolute bottom-1 right-1 p-1 text-black"
                            >🗑️</button>
                          )}

                          <div className="flex justify-between text-black">
                            <span>{evt.title}</span>
                            <input
                              type="checkbox"
                              checked={evt.completed}
                              onChange={()=>toggleComplete(dk,evt.id)}
                            />
                          </div>
                          <div className="text-[10px] text-black">
                            {evt.startTime} – {evt.endTime}
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
