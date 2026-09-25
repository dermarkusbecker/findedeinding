import SwiftUI
import CoachingCore
struct OnboardingView:View {
 @EnvironmentObject var store:AppStore
 @State private var fields:[String:String]=[:]
 @State private var birth=Calendar.current.date(byAdding:.year,value:-30,to:Date())!
 @State private var start=Date()
 @State private var date=Date()
 @State private var privacy=false
 @State private var sensitive=false
 @State private var ai=false
 @State private var commitment=false
 @State private var busy=false
 @State private var error:String?
 let profileFields=[("name","Vor- und Nachname"),("street","Straße und Hausnummer"),("postalCode","Postleitzahl"),("city","Ort"),("country","Land"),("mobilePhone","Mobilnummer"),("phone","Telefon (optional)")]
 func binding(_ key:String)->Binding<String>{Binding(get:{fields[key] ?? ""},set:{fields[key]=$0;saveDraft()})}
 var body:some View {Form {Section("1 · Dein Profil"){ForEach(profileFields,id:\.0){key,label in TextField(label,text:binding(key)).textContentType(key=="name" ? .name:nil)};DatePicker("Geburtsdatum",selection:$birth,in:...Date(),displayedComponents:.date);Button("Profil speichern"){perform(["action":"save_onboarding_profile","profile":profile])};if store.program["onboarding"]["profileComplete"].bool{Label("Profil vollständig",systemImage:"checkmark.circle")}}
 Section("2 · Datenschutz & KI"){Text("Clara verarbeitet deine Antworten mit KI, um dich durch dein Coaching zu begleiten. Lies die vollständigen Hinweise, bevor du bestätigst.");Button("Datenschutzvereinbarung als PDF lesen"){Task{await store.showDocument(path:"/api/participant-program?feature=privacy-template",name:"Datenschutzvereinbarung.pdf")}};NavigationLink("Datenschutz der App"){PrivacyView()};if store.program["onboarding"]["privacyConfirmed"].bool {Label("Datenschutzvereinbarung bestätigt",systemImage:"checkmark.circle")}else{Toggle("Ich habe die Datenschutzinformation gelesen.",isOn:$privacy);Toggle("Ich willige in die Verarbeitung freiwillig angegebener sensibler Daten gemäß der Vereinbarung ein.",isOn:$sensitive);Toggle("Ich habe die Hinweise zur KI-gestützten Verarbeitung gelesen.",isOn:$ai);TextField("Ort der Bestätigung",text:binding("place"));DatePicker("Bestätigungsdatum",selection:$date,displayedComponents:.date);Button("Ausgefüllte Vorschau ansehen"){Task{await store.showDocument(path:"/api/participant-program?feature=privacy-preview",name:"Datenschutz-Vorschau.pdf",method:"POST",body:["consent":consent])}};Button("Datenschutz verbindlich bestätigen"){perform(["action":"confirm_privacy","consent":consent])}.disabled(!privacy || !sensitive || !ai)}}
 Section("3 · Dein persönliches Commitment"){if store.program["onboarding"]["commitmentConfirmed"].bool{Label("Commitment bestätigt",systemImage:"checkmark.circle")}else{DatePicker("Dein Startdatum",selection:$start,displayedComponents:.date);TextField("Warum bist du hier?",text:binding("why"),axis:.vertical).lineLimit(3...8);TextField("Was möchtest du verändern?",text:binding("change"),axis:.vertical).lineLimit(3...8);TextField("Was kostet dich weitere Unklarheit?",text:binding("costOfUnclarity"),axis:.vertical).lineLimit(3...8);Toggle("Ich bestätige mein persönliches Commitment verbindlich.",isOn:$commitment);Button("Commitment-Vorschau ansehen"){Task{await store.showDocument(path:"/api/participant-program?feature=commitment-preview",name:"Commitment-Vorschau.pdf",method:"POST",body:["commitment":commitmentData])}};Button("Commitment verbindlich bestätigen"){perform(["action":"confirm_commitment","commitment":commitmentData])}.disabled(!commitment)}}
 Section{InlineError(text:error);PrimaryButton(title:"Coaching starten",busy:busy){perform(["action":"start","profile":profile])}.disabled(!store.program["onboarding"]["profileComplete"].bool || !store.program["onboarding"]["privacyConfirmed"].bool || !store.program["onboarding"]["commitmentConfirmed"].bool);Text("Deine eingegebenen Texte werden als geschützter Entwurf auf diesem Gerät gesichert.").font(.footnote)}
 }.disabled(busy || store.program["onboardingComplete"].bool).navigationTitle("Dein Einstieg").task{for (key,_) in profileFields {fields[key]=store.program["profile"][key].string};fields["place"]=fields["city"];if fields["country"]?.isEmpty != false{fields["country"]="Deutschland"};if let d=Keychain.read(draftKey),let saved=try? JSONDecoder().decode([String:String].self,from:d){fields.merge(saved){_,new in new}};if let d=Self.format.date(from:store.program["profile"]["birthDate"].string){birth=d}}
 }
 var draftKey:String{"onboarding.\(store.user["id"].string)"}
 static let format:DateFormatter={let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="yyyy-MM-dd";return f}()
 var profile:[String:Any]{var p:[String:Any]=fields;p["birthDate"]=Self.format.string(from:birth);return p}
 var consent:[String:Any]{["name":fields["name"] ?? "","place":fields["place"] ?? "","date":Self.format.string(from:date),"privacyNotice":privacy,"specialCategories":sensitive,"aiNotice":ai]}
 var commitmentData:[String:Any]{["name":fields["name"] ?? "","startDate":Self.format.string(from:start),"why":fields["why"] ?? "","change":fields["change"] ?? "","costOfUnclarity":fields["costOfUnclarity"] ?? "","place":fields["place"] ?? "","signatureDate":Self.format.string(from:date),"accepted":commitment]}
 func saveDraft(){if let data=try? JSONEncoder().encode(fields){do{try Keychain.save(data,key:draftKey)}catch{self.error="Der Entwurf konnte nicht gespeichert werden."}}}
 func perform(_ body:[String:Any]){busy=true;error=nil;Task{defer{busy=false};do{_ = try await APIClient.shared.call("/api/participant-program",method:"PATCH",body:body);await store.reload();if store.program["onboardingComplete"].bool{Keychain.remove(draftKey)}}catch{self.error=error.localizedDescription}}}
}
