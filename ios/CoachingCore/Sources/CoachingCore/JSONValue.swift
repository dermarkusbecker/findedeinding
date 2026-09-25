import Foundation
public enum JSONValue: Codable, Equatable, Sendable {
 case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
 public init(from decoder: Decoder) throws {
  let c = try decoder.singleValueContainer()
  if c.decodeNil() { self = .null }
  else if let v = try? c.decode(Bool.self) { self = .bool(v) }
  else if let v = try? c.decode(Double.self) { self = .number(v) }
  else if let v = try? c.decode(String.self) { self = .string(v) }
  else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
  else { self = .object(try c.decode([String: JSONValue].self)) }
 }
 public func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); switch self { case .null: try c.encodeNil(); case .bool(let v): try c.encode(v); case .number(let v): try c.encode(v); case .string(let v): try c.encode(v); case .array(let v): try c.encode(v); case .object(let v): try c.encode(v) } }
 public subscript(_ key: String) -> JSONValue { if case .object(let v) = self { return v[key] ?? .null }; return .null }
 public var string: String { switch self { case .string(let v): return v; case .number(let v): return v.isFinite && v == floor(v) && v > Double(Int.min) && v < Double(Int.max) ? String(Int(v)) : String(v); case .bool(let v): return v ? "Ja" : "Nein"; default: return "" } }
 public var double: Double { if case .number(let v) = self { return v }; return Double(string) ?? 0 }
 public var int: Int { let value = double; guard value.isFinite, value > Double(Int.min), value < Double(Int.max) else { return 0 }; return Int(value) }
 public var bool: Bool { if case .bool(let v) = self { return v }; return false }
 public var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
 public var object: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
 public var isNull: Bool { self == .null }
 public static func from(_ value: Any) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])) }
}
public enum CoachingRules {
 public static func canEdit(week: Int, program: JSONValue) -> Bool {
  program["onboardingComplete"].bool && program["access"]["status"].string != "paused" && program["access"]["processWeek"].int == week && program["access"]["weekStates"].array.contains { $0["week"].int == week && $0["accessible"].bool && !$0["completed"].bool }
 }
 public static func progress(steps: [JSONValue], records: [JSONValue], week: Int) -> Double {
  if records.contains(where: { $0["step_id"].string == "week_complete_\(week)" && $0["status"].string == "completed" }) { return 1 }
  guard !steps.isEmpty else { return 0 }
  let done = steps.reduce(0.0) { sum, step in let record = records.first { $0["step_id"].string == step["id"].string }; return sum + (record?["status"].string == "completed" ? 1 : (record?["messages"].array.contains { $0["role"].string == "user" } == true ? 0.5 : 0)) }
  return min(0.99, done / Double(steps.count))
 }
 public static func validSelection(_ selected: [String], lesson: JSONValue) -> Bool { Set(selected).count == selected.count && selected.count >= lesson["minItems"].int && selected.count <= lesson["maxItems"].int && selected.allSatisfy { value in lesson["options"].array.contains { $0.string == value } } }
 public static func safeExternalURL(_ raw: String) -> URL? { guard let url = URL(string: raw), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else { return nil }; return url }
}
