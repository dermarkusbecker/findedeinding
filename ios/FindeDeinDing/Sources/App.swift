import SwiftUI
import CoachingCore
import UserNotifications

@main struct FindeDeinDingApp: App {
 @StateObject private var store = AppStore()
 @Environment(\.scenePhase) private var phase
 var body: some Scene { WindowGroup { RootView().environmentObject(store).tint(Brand.orange).preferredColorScheme(.light).task { await store.restore() }.onChange(of:phase) { _, value in if value == .active { Task { await store.resume() } } }.overlay { if phase != .active { Brand.navy.ignoresSafeArea().overlay(Image("BrandLogo").resizable().scaledToFit().padding(50)) } } } }
}
@MainActor final class AppStore: ObservableObject {
 @Published var user: JSONValue = .null
 @Published var program: JSONValue = .null
 @Published var curriculum: JSONValue = .null
 @Published var overview: JSONValue = .null
 @Published var invoices: JSONValue = .null
 @Published var loading = true
 @Published var error: String?
 @Published var document: AppDocument?
 var signedIn: Bool { !user.isNull }
 var coaching: Bool { user["coachingActive"].bool }
 func restore() async { defer { loading=false }; await recoverDeletion(); guard await APIClient.shared.credentials() != nil else{return};await resume() }
 func recoverDeletion() async {
  guard let data=Keychain.read("deletion-receipt"),let proof=try? JSONDecoder().decode(JSONValue.self,from:data) else{return}
  do {let result=try await APIClient.shared.call("/api/auth?action=mobile-delete-status",method:"POST",body:["requestId":proof["requestId"].string,"receipt":proof["receipt"].string],authenticated:false);if result["complete"].bool{Keychain.remove("deletion-receipt");error="Deine Kontolöschung ist vollständig abgeschlossen."}else{error="Dein Konto ist gesperrt. Die technische Dateibereinigung wird noch abgeschlossen."}}catch{self.error="Der Status deiner Kontolöschung konnte gerade nicht geladen werden. Bitte später erneut öffnen."}
 }
 func resume() async { guard await APIClient.shared.credentials() != nil else{return};do { try await APIClient.shared.refresh();user=try await APIClient.shared.call("/api/auth?action=mobile-account")["user"];if !user["mustChangePassword"].bool {await reload()} }catch { if (error as? APIError)?.status==401 {await signOut()}else{self.error=error.localizedDescription} } }
 func accept(_ response: JSONValue) async throws { let session=try JSONDecoder().decode(AppSession.self,from:JSONEncoder().encode(response));try await APIClient.shared.set(session);user=response["user"];await reload() }
 func reload() async { guard signedIn,!user["mustChangePassword"].bool else{return};do {overview=try await APIClient.shared.call("/api/customer-records?action=overview");if coaching {program=try await APIClient.shared.call("/api/participant-program?fast=1");if program["processVersion"]["definition"]["weeks"].array.contains(where: {!$0["steps"].array.isEmpty}) {curriculum=try await APIClient.shared.call("/api/participant-program?feature=curriculum")}} }catch{self.error=error.localizedDescription} }
 func loadInvoices() async {do{invoices=try await APIClient.shared.call("/api/leads?action=finance-my-invoices")}catch{self.error=error.localizedDescription} }
 func signOut() async { _ = try? await APIClient.shared.call("/api/auth?action=mobile-logout",method:"POST",body:[:]);await APIClient.shared.clear();user = .null;program = .null;curriculum = .null;overview = .null;invoices = .null;document=nil;clearFiles() }
 func clearFiles() {UNUserNotificationCenter.current().removeAllPendingNotificationRequests();UNUserNotificationCenter.current().removeAllDeliveredNotifications();try? FileManager.default.removeItem(at:FileManager.default.temporaryDirectory.appendingPathComponent("FDDDocuments"))}
 func showDocument(path:String,name:String,method:String="GET",body:[String:Any]?=nil) async {do {let data=try await APIClient.shared.bytes(path,method:method,body:body);let folder=FileManager.default.temporaryDirectory.appendingPathComponent("FDDDocuments");try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true);let safe=URL(fileURLWithPath:name).lastPathComponent;let url=folder.appendingPathComponent(UUID().uuidString+"-"+safe);try data.write(to:url,options:[.atomic,.completeFileProtection]);document=AppDocument(url:url)}catch{self.error=error.localizedDescription} }
}
struct RootView: View {
 @EnvironmentObject var store:AppStore
 var body:some View { Group { if store.loading {ProgressView("Dein Coaching wird geladen …")} else if !store.signedIn {AuthenticationView()} else if store.user["mustChangePassword"].bool {InitialPasswordView()} else {TabView {NavigationStack {HomeView()}.tabItem {Label("Heute",systemImage:"sun.max")};NavigationStack {ProgramView()}.tabItem {Label("Coaching",systemImage:"bubble.left.and.bubble.right")};NavigationStack {LibraryView()}.tabItem {Label("Unterlagen",systemImage:"folder")};NavigationStack {AppointmentsView()}.tabItem {Label("Termine",systemImage:"calendar")};NavigationStack {AccountView()}.tabItem {Label("Profil",systemImage:"person.crop.circle")}}} }.alert("Bitte prüfen",isPresented:Binding(get:{store.error != nil},set:{if !$0 {store.error=nil}})) {Button("OK"){store.error=nil}} message:{Text(store.error ?? "")}.sheet(item:$store.document){DocumentView(document:$0)} }
}
enum Brand {static let navy=Color(red:0.035,green:0.17,blue:0.22);static let orange=Color(red:1,green:0.31,blue:0.015);static let pale=Color(red:0.94,green:0.965,blue:0.97)}
struct Card<Content:View>:View {var title:String;var icon:String;@ViewBuilder var content:Content;var body:some View {VStack(alignment:.leading,spacing:16){Label(title,systemImage:icon).font(.headline).foregroundStyle(Brand.navy);content}.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.background,in:RoundedRectangle(cornerRadius:22)).overlay(RoundedRectangle(cornerRadius:22).stroke(Brand.navy.opacity(0.1))).padding(.horizontal)}}
struct PrimaryButton:View {var title:String;var busy=false;var action:()->Void;var body:some View{Button(action:action){HStack{if busy{ProgressView().tint(.white)};Text(title).font(.headline)}.frame(maxWidth:.infinity).padding(14)}.buttonStyle(.borderedProminent).disabled(busy)}}
struct InlineError:View {let text:String?;var body:some View {if let text=text {Label(text,systemImage:"exclamationmark.circle").foregroundStyle(.red).font(.callout).accessibilityAddTraits(.updatesFrequently)}}}
struct HomeView:View {
 @EnvironmentObject var store:AppStore
 var body:some View {ScrollView {VStack(spacing:20){VStack(alignment:.leading,spacing:14){Image("BrandLogo").resizable().scaledToFit().frame(maxWidth:260).accessibilityLabel("Finde dein Ding");Text("Schön, dass du da bist, \(store.user["name"].string.components(separatedBy:" ").first ?? "")").font(.largeTitle.bold());Text("Dein Weg. Dein Tempo. Mehr Klarheit.").foregroundStyle(.white.opacity(0.85))}.foregroundStyle(.white).padding(26).frame(maxWidth:.infinity,alignment:.leading).background(Brand.navy,in:RoundedRectangle(cornerRadius:26)).padding(.horizontal)
 if !store.coaching {Card(title:"Dein Intake ist angekommen",icon:"checkmark.seal"){Text("Markus prüft deine Angaben und meldet sich bei dir. Sobald dein Coaching vereinbart und freigeschaltet ist, findest du es hier. Dein Zugang allein startet keinen kostenpflichtigen Vertrag.");Button("Status aktualisieren"){Task{await store.resume()}}}}else if !store.program["onboardingComplete"].bool {Card(title:"Bevor wir starten",icon:"hand.wave"){Text("Vervollständige dein Profil und deine persönlichen Vereinbarungen.");NavigationLink("Onboarding starten"){OnboardingView()}.buttonStyle(.borderedProminent)}} else {Card(title:"Dein nächster Schritt",icon:"sparkles"){Text("Woche \(max(1,store.program["access"]["processWeek"].int)) von 8").font(.title2.bold());NavigationLink("Mit Clara weitermachen"){ProgramView()}.buttonStyle(.borderedProminent);Text("Clara ist deine KI-Begleiterin. Markus begleitet die fachlichen Entscheidungen.").font(.footnote).foregroundStyle(.secondary)};Card(title:"Deine Klarheit",icon:"chart.xyaxis.line"){Text(store.program["currentClarity"].isNull ? "Dein erster Check-in wartet auf dich." : "Dein aktueller Stand");ValueTree(value:store.program["currentClarity"]);NavigationLink("Erkenntnisse & Verlauf"){InsightsView()}}}
 Card(title:"Deine Unterlagen",icon:"doc.text"){NavigationLink("Verträge, Rechnungen & Dokumente"){LibraryView()}}
 }.padding(.vertical).frame(maxWidth:780).frame(maxWidth:.infinity)}.background(Brand.pale).navigationTitle("Heute").refreshable{await store.resume()} }
}
