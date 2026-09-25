import Foundation
import Security
import CoachingCore
struct AppSession: Codable {
 let token: String
 let refreshToken: String
 let user: JSONValue
}
struct APIError: LocalizedError {
 let message: String
 let status: Int
 var errorDescription: String? { message }
}
enum Keychain {
 private static let service = "de.findedeinding.coaching"
 static func save(_ data: Data, key: String) throws {
  let q: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
  SecItemDelete(q as CFDictionary)
  var item=q;item[kSecValueData as String]=data;item[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else { throw APIError(message:"Der geschützte Gerätespeicher ist nicht verfügbar.",status:0) }
 }
 static func read(_ key: String) -> Data? { let q: [String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne];var out: CFTypeRef?;guard SecItemCopyMatching(q as CFDictionary,&out)==errSecSuccess else{return nil};return out as? Data }
 static func remove(_ key: String) { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key] as [String:Any] as CFDictionary) }
 static func clear() { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service] as [String:Any] as CFDictionary) }
}
final class RedirectGuard: NSObject, URLSessionTaskDelegate {
 func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?)->Void) {
  guard request.url?.scheme == "https" else { completionHandler(nil);return }
  var safe=request;if request.url?.host != response.url?.host { safe.setValue(nil,forHTTPHeaderField:"Authorization") };completionHandler(safe)
 }
}
actor APIClient {
 static let shared=APIClient()
 let base=URL(string:"https://findedeinding.vercel.app")!
 private let session: URLSession
 private var auth: AppSession?
 private var refreshTask: Task<AppSession,Error>?
 init() { let c=URLSessionConfiguration.ephemeral;c.httpShouldSetCookies=false;c.urlCache=nil;c.requestCachePolicy = .reloadIgnoringLocalCacheData;c.timeoutIntervalForRequest=60;c.timeoutIntervalForResource=90;session=URLSession(configuration:c,delegate:RedirectGuard(),delegateQueue:nil);if let data=Keychain.read("session") {auth=try? JSONDecoder().decode(AppSession.self,from:data)} }
 func credentials() -> AppSession? {auth}
 func set(_ value: AppSession) throws {try Keychain.save(JSONEncoder().encode(value),key:"session");auth=value}
 func clear() {auth=nil;Keychain.clear()}
 func call(_ path: String, method: String="GET", body: [String:Any]?=nil, authenticated: Bool=true) async throws -> JSONValue {
  let data=try await bytes(path,method:method,body:body,authenticated:authenticated);return try JSONDecoder().decode(JSONValue.self,from:data)
 }
 func bytes(_ path: String, method: String="GET", body: [String:Any]?=nil, authenticated: Bool=true, retried: Bool=false) async throws -> Data {
  guard path.hasPrefix("/api/"),let url=URL(string:path,relativeTo:base)?.absoluteURL,url.host==base.host else{throw APIError(message:"Ungültiger API-Pfad.",status:0)}
  var r=URLRequest(url:url);r.httpMethod=method;r.setValue("application/json",forHTTPHeaderField:"Content-Type");r.setValue("FindeDeinDing-iOS/1",forHTTPHeaderField:"X-FDD-Client")
  if authenticated,let auth=auth {r.setValue("Bearer \(auth.token)",forHTTPHeaderField:"Authorization")};if let body=body{r.httpBody=try JSONSerialization.data(withJSONObject:body)}
  let (data,response)=try await session.data(for:r);let status=(response as? HTTPURLResponse)?.statusCode ?? 0
  if status==401 && authenticated && !retried && auth != nil {try await refresh();return try await bytes(path,method:method,body:body,authenticated:true,retried:true)}
  guard (200..<300).contains(status) else {let value=try? JSONDecoder().decode(JSONValue.self,from:data);throw APIError(message:value?["error"].string.isEmpty==false ? value!["error"].string : "Die Verbindung konnte nicht abgeschlossen werden. Bitte erneut versuchen.",status:status)}
  return data
 }
 func refresh() async throws {
  if let task=refreshTask {try set(await task.value);return}
  guard let current=auth else{throw APIError(message:"Bitte erneut anmelden.",status:401)}
  let task=Task<AppSession,Error>{let data=try await self.bytes("/api/auth?action=mobile-refresh",method:"POST",body:["refreshToken":current.refreshToken],authenticated:false);return try JSONDecoder().decode(AppSession.self,from:data)}
  refreshTask=task;defer{refreshTask=nil};do{try set(await task.value)}catch{if (error as? APIError)?.status==401{clear()};throw error}
 }
}
