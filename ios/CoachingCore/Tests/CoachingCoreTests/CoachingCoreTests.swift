import XCTest
@testable import CoachingCore
final class CoachingCoreTests: XCTestCase {
 func testJSONRoundtrip() throws { let value = try JSONValue.from(["name":"Müller","ready":true,"score":7,"messages":[["role":"user","content":"Hallo"]]]); XCTAssertEqual(value["score"].int,7); XCTAssertTrue(value["ready"].bool); XCTAssertEqual(try JSONDecoder().decode(JSONValue.self,from:JSONEncoder().encode(value)),value) }
 func testServerGatesWin() throws { let p = try JSONValue.from(["onboardingComplete":true,"access":["status":"active","processWeek":2,"weekStates":[["week":2,"accessible":true,"completed":false]]]]); XCTAssertTrue(CoachingRules.canEdit(week:2,program:p));XCTAssertFalse(CoachingRules.canEdit(week:3,program:p));XCTAssertFalse(CoachingRules.canEdit(week:1,program:.null)) }
 func testProgressDoesNotInventCompletion() throws { let steps = try JSONValue.from([["id":"a"],["id":"b"]]).array;let records=try JSONValue.from([["step_id":"a","status":"completed"],["step_id":"b","messages":[["role":"user"]]]]).array;XCTAssertEqual(CoachingRules.progress(steps:steps,records:records,week:1),0.75) }
 func testSafeLinks() { XCTAssertNil(CoachingRules.safeExternalURL("javascript:alert(1)"));XCTAssertNil(CoachingRules.safeExternalURL("https://user:pass@example.com"));XCTAssertNotNil(CoachingRules.safeExternalURL("https://meet.google.com/abc")) }
}
