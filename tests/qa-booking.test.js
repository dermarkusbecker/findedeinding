import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateAvailableSlots,isWithinBookingAvailability} from '../lib/booking-availability.js';

test('Q&A accepts 15 minute slots independently from intake categories',()=>{
  const settings={categories:[{id:'initial',name:'Klarheitsgespräch',duration:45,active:true}],weeklyAvailability:{0:[],1:[{start:'10:00',end:'11:00'}],2:[],3:[],4:[],5:[],6:[]},defaultDurationMinutes:15,offeredDurations:[15],minNoticeHours:0,bookingHorizonDays:180};
  const now=new Date('2026-10-01T00:00:00Z');
  const slots=generateAvailableSlots({settings,from:'2026-10-05',to:'2026-10-05',duration:15,now});
  assert.equal(slots.length,4);
  assert.ok(isWithinBookingAvailability(slots[0].start,15,settings,now));
});

test('Q&A links, independent settings and calendar booking are wired',async()=>{
  const [html,admin,api,migration]=await Promise.all(['admin.html','admin.js','api/leads.js','supabase/migrations/20261008211000_qa_booking.sql'].map(path=>readFile(new URL(`../${path}`,import.meta.url),'utf8')));
  assert.match(html,/id="qaBookingRows"/);
  assert.match(admin,/qa-buchen\?dauer=/);
  assert.match(api,/public-qa-slots/);
  assert.match(api,/public-qa-book/);
  assert.match(api,/assertCalendarAvailable\(accessToken,start\.toISOString\(\),end\.toISOString\(\)\)/);
  assert.match(migration,/crm_qa_bookings/);
  assert.match(migration,/qa_booking_no_overlap/);
});
