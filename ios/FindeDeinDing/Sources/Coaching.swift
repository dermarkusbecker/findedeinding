import SwiftUI
import CoachingCore
import UniformTypeIdentifiers
import AudioToolbox

struct ProgramView:View {
 @EnvironmentObject var store:AppStore
 var weeks:[JSONValue]{store.curriculum["definition"]["weeks"].array}
 var body:some View {ScrollView{LazyVStack(spacing:16){if !store.coaching {Card(title:"Dein Coaching",icon:"lock"){Text("Nach deinem Intake vereinbarst du dein Coaching mit Markus. Sobald es freigeschaltet ist, geht es hier weiter.")}}else if !store.program["onboardingComplete"].bool {Card(title:"Dein Einstieg",icon:"person.crop.circle.badge.checkmark"){NavigationLink("Onboarding vervollständigen"){OnboardingView()}}}else if weeks.isEmpty {Card(title:"Coaching laden",icon:"arrow.clockwise"){Text("Dein Coachingplan konnte noch nicht geladen werden.");Button("Erneut laden"){Task{await store.reload()}}}}else{ForEach(Array(weeks.enumerated()),id:\.offset){index,week in let number=index+1;let accessible=store.program["access"]["weekStates"].array.contains{$0["week"].int==number && $0["accessible"].bool};let progress=CoachingRules.progress(steps:week["steps"].array,records:store.curriculum["records"].array,week:number);Card(title:"Woche \(number)",icon:accessible ? "sparkles":"lock"){Text(week["title"].string).font(.title3.bold());Text(week["intro"].string).foregroundStyle(.secondary);ProgressView(value:progress).accessibilityLabel("Woche \(number), \(Int(progress*100)) Prozent abgeschlossen");Text("\(Int(progress*100)) % abgeschlossen").font(.caption).monospacedDigit();if accessible {NavigationLink(progress==1 ? "Gespräch ansehen":"Woche öffnen"){WeekView(number:number)}.buttonStyle(.borderedProminent)}else{Text("Wird nach deinem Coachingzeitplan freigeschaltet.").font(.footnote)}}}}}.padding(.vertical)}.background(Brand.pale).navigationTitle("Dein Coaching").refreshable{await store.reload()} }
}
struct WeekView:View {
 @EnvironmentObject var store:AppStore
 let number:Int
 @State private var weekProgram:JSONValue = .null
 @State private var score=5
 @State private var changed=false
 @State private var note=""
 @State private var busy=false
 @State private var error:String?
 var definition:JSONValue{store.curriculum["definition"]["weeks"].array.indices.contains(number-1) ? store.curriculum["definition"]["weeks"].array[number-1] : .null}
 var clarityDone:Bool {number==1 ? weekProgram["weekOne"]["clarity_baseline"]["completed"].bool : weekProgram["weekState"]["clarity_checkin"]["completed"].bool}
 var editable:Bool {CoachingRules.canEdit(week:number,program:store.program)}
 var body:some View {List {Section{Text(definition["title"].string).font(.title2.bold());Text(definition["intro"].string)};if editable && !clarityDone {Section("Klarheits-Check-in"){Text("Wie klar ist dir gerade, was du wirklich willst?");Stepper("\(score) von 10",value:$score,in:1...10);if number>1{Toggle("Seit letzter Woche hat sich etwas verändert",isOn:$changed)};TextField("Was beschäftigt dich? (optional)",text:$note,axis:.vertical);PrimaryButton(title:"Check-in speichern",busy:busy){saveClarity()};InlineError(text:error)}};Section("Deine Themen"){ForEach(Array(definition["steps"].array.enumerated()),id:\.offset){index,step in let records=store.curriculum["records"].array;let complete=records.contains{$0["step_id"].string==step["id"].string && $0["status"].string=="completed"};let prior=definition["steps"].array.prefix(index).allSatisfy{s in s["optional"].bool || records.contains{$0["step_id"].string==s["id"].string && $0["status"].string=="completed"}};NavigationLink{ConversationView(week:number,step:step,canEdit:editable && prior && clarityDone)}label:{Label{VStack(alignment:.leading){Text(step["title"].string);Text(complete ? "Bearbeitet":step["kind"].string=="external" ? "Fachliche Bestätigung durch Markus":prior ? "Dein nächster Schritt":"Vorherige Themen zuerst abschließen").font(.caption).foregroundStyle(.secondary)}}icon:{Image(systemName:complete ? "checkmark.circle.fill":prior ? "bubble.left":"lock")}}}}
 if editable && definition["steps"].array.allSatisfy({s in s["optional"].bool || store.curriculum["records"].array.contains{$0["step_id"].string==s["id"].string && $0["status"].string=="completed"}}) {Section {Button("Woche abschließen"){finalize()}.disabled(busy);Text("Nach dem Abschluss bleibt die Woche als gespeicherte Ansicht erhalten.").font(.footnote)}};Section {NavigationLink("Frage an Markus"){SupportView(week:number)}}}.navigationTitle("Woche \(number)").task{await load()}.refreshable{await load()}}
 func load() async {do{weekProgram=try await APIClient.shared.call("/api/participant-program?week=\(number)")}catch{self.error=error.localizedDescription}}
 func saveClarity(){busy=true;error=nil;Task{defer{busy=false};do{let action:[String:Any]=number==1 ? ["type":"save_clarity","score":score,"reason":note]:["type":"save_clarity_checkin","score":score,"changed":changed,"note":note];_ = try await APIClient.shared.call("/api/participant-program",method:"PATCH",body:["action":number==1 ? "week_1_update":"guided_week_update","week":number,"stepAction":action]);await load();await store.reload()}catch{self.error=error.localizedDescription}}}
 func finalize(){busy=true;Task{defer{busy=false};do{_ = try await APIClient.shared.call("/api/participant-program?feature=curriculum",method:"POST",body:["action":"finalize","week":number]);await store.reload();await load()}catch{self.error=error.localizedDescription}}}
}
struct ConversationView:View {
 @EnvironmentObject var store:AppStore
 @Environment(\.dismiss) var dismiss
 let week:Int,step:JSONValue,canEdit:Bool
 @State private var draft=""
 @State private var pending=""
 @State private var error:String?
 @State private var busy=false
 @State private var selection:[String]=[]
 @State private var scale=1
 @State private var confirmed=false
 @State private var importing=false
 @State private var signals:[String:String]=[:]
 @StateObject private var speech=SpeechInput()
 var record:JSONValue {store.curriculum["records"].array.first{$0["step_id"].string==step["id"].string} ?? .null}
 var draftKey:String {"draft.\(store.user["id"].string).\(step["id"].string)"}
 var editable:Bool {canEdit && step["kind"].string != "external"}
 var needsCV:Bool {step["id"].string=="c44_w1_l4" && store.curriculum["cvDocument"].isNull}
 var body:some View {VStack(spacing:0){HStack(spacing:12){Image("ClaraPortrait").resizable().scaledToFill().frame(width:46,height:46).clipShape(Circle()).accessibilityHidden(true);VStack(alignment:.leading){Text("Clara").font(.headline);Text("Deine KI-Begleiterin").font(.caption).foregroundStyle(.secondary)};Spacer();Button("Später"){saveDraft();dismiss()}.accessibilityLabel("Später weitermachen. Entwurf auf diesem Gerät sichern.")}.padding().background(Brand.pale)
 ScrollViewReader{proxy in ScrollView{LazyVStack(alignment:.leading,spacing:16){Text(step["title"].string).font(.title3.bold());Bubble(text:step["opening"].string,own:false);ForEach(Array(record["messages"].array.enumerated()),id:\.offset){_,m in if ["user","assistant"].contains(m["role"].string){Bubble(text:m["content"].string,own:m["role"].string=="user")}};if !pending.isEmpty {Bubble(text:pending,own:true)};if busy {HStack{ProgressView();Text("Clara arbeitet …")}.font(.callout).accessibilityAddTraits(.updatesFrequently)};if !record["signals"].array.isEmpty{ForEach(Array(record["signals"].array.enumerated()),id:\.offset){_,signal in VStack(alignment:.leading){Text(signal["signal"].string).font(.headline);Picker("Deine Einschätzung",selection:Binding(get:{signals[signal["signal"].string] ?? signal["participant_status"].string},set:{signals[signal["signal"].string]=$0})){ForEach(["offen","bestätigt","abgeschwächt","widersprochen"],id:\.self){Text($0).tag($0)}}.disabled(!editable || busy)}}};Color.clear.frame(height:1).id("latest")}.padding()}.scrollDismissesKeyboard(.interactively).onChange(of:record){_,_ in withAnimation{proxy.scrollTo("latest",anchor:.bottom)}}.onChange(of:busy){_,_ in withAnimation{proxy.scrollTo("latest",anchor:.bottom)}}.onAppear{proxy.scrollTo("latest",anchor:.bottom)}}
 VStack(spacing:10){InlineError(text:error ?? speech.error);if editable {if needsCV {Text("Lade deinen Lebenslauf hoch, damit Clara deinen bisherigen Weg einordnen kann.").font(.callout);Button("Lebenslauf hochladen"){importing=true}.buttonStyle(.borderedProminent)}else{editor;if record["ready"].bool {Button("Das passt · Weiter"){submit("confirm")}.buttonStyle(.borderedProminent)};if step["optional"].bool {Button("Optional überspringen"){submit("skip")}.font(.footnote)}}}else{Text(step["kind"].string=="external" ? "Markus bestätigt dieses Ergebnis nach der fachlichen Prüfung.":"Gespeicherte Ansicht · Bearbeitung derzeit nicht verfügbar").font(.footnote).foregroundStyle(.secondary)}}.padding().background(Brand.pale).disabled(busy)
 }.navigationTitle("Woche \(week)").navigationBarTitleDisplayMode(.inline).task{draft=Keychain.read(draftKey).flatMap{String(data:$0,encoding:.utf8)} ?? "";selection=record["structured_data"]["selection"].array.map(\.string);scale=max(step["min"].int,record["structured_data"]["score"].int)}.onChange(of:draft){_,_ in saveDraft()}.onChange(of:speech.transcript){_,text in if !text.isEmpty{draft=text}}.onDisappear{speech.stop();saveDraft()}.fileImporter(isPresented:$importing,allowedContentTypes:[.pdf,.png,.jpeg,UTType(filenameExtension:"docx")!]){result in upload(result)} }
 @ViewBuilder var editor: some View {
  switch step["kind"].string {
  case "selection", "priority_selection":
   ScrollView {
    VStack(alignment: .leading) {
     Text("Wähle \(step["minItems"].int) bis \(step["maxItems"].int) Einträge.").font(.caption)
     ForEach(step["options"].array.map(\.string), id: \.self) { option in
      Button {
       if selection.contains(option) { selection.removeAll { $0 == option } }
       else if selection.count < step["maxItems"].int { selection.append(option) }
      } label: {
       Label(option, systemImage: selection.contains(option) ? "checkmark.circle.fill" : "circle")
        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
      }
     }
     if step["kind"].string == "priority_selection" {
      ForEach(Array(selection.enumerated()), id: \.offset) { index, item in
       HStack {
        Text("\(index + 1). \(item)")
        Spacer()
        if index > 0 {
         Button { selection.swapAt(index, index - 1) } label: { Image(systemName: "arrow.up") }
          .accessibilityLabel("\(item) nach oben")
        }
       }
      }
     }
    }
   }.frame(maxHeight: 220)
   Button("Auswahl senden") { submit("message") }
    .disabled(!CoachingRules.validSelection(selection, lesson: step))
  case "scale":
   Stepper("Einschätzung: \(scale)", value: $scale, in: step["min"].int...max(step["min"].int, step["max"].int))
   Button("Einschätzung senden") { submit("message") }
  case "confirmation":
   Toggle(step["expected"].string, isOn: $confirmed)
   Button("Bestätigung senden") { submit("message") }.disabled(!confirmed)
  case "upload":
   Button("Datei hochladen · maximal 3 MB") { importing = true }.buttonStyle(.borderedProminent)
  default:
   HStack(alignment: .bottom) {
    TextField("Schreib Clara …", text: $draft, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder)
    Button { speech.isRecording ? speech.stop() : speech.start(existing: draft) } label: {
     Image(systemName: speech.isRecording ? "stop.circle.fill" : "mic.fill").font(.title2).frame(width: 44, height: 44)
    }.accessibilityLabel(speech.isRecording ? "Aufzeichnung beenden" : "Antwort diktieren")
    Button { submit("message") } label: {
     Image(systemName: "arrow.up.circle.fill").font(.largeTitle).frame(width: 44, height: 44)
    }.disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 12000)
     .accessibilityLabel("Nachricht senden")
   }
   Text("Entwurf bleibt auf diesem Gerät. Erst Senden überträgt deine Antwort.").font(.caption2).foregroundStyle(.secondary)
  }
 }
 func saveDraft(){if let data=(pending.isEmpty ? draft : pending).data(using:.utf8){do{try Keychain.save(data,key:draftKey)}catch{self.error="Entwurf konnte nicht auf diesem Gerät gesichert werden."}}}
 func submit(_ action:String,uploadedId:String?=nil){guard !busy else{return};speech.stop();let sent=draft;var body:[String:Any]=["action":action,"week":week,"stepId":step["id"].string,"revision":record["revision"].int,"signalStatuses":signals];if action=="message" {switch step["kind"].string{case "selection","priority_selection":body["input"]=selection;case "scale":body["input"]=scale;case "confirmation":body["input"]=confirmed;case "upload":body["input"]=uploadedId;default:body["content"]=sent;pending=sent;draft=""};AudioServicesPlaySystemSound(1104)};busy=true;error=nil;Task{defer{busy=false;pending=""};do{let result=try await APIClient.shared.call("/api/participant-program?feature=curriculum",method:"POST",body:body);if !result["records"].isNull {var object=store.curriculum.object;object["records"]=result["records"];store.curriculum = .object(object)}else{await store.reload()};if action=="message"{Keychain.remove(draftKey)}else{await store.reload();dismiss()}}catch{draft=sent;self.error=error.localizedDescription}}}
 func upload(_ result:Result<URL,Error>){Task{do{let url=try result.get();let access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}};let values=try url.resourceValues(forKeys:[.fileSizeKey,.contentTypeKey]);guard (values.fileSize ?? 0)<=3*1024*1024 else{throw APIError(message:"Die Datei darf maximal 3 MB groß sein.",status:0)};let data=try Data(contentsOf:url);busy=true;defer{busy=false};let r=try await APIClient.shared.call("/api/participant-program?feature=participant-document",method:"POST",body:["week":week,"documentType":needsCV ? "cv":"workbook","fileName":url.lastPathComponent,"mimeType":values.contentType?.preferredMIMEType ?? "application/octet-stream","contentBase64":data.base64EncodedString()]);let wasCV=needsCV;store.curriculum=try await APIClient.shared.call("/api/participant-program?feature=curriculum");busy=false;if !wasCV {submit("message",uploadedId:r["document"]["id"].string)}}catch{self.error=error.localizedDescription}}}
}
struct Bubble:View {let text:String,own:Bool;var body:some View {HStack{if own{Spacer(minLength:30)};VStack(alignment:.leading,spacing:8){Text(own ? "Du":"Clara").font(.caption.bold()).foregroundStyle(own ? Brand.navy:Color.orange);Text(text).textSelection(.enabled).fixedSize(horizontal:false,vertical:true)}.padding(16).foregroundStyle(own ? Brand.navy:.white).background(own ? Brand.orange.opacity(0.13):Brand.navy,in:RoundedRectangle(cornerRadius:20));if !own{Spacer(minLength:30)}}}}
struct SupportView:View {@EnvironmentObject var store:AppStore;let week:Int;@State private var text="";@State private var busy=false;@State private var sent=false;@State private var error:String?;var body:some View{Form{Section{Text("Deine Frage wird im CRM bei Markus hinterlegt.");TextField("Deine Frage",text:$text,axis:.vertical).lineLimit(5...12)};InlineError(text:error);if sent {Label("Frage gespeichert",systemImage:"checkmark.circle")}else{PrimaryButton(title:"An Markus senden",busy:busy){busy=true;Task{defer{busy=false};do{_ = try await APIClient.shared.call("/api/participant-program",method:"PATCH",body:["action":"support_question","week":week,"question":text]);sent=true}catch{self.error=error.localizedDescription}}}.disabled(text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || text.count>3000)}}.navigationTitle("Frage an Markus")}}
