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
const minuteOptions = ['00','15','30','45'];
const gridHours = Array.from({ length: 24 }, (_, i) => {
  const hour = i % 12 === 0 ? 12 : i % 12;
  const suffix = i < 12 ? 'AM' : 'PM';
  return `${hour}:00 ${suffix}`;
});
const days          = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// Google OAuth info
const CLIENT_ID      = '860532901417-eos75c7iicf4n31tf4sapahjugpd7hmn.apps.googleusercontent.com';
const API_KEY        = 'AIzaSyAGM86BLqXWdSQ_iQFA5hYVNn_IcghxdzM';
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const SCOPES         = "https://www.googleapis.com/auth/calendar";

// ------------- HELPERS -------------
function startOfWeek(date) {
  const d = new Date(date);
  const diff = (d.getDay()+6) % 7; // Monday=0
  d.setDate(d.getDate() - diff);
  d.setHours(0,0,0,0);
  return d;
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${suffix}`;
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
  const [userSetEndTime, setUserSetEndTime] = useState({});
  const [weekStart,  setWeekStart]  = useState(() => startOfWeek(new Date()));
  // --------- Persists ---------
  const [events, setEvents] = useState(() => JSON.parse(localStorage.getItem('smartcalendar-events')) || {});
  const [tasks,  setTasks]  = useState(() => JSON.parse(localStorage.getItem('smartcalendar-tasks'))  || {});
  const hasIncompleteTasks = dk => {
    const list = tasks[dk] || [];
    return list.some(task => !task.completed);
  };
  

  // ----------- Helpers/UI ------------
  const [categoryColors, setCategoryColors] = useState(initialCategoryColors);
  const [formVisible,    setFormVisible]    = useState({});
  const [taskInput,      setTaskInput]      = useState({});
  const [editingTask,    setEditingTask]    = useState(null);
  const [hoveredEvent,   setHoveredEvent]   = useState(null);
  const [dragHover,      setDragHover]      = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editFields, setEditFields] = useState({ title: '', start: '', end: '', details: '' });

  // Time selects by date
  const [startHours, setStartHours] = useState({});
  const [startMins,  setStartMins ] = useState({});
  const [endHours,   setEndHours ]  = useState({});
  const [endMins,    setEndMins ]   = useState({});
  const [startAmPm, setStartAmPm] = useState({});
  const [endAmPm, setEndAmPm] = useState({});


  // Persist to localStorage
  useEffect(() => { localStorage.setItem('smartcalendar-events', JSON.stringify(events)); }, [events]);
  useEffect(() => { localStorage.setItem('smartcalendar-tasks',  JSON.stringify(tasks));  }, [tasks]);

  // Build 7-day array
  const weekDates = days.map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dateKeys = weekDates.map(d => d.toLocaleDateString('sv-SE'));

  // Friendly column headers: “Monday 4/21”
  const headerLabels = weekDates.map(d => {
    const w  = d.toLocaleDateString(undefined, { weekday: 'long' });
    const m  = d.getMonth()+1, day = d.getDate();
    return `${w} ${m}/${day}`;
  });

  // ------------- REDIRECT-FLOW AUTH -------------
  const [accessToken, setAccessToken] = useState(null);

// On first load: check if access_token is in the URL hash
useEffect(() => {
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const token = hashParams.get("access_token");
  if (token) {
    setAccessToken(token);
    window.history.replaceState(null, null, window.location.pathname); // Clean up the URL
  }
}, []);

// upcoming event

const getNextEvent = () => {
  const now = new Date();
  const upcoming = [];

  Object.entries(events).forEach(([date, eventList]) => {
    eventList.forEach(evt => {
      const [hour, minute] = evt.startTime.split(':').map(Number);
      const [year, month, day] = date.split('-').map(Number); // YYYY-MM-DD
      const eventDate = new Date(year, month - 1, day, hour, minute); // local time
      if (eventDate > now) {
        upcoming.push({ ...evt, date: eventDate });
      }
    });
  });

  upcoming.sort((a, b) => a.date - b.date);
  return upcoming[0];
};

  // On mount: if URL hash has a token, grab it
  useEffect(() => {
    dateKeys.forEach(dk => {
      const sh = startHours[dk], sm = startMins[dk], ap = startAmPm[dk];
      if (sh && sm && ap && !userSetEndTime[dk]) {
        let hour24 = parseInt(sh, 10);
        if (ap === 'PM' && hour24 !== 12) hour24 += 12;
        if (ap === 'AM' && hour24 === 12) hour24 = 0;
  
        const startTotalMin = hour24 * 60 + parseInt(sm, 10);
        const endTotalMin = (startTotalMin + 60) % (24 * 60);
        const endHour24 = Math.floor(endTotalMin / 60);
        const endMin = String(endTotalMin % 60).padStart(2, '0');
  
        const endAmPmVal = endHour24 >= 12 ? 'PM' : 'AM';
        let endHour12 = endHour24 % 12;
        if (endHour12 === 0) endHour12 = 12;
  
        setEndHours(h => ({ ...h, [dk]: String(endHour12).padStart(2, '0') }));
        setEndMins(m => ({ ...m, [dk]: endMin }));
        setEndAmPm(am => ({ ...am, [dk]: endAmPmVal }));
      }
    });
  }, [startHours, startMins, startAmPm, dateKeys, userSetEndTime]);
  

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
    }
    
    catch(e) {
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
    const title = formVisible[`title-${dk}`] || '';
    const sh    = startHours[dk], sm = startMins[dk];
    const eh    = endHours[dk],   em = endMins[dk];
    const sap   = startAmPm[dk] || 'AM';
    const eap   = endAmPm[dk]   || 'AM';
    const rpt   = formVisible[`repeat-${dk}`] || 'None';
  
    if (!title || !sh || !sm || !eh || !em) return;
  
    const convertTo24 = (h, ap) => {
      let hour = parseInt(h, 10);
      if (ap === 'PM' && hour !== 12) hour += 12;
      if (ap === 'AM' && hour === 12) hour = 0;
      return hour.toString().padStart(2, '0');
    };
  
    const sh24 = convertTo24(sh, sap);
    const eh24 = convertTo24(eh, eap);
  
    const seriesId = Date.now() + Math.random();
    const base = {
      id:        seriesId,
      title,
      startTime: `${sh24}:${sm}`,
      endTime:   `${eh24}:${em}`,
      category:  categorizeEvent(title),
      completed: false
    };
  
    setEvents(prev => {
      const nxt = { ...prev };
      const pushed = new Set();
    
      const pushOn = iso => {
        if (!nxt[iso]) nxt[iso] = [];
        if (pushed.has(iso)) return; // Prevent duplicate pushes
        pushed.add(iso);
        nxt[iso].push({ ...base });
      };
    
      pushOn(dk);
      if (rpt !== 'None') {
        const limit = new Date();
        limit.setMonth(limit.getMonth() + 3);
        const step = rpt === 'Daily' ? 1 : 7;
        const tmp = new Date(dk);
        while (tmp <= limit) {
          tmp.setDate(tmp.getDate() + step);
          const iso = tmp.toISOString().split('T')[0];
          pushOn(iso);
        }
      }
    
      return nxt;
    });
    
  
    // Reset form
    setFormVisible(fv => ({
      ...fv,
      [`title-${dk}`]: '',
      [`event-${dk}`]: false,
      [`repeat-${dk}`]: 'None'
    }));
    setStartHours(h => ({ ...h, [dk]: '' }));
    setStartMins(m  => ({ ...m, [dk]: '' }));
    setEndHours(h   => ({ ...h, [dk]: '' }));
    setEndMins(m    => ({ ...m, [dk]: '' }));
    setStartAmPm(a  => ({ ...a, [dk]: 'AM' }));
    setEndAmPm(a    => ({ ...a, [dk]: 'AM' }));
    setUserSetEndTime(u => ({ ...u, [dk]: false }));
  };
  

  // ------------- TASK HELPERS -------------
const addTask = dk => {
  const txt = taskInput[dk] || '';
  const repeat = formVisible[`taskRepeat-${dk}`] || 'None';
  if (!txt) return;

  const taskId = Date.now();
  const baseTask = { id: taskId, text: txt, completed: false };

  setTasks(prev => {
    const updated = { ...prev };
    const pushed = new Set();

    const pushOn = iso => {
      if (!updated[iso]) updated[iso] = [];
      if (pushed.has(iso)) return; // ✅ Avoid duplicate
      pushed.add(iso);
      updated[iso].push({ ...baseTask });
    };

    if (repeat === 'None') {
      pushOn(dk);
    } else {
      const limit = new Date();
      limit.setMonth(limit.getMonth() + 3);
      const step = repeat === 'Daily' ? 1 : 7;
      const tmp = new Date(dk);
      while (tmp <= limit) {
        const iso = tmp.toISOString().split('T')[0];
        pushOn(iso);
        tmp.setDate(tmp.getDate() + step);
      }
    }

    return updated;
  });

  // Clear input and repeat state
  setTaskInput(ti => ({ ...ti, [dk]: '' }));
  setFormVisible(fv => ({ ...fv, [`taskRepeat-${dk}`]: 'None' }));
};

  
  
  const updateTaskText    = (dk,id,txt) => setTasks(ts=>({
    ...ts,
    [dk]: ts[dk].map(t=> t.id===id ? { ...t, text: txt } : t )
  }));
  const toggleTaskComplete= (dk,id) => setTasks(ts=>({
    ...ts,
    [dk]: ts[dk].map(t=> t.id===id ? { ...t, completed: !t.completed } : t )
  }));
  const deleteTask = (dk, id) => {
    setTasks(ts => ({
      ...ts,
      [dk]: ts[dk].filter(t => t.id !== id)
    }));
  };
  

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
    if (window.confirm("Are you sure you want to clear all events and tasks? This cannot be undone.")) {
      setEvents({});
      setTasks({});
      localStorage.removeItem('smartcalendar-events');
      localStorage.removeItem('smartcalendar-tasks');
    }
  };
  

  // ------------- DRAG & DROP -------------
  const handleDragStart = (e,evt,dk) => {
    e.dataTransfer.setData('application/json',
      JSON.stringify({ id:evt.id, dateKey:dk })
    );
  };
  const handleDrop = (e, dk, hour) => {
    e.preventDefault();
    setDragHover(null);
  
    const data = JSON.parse(e.dataTransfer.getData('application/json'));
    if (!data) return;
  
    // Snap drop to nearest 15-minute increment
    const rect = e.currentTarget.getBoundingClientRect();
    const rawMin = ((e.clientY - rect.top) / rect.height) * 60;
    const snapped = Math.round(rawMin / 15) * 15;
    const newStart = hour * 60 + snapped;
  
    setEvents(prev => {
      const oldDayEvents = prev[data.dateKey] || [];
      const eventToMove = oldDayEvents.find(x => x.id === data.id);
      if (!eventToMove) return prev;
  
      // Remove event from original day
      const updatedOldDay = oldDayEvents.filter(x => x.id !== data.id);
  
      // Duration calculation
      const [oSh, oSm] = eventToMove.startTime.split(':').map(Number);
      const [oEh, oEm] = eventToMove.endTime.split(':').map(Number);
      const duration = (oEh * 60 + oEm) - (oSh * 60 + oSm);
  
      // New start and end time
      const newStartH = Math.floor(newStart / 60);
      const newStartM = newStart % 60;
      const newEnd = newStart + duration;
      const newEndH = Math.floor(newEnd / 60) % 24;
      const newEndM = newEnd % 60;
  
      const newEvent = {
        ...eventToMove,
        startTime: `${String(newStartH).padStart(2, '0')}:${String(newStartM).padStart(2, '0')}`,
        endTime:   `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`
      };
  
      const updatedEvents = { ...prev };
  
      // Update old date
      updatedEvents[data.dateKey] = updatedOldDay;
  
      // Add to new date
      updatedEvents[dk] = [...(updatedEvents[dk] || []), newEvent];
  
      // Sort by start time to avoid overlaps or incorrect stacking
      updatedEvents[dk].sort((a, b) => a.startTime.localeCompare(b.startTime));
  
      return updatedEvents;
    });
  };
return (
  <div className="bg-white text-black min-h-screen">
<div className="px-28 py-4 max-w-full">

      {/* NAV / GOOGLE AUTH */}
{/* NAVIGATION BAR */}
<div className="flex items-center justify-between mb-4">
  {/* LEFT CONTROLS */}
  <div className="flex items-center space-x-2 pl-1">
  <button
      onClick={() => setWeekStart(startOfWeek(new Date()))}
      className="border border-gray-400 text-sm px-4 py-1 rounded-full hover:bg-gray-100"
    >
      Today
    </button>
    <button
      onClick={() => setWeekStart(d => {
        const n = new Date(d);
        n.setDate(n.getDate() - 7);
        return n;
      })}
      className="text-xl px-2"
    >
      &lt;
    </button>
    <button
      onClick={() => setWeekStart(d => {
        const n = new Date(d);
        n.setDate(n.getDate() + 7);
        return n;
      })}
      className="text-xl px-2"
    >
      &gt;
    </button>
    <button
      onClick={clearAll}
      className="ml-2 px-3 py-1 bg-red-400 text-white text-sm rounded"
    >
      Clear Calendar
    </button>
  </div>

{/* RIGHT: Upcoming Event + Google Auth */}
<div
  className="flex items-center justify-center space-x-4 bg-blue-600 text-white px-4 py-2 rounded shadow-sm text-sm max-w-full overflow-hidden transform"
  style={{ transform: 'translateX(-0.9in)' }}
>
  {getNextEvent() ? (
    <>
      <span className="font-semibold">Next:</span>
      <span className="truncate max-w-[200px]">{getNextEvent().title}</span>
      <span className="text-xs text-gray-200">{formatTime(getNextEvent().startTime)}</span>
    </>
  ) : (
    <span className="text-gray-200">No upcoming events</span>
  )}
</div>



    {accessToken ? (
      <button
        onClick={() => setAccessToken(null)}
        className="px-3 py-1 bg-red-600 text-white text-sm rounded"
      >
        Sign Out
      </button>
    ) : (
      <a
        href={buildGoogleAuthUrl()}
        className="px-3 py-1 bg-blue-600 text-white text-sm rounded"
      >
        Sync Google
      </a>
    )}
  </div>
</div>
        {/* WEEK LABEL */}
        <h1 className="text-2xl font-bold mb-4 px-28">
        Week of {weekStart.toLocaleDateString()}
</h1>


        {/* DAY HEADERS + ADD FORMS */}
        <div className="px-4">
        <div className="grid grid-cols-[100px_repeat(7,1fr)] gap-1 mb-2 sticky top-0 z-40 bg-white">
        <div /> 
          {dateKeys.map((dk, idx) => (
            <div key={dk} className="border-b pb-2">
<div
  className={`text-center font-semibold rounded px-1 ${
    dk === new Date().toLocaleDateString('sv-SE') ? 'bg-blue-100' : ''
  }`}
>
  {headerLabels[idx]}
</div>

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

                  <div className="flex flex-col gap-2">
  <div className="flex gap-1">
    <select
      className="border p-1 text-sm flex-1"
      value={startHours[dk] || ''}
      onChange={e => onStartHour(dk, e.target.value)}
    >
      <option value="">HH</option>
      {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(h => (
        <option key={h} value={h}>{h}</option>
      ))}
    </select>
    <select
      className="border p-1 text-sm flex-1"
      value={startMins[dk] || ''}
      onChange={e => onStartMin(dk, e.target.value)}
    >
      <option value="">MM</option>
      {minuteOptions.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
    <select
  className="border p-1 text-sm flex-1"
  value={startAmPm[dk] || 'AM'}
  onChange={e => setStartAmPm(a => ({ ...a, [dk]: e.target.value }))}
>
  <option value="AM">AM</option>
  <option value="PM">PM</option>
</select>

  </div>

  <div className="flex gap-1">
    <select
      className="border p-1 text-sm flex-1"
      value={endHours[dk] || ''}
      onChange={e => onEndHour(dk, e.target.value)}
    >
      <option value="">HH</option>
      {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(h => (
        <option key={h} value={h}>{h}</option>
      ))}
    </select>
    <select
      className="border p-1 text-sm flex-1"
      value={endMins[dk] || ''}
      onChange={e => onEndMin(dk, e.target.value)}
    >
      <option value="">MM</option>
      {minuteOptions.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
    <select
  className="border p-1 text-sm flex-1"
  value={endAmPm[dk] || 'AM'}
  onChange={e => setEndAmPm(a => ({ ...a, [dk]: e.target.value }))}
>
  <option value="AM">AM</option>
  <option value="PM">PM</option>
</select>

  </div>
</div>


                  <button
                    onClick={()=>addEvent(dk)}
                    className="w-full bg-blue-600 text-white py-1 rounded"
                  >Add</button>
                </div>
              )}

              {/* Add Task */}
{/* Add Task */}
{/* Add Task */}
<button
  onClick={() => toggleForm(`tasks-${dk}`)}
  className="relative mt-1 w-full bg-gray-600 text-white py-1 text-sm rounded text-center"
>
  Tasks
  {dk === new Date().toLocaleDateString('sv-SE') && hasIncompleteTasks(dk) && (
  <span className="absolute right-2 top-1.5 transform -translate-y-1/2 text-red-400 font-bold animate-bounce">!</span>
)}

</button>

{formVisible[`tasks-${dk}`] && (
  <form
    onSubmit={e => {
      e.preventDefault();
      addTask(dk);
    }}
    className="mt-2 space-y-2"
  >
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      className="p-2 bg-gray-100 rounded space-y-2"
    >
      <div className="flex gap-2 items-center">
        <input
          placeholder="New Task"
          className="flex-1 border p-1 text-sm"
          value={taskInput[dk] || ''}
          onChange={e =>
            setTaskInput(ti => ({ ...ti, [dk]: e.target.value }))
          }
        />
        <select
          className="border p-1 text-sm"
          value={formVisible[`taskRepeat-${dk}`] || 'None'}
          onChange={e =>
            setFormVisible(fv => ({
              ...fv,
              [`taskRepeat-${dk}`]: e.target.value,
            }))
          }
        >
          <option value="None">No Repeat</option>
          <option value="Daily">Daily</option>
          <option value="Weekly">Weekly</option>
        </select>
      </div>

      <button
        type="submit"
        className="w-full bg-gray-700 text-white py-1 rounded"
      >
        Add Task
      </button>

      <ul className="space-y-1">
        {(tasks[dk] || []).map(t => (
          <li
            key={t.id}
            className={`flex justify-between items-center p-1 rounded ${
              t.completed ? 'opacity-50 bg-gray-300' : 'bg-blue-200'
            }`}
          >
            <div className="flex-1">
              {editingTask === t.id ? (
                <input
                  autoFocus
                  className="w-full border p-1 text-sm"
                  value={t.text}
                  onChange={e =>
                    updateTaskText(dk, t.id, e.target.value)
                  }
                  onBlur={() => setEditingTask(null)}
                  onKeyDown={e =>
                    e.key === 'Enter' && setEditingTask(null)
                  }
                />
              ) : (
                <span
                  onDoubleClick={() => setEditingTask(t.id)}
                  className="cursor-text"
                >
                  {t.text}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 ml-2">
              <button
                onClick={() => deleteTask(dk, t.id)}
                className="text-red-600 hover:text-red-800 text-xs"
                title="Delete task"
              >
                🗑️
              </button>
              <input
                type="checkbox"
                checked={t.completed}
                onChange={() => toggleTaskComplete(dk, t.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  </form>
)}

              
            </div>
          ))}
        </div>
        </div>
        {/* TIME GRID + EVENTS */}
        <div className="relative overflow-y-auto max-h-[70vh]">
        <div className="px-4">
  <div className="grid grid-cols-[100px_repeat(7,1fr)] gap-1">
        {gridHours.map(h=>(
              <React.Fragment key={h}>
                <div className="text-sm border-t py-2 pr-2 text-right">{h}</div>
                {dateKeys.map(dk=>(
                  <motion.div
                    key={`${dk}-${h}`}
                    className="relative border-t border-r border-gray-200"
                    onDragOver={e=>{
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      const y = e.clientY - r.top;
                      const pct = Math.round((y/r.height)*60/15)*15;
                      setDragHover({ dateKey: dk, hour: h.split(':')[0], minute: pct });
                    }}
                    onDrop={e => {
                      const hourString = h.split(' ')[0];     // "1:00"
                      const ampm = h.split(' ')[1];           // "AM" or "PM"
                      let hour = parseInt(hourString.split(':')[0], 10);
                      if (ampm === 'PM' && hour !== 12) hour += 12;
                      if (ampm === 'AM' && hour === 12) hour = 0;
                      handleDrop(e, dk, hour);
                    }}
                                        initial={{ minHeight:20 }}
                    animate={{ minHeight:24 }}
                    transition={{ duration:0.2 }}
                  >
                    {/* drop highlight */}

{/* current time indicator */}
{(() => {
  const now = new Date();
  const todayKey = now.toLocaleDateString('sv-SE');
  if (dk !== todayKey) return null;

  const hour = now.getHours();
  const minute = now.getMinutes();
  const [labelHour, ampm] = h.split(' ');
  let baseHour = parseInt(labelHour.split(':')[0], 10);
  if (ampm === 'PM' && baseHour !== 12) baseHour += 12;
  if (ampm === 'AM' && baseHour === 12) baseHour = 0;

  if (hour !== baseHour) return null;

  const topPercent = (minute / 60) * 100;

  return (
    <div
      className="absolute left-0 right-0 bg-red-500 h-0.5 z-50"
      style={{ top: `${topPercent}%` }}
    >
      <div className="w-2 h-2 bg-red-500 rounded-full absolute -left-1 top-[-4px]" />
    </div>
  );
})()}


                    {dragHover?.dateKey===dk && dragHover.hour===h.split(':')[0] && (
                      <div
                        className="absolute left-0 right-0 bg-blue-400"
                        style={{ top:`${(dragHover.minute/60)*100}%`, height:'2px', zIndex:50 }}
                      />
                    )}

                    {/* events */}
                    {(events[dk] || []).map((evt, _, all) => {
  const [sh, sm] = evt.startTime.split(':').map(Number);
  const [eh, em] = evt.endTime.split(':').map(Number);
  const s = sh * 60 + sm,
        e = eh * 60 + em;

  const [hourStr, ampm] = h.split(' ');
  let baseHour = parseInt(hourStr.split(':')[0], 10);
  if (ampm === 'PM' && baseHour !== 12) baseHour += 12;
  if (ampm === 'AM' && baseHour === 12) baseHour = 0;
  const base = baseHour * 60;

  if (s < base || s >= base + 60) return null;

  const overlaps = all.filter(x => {
    const [os, om] = x.startTime.split(':').map(Number);
    const [oe, om2] = x.endTime.split(':').map(Number);
    return os * 60 + om < e && oe * 60 + om2 > s;
  });

  const idx = overlaps.findIndex(x => x.id === evt.id);
  const wPct = 100 / overlaps.length;
  const lPct = idx * wPct;
  const topPx = (s - base) / 15 * 9;
  const hPx = (e - s) / 15 * 9;

  return (
    <motion.div
      key={evt.id}
      draggable
      onDragStart={e => handleDragStart(e, evt, dk)}
      onMouseEnter={() => setHoveredEvent(evt.id)}
      onMouseLeave={() => setHoveredEvent(null)}
      className={`${categoryColors[evt.category]} absolute m-1 p-1 text-xs rounded ${
        evt.completed ? 'opacity-50 line-through' : ''
      }`}
      style={{
        top: `${topPx}px`,
        left: `${lPct}%`,
        width: `${wPct}%`,
        minHeight: `${hPx}px`,
        whiteSpace: 'normal',
        overflowWrap: 'break-word',
        zIndex: hoveredEvent === evt.id && evt.details ? 10 : 1,
      }}
      layout
      animate={{
        height: hoveredEvent === evt.id && evt.details ? 'auto' : hPx,
      }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
    >
      {/* color picker */}
      {hoveredEvent === evt.id && wPct > 50 && (
  <div className="absolute top-1 left-1 flex gap-1">
    {colorOptions.map(c => (
      <button
        key={c}
        onClick={() => setCategoryColors(pc => ({ ...pc, [evt.category]: c }))}
        className={`${c} w-2.5 h-2.5 rounded-full border border-white hover:scale-110`}
      />
    ))}
  </div>
)}

<div className="flex justify-between text-black">
  <span>{evt.title}</span>
  <input
    type="checkbox"
    checked={evt.completed}
    onChange={() => toggleComplete(dk, evt.id)}
  />
</div>

<div className="text-[10px] text-black">
  {formatTime(evt.startTime)} – {formatTime(evt.endTime)}
</div>

{hoveredEvent === evt.id && evt.details && (
  <div className="mt-1 text-[10px] text-black whitespace-pre-wrap">
    {evt.details}
  </div>
)}

{hoveredEvent === evt.id && (
  evt.details ? (
    // Show buttons BELOW the details if details exist
    <div className="flex justify-end mt-1 space-x-1">
      <button
        onClick={() => {
          setEditingEvent({ ...evt, dateKey: dk });
          setEditFields({
            title: evt.title,
            start: evt.startTime,
            end: evt.endTime,
            details: evt.details || ''
          });
        }}
        className="text-black text-xs bg-white px-1 rounded shadow"
      >
        ✏️ 
      </button>
      <button
        onClick={() => deleteEvent(dk, evt.id)}
        className="text-black text-xs bg-white px-1 rounded shadow"
      >
        🗑️
      </button>
    </div>
  ) : (
    // Show buttons in the bottom-right corner if NO details
    <>
      <button
        onClick={() => {
          setEditingEvent({ ...evt, dateKey: dk });
          setEditFields({
            title: evt.title,
            start: evt.startTime,
            end: evt.endTime,
            details: evt.details || ''
          });
        }}
        className="absolute bottom-1 right-8 text-black text-xs bg-white px-1 rounded shadow"
      >
        ✏️
      </button>
      <button
        onClick={() => deleteEvent(dk, evt.id)}
        className="absolute bottom-1 right-1 text-black text-xs bg-white px-1 rounded shadow"
      >
        🗑️
      </button>
    </>
  )
)}

    </motion.div>
  );
})}

                  </motion.div>
                ))}
              </React.Fragment>
            ))}
          </div>
          {editingEvent && (
  <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div className="bg-white rounded-lg p-4 w-full max-w-md shadow-lg space-y-4">
      <h2 className="text-lg font-semibold">Edit Event</h2>

      <input
        className="w-full border p-2 text-sm"
        placeholder="Title"
        value={editFields.title}
        onChange={e => setEditFields(f => ({ ...f, title: e.target.value }))}
      />
      <input
        className="w-full border p-2 text-sm"
        placeholder="Start Time (HH:MM)"
        value={editFields.start}
        onChange={e => setEditFields(f => ({ ...f, start: e.target.value }))}
      />
      <input
        className="w-full border p-2 text-sm"
        placeholder="End Time (HH:MM)"
        value={editFields.end}
        onChange={e => setEditFields(f => ({ ...f, end: e.target.value }))}
      />
      <textarea
        className="w-full border p-2 text-sm"
        placeholder="Details (optional)"
        rows={3}
        value={editFields.details}
        onChange={e => setEditFields(f => ({ ...f, details: e.target.value }))}
      />

      <div className="flex justify-end space-x-2">
        <button
          className="bg-gray-300 px-3 py-1 rounded"
          onClick={() => setEditingEvent(null)}
        >
          Cancel
        </button>
        <button
          className="bg-blue-600 text-white px-3 py-1 rounded"
          onClick={() => {
            const { dateKey, id, title, startTime, endTime } = editingEvent;
            const isChangingDetails = editFields.details && editFields.details !== editingEvent.details;
          
            const applyUpdate = (applyToAll = false) => {
              setEvents(prev => {
                const updated = { ...prev };
                for (const [dk, list] of Object.entries(prev)) {
                  updated[dk] = list.map(evt => {
                    const match =
                      evt.title === title &&
                      evt.startTime === startTime &&
                      evt.endTime === endTime;
          
                    if ((applyToAll && match) || (!applyToAll && dk === dateKey && evt.id === id)) {
                      return {
                        ...evt,
                        title: editFields.title,
                        startTime: editFields.start,
                        endTime: editFields.end,
                        details: editFields.details,
                      };
                    }
                    return evt;
                  });
                }
                return updated;
              });
          
              setEditingEvent(null);
            };
          
            if (isChangingDetails) {
              const confirmAll = window.confirm(
                'Do you want to add these details to all matching events with the same title and time?'
              );
              applyUpdate(confirmAll);
            } else {
              applyUpdate(false);
            }
          }}
          
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}

        </div>
      </div>
      </div>
  );
}