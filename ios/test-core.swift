import Foundation
import CoachingCore
let profile=try JSONValue.from(["onboardingComplete":true,"access":["status":"active","processWeek":1,"weekStates":[["week":1,"accessible":true,"completed":false]]]])
precondition(CoachingRules.canEdit(week:1,program:profile))
precondition(!CoachingRules.canEdit(week:2,program:profile))
let lesson=try JSONValue.from(["id":"first","minItems":2,"maxItems":2,"options":["A","B","C"]])
precondition(CoachingRules.validSelection(["A","B"],lesson:lesson))
precondition(!CoachingRules.validSelection(["A","A"],lesson:lesson))
precondition(!CoachingRules.validSelection(["A","foreign"],lesson:lesson))
let records=try JSONValue.from([["step_id":"first","status":"completed"]]).array
precondition(CoachingRules.progress(steps:[lesson],records:records,week:1)==0.99)
let done=try JSONValue.from([["step_id":"week_complete_1","status":"completed"]]).array
precondition(CoachingRules.progress(steps:[lesson],records:done,week:1)==1)
precondition(CoachingRules.safeExternalURL("javascript:alert(1)")==nil)
precondition(CoachingRules.safeExternalURL("https://user:password@example.com")==nil)
precondition(CoachingRules.safeExternalURL("https://meet.google.com/abc") != nil)
let data=try JSONEncoder().encode(profile)
precondition(try JSONDecoder().decode(JSONValue.self,from:data)==profile)
precondition(JSONValue.number(1e30).int==0)
precondition(JSONValue.number(1e30).string=="1e+30")
print("CoachingCore: access gates, selection bounds/uniqueness, finalization progress, safe links, JSON roundtrip and large number safety passed.")
